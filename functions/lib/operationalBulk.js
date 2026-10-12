import { guardOperationalSync } from './waitlistSyncGuard.js'
import { projectForRead } from './dataProjection.js'
const guardedKind=op=>['bookings','tables'].includes(op.ref.path.split('/')[0])
const reject=()=>{throw Object.assign(Error('use-queue-command'),{status:409})}
// Ordinary legacy bulk sync retains chunk semantics. Candidate waitlist-derived or
// protected records are rejected across the entire request before the first write.
export async function commitOrdinaryBulk(db,ops){
  if(ops.some(op=>op.ref.path.startsWith('waitlist/')))reject()
  await db.runTransaction(async tx=>{
    const states=await Promise.all(ops.filter(guardedKind).map(async op=>({op,snap:await tx.get(op.ref)})))
    for(const {op,snap} of states){
      const stored=snap.exists?snap.data():null
      if(stored?.operationalVersion||stored?.waitlistId||op.data?.waitlistId||op.data?.waitlistCommandId||op.data?.createdBy==='waitlist'||op.ref.path.startsWith('bookings/WLB_'))reject()
      guardOperationalSync(op,stored)
    }
  })
  const writtenVersions={bookings:{},tables:{}}
  for(let i=0;i<ops.length;i+=450){
    const chunk=ops.slice(i,i+450)
    const written=await db.runTransaction(async tx=>{
      const checked=await Promise.all(chunk.map(async op=>{
        if(!guardedKind(op))return op
        const snap=await tx.get(op.ref),stored=snap.exists?snap.data():null
        if(stored?.operationalVersion||stored?.waitlistId)reject()
        return guardOperationalSync(op,stored)
      }))
      for(const op of checked){if(op.delete)tx.delete(op.ref);else tx.set(op.ref,op.data,op.options||{merge:true})}
      return checked.filter(guardedKind).map(op=>({path:op.ref.path,version:op.delete?null:(op.data.operationalVersion||0)}))
    })
    for(const entry of written){const [kind,id]=entry.path.split('/');writtenVersions[kind][id]=entry.version}
  }
  return writtenVersions
}

// Read committed documents rather than echoing the client's obsolete version.
export async function readOperationalUpdates(db,ops,role){
  const result={bookingUpdates:[],tableUpdates:[],deletedBookingIds:[],deletedTableIds:[]}
  const selected=[...new Map(ops.filter(guardedKind).map(op=>[op.ref.path,op])).values()]
  if(!selected.length)return result
  return db.runTransaction(async tx=>{
    const snapshots=await Promise.all(selected.map(async op=>({op,snap:await tx.get(op.ref)})))
    for(const {op,snap} of snapshots){
      const [kind,id]=op.ref.path.split('/')
      const key=kind==='bookings'?'booking':'table'
      if(snap.exists)result[key+'Updates'].push(projectForRead(kind,snap.data(),role))
      else result[kind==='bookings'?'deletedBookingIds':'deletedTableIds'].push(id)
    }
    return result
  })
}
