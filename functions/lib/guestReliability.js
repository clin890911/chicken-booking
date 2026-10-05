import crypto from 'node:crypto'
export const GUEST_BOOKING_POLICY = 'arrival-lead-60-v1'
export const MIN_GUEST_LEAD_MINUTES = 60
export function guestPolicy(){return {onlineBookingPolicy:GUEST_BOOKING_POLICY,onlineMinimumLeadMinutes:MIN_GUEST_LEAD_MINUTES}}
export function isBeforeGuestDeadline(nowMs,slotMs){return Number.isFinite(slotMs)&&slotMs-Number(nowMs)>=MIN_GUEST_LEAD_MINUTES*60000}
export function canonicalGuestIntent(body={}){
 return {name:String(body.name||'').trim(),phoneDigits:String(body.phone||'').replace(/\D/g,''),guests:Number(body.guests),date:String(body.date||'').trim(),timeSlot:String(body.timeSlot||'').trim(),notes:{pet:!!body.notes?.pet,child:!!body.notes?.child,mobility:!!body.notes?.mobility,text:String(body.notes?.text||'').trim().slice(0,500)}}
}
export function submissionProof(body={}){
 const key=body.submissionKey
 if(key==null)return null // 舊客戶端相容：仍可建立，無capability recovery；不得用電話猜token。
 if(typeof key!=='string'||!/^([a-f0-9]{64})$/.test(key))throw Object.assign(Error('invalid-submission-key'),{status:400})
 return {id:crypto.createHash('sha256').update(key).digest('hex'),payloadHash:crypto.createHash('sha256').update(JSON.stringify(canonicalGuestIntent(body))).digest('hex')}
}
export function verifyReceipt(receipt,proof){
 if(!receipt||receipt.payloadHash!==proof?.payloadHash)throw Object.assign(Error('submission-payload-conflict'),{status:409})
 if(typeof receipt.bookingId!=='string'||!receipt.bookingId)throw Object.assign(Error('submission-recovery-unavailable'),{status:410})
 return receipt.bookingId
}
