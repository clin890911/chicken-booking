import {describe,it,expect} from 'vitest'
import crypto from 'node:crypto'
import {submissionProof,verifyReceipt,isBeforeGuestDeadline,guestPolicy} from '../../functions/lib/guestReliability'
import {notificationIntent,claimNotification,deliveryUpdate,aggregateNotificationHealth} from '../../functions/lib/durableNotifications'
describe('capability receipt與60min政策',()=>{
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
 it.each([[59,false],[60,true],[61,true],[0,false],[-1,false]])('抵達相距%d分鐘，exact60允', (min,ok)=>expect(isBeforeGuestDeadline(100000,100000+min*60000)).toBe(ok))
 it('新版政策固定60不取legacy120',()=>expect(guestPolicy()).toMatchObject({onlineMinimumLeadMinutes:60,onlineBookingPolicy:'arrival-lead-60-v1'}))
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
