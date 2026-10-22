import crypto from 'node:crypto'

// Preserve the existing customerService.upsert contract: creating a waitlist
// entry and later creating its walk-in booking each count as an upsert/visit.
export function customerUpdateIntent({item,command,now}){
  const phone=String(item.phone||'').replace(/\D/g,'')
  if(!phone)return null
  return {id:crypto.createHash('sha256').update(JSON.stringify([command.id,command.commandId])).digest('hex'),status:'pending',phone,name:item.name||'',lineUserId:item.lineUserId||null,partySize:item.partySize,source:command.action==='create'?'walk-in':'walkin',notes:command.action==='create'?'':item.notes||'',createdAt:now,updatedAt:now}
}

export async function processCustomerUpdateIntent({db,id,now=new Date().toISOString()}){
  if(!id)return false
  return db.runTransaction(async tx=>{
    const intentRef=db.collection('customerUpdateIntents').doc(id),snap=await tx.get(intentRef)
    if(!snap.exists||snap.data().status!=='pending')return false
    const intent=snap.data(),ref=db.collection('customers').doc(intent.phone),customer=await tx.get(ref)
    const old=customer.exists?customer.data():null,eventAt=intent.createdAt
    const newest=!old?.lastVisit||eventAt>=old.lastVisit
    const placeholder=['訪客','散客'].includes(intent.name.trim())
    const next=old?{
      ...old,phoneDigits:intent.phone,
      name:newest?((placeholder?old.name:intent.name)||old.name||intent.name||''):old.name||'',
      lineUserId:(newest&&intent.lineUserId)||old.lineUserId||null,
      visits:(Number(old.visits)||0)+1,totalGuests:(Number(old.totalGuests)||0)+(Number(intent.partySize)||0),
      lastVisit:newest?eventAt:old.lastVisit,updatedAt:now,
    }:{phone:intent.phone,phoneDigits:intent.phone,name:intent.name,lineUserId:intent.lineUserId||null,visits:1,lastVisit:eventAt,totalGuests:Number(intent.partySize)||0,totalSpend:0,notes:intent.notes||'',allergies:'',blacklisted:false,vipTier:'none',archived:false,source:intent.source,createdAt:eventAt,updatedAt:now}
    tx.set(ref,next)
    tx.set(intentRef,{...intent,status:'completed',completedAt:now,updatedAt:now})
    return true
  })
}

export async function reconcileCustomerUpdateIntents({db,limit=100}){
  const pending=await db.collection('customerUpdateIntents').where('status','==','pending').limit(limit).get()
  for(const doc of pending.docs){try{await processCustomerUpdateIntent({db,id:doc.id})}catch{/* Keep pending; one bad document cannot block the batch. */}}
}
