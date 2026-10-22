// @vitest-environment node
import {describe,it,expect,vi,afterEach} from 'vitest'
import {executeWaitlistCommand,createWaitlistHandler} from '../../functions/lib/waitlistCommands.js'
import {customerUpdateIntent,processCustomerUpdateIntent,reconcileCustomerUpdateIntents} from '../../functions/lib/waitlistCustomers.js'

function memoryDb(){
  const records=new Map()
  const snapshot=path=>({exists:records.has(path),data:()=>structuredClone(records.get(path))})
  const ref=path=>({path,id:path.split('/').at(-1),get:async()=>snapshot(path),collection:n=>collection(path+'/'+n)})
  const collection=(path,key,value,limit=Infinity)=>({path,doc:id=>ref(path+'/'+id),where:(k,op,v)=>collection(path,k,v),limit:n=>collection(path,key,value,n),get:async()=>query(path,key,value,limit)})
  const query=(path,key,value,limit)=>({docs:[...records].filter(([p,v])=>p.startsWith(path+'/')&&p.split('/').length===path.split('/').length+1&&(!key||v[key]===value)).slice(0,limit).map(([p,v])=>({id:p.split('/').at(-1),data:()=>structuredClone(v)}))})
  let tail=Promise.resolve()
  const db={collection,runTransaction:fn=>{
    const run=tail.then(async()=>{
      const writes=[];let writing=false
      const result=await fn({get:async r=>{if(writing)throw Error('read-after-write');return r.get()},set:(r,v)=>{writing=true;writes.push([r.path,v])},delete:r=>{writing=true;writes.push([r.path,null])}})
      for(const [p,v] of writes){if(v)records.set(p,structuredClone(v));else records.delete(p)}return result
    });tail=run.catch(()=>{});return run
  }}
  return {db,records}
}
const now='2026-10-12T04:00:00.000Z',day='2026-10-12',staff={uid:'A',role:'floor'}
const command=(action,id,expectedVersion,payload={},commandId=`${action}_${id}_command`)=>({action,id,expectedVersion,payload,commandId,date:day})
const invoke=async(handler,body)=>{const res={code:200,status(code){this.code=code;return this},json(body){this.body=body;return this}};await handler({method:'POST',body},res);return res}
const run=(db,c,time=now)=>executeWaitlistCommand({db,staff,command:c,now:time})
function setup(){const env=memoryDb();for(const id of ['W1','W2'])env.records.set(`waitlist/${id}`,{id,takenAt:now,status:'waiting',queueVersion:1,queueNumber:1,name:'Test',phone:'',partySize:3,children:0});for(const n of ['T1','T2'])env.records.set(`tables/${n}`,{number:n,floor:1,capacity:4,status:'vacant'});env.records.set('bookings/PRE',{id:'PRE',date:day,timeSlot:'12:00',status:'confirmed',assignedTableId:'T1',extraTableIds:['T2']});return env}
const seat1=command('seat','W1',1,{tableNumbers:['T1'],confirmedConflictTables:['T1']})
const undo1=command('undo','W1',2,{seatCommandId:seat1.commandId})

