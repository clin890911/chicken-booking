const fail=()=>{throw Object.assign(Error('operational-state-changed'),{status:409})}
const equal=(a,b)=>JSON.stringify(a??null)===JSON.stringify(b??null)
// Merge layout edits while fencing stale occupancy snapshots. Versions are server-owned.
export function guardOperationalSync(op,current){
  const kind=op.ref.path.split('/')[0],item=op.data||{}
  if(kind==='bookings'&&!current&&(item.createdBy==='waitlist'||item.waitlistId||item.waitlistCommandId))fail()
  if(!current?.operationalVersion){const {operationalVersion,waitlistId,waitlistCommandId,...data}=item;return {...op,data}}
  if(op.delete){
    if(kind==='tables'&&current.status==='vacant'&&!current.currentBookingId&&!current.currentRef)return op
    if(kind==='bookings'&&['cancelled','completed','noshow'].includes(current.status))return op
    fail()
  }
  const keys=kind==='tables'?['status','currentBookingId','currentRef','seatedAt','waitlistId']:kind==='bookings'?['status','assignedTableId','extraTableIds','actualArrivalTime']:[]
  const changed=keys.some(k=>Object.hasOwn(item,k)&&!equal(item[k],current[k]))
  if(changed&&item.operationalVersion!==current.operationalVersion)fail()
  const data={...item,operationalVersion:current.operationalVersion+(changed?1:0)}
  if(kind==='bookings')for(const k of ['waitlistId','waitlistCommandId'])data[k]=current[k]||null
  if(!changed)for(const k of keys)data[k]=current[k]??null
  return {...op,data}
}
