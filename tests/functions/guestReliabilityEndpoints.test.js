import {describe,it,expect,vi,beforeEach,afterEach} from 'vitest'
import crypto from 'node:crypto'
import {guestBackendHarness} from '../helpers/guestBackendHarness'
const input=(patch={})=>({submissionKey:crypto.randomBytes(32).toString('hex'),name:'假資料',phone:'0900000000',date:'2026-10-05',timeSlot:'13:00',guests:2,notes:{},...patch})
let h
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(new Date(2026,9,5,12));h=guestBackendHarness()})
afterEach(()=>vi.useRealTimers())
const books=()=>[...h.records].filter(([key])=>key.startsWith('bookings/')).map(([,b])=>b)
const configuredLine=()=>Object.assign(h.settings,{lineLoginChannelId:'1234567890',lineLoginStartEndpoint:'https://lineloginstart-reaor76eyq-uc.a.run.app',lineLoginCallbackUrl:'https://linelogincallback-reaor76eyq-uc.a.run.app',publicSiteUrl:'https://chicken-booking.zeabur.app'})
describe('真guestcreate＋完整通知helper鏈',()=>{
 it('samekey/reload/replylost仍回原booking/token、只一單一次notify，payload改動409不洩token',async()=>{
  const body=input(),first=await h.call('guestCreateBooking',body),retry=await h.call('guestCreateBooking',body)
  expect(first.code).toBe(200);expect(retry.code).toBe(200);expect(retry.body.recovered).toBe(true);expect(retry.body.booking.manageToken).toBe(first.body.booking.manageToken);expect(books()).toHaveLength(1);expect(h.deliveries).toHaveLength(1)
  const changed=await h.call('guestCreateBooking',{...body,guests:3});expect(changed.code).toBe(409);expect(changed.body.booking).toBeUndefined();expect(changed.body.bookingOutcome).toBeUndefined()
 })
 it('跨60min截止與午夜同key先recover原單，取消/完成反映當前、不重建；刪除410',async()=>{
  const body=input(),first=await h.call('guestCreateBooking',body),id=first.body.booking.id
  vi.setSystemTime(new Date(2026,9,6,0,1));expect((await h.call('guestCreateBooking',body)).code).toBe(200)
  h.records.set('bookings/'+id,{...h.records.get('bookings/'+id),status:'cancelled'})
  expect((await h.call('guestCreateBooking',body)).body.booking.status).toBe('cancelled');expect(h.deliveries).toHaveLength(1)
  h.records.delete('bookings/'+id);expect((await h.call('guestCreateBooking',body)).code).toBe(410);expect(books()).toHaveLength(0)
  expect((await h.call('guestCreateBooking',{...body,submissionKey:crypto.randomBytes(32).toString('hex')})).code).toBe(400)
 })
 it('Firestore commit已完成但ACKlost：500不標notcreated，同key再查原單',async()=>{
  const body=input();h.controls.commitAckLost=true
  const lost=await h.call('guestCreateBooking',body);expect(lost.code).toBe(500);expect(lost.body.bookingOutcome).toBeUndefined();expect(books()).toHaveLength(1)
  expect((await h.call('guestCreateBooking',body)).code).toBe(200);expect(books()).toHaveLength(1)
  await h.api.reconcileNotificationIntents();expect(h.deliveries).toHaveLength(1)
 })
 it('notifications寫失敗不破坏已成立，耐久intentpending→排程repair補一份，不只catch吞掉',async()=>{
  const body=input();h.controls.failWrites='notifications'
  const first=await h.call('guestCreateBooking',body);expect(first.code).toBe(200);expect(books()).toHaveLength(1)
  expect([...h.records].filter(([p])=>p.startsWith('notificationIntents/')).map(([,v])=>v.status)).toEqual(['pending']);expect(h.deliveries).toHaveLength(0);expect(first.body.booking.notificationHealth.status).toBe('retrying')
  h.controls.failWrites=null;vi.advanceTimersByTime(61000);await h.api.reconcileNotificationIntents();await h.api.reconcileNotificationIntents()
  expect(h.deliveries).toHaveLength(1);expect([...h.records].filter(([p])=>p.startsWith('notifications/'))).toHaveLength(1);expect(books()[0].notificationHealth.status).toBe('sent')
 })
 it('初始intent write失敗與receipt/booking都不commit，回unknown，不假成功',async()=>{
  h.controls.failWrites='notificationIntents';const result=await h.call('guestCreateBooking',input());expect(result.code).toBe(500);expect(result.body.bookingOutcome).toBeUndefined();expect(books()).toHaveLength(0);expect([...h.records.keys()].some(p=>p.startsWith('guestSubmissionReceipts/'))).toBe(false)
 })
 it('舊無submissionKey仍可建立，但不靠phone/date duplicate吐管理token',async()=>{
  const body=input();delete body.submissionKey
  const result=await h.call('guestCreateBooking',body);expect(result.code).toBe(200);expect(result.body.recoverySupported).toBe(false)
  const duplicate=await h.call('guestCreateBooking',body);expect(duplicate.code).toBe(409);expect(duplicate.body.booking).toBeUndefined()
 })
 it.each([[59,400],[60,200],[61,200]])('新政策對舊120設定：距抵達%d分鐘code%d',async(min,code)=>{
  vi.setSystemTime(Date.parse('2026-10-05T13:00:00+08:00')-min*60000);const r=await h.call('guestCreateBooking',input());expect(r.code).toBe(code);if(code===400)expect(r.body.bookingOutcome).toBe('not-created')
 })
 it('confirmation reload DTO有真settings readiness且不下發private設定',async()=>{
  configuredLine();const created=await h.call('guestCreateBooking',input()),b=created.body.booking
  const remote=await h.call('guestGetBooking',{bookingId:b.id,token:b.manageToken})
  expect(remote.code).toBe(200);expect(remote.body.store.lineLoginReady).toBe(true);expect(remote.body.store.lineLoginChannelId).toBeUndefined()
 })
 it('兩個samekey並發只一單原token；最後3席兩組2位只一勝',async()=>{
  const body=input();const same=await Promise.all([h.call('guestCreateBooking',body),h.call('guestCreateBooking',body)]);expect(same.map(r=>r.code)).toEqual([200,200]);expect(same[0].body.booking.id).toBe(same[1].body.booking.id);expect(h.deliveries).toHaveLength(1)
  h=guestBackendHarness();h.records.set('tables/T',{number:'T',capacity:3,isActive:true})
  const last=await Promise.all([h.call('guestCreateBooking',input()),h.call('guestCreateBooking',input({phone:'0900000001'}))]);expect(last.map(r=>r.code).sort()).toEqual([200,409]);expect(books()).toHaveLength(1)
 })
})
describe('完整outbox lease/LINE atomic event',()=>{
 it('兩worker同event只有一次送；sender ACK寫失敗標processing，leaseexpire可能重送（外部限制）',async()=>{
  const doc={channel:'telegram',event:'updated',bookingId:null,version:'1',payload:{text:'MOCK'}}
  await h.api.enqueueAndTrySend(doc);expect(h.deliveries).toHaveLength(1)
  const [path,record]=[...h.records].find(([p])=>p.startsWith('notifications/'));h.records.set(path,{...record,status:'pending',sentAt:null})
  await Promise.all([h.api.sendOutboxDoc(h.db.collection('notifications').doc(path.split('/')[1])),h.api.sendOutboxDoc(h.db.collection('notifications').doc(path.split('/')[1]))]);expect(h.deliveries).toHaveLength(2)
  h.controls.failMarkSent=true;h.records.set(path,{...record,status:'pending',sentAt:null});await h.api.sendOutboxDoc(h.db.collection('notifications').doc(path.split('/')[1])).catch(()=>{})
  expect(h.records.get(path).status).toBe('processing');vi.advanceTimersByTime(61000);await h.api.sendOutboxDoc(h.db.collection('notifications').doc(path.split('/')[1]));expect(h.records.get(path).deliveryUnknown).toBe(true)
 })
 it('binding和intent同tx；TG queue失败后LINE成功不能盖掉retry warning',async()=>{
  const r=await h.call('guestCreateBooking',input({timeSlot:'18:00'})),b=r.body.booking
  h.controls.failWrites='notifications';await h.api.enqueueAndTrySend({channel:'telegram',event:'test-failure',bookingId:b.id,version:'1',payload:{text:'MOCK'}})
  h.controls.failWrites=null;configuredLine();await h.api.attachLineBindingAndPush({authBooking:b,settings:h.settings,line:{userId:'MOCK_LINE_USER',friendFlag:true}})
  expect(h.records.get('bookings/'+b.id).notificationHealth.status).toBe('retrying');expect(h.records.has('lineBookingBindings/'+b.id)).toBe(true)
  const count=h.deliveries.filter(d=>d.channel==='line').length;await h.api.attachLineBindingAndPush({authBooking:b,settings:h.settings,line:{userId:'MOCK_LINE_USER',friendFlag:true}});expect(h.deliveries.filter(d=>d.channel==='line')).toHaveLength(count)
 })
 it('已綁LINE的update/cancel intent跟booking同tx，queue失败可repair；保留原單2h管理截止',async()=>{
  const r=await h.call('guestCreateBooking',input({timeSlot:'18:00'})),b=r.body.booking;configuredLine();await h.api.attachLineBindingAndPush({authBooking:b,settings:h.settings,line:{userId:'MOCK_LINE_USER',friendFlag:true}})
  h.controls.failWrites='notifications';const updated=await h.call('guestUpdateBooking',{bookingId:b.id,token:b.manageToken,patch:{guests:3}});expect(updated.code).toBe(200)
  expect([...h.records].filter(([p,v])=>p.startsWith('notificationIntents/')&&v.event==='updated')).toHaveLength(2)
  h.controls.failWrites=null;vi.advanceTimersByTime(61000);await h.api.reconcileNotificationIntents();expect(h.deliveries.some(d=>d.channel==='line'&&d.event==='updated')).toBe(true)
  vi.setSystemTime(new Date(2026,9,5,16,1));expect((await h.call('guestCancelBooking',{bookingId:b.id,token:b.manageToken})).code).toBe(409)
 })
 it('A→B→A不同事件revision各送一次，舊前端linePush同event不重送',async()=>{
  const r=await h.call('guestCreateBooking',input({timeSlot:'18:00'})),b=r.body.booking;configuredLine();await h.api.attachLineBindingAndPush({authBooking:b,settings:h.settings,line:{userId:'MOCK_LINE_USER',friendFlag:true}})
  for(const guests of [3,2]){const u=await h.call('guestUpdateBooking',{bookingId:b.id,token:b.manageToken,patch:{guests}});expect(u.code).toBe(200);await h.api.notifyLineBookingChange(b.id,u.body.booking,'updated',h.settings)}
  expect(h.deliveries.filter(d=>d.channel==='line'&&d.event==='updated')).toHaveLength(2)
 })
 it('舊pending改期/取消後reconcile不補送過時成功或舊時間，標superseded',async()=>{
  h.controls.failWrites='notifications';const created=await h.call('guestCreateBooking',input({timeSlot:'18:00'}));const b=created.body.booking
  const cancelled=await h.call('guestCancelBooking',{bookingId:b.id,token:b.manageToken});expect(cancelled.code).toBe(200)
  h.controls.failWrites=null;vi.advanceTimersByTime(61000);await h.api.reconcileNotificationIntents()
  expect(h.deliveries.some(d=>d.event==='created')).toBe(false);expect(h.deliveries.some(d=>d.event==='cancelled')).toBe(true)
  expect([...h.records].find(([p,n])=>p.startsWith('notifications/')&&n.event==='created')[1].status).toBe('superseded')
 })
 it('兩channel永久錯誤可見，正常channel成功不能清掉失敗',async()=>{
  const created=await h.call('guestCreateBooking',input({timeSlot:'18:00'})),b=created.body.booking;configuredLine()
  h.controls.result={ok:false,error:'MOCK_PROVIDER_DENIED',retryable:false};await h.api.attachLineBindingAndPush({authBooking:b,settings:h.settings,line:{userId:'MOCK_LINE_USER',friendFlag:true}})
  expect(h.records.get('bookings/'+b.id).notificationHealth.status).toBe('failed')
  h.controls.result={ok:true};await h.api.enqueueAndTrySend({channel:'telegram',bookingId:b.id,event:'test-good',version:'other',payload:{text:'MOCK'}})
  expect(h.records.get('bookings/'+b.id).notificationHealth.status).toBe('failed')
 })

})
