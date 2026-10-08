import crypto from 'node:crypto'
// 線上客人新訂位／改期到新時段：以「客人選的抵達時段」往前算，至少提前 MIN_GUEST_LEAD_MINUTES（exact 可訂）。
// 唯一真相：guestGetAvailability 的 closed、validateNewBooking、guestUpdateBooking 改期都走 isBeforeGuestDeadline。
// 前端文案常數 src/utils/guestPolicy.js 須與此同步（tests/functions/guestReliability.test.js 鎖住）。
// 注意：既有訂位的取消／改人數期限是另一條「用餐前 2 小時」規則（guestEditable），與此無關。
export const GUEST_BOOKING_POLICY = 'arrival-lead-120-v1'
export const MIN_GUEST_LEAD_MINUTES = 120
export function guestLeadLabel(min=MIN_GUEST_LEAD_MINUTES){return min%60===0?`${min/60} 小時`:`${min} 分鐘`}
export function guestLeadError(kind='create'){return `線上${kind==='reschedule'?'改期':'訂位'}須至少提前 ${guestLeadLabel()}，請選擇較晚時段或來電洽詢`}
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
