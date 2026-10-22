import { isTableUsableOnDate } from './tableUsable.js'
const tableIds=b=>[b?.assignedTableId,...(b?.extraTableIds||[])].filter(Boolean).map(String)
const active=b=>!['cancelled','completed','noshow'].includes(b.status)
const at=(date,time)=>Date.parse(`${date}T${time}:00+08:00`)
const overlaps=(a,b)=>a.start<b.end&&b.start<a.end
const fail=()=>{throw Object.assign(Error('undo-preassign-table-taken'),{status:409})}

// Check every original table, including tables not selected for this seating.
// Reads are part of the undo transaction, so another seat/assignment conflicts
// with the commit rather than allowing two groups to claim the same table.
export async function assertRestorablePreassigns({db,tx,restore,removedBooking,now,day}){
  if(!restore.length)return
  const ids=[...new Set(restore.flatMap(tableIds))]
  const [snapshots,books,groups,settingsSnap]=await Promise.all([
    Promise.all(ids.map(id=>tx.get(db.collection('tables').doc(id)))),
    tx.get(db.collection('bookings').where('date','==',day)),
    tx.get(db.collection('groupReservations').where('date','==',day)),
    tx.get(db.collection('settings').doc('main')),
  ])
  const settings=settingsSnap.exists?settingsSnap.data():{},buffer=(Number(settings.cleanupBufferMin)||10)*60000
  const duration=((Number(settings.diningDurationMin)||90)+(Number(settings.cleanupBufferMin)||10))*60000
  const currentMs=Date.parse(now),tableMap=new Map(ids.map((id,i)=>[id,snapshots[i].exists?snapshots[i].data():null]))
  const otherBooks=books.docs.map(s=>s.data()).filter(b=>active(b)&&b.id!==removedBooking.id&&!restore.some(r=>r.id===b.id))
  const window=b=>({start:at(b.date,b.timeSlot),end:at(b.date,b.timeSlot)+duration})
  for(const old of restore){
    const wanted=window(old)
    if(!Number.isFinite(wanted.start))fail()
    for(const id of tableIds(old)){
      const t=tableMap.get(id)
      if(!t||!isTableUsableOnDate(t,day))fail()
      if(otherBooks.some(b=>tableIds(b).includes(id)&&overlaps(wanted,window(b))))fail()
      if(groups.docs.some(s=>{const g=s.data();return active(g)&&(g.batches||[]).some(batch=>!batch.releasedAt&&(batch.tableNumbers||[]).map(String).includes(id)&&overlaps(wanted,{start:at(day,batch.timeSlot),end:at(day,batch.timeSlot)+duration}))}))fail()
      if(t.status==='vacant'&&!t.currentBookingId&&!t.currentRef)continue
      if((t.currentBookingId===removedBooking.id||(t.status==='reserved'&&t.currentBookingId===old.id))&&!t.currentRef)continue
      const holder=otherBooks.find(b=>b.id===t.currentBookingId)
      const occupied=t.status==='reserved'&&holder?window(holder):{
        start:currentMs,
        end:t.status==='blocked'?at(day,'23:59')+60000:t.status==='cleaning'?currentMs+buffer:Math.max((Date.parse(t.seatedAt)||currentMs)+duration,currentMs+buffer),
      }
      if(overlaps(wanted,occupied))fail()
    }
  }
}
