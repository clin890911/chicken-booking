// @vitest-environment node
import { beforeAll, beforeEach, afterAll, describe, it, expect } from 'vitest'
import { performance } from 'node:perf_hooks'
import { createWaitlistHandler } from '../../functions/lib/waitlistCommands.js'
import { kickWaitlistSms, sweepSmsOutbox } from '../../functions/lib/smsDispatch.js'
import { connectWaitlistEmulator, resetEmulator, seedEmulator, invokeHandler, testCommand, HOST, PROJECT } from '../support/waitlistEmulator.js'

const enabled = process.env.FIRESTORE_EMULATOR_HOST === HOST && process.env.GCLOUD_PROJECT === PROJECT
const now = '2026-10-12T04:00:00.000Z', day = '2026-10-12'
describe.runIf(enabled)('waitlist real Firestore transactions, isolated demo project', () => {
  let env, handler
  const makeHandler=()=>createWaitlistHandler({ db: env.measured, now: () => now, requireStaff: async req => {
    if (req.headers.authorization !== 'Bearer isolated-test-token') throw Object.assign(Error('unauthorized'), { status: 401 })
    return { uid: req.headers.actor || 'TEST_STAFF', role: req.headers.role || 'floor' }
  }, afterCommit: async () => {} })
  beforeAll(() => {
    env = connectWaitlistEmulator()
    handler = makeHandler()
  })
  afterAll(async () => { await env?.close() })
  beforeEach(async () => { await resetEmulator(); await seedEmulator(env.db, day); env.metrics.transactions = 0; env.metrics.attempts = 0 })
  const create = id => testCommand('create', id, 0, { name: `測試${id}`, partySize: 4, phone: '', children: 0 }, day)
  const call = body => invokeHandler(handler, body)

  it.each([1,3])('%i independent handler factory/ies: 100 simultaneous creates stay unique; replay/lost ACK writes no second number', async (factoryCount) => {
    const factories=Array.from({length:factoryCount},makeHandler)
    const commands = Array.from({ length: 100 }, (_, i) => create(`BURST_${i}`))
    const durations = [], start = performance.now()
    const responses = await Promise.all(commands.map(async (command,index) => { const t = performance.now(); const result = await invokeHandler(factories[index%factoryCount],command); durations.push(performance.now() - t); return result }))
    durations.sort((a,b)=>a-b)
    console.info('LOCAL_EMULATOR_BURST', JSON.stringify({ requests:100, factoryCount, failed:responses.filter(r=>r.code!==200).length, totalMs:Math.round(performance.now()-start), p95Ms:Math.round(durations[94]), ...env.metrics }))
    expect(responses.map(r => ({ code: r.code, error: r.body?.error })).filter(r => r.code !== 200)).toEqual([])
    expect(responses.map(r => r.body.item.queueNumber).sort((a,b) => a-b)).toEqual(Array.from({length:100},(_,i)=>i+1))
    if(factoryCount===3)expect(env.metrics.attempts).toBeGreaterThan(env.metrics.transactions)
    const counterBefore = (await env.db.collection('waitlistCounters').doc(day).get()).data()
    const replay = await call(commands[0]) // First successful HTTP response intentionally discarded: same command is retried.
    expect(replay.body.replayed).toBe(true)
    expect((await env.db.collection('waitlistCounters').doc(day).get()).data()).toEqual(counterBefore)
    expect((await env.db.collection('waitlist').get()).size).toBe(100)
  }, 180000)
  it('warm daily counter: 3 / 10 / 50 create burst baseline',async()=>{
    for(const [count,factoryCount] of [[3,1],[10,1],[50,1],[3,3],[50,3]]){
      await resetEmulator();await seedEmulator(env.db,day)
      await env.db.collection('waitlistCounters').doc(day).set({lastNumber:0,updatedAt:now})
      env.metrics.attempts=0;env.metrics.transactions=0
      const factories=Array.from({length:factoryCount},makeHandler)
      const durations=[],start=performance.now()
      const results=await Promise.all(Array.from({length:count},(_,i)=>{const t=performance.now();return invokeHandler(factories[i%factoryCount],create(`WARM_${i}`)).then(r=>{durations.push(performance.now()-t);return r})}))
      expect(results.filter(r=>r.code!==200)).toEqual([])
      durations.sort((a,b)=>a-b)
      console.info('LOCAL_EMULATOR_WARM',JSON.stringify({count,factoryCount,totalMs:Math.round(performance.now()-start),p95Ms:Math.round(durations[Math.ceil(count*.95)-1]),...env.metrics}))
    }
  },180000)

  it('same record/version simultaneous call vs leave has one winner; stale update cannot overwrite', async () => {
    const created = await call(create('SAME'))
    const results = await Promise.all(['call','leave'].map(action => call(testCommand(action,'SAME',created.body.item.queueVersion,{},day))))
    expect(results.map(r=>r.code).sort()).toEqual([200,409])
    expect((await env.db.collection('waitlist').doc('SAME').get()).data().queueVersion).toBe(2)
  })
  it('different groups race for the same table: exactly one atomic seat, no orphan booking', async () => {
    await Promise.all(['A','B'].map(id => call(create(id))))
    const results = await Promise.all(['A','B'].map(id => call(testCommand('seat',id,1,{tableNumbers:['101']},day))))
    expect(results.map(r=>r.code).sort()).toEqual([200,409])
    expect((await env.db.collection('bookings').get()).size).toBe(1)
    const table = (await env.db.collection('tables').doc('101').get()).data()
    expect(table.status).toBe('dining')
    expect((await env.db.collection('bookings').doc(table.currentBookingId).get()).exists).toBe(true)
    expect((await env.db.collection('waitlist').get()).docs.filter(d=>d.data().status==='seated')).toHaveLength(1)
  }, 30000)
  it('authentication, kitchen permission, and stale business day reject without writes', async () => {
    expect((await invokeHandler(handler,create('NO_AUTH'),{})).code).toBe(401)
    expect((await invokeHandler(handler,create('KITCHEN'),{authorization:'Bearer isolated-test-token',role:'kitchen'})).code).toBe(403)
    expect((await call({...create('YESTERDAY'),date:'2026-10-11'})).code).toBe(409)
    expect((await env.db.collection('waitlist').get()).empty).toBe(true)
  })
  it('legacy missing counter initializes concurrently from max existing number, including gaps; deleted highest never reuses counter', async () => {
    await env.db.collection('waitlist').doc('LEGACY').set({id:'LEGACY',queueNumber:87,takenAt:now,status:'left',queueVersion:0})
    await env.db.collection('waitlist').doc('OLD_DAY').set({id:'OLD_DAY',queueNumber:900,takenAt:'2026-10-11T04:00:00Z',status:'left'})
    const factories=Array.from({length:3},makeHandler)
    const results=await Promise.all(Array.from({length:10},(_,i)=>invokeHandler(factories[i%3],create(`INIT_${i}`))))
    expect(results.filter(r=>r.code!==200)).toEqual([])
    expect(results.map(r=>r.body.item.queueNumber).sort((a,b)=>a-b)).toEqual(Array.from({length:10},(_,i)=>88+i))
    const highest=results.find(r=>r.body.item.queueNumber===97).body.item
    await env.db.collection('waitlist').doc(highest.id).delete()
    expect((await call(create('AFTER_DELETE'))).body.item.queueNumber).toBe(98)
    expect(env.metrics.attempts).toBeGreaterThan(env.metrics.transactions)
  },60000)
  it('changed body/actor cannot hijack a saved command receipt; afterCommit failure does not erase committed result',async()=>{
    const command=create('REPLAY_OWNER');expect((await call(command)).code).toBe(200)
    expect((await call({...command,payload:{...command.payload,name:'changed'}})).code).toBe(409)
    expect((await invokeHandler(handler,command,{authorization:'Bearer isolated-test-token',actor:'OTHER_STAFF'})).code).toBe(403)
    const failingNotify=createWaitlistHandler({db:env.measured,now:()=>now,requireStaff:async()=>({uid:'TEST_STAFF',role:'floor'}),afterCommit:async()=>{throw Error('isolated-provider-unavailable')}})
    expect((await invokeHandler(failingNotify,create('NOTIFY_FAIL'))).code).toBe(200)
    expect((await env.db.collection('waitlist').get()).size).toBe(2)
  })
  it('call with mobile commits smsOutbox atomically in the same transaction; replay/lost ACK never rewrites it',async()=>{
    const created=await call(testCommand('create','SMS_CALL',0,{name:'簡訊',partySize:2,phone:'0912345678',children:0},day))
    expect(created.code).toBe(200)
    const callCmd=testCommand('call','SMS_CALL',created.body.item.queueVersion,{},day)
    const first=await call(callCmd)
    expect(first.code).toBe(200)
    const box=await env.db.collection('smsOutbox').get()
    expect(box.size).toBe(1)
    expect(box.docs[0].data()).toMatchObject({kind:'waitlist-call',waitlistId:'SMS_CALL',commandId:callCmd.commandId,to:'0912345678',status:'pending',calledAt:first.body.item.calledAt})
    expect((await env.db.collection('waitlist').doc('SMS_CALL').get()).data()).toMatchObject({status:'called',queueVersion:2})
    await box.docs[0].ref.update({status:'sent'}) // dispatcher already delivered it
    const replay=await call(callCmd) // first HTTP response lost; same command retried
    expect(replay.body.replayed).toBe(true)
    const after=await env.db.collection('smsOutbox').get()
    expect(after.size).toBe(1)
    expect(after.docs[0].data().status).toBe('sent')
  })
  it('landline call and concurrent call/leave race write no stray smsOutbox',async()=>{
    const land=await call(testCommand('create','SMS_LAND',0,{name:'市話',partySize:2,phone:'0492753377',children:0},day))
    expect((await call(testCommand('call','SMS_LAND',land.body.item.queueVersion,{},day))).code).toBe(200)
    const mob=await call(testCommand('create','SMS_RACE',0,{name:'競爭',partySize:2,phone:'0912345678',children:0},day))
    const results=await Promise.all(['call','leave'].map(action=>call(testCommand(action,'SMS_RACE',mob.body.item.queueVersion,{},day))))
    expect(results.map(r=>r.code).sort()).toEqual([200,409])
    const status=(await env.db.collection('waitlist').doc('SMS_RACE').get()).data().status
    const box=(await env.db.collection('smsOutbox').get()).docs.map(d=>d.data().waitlistId)
    expect(box).toEqual(status==='called'?['SMS_RACE']:[])
  })
  it('dispatcher on real Firestore: disabled→skipped, dryRun kick→dry-run without HTTP, smsStatus written without queueVersion bump, expired lease→unknown',async()=>{
    const fetchImpl=async()=>{throw Error('network forbidden in emulator test')}
    const deps={fetchImpl,credentials:null,alert:async()=>{},clock:()=>Date.parse(now)+2000}
    const mk=async id=>{const c=await call(testCommand('create',id,0,{name:id,partySize:2,phone:'0912345678',children:0},day));return call(testCommand('call',id,c.body.item.queueVersion,{},day))}
    await mk('SMS_OFF')
    expect((await kickWaitlistSms({db:env.db,waitlistId:'SMS_OFF',...deps})).map(r=>r.status)).toEqual(['skipped-disabled'])
    expect((await env.db.collection('waitlist').doc('SMS_OFF').get()).data()).not.toHaveProperty('smsStatus')
    await env.db.collection('system').doc('smsConfig').set({enabled:true,dryRun:true})
    await mk('SMS_DRY')
    expect((await kickWaitlistSms({db:env.db,waitlistId:'SMS_DRY',...deps})).map(r=>r.status)).toEqual(['dry-run'])
    const w=(await env.db.collection('waitlist').doc('SMS_DRY').get()).data()
    expect(w).toMatchObject({status:'called',queueVersion:2,smsStatus:{state:'dry-run'}})
    // smsStatus 回寫後，同一裝置用原本的 queueVersion 繼續操作不會被 waitlist-changed 擋
    expect((await call(testCommand('leave','SMS_DRY',2,{},day))).code).toBe(200)
    await mk('SMS_LEASE')
    const box=(await env.db.collection('smsOutbox').where('waitlistId','==','SMS_LEASE').get()).docs[0]
    await box.ref.update({status:'processing',claimToken:'t',leaseUntil:new Date(Date.parse(now)-1).toISOString()})
    const swept=await sweepSmsOutbox({db:env.db,...deps})
    expect(swept.find(r=>r.id===box.id).status).toBe('unknown')
    expect((await box.ref.get()).data().status).toBe('unknown')
  })
  it('dispatcher 併發（真 Firestore）：kick／sweeper／kick 同時撿同一筆 → 每個門號只實送 1 次；kick 與離開同時 → 欄位不被蓋回',async()=>{
    await env.db.collection('system').doc('smsConfig').set({enabled:true,dryRun:false})
    const sends=new Map()
    const fetchImpl=async(_url,init)=>{
      const to=new URLSearchParams(init.body).get('DEST')
      sends.set(to,(sends.get(to)||0)+1)
      await new Promise(r=>setTimeout(r,100))
      return {ok:true,status:200,text:async()=>'100,1,1,0,BATCH'}
    }
    const deps={fetchImpl,credentials:{uid:'u',pwd:'p'},alert:async()=>{},clock:()=>Date.parse(now)+2000}
    const mk=async(id,phone)=>{const c=await call(testCommand('create',id,0,{name:id,partySize:2,phone,children:0},day));return call(testCommand('call',id,c.body.item.queueVersion,{},day))}
    for(let i=0;i<6;i++){
      const id=`SMS_RACE_${i}`
      await mk(id,`09123456${String(10+i)}`)
      await Promise.all([kickWaitlistSms({db:env.db,waitlistId:id,...deps}),sweepSmsOutbox({db:env.db,...deps}),kickWaitlistSms({db:env.db,waitlistId:id,...deps})])
    }
    expect([...sends.values()]).toEqual(Array(6).fill(1)) // 0 次重複實送
    expect((await env.db.collection('smsOutbox').get()).docs.map(d=>d.data().status)).toEqual(Array(6).fill('sent'))
    await env.db.collection('system').doc('smsConfig').set({enabled:true,dryRun:true})
    for(let i=0;i<5;i++){
      const id=`SMS_CLOB_${i}`
      const called=await mk(id,`09987654${String(10+i)}`)
      const [,leave]=await Promise.allSettled([kickWaitlistSms({db:env.db,waitlistId:id,...deps}),call(testCommand('leave',id,called.body.item.queueVersion,{},day))])
      expect(leave.value.code).toBe(200)
      expect((await env.db.collection('waitlist').doc(id).get()).data()).toMatchObject({status:'left',queueVersion:3})
    }
  },60000)
  it('released group batch at same table/time no longer holds a vacant table; no override consent required',async()=>{
    await env.db.collection('groupReservations').doc('RELEASED_GROUP').set({id:'RELEASED_GROUP',date:day,status:'confirmed',batches:[{id:'BATCH',tableNumbers:['101'],timeSlot:'12:00',releasedAt:now}]})
    expect((await call(create('RELEASED_SEAT'))).code).toBe(200)
    const result=await call(testCommand('seat','RELEASED_SEAT',1,{tableNumbers:['101']},day))
    expect({code:result.code,error:result.body?.error}).toEqual({code:200,error:undefined})
    expect(result.body.item.status).toBe('seated')
  })
})