describe('undo rechecks every original preassigned table',()=>{
 it('rejects original extra table taken by another waitlist; leaves all state unchanged',async()=>{
   const {db,records}=setup();await run(db,seat1);await run(db,command('seat','W2',1,{tableNumbers:['T2']}),'2026-10-12T04:00:01.000Z')
   const before=structuredClone(records)
   await expect(run(db,undo1,'2026-10-12T04:00:02.000Z')).rejects.toThrow('undo-preassign-table-taken')
   expect(records).toEqual(before)
 })
 it.each(['booking','group','missing','blocked'])('rejects %s appearing on original extra table after release',async kind=>{
   const {db,records}=setup();await run(db,seat1)
   if(kind==='booking')records.set('bookings/OTHER',{id:'OTHER',date:day,timeSlot:'12:00',status:'confirmed',assignedTableId:'T2'})
   if(kind==='group')records.set('groupReservations/G',{id:'G',date:day,status:'confirmed',batches:[{tableNumbers:['T2'],timeSlot:'12:00'}]})
   if(kind==='missing')records.delete('tables/T2')
   if(kind==='blocked')records.set('tables/T2',{...records.get('tables/T2'),status:'blocked'})
   await expect(run(db,undo1,'2026-10-12T04:00:02.000Z')).rejects.toThrow('undo-preassign-table-taken')
 })
 it('allows a later non-overlapping reservation and restores all original tables',async()=>{
   const {db,records}=setup();await run(db,seat1)
   records.set('bookings/LATER',{id:'LATER',date:day,timeSlot:'20:00',status:'confirmed',assignedTableId:'T2'})
   records.set('tables/T2',{...records.get('tables/T2'),status:'reserved',currentBookingId:'LATER'})
   await run(db,undo1,'2026-10-12T04:00:02.000Z')
   expect(records.get('bookings/PRE')).toMatchObject({assignedTableId:'T1',extraTableIds:['T2']})
   expect(records.get('tables/T2').currentBookingId).toBe('LATER')
 })
})

describe('FIFO retains actual unfinished transaction slots',()=>{
 afterEach(()=>vi.useRealTimers())
 it('HTTP timeout does not free maxQueue capacity until transaction settles',async()=>{
   vi.useFakeTimers();let finish,transactions=0
   const db={collection:()=>({doc:()=>({collection:()=>({doc:()=>({get:async()=>({exists:false})})})})}),runTransaction:()=>{transactions++;return new Promise(resolve=>{finish=resolve})}}
   const handler=createWaitlistHandler({db,requireStaff:async()=>staff,now:()=>now,maxQueue:1})
   const first=invoke(handler,command('create','NEW',0,{name:'Test',partySize:3}));await vi.advanceTimersByTimeAsync(20001)
   expect((await first).code).toBe(503)
   expect((await invoke(handler,command('create','NEW2',0,{name:'Test',partySize:3}))).code).toBe(503)
   expect(transactions).toBe(1)
   finish({ok:true,item:{phone:''}});await vi.advanceTimersByTimeAsync(1)
   const third=invoke(handler,command('create','NEW3',0,{name:'Test',partySize:3}));await vi.advanceTimersByTimeAsync(1);expect(transactions).toBe(2)
   finish({ok:true,item:{phone:''}});expect((await third).code).toBe(200)
 })
 it('expired queued requests never start after an earlier transaction finally ends',async()=>{
   vi.useFakeTimers();let finish,transactions=0
   const db={collection:()=>({doc:()=>({collection:()=>({doc:()=>({get:async()=>({exists:false})})})})}),runTransaction:()=>{transactions++;return new Promise(resolve=>{finish=resolve})}}
   const handler=createWaitlistHandler({db,requireStaff:async()=>staff,now:()=>now,maxQueue:2})
   const first=invoke(handler,command('create','NEW',0)),second=invoke(handler,command('create','NEW2',0))
   await vi.advanceTimersByTimeAsync(20001);expect((await first).code).toBe(503);expect((await second).code).toBe(503)
   finish({ok:true,item:{phone:''}});await vi.advanceTimersByTimeAsync(1);expect(transactions).toBe(1)
 })
})

