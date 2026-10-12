import {describe,it,expect} from 'vitest'
import {executeWaitlistCommand} from '../../functions/lib/waitlistCommands.js'
import {projectForRead} from '../../functions/lib/dataProjection.js'
const fakeDb=()=>{
 const records=new Map()
 const ref=path=>({path,id:path.split('/').at(-1),collection:n=>({doc:id=>ref(path+'/'+n+'/'+id)})})
 const db={collection:n=>({doc:id=>ref(n+'/'+id),where:(key,op,value)=>({collection:n,key,value})}),runTransaction:async fn=>{
  const writes=[];let writing=false
  const result=await fn({get:async r=>{if(writing)throw Error('read-after-write');if(typeof r.collection==='string')return {docs:[...records].filter(([p,v])=>p.startsWith(r.collection+'/')&&p.split('/').length===2&&v[r.key]===r.value).map(([p,v])=>({id:p.split('/').at(-1),data:()=>structuredClone(v)}))};return {exists:records.has(r.path),data:()=>structuredClone(records.get(r.path))}},set:(r,d)=>{writing=true;writes.push([r.path,d])},delete:r=>{writing=true;writes.push([r.path,null])}})
  for(const [p,v] of writes){if(v)records.set(p,structuredClone(v));else records.delete(p)}return result
 }}
 return {db,records}
}
describe('private preassign undo state never crosses staff read boundary',()=>{
 it('direct seat, replay and adminPull projection contain no snapshots or guest tokens; undo restores private snapshot',async()=>{
  const {db,records}=fakeDb(),now='2026-10-12T04:00:00.000Z',staff={uid:'A',role:'floor'}
  records.set('waitlist/W1',{id:'W1',takenAt:now,status:'waiting',queueVersion:1,queueNumber:1,name:'Test',phone:'',partySize:3,children:0})
  records.set('tables/T1',{number:'T1',floor:1,capacity:4,status:'vacant'})
  records.set('bookings/PRE',{id:'PRE',date:'2026-10-12',timeSlot:'12:00',status:'confirmed',assignedTableId:'T1',extraTableIds:[],manageToken:'FAKE_SECRET',token:'FAKE_ALIAS',name:'Preassign'})
  const seat={id:'W1',date:'2026-10-12',commandId:'seat_command_1',expectedVersion:1,action:'seat',payload:{tableNumbers:['T1'],confirmedConflictTables:['T1']}}
  const reply=await executeWaitlistCommand({db,staff,command:seat,now})
  expect(JSON.stringify(reply)).not.toMatch(/FAKE_SECRET|FAKE_ALIAS|releasedPreassigns|privateUndo/)
  expect(records.get('waitlist/W1')).not.toHaveProperty('releasedPreassigns')
  expect(records.get('waitlist/W1/commands/seat_command_1').privateUndo.releasedPreassigns[0].manageToken).toBe('FAKE_SECRET')
  expect(JSON.stringify(await executeWaitlistCommand({db,staff,command:seat,now}))).not.toMatch(/FAKE_SECRET|FAKE_ALIAS|releasedPreassigns/)
  // Older persisted documents are sanitized by the same projection used by adminPullData.
  const legacy={...records.get('waitlist/W1'),releasedPreassigns:[records.get('bookings/PRE')],privateUndo:{token:'FAKE_ALIAS'}}
  for(const role of ['manager','floor','host','kitchen'])expect(JSON.stringify(projectForRead('waitlist',legacy,role))).not.toMatch(/FAKE_SECRET|FAKE_ALIAS|releasedPreassigns|privateUndo/)
  const undo={id:'W1',date:'2026-10-12',commandId:'undo_command_1',expectedVersion:2,action:'undo',payload:{seatCommandId:'seat_command_1'}}
  await expect(executeWaitlistCommand({db,staff:{...staff,uid:'B'},command:undo,now})).rejects.toThrow('undo-unavailable')
  const restored=await executeWaitlistCommand({db,staff,command:undo,now:'2026-10-12T04:00:01.000Z'})
  expect(records.get('bookings/PRE')).toMatchObject({assignedTableId:'T1',manageToken:'FAKE_SECRET',token:'FAKE_ALIAS'})
  expect(JSON.stringify(restored)).not.toMatch(/FAKE_SECRET|FAKE_ALIAS|releasedPreassigns|privateUndo/)
 })
})
