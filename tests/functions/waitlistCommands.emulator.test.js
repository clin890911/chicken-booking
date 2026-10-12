// @vitest-environment node
import { beforeAll, beforeEach, afterAll, describe, it, expect } from 'vitest'
import { performance } from 'node:perf_hooks'
import { createWaitlistHandler } from '../../functions/lib/waitlistCommands.js'
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
  it('released group batch at same table/time no longer holds a vacant table; no override consent required',async()=>{
    await env.db.collection('groupReservations').doc('RELEASED_GROUP').set({id:'RELEASED_GROUP',date:day,status:'confirmed',batches:[{id:'BATCH',tableNumbers:['101'],timeSlot:'12:00',releasedAt:now}]})
    expect((await call(create('RELEASED_SEAT'))).code).toBe(200)
    const result=await call(testCommand('seat','RELEASED_SEAT',1,{tableNumbers:['101']},day))
    expect({code:result.code,error:result.body?.error}).toEqual({code:200,error:undefined})
    expect(result.body.item.status).toBe('seated')
  })
})