describe('durable idempotent waitlist customer updates',()=>{
 const create=command('create','NEW',0,{name:'Customer',phone:'(0900) 000-001',partySize:3})
 it('create and seat preserve legacy visit counts; replay and competing workers never double count',async()=>{
   const {db,records}=memoryDb();records.set('tables/T1',{number:'T1',floor:1,capacity:4,status:'vacant'})
   const handler=createWaitlistHandler({db,requireStaff:async()=>staff,now:()=>now})
   expect((await invoke(handler,create)).code).toBe(200)
   expect(records.get('customers/0900000001')).toMatchObject({name:'Customer',visits:1,totalGuests:3})
   expect((await invoke(handler,create)).body.replayed).toBe(true)
   expect((await invoke(handler,command('seat','NEW',1,{tableNumbers:['T1']}))).code).toBe(200)
   expect(records.get('customers/0900000001')).toMatchObject({visits:2,totalGuests:6})
   const id=customerUpdateIntent({item:{phone:'0900000001'},command:create,now}).id
   await Promise.all(Array.from({length:3},()=>processCustomerUpdateIntent({db,id})))
   expect(records.get('customers/0900000001').visits).toBe(2)
 })
 it('CRM outage leaves successful seat plus pending intent; bounded scheduled recovery updates once',async()=>{
   const {db,records}=setup();records.get('waitlist/W1').phone='0900000001'
   const base=db.runTransaction;db.runTransaction=fn=>base(tx=>fn({...tx,get:r=>{if(r.path.startsWith('customerUpdateIntents/'))throw Error('isolated CRM failure');return tx.get(r)}}))
   const handler=createWaitlistHandler({db,requireStaff:async()=>staff,now:()=>now})
   expect((await invoke(handler,seat1)).code).toBe(200)
   expect(records.get('waitlist/W1').status).toBe('seated')
   expect([...records.values()].some(v=>v.status==='pending'&&v.phone==='0900000001')).toBe(true)
   db.runTransaction=base
   await reconcileCustomerUpdateIntents({db,limit:1});await reconcileCustomerUpdateIntents({db,limit:1})
   expect(records.get('customers/0900000001')).toMatchObject({visits:1,totalGuests:3})
 })
 it('a stalled CRM transaction cannot hold the successful queue HTTP response',async()=>{
   vi.useFakeTimers()
   try{
     const {db,records}=setup();records.get('waitlist/W1').phone='0900000001'
     const base=db.runTransaction;db.runTransaction=fn=>base(tx=>fn({...tx,get:r=>r.path.startsWith('customerUpdateIntents/')?new Promise(()=>{}):tx.get(r)}))
     const handler=createWaitlistHandler({db,requireStaff:async()=>staff,now:()=>now})
     const response=invoke(handler,seat1)
     await vi.advanceTimersByTimeAsync(2001)
     expect((await response).code).toBe(200)
     expect(records.get('waitlist/W1').status).toBe('seated')
     expect([...records.values()].some(v=>v.status==='pending'&&v.phone==='0900000001')).toBe(true)
   }finally{vi.useRealTimers()}
 })
 it('a failing pending intent does not block the remaining batch; placeholders preserve names and profile fields',async()=>{
   const {db,records}=memoryDb()
   records.set('customers/0900000001',{phone:'0900000001',name:'Real Name',visits:4,totalGuests:10,blacklisted:true,notes:'Keep',lastVisit:'2026-10-11T00:00:00Z'})
   records.set('customerUpdateIntents/BAD',{status:'pending'})
   const intent=customerUpdateIntent({item:{phone:'0900000001',name:'訪客',partySize:3},command:create,now});records.set('customerUpdateIntents/'+intent.id,intent)
   const base=db.runTransaction;db.runTransaction=fn=>base(tx=>fn({...tx,get:r=>{if(r.path==='customerUpdateIntents/BAD')throw Error('bad intent');return tx.get(r)}}))
   await reconcileCustomerUpdateIntents({db})
   expect(records.get('customers/0900000001')).toMatchObject({name:'Real Name',visits:5,totalGuests:13,blacklisted:true,notes:'Keep',lastVisit:now})
   expect(records.get('customerUpdateIntents/BAD').status).toBe('pending')
 })
 it('late replay of an older intent cannot move lastVisit or a newer name backward',async()=>{
   const {db,records}=memoryDb();records.set('customers/0900000001',{name:'Newer',visits:2,totalGuests:6,lastVisit:'2026-10-13T00:00:00Z'})
   const intent=customerUpdateIntent({item:{phone:'0900000001',name:'Older',partySize:3},command:create,now});records.set('customerUpdateIntents/'+intent.id,intent)
   await processCustomerUpdateIntent({db,id:intent.id})
   expect(records.get('customers/0900000001')).toMatchObject({name:'Newer',visits:3,lastVisit:'2026-10-13T00:00:00Z'})
 })
})
