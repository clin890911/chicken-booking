import {describe,it,expect} from 'vitest'
import crypto from 'node:crypto'
import {submissionProof,verifyReceipt,isBeforeGuestDeadline,guestPolicy,guestLeadError,guestLeadLabel,MIN_GUEST_LEAD_MINUTES} from '../../functions/lib/guestReliability'
import {ONLINE_MIN_LEAD_MINUTES,onlineLeadLabel} from '../../src/utils/guestPolicy'
import {notificationIntent,claimNotification,deliveryUpdate,aggregateNotificationHealth} from '../../functions/lib/durableNotifications'
describe('capability receipt與120min（2小時）政策',()=>{
 it('key高熵proof只回hash，canonical normalize相同；改payload拒且不靠電話回token',()=>{
  const key=crypto.randomBytes(32).toString('hex'),body={submissionKey:key,name:' 測試 ',phone:'0900-000-000',guests:'2',date:'2026-10-05',timeSlot:'13:00',notes:{text:' test '}}
  const a=submissionProof(body),b=submissionProof({...body,name:'測試',phone:'0900000000',guests:2,notes:{pet:false,text:'test'},line:{idToken:'MOCK_OTHER_SHORT_TOKEN'}})
  expect(a).toEqual(b);expect(JSON.stringify(a)).not.toContain(key)
  expect(verifyReceipt({bookingId:'B',payloadHash:a.payloadHash},a)).toBe('B')
  expect(()=>verifyReceipt({bookingId:'B',payloadHash:a.payloadHash},submissionProof({...body,guests:3}))).toThrow('submission-payload-conflict')
  expect(submissionProof({phone:'0900000000'})).toBeNull()
 })
 it.each([undefined,'a','x'.repeat(64),'A'.repeat(64)])('非法key不當可猜receipt',key=>{
  if(key===undefined)expect(submissionProof({submissionKey:key})).toBeNull();else expect(()=>submissionProof({submissionKey:key})).toThrow('invalid-submission-key')
 })
 it.each([[59,false],[60,false],[119,false],[120,true],[121,true],[0,false],[-1,false]])('抵達相距%d分鐘，exact120允', (min,ok)=>expect(isBeforeGuestDeadline(100000,100000+min*60000)).toBe(ok))
 it('提前量以抵達時段算：119分59秒拒、120分整允',()=>{expect(isBeforeGuestDeadline(0,120*60000-1000)).toBe(false);expect(isBeforeGuestDeadline(0,120*60000)).toBe(true);expect(isBeforeGuestDeadline(0,NaN)).toBe(false)})
 it('政策固定120（2小時），版本字串同步',()=>expect(guestPolicy()).toMatchObject({onlineMinimumLeadMinutes:120,onlineBookingPolicy:'arrival-lead-120-v1'}))
 it('前端文案常數與後端唯一真相同步（改一邊必須改另一邊）',()=>{expect(ONLINE_MIN_LEAD_MINUTES).toBe(MIN_GUEST_LEAD_MINUTES);expect(onlineLeadLabel()).toBe(guestLeadLabel());expect(guestLeadLabel()).toBe('2 小時')})
 it('拒絕訊息不再寫60分鐘',()=>{expect(guestLeadError('create')).toBe('線上訂位須至少提前 2 小時，請選擇較晚時段或來電洽詢');expect(guestLeadError('reschedule')).toContain('線上改期須至少提前 2 小時');expect(guestLeadError()+guestLeadError('reschedule')).not.toMatch(/60/)})
})
describe('耐久通知identity/lease/health',()=>{
 const doc={channel:'line',event:'updated',bookingId:'B',version:'1',payload:{to:'MOCK_USER',messages:[]}}
 it('同eventversion同id，A→B→A的新版本有新id',()=>{
  const a=notificationIntent(doc,'now'),b=notificationIntent({...doc,version:'2'},'later')
  expect(notificationIntent(doc,'later').id).toBe(a.id);expect(b.id).not.toBe(a.id);expect(notificationIntent({...doc,version:'3'},'later').id).not.toBe(a.id)
 })
 it('lease期间不可重claim，过期才恢复并标deliveryunknown',()=>{
  const a=claimNotification({status:'pending'},'ownerA',1000)
  expect(claimNotification(a,'ownerB',2000)).toBeNull()
  expect(claimNotification(a,'ownerB',62000)).toMatchObject({leaseOwner:'ownerB',deliveryUnknown:true})
  expect(claimNotification({status:'sent'},'ownerC',999999)).toBeNull()
 })
 it('失败永久可见，sent须实际成功后标',()=>{
  expect(deliveryUpdate({attempts:5,maxAttempts:6},{ok:false,error:'test'},1000,[1000])).toMatchObject({status:'failed',attempts:6})
  expect(deliveryUpdate({attempts:0},{ok:true},1000,[1000])).toMatchObject({status:'sent',leaseOwner:null})
 })
 it('TG retrying/failed不被LINE成功盖掉',()=>{
  expect(aggregateNotificationHealth({a:{status:'retrying'},b:{status:'sent'}},'now').status).toBe('retrying')
  expect(aggregateNotificationHealth({a:{status:'failed'},b:{status:'sent'}},'now').status).toBe('failed')
 })
})
