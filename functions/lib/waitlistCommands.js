import crypto from 'node:crypto'
import { businessDate, checkCommand, buildQueueCommand } from './operationalCommands.js'
import { roleCan } from './staffAccess.js'
import { projectBookingForRead, projectWaitlistForRead } from './dataProjection.js'
import { notificationIntent } from './durableNotifications.js'
import { isTableUsableOnDate } from './tableUsable.js'
import { buildWaitlistCallOutbox } from './smsPhone.js'

const fail=(message,status=409)=>{throw Object.assign(Error(message),{status})}
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v
const hash=v=>crypto.createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex')
const docData=s=>s.exists?s.data():null
const tableIds=b=>[b?.assignedTableId,...(b?.extraTableIds||[])].filter(Boolean).map(String)
const publicBooking=b=>projectBookingForRead(b,'manager')
const validId=v=>typeof v==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(v)

// Pure dependency-injected transaction entry; importing this module never initializes Firebase.
export async function executeWaitlistCommand({db,staff,command,now=new Date().toISOString()}) {
  checkCommand(command)
  const {action,id,commandId,expectedVersion}=command,p=command.payload||{}
  if(!['create','call','leave','seat','undo','skip','return'].includes(action))fail('invalid-action',400)
  if(!roleCan(staff.role,action==='create'?'waitlist.create':'waitlist.update'))fail('permission-denied',403)
  if(['seat','undo'].includes(action)&&(!roleCan(staff.role,'table.update')||!roleCan(staff.role,'booking.create')))fail('permission-denied',403)
  const ref=db.collection('waitlist').doc(id),receiptRef=ref.collection('commands').doc(commandId)
  const requestHash=hash(command),day=businessDate(now)
  return db.runTransaction(async tx=>{
    const [snap,receipt]=await Promise.all([tx.get(ref),tx.get(receiptRef)])
    const current=docData(snap)
    if(receipt.exists){
      const saved=receipt.data()
      if(saved.actor!==staff.uid)fail('command-owner-mismatch',403)
      if(saved.requestHash!==requestHash)fail('command-reused')
      const result={...saved.result,item:projectWaitlistForRead(current||saved.result.item,staff.role),replayed:true}
      const bids=[...new Set((saved.result.bookings||[]).map(b=>b.id))]
      const canonicalBooks=await Promise.all(bids.map(async bid=>docData(await tx.get(db.collection('bookings').doc(bid)))))
      result.bookings=canonicalBooks.filter(Boolean).map(publicBooking)
      result.deletedBookingIds=bids.filter((_,i)=>!canonicalBooks[i])
      const tids=[...new Set([...(saved.result.tables||[]).map(t=>t.number),...canonicalBooks.filter(Boolean).flatMap(tableIds)])]
      result.tables=(await Promise.all(tids.map(async n=>docData(await tx.get(db.collection('tables').doc(n)))))).filter(Boolean)
      return result
    }
    if(command.date!==day)fail('waitlist-not-today')
    if(action!=='create'){
      if(!current)fail('waitlist-not-found',404)
      if(businessDate(current.takenAt)!==day)fail('waitlist-not-today')
      if((current.queueVersion||0)!==expectedVersion)fail('waitlist-changed')
    }
    let item,result,booking=null,tables=[],writes=[],deletes=[],privateUndo=null
    if(action==='create'){
      if(current||expectedVersion!==0)fail('waitlist-already-exists')
      const size=Number(p.partySize),children=Number(p.children||0)
      if(!Number.isInteger(size)||size<1||size>100||!Number.isInteger(children)||children<0||children>=size)fail('invalid-party-size',400)
      if(typeof p.name!=='string'||p.name.length>80||typeof (p.phone||'')!=='string'||(p.phone||'').length>30||typeof(p.notes||'')!=='string'||(p.notes||'').length>1000)fail('invalid-waitlist-data',400)
      const counterRef=db.collection('waitlistCounters').doc(day),counter=docData(await tx.get(counterRef))
      let last=Number(counter?.lastNumber)||0
      if(!counter){const existing=await tx.get(db.collection('waitlist'));for(const s of existing.docs){const w=s.data();if(businessDate(w.takenAt)===day)last=Math.max(last,Number(w.queueNumber)||0)}}
      item={id,queueNumber:last+1,takenAt:now,name:p.name.trim()||'訪客',phone:(p.phone||'').trim(),partySize:size,adults:size-children,children,notes:p.notes||'',estimatedMin:Math.max(0,Math.min(1440,Number(p.estimatedMin)||20)),lineUserId:null,status:'waiting',calledAt:null,seatedAt:null,leftAt:null,assignedTableNumber:null,queueVersion:1,serverManaged:true,createdBy:staff.uid,updatedAt:now}
      writes.push([counterRef,{lastNumber:last+1,updatedAt:now}])
    }else if(['skip','return'].includes(action))item={...buildQueueCommand(command,current,{role:staff.role,now}),serverManaged:true,updatedAt:now}
    else if(action==='call'||action==='leave'){
      if(!['waiting','called',...(action==='leave'?['skipped']:[])].includes(current.status))fail('waitlist-ended')
      if(action==='call'&&current.status==='called')fail('waitlist-already-called')
      item={...current,status:action==='call'?'called':'left',[action==='call'?'calledAt':'leftAt']:now,queueVersion:expectedVersion+1,serverManaged:true,updatedAt:now}
    }else if(action==='seat'){
      if(!['waiting','called'].includes(current.status))fail('waitlist-ended')
      const nums=p.tableNumbers
      if(!Array.isArray(nums)||!nums.length||nums.length>20||nums.some(n=>!validId(n))||new Set(nums).size!==nums.length)fail('invalid-tables',400)
      const [tableSnaps,bookSnap,groupSnap,settingsSnap]=await Promise.all([Promise.all(nums.map(n=>tx.get(db.collection('tables').doc(n)))),tx.get(db.collection('bookings').where('date','==',day)),tx.get(db.collection('groupReservations').where('date','==',day)),tx.get(db.collection('settings').doc('main'))])
      tables=tableSnaps.map(docData)
      tables.forEach((t,i)=>{if(!t)fail('table-not-found',404);if(!isTableUsableOnDate(t,day))fail('table-unusable');if(t.status!=='vacant'||t.currentBookingId||t.currentRef)fail('table-occupied')})
      if(new Set(tables.map(t=>t.floor)).size>1)fail('tables-different-floors')
      if(tables.reduce((n,t)=>n+(Number(t.capacity)>0?Number(t.capacity)+1:0),0)<current.partySize)fail('table-capacity-insufficient')
      const settings=docData(settingsSnap)||{},duration=Math.max(0,(Number(settings.diningDurationMin)||90)+(Number(settings.cleanupBufferMin)||10))
      const start=Date.parse(now),end=start+duration*60000
      const conflicts=bookSnap.docs.map(s=>s.data()).filter(b=>!['cancelled','completed','noshow'].includes(b.status)&&tableIds(b).some(n=>nums.includes(n))&&Date.parse(`${b.date}T${b.timeSlot}:00+08:00`)<end&&Date.parse(`${b.date}T${b.timeSlot}:00+08:00`)+duration*60000>start)
      const groups=groupSnap.docs.map(s=>s.data()).filter(g=>!['cancelled','completed','noshow'].includes(g.status)).flatMap(g=>(g.batches||[]).filter(b=>{if(b.releasedAt)return false;const at=Date.parse(`${day}T${b.timeSlot}:00+08:00`);return at<end&&at+duration*60000>start&&(b.tableNumbers||[]).some(n=>nums.includes(String(n)))}).map(b=>({id:g.id,tableNumbers:b.tableNumbers})))
      const conflictTables=nums.filter(n=>conflicts.some(b=>tableIds(b).includes(n))||groups.some(g=>[g.assignedTableId,...(g.tableNumbers||[]),...(g.assignedTableIds||[])].map(String).includes(n)))
      if(conflictTables.some(n=>!(p.confirmedConflictTables||[]).includes(n)))fail('table-preassign-conflict')
      if(conflicts.some(b=>b.status==='arrived'))fail('table-occupied')
      const released=conflicts.map(b=>({...b,assignedTableId:null,extraTableIds:[],updatedAt:now,operationalVersion:(b.operationalVersion||0)+1}))
      writes.push(...released.map(b=>[db.collection('bookings').doc(b.id),b]))
      const bid='WLB_'+hash([id,commandId]).slice(0,32),bookingRef=db.collection('bookings').doc(bid)
      if((await tx.get(bookingRef)).exists)fail('booking-already-exists')
      const local=new Date(start+8*3600000),timeSlot=`${String(local.getUTCHours()).padStart(2,'0')}:${String(Math.floor(local.getUTCMinutes()/30)*30).padStart(2,'0')}`
      booking={id:bid,name:current.name,phone:current.phone,phoneDigits:String(current.phone||'').replace(/\D/g,''),guests:current.partySize,adults:current.partySize-(current.children||0),children:current.children||0,date:day,timeSlot,source:'walkin',status:'arrived',assignedTableId:nums[0],extraTableIds:nums.slice(1),lineUserId:current.lineUserId||null,notes:{pet:false,child:(current.children||0)>0,mobility:false,text:current.notes||''},manageToken:crypto.randomBytes(32).toString('hex'),createdAt:now,updatedAt:now,actualArrivalTime:now,createdBy:'waitlist',waitlistId:id,waitlistCommandId:commandId,operationalVersion:1}
      tables=tables.map(t=>({...t,status:'dining',currentBookingId:bid,currentRef:null,seatedAt:now,updatedAt:now,waitlistId:id,operationalVersion:(t.operationalVersion||0)+1}))
      item={...current,status:'seated',seatedAt:now,assignedTableNumber:nums[0],tableNumbers:nums,bookingId:bid,seatCommandId:commandId,seatActor:staff.uid,undoUntil:new Date(start+5000).toISOString(),queueVersion:expectedVersion+1,serverManaged:true,updatedAt:now}
      privateUndo={releasedPreassigns:conflicts}
      writes.push([bookingRef,booking],...tables.map(t=>[db.collection('tables').doc(t.number),t]))
    }else{
      if(current.status!=='seated'||current.seatCommandId!==p.seatCommandId||current.seatActor!==staff.uid||Date.parse(now)>Date.parse(current.undoUntil))fail('undo-unavailable')
      const bRef=db.collection('bookings').doc(current.bookingId),b=docData(await tx.get(bRef))
      tables=await Promise.all((current.tableNumbers||[]).map(async n=>docData(await tx.get(db.collection('tables').doc(n)))))
      if(!b||b.status!=='arrived'||b.updatedAt!==current.seatedAt||b.waitlistCommandId!==current.seatCommandId||JSON.stringify(tableIds(b))!==JSON.stringify(current.tableNumbers)||tables.some(t=>!t||t.status!=='dining'||t.currentBookingId!==b.id||t.seatedAt!==current.seatedAt))fail('undo-changed')
      const originalReceipt=docData(await tx.get(ref.collection('commands').doc(current.seatCommandId)))
      if(!originalReceipt||originalReceipt.actor!==staff.uid)fail('undo-unavailable')
      const restore=[]
      for(const old of originalReceipt.privateUndo?.releasedPreassigns||[]){const r=db.collection('bookings').doc(old.id),latest=docData(await tx.get(r));if(!latest||latest.updatedAt!==current.seatedAt||latest.status!==old.status||latest.assignedTableId||latest.extraTableIds?.length||(latest.operationalVersion||0)!==(old.operationalVersion||0)+1)fail('undo-preassign-changed');restore.push({...old,updatedAt:now,operationalVersion:(latest.operationalVersion||0)+1})}
      writes.push(...restore.map(b=>[db.collection('bookings').doc(b.id),b]))
      booking={...b,status:'cancelled',cancellationReason:'waitlist-seat-undo',assignedTableId:null,extraTableIds:[],updatedAt:now}
      tables=tables.map(t=>({...t,status:'vacant',currentBookingId:null,currentRef:null,seatedAt:null,waitlistId:null,updatedAt:now,operationalVersion:(t.operationalVersion||0)+1}))
      item={...current,status:current.calledAt?'called':'waiting',seatedAt:null,assignedTableNumber:null,bookingId:null,tableNumbers:[],undoUntil:null,queueVersion:expectedVersion+1,serverManaged:true,updatedAt:now}
      deletes.push(bRef);writes.push(...tables.map(t=>[db.collection('tables').doc(t.number),t]))
    }
    result={ok:true,item:projectWaitlistForRead(item,staff.role),bookings:writes.filter(([r])=>r.path?.startsWith('bookings/')).map(([,b])=>publicBooking(b)),tables,deletedBookingIds:deletes.map(r=>r.id||r.path.split('/').at(-1)),undoUntil:item.undoUntil||null}
    if(['create','seat'].includes(action)){const intent=notificationIntent({channel:'telegram',event:action==='create'?'waitlist_created':'waitlist_seated',version:`${id}:${commandId}`,payload:{text:action==='create'?`候位 #${item.queueNumber} 已取號（${item.partySize} 位）`:`候位 #${item.queueNumber} 已入座：${item.tableNumbers.join(' + ')}`}},now);writes.push([db.collection('notificationIntents').doc(intent.id),intent])}
    // 叫號簡訊：只多一筆 smsOutbox 寫入（不讀、不改驗證/狀態/版本）；送出由 smsKick／smsSweeper 處理。
    if(action==='call'){const sms=buildWaitlistCallOutbox({item,commandId,now});if(sms)writes.push([db.collection('smsOutbox').doc(sms.id),sms.data])}
    // All transactional reads above precede every write.
    for(const [r,data] of writes)tx.set(r,data)
    for(const r of deletes)tx.delete(r)
    delete item.releasedPreassigns
    tx.set(ref,item);tx.set(receiptRef,{actor:staff.uid,requestHash,result,createdAt:now,...(privateUndo?{privateUndo}: {})})
    return result
  },{maxAttempts:30})
}
// FIFO limits local counter contention; Firestore remains the cross-instance authority.
export function createWaitlistHandler({db,requireStaff,now=()=>new Date().toISOString(),afterCommit=async()=>{},maxQueue=128}){
  const queues=new Map()
  const schedule=async(key,run)=>{
    const state=queues.get(key)||{tail:Promise.resolve(),size:0}
    if(state.size>=maxQueue)fail('waitlist-busy-retry',503)
    state.size++;queues.set(key,state)
    const bounded=async work=>{let timer;try{return await Promise.race([work,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Object.assign(Error('waitlist-busy-retry'),{status:503})),20000)})])}finally{clearTimeout(timer)}}
    const previous=state.tail
    let release;state.tail=new Promise(resolve=>{release=resolve})
    try{await bounded(previous);return await bounded(run())}
    finally{release();state.size--;if(!state.size&&queues.get(key)===state)queues.delete(key)}
  }
  return async(req,res)=>{try{
    const staff=await requireStaff(req)
    if(req.method!=='POST')return res.status(405).json({ok:false,error:'method-not-allowed'})
    const run=()=>executeWaitlistCommand({db,staff,command:req.body,now:now()})
    let result
    if(req.body?.action==='create'){
      checkCommand(req.body)
      const receipt=await db.collection('waitlist').doc(req.body.id).collection('commands').doc(req.body.commandId).get()
      result=receipt.exists?await run():await schedule(businessDate(now()),run)
    }else result=await run()
    try{await afterCommit(result)}catch{}
    return res.json(result)
  }catch(e){return res.status(e.status||500).json({ok:false,error:e.message||'operation-failed',...(e.status===503?{retryable:true}: {})})}}
}
