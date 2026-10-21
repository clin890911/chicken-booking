import {describe,it,expect} from 'vitest'
import {commitOrdinaryBulk,readOperationalUpdates} from '../../functions/lib/operationalBulk.js'
const fixture=()=>{
 const records=new Map(),writes=[],chunks=[]
 const db={runTransaction:async fn=>{const pending=[];let written=false;const result=await fn({get:async r=>{if(written)throw Error('read-after-write');return {exists:records.has(r.path),data:()=>structuredClone(records.get(r.path))}},set:(r,data)=>{written=true;pending.push([r.path,data])},delete:r=>{written=true;pending.push([r.path,null])}});for(const [p,v] of pending){writes.push(p);if(v)records.set(p,v);else records.delete(p)}if(pending.length)chunks.push(pending.length);return result}}
 return {db,records,writes,chunks}
}
const ordinary=()=>Array.from({length:451},(_,i)=>({ref:{path:i%2?`tables/${i}`:`bookings/B${i}`},data:i%2?{number:String(i),status:'vacant'}:{id:`B${i}`,status:'confirmed',createdBy:'staff'}}))
describe('ordinary >450 write compatibility without waitlist bypass',()=>{
 it('commits 451 ordinary booking/table writes in guarded chunks',async()=>{
  const f=fixture();const written=await commitOrdinaryBulk(f.db,ordinary());expect(f.writes).toHaveLength(451);expect(f.chunks).toEqual([450,1]);f.records.get('bookings/B450').name='committed value';f.records.get('bookings/B450').operationalVersion=3;const ack=await readOperationalUpdates(f.db,ordinary(),'floor');expect(ack.bookingUpdates.length+ack.tableUpdates.length).toBe(451);expect(ack.bookingUpdates.find(b=>b.id==='B450').name).toBe('committed value');expect(written.bookings.B450).toBe(0);expect(ack.bookingUpdates.find(b=>b.id==='B450').operationalVersion).toBe(3)
 })
 it.each(['protected','stale','derived','waitlist'])('preflights %s mixed at final position before committing any ordinary prefix',async mode=>{
  const f=fixture(),ops=ordinary(),last=ops.at(-1)
  if(mode==='protected')f.records.set(last.ref.path,{...last.data,operationalVersion:1,waitlistId:'W1'})
  if(mode==='stale'){last.ref.path='tables/T';last.data={status:'vacant'};f.records.set(last.ref.path,{status:'dining',currentBookingId:'WLB_X',operationalVersion:3})}
  if(mode==='derived')last.data={id:'B450',createdBy:'waitlist'}
  if(mode==='waitlist')last.ref.path='waitlist/W1'
  await expect(commitOrdinaryBulk(f.db,ops)).rejects.toThrow('use-queue-command');expect(f.writes).toHaveLength(0)
 })
})
