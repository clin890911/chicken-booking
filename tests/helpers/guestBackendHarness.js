// 真HTTP handler/完整enqueue helper，Firestore/Auth/provider均在記憶體，不初始化Firebase/ADC。
import {readFileSync} from 'node:fs'
import crypto from 'node:crypto'
import {submissionProof,verifyReceipt,isBeforeGuestDeadline,guestPolicy} from '../../functions/lib/guestReliability'
import {notificationIntent,notificationIdentity,outboxFromIntent,claimNotification,deliveryUpdate,aggregateNotificationHealth,healthEntry,notificationIsSuperseded} from '../../functions/lib/durableNotifications'
import {consumeLineLoginState,buildAuthorizeUrl,buildBindResultUrl,parseFriendFlag,LINE_LOGIN_STATE_TTL_MS} from '../../functions/lib/lineLogin'
import {validateLineReadiness} from '../../functions/lib/lineReadiness'
import {buildLineBindingRecord} from '../../functions/lib/lineBinding'
import {isTableUsableOnDate} from '../../functions/lib/tableUsable'
import {slotEpochMs} from '../../functions/lib/myBookings'
import {isOverAutoCloseThreshold} from '../../functions/lib/onlineGuards'
import {notificationStateHash,buildManageUrl,dayLabelServer} from '../../functions/lib/notify'
import {bookingOccupiedTables} from '../../functions/lib/groupTableConflicts'
import {heldTableIdsToRelease} from '../../functions/lib/bookingTableRelease'
const source=readFileSync('functions/index.js','utf8')
const fn=name=>{let start=source.indexOf('function '+name+'(');if(start<0)throw Error('Missing helper '+name);if(source.slice(start-6,start)==='async ')start-=6;return source.slice(start,source.indexOf('\n}',start)+2)}
const handler=name=>{const start=source.indexOf('export const '+name+' =');return source.slice(start,source.indexOf('\n})',start)+3).replace('export const','const')}
const clone=value=>structuredClone(value)
const merge=(old,next)=>{const out={...old};for(const [key,value]of Object.entries(next))out[key]=value&&typeof value==='object'&&!Array.isArray(value)?merge(old?.[key]||{},value):clone(value);return out}
export function guestBackendHarness(){
 const records=new Map(),deliveries=[],logs=[]
 const controls={failWrites:null,commitAckLost:false,failMarkSent:false,result:{ok:true},clock:null}
 let lock=Promise.resolve(),exchangeCount=0
 class Clock extends Date{constructor(...args){super(...(args.length?args:[controls.clock||Date.now()]))}static now(){return controls.clock?Date.parse(controls.clock):Date.now()}}
 const snap=path=>({id:path.split('/').at(-1),ref:doc(path),exists:records.has(path),data:()=>clone(records.get(path))})
 const querySnap=(name,filters=[],max=Infinity)=>{const docs=[...records].filter(([path,value])=>path.startsWith(name+'/')&&path.split('/').length===2&&filters.every(([field,wanted])=>value[field]===wanted)).slice(0,max).map(([path])=>snap(path));return {docs,size:docs.length}}
 const doc=path=>({path,id:path.split('/').at(-1),get:async()=>snap(path),set:async(data,options)=>{if(controls.failWrites&&path.startsWith(controls.failWrites+'/'))throw Error('MOCK_WRITE_FAILED');records.set(path,options?.merge?merge(records.get(path)||{},data):clone(data))},update:async data=>{if(!records.has(path))throw Error('not-found');records.set(path,merge(records.get(path),data))},delete:async()=>records.delete(path)})
 const collection=(name,filters=[],max=Infinity)=>({name,filters,max,doc:id=>doc(name+'/'+(id||crypto.randomBytes(12).toString('hex'))),where:(field,operator,wanted)=>collection(name,[...filters,[field,wanted]],max),limit:n=>collection(name,filters,n),get:async()=>querySnap(name,filters,max)})
 const db={collection,runTransaction:callback=>{
  const run=lock.then(async()=>{
   const writes=[];const tx={get:async ref=>{if(writes.length)throw Error('READ_AFTER_WRITE');return ref.path?snap(ref.path):querySnap(ref.name,ref.filters,ref.max)},set:(ref,data,options)=>writes.push({ref,data,merge:options?.merge}),delete:ref=>writes.push({ref,delete:true})}
   const value=await callback(tx)
   if(writes.some(w=>controls.failWrites&&w.ref.path.startsWith(controls.failWrites+'/')))throw Error('MOCK_WRITE_FAILED')
   if(controls.failMarkSent&&writes.some(w=>w.data?.status==='sent'&&w.ref.path.startsWith('notifications/'))){controls.failMarkSent=false;throw Error('MOCK_SEND_ACK_WRITE_FAILED')}
   for(const w of writes){if(w.delete)records.delete(w.ref.path);else records.set(w.ref.path,w.merge?merge(records.get(w.ref.path)||{},w.data):clone(w.data))}
   if(controls.commitAckLost&&writes.some(w=>w.ref.path.startsWith('guestSubmissionReceipts/'))){controls.commitAckLost=false;throw Error('MOCK_COMMIT_ACK_LOST')}
   return value
  });lock=run.catch(()=>{});return run
 }}
 const settings={openTime:'11:00',closeTime:'19:00',slotInterval:30,maxDaysAhead:30,diningDurationMin:90,cleanupBufferMin:10,onlineSessionCutoffMin:120,onlineAutoCloseEnabled:false,onlineAutoClosePercent:80,...guestPolicy(),closures:{closedDates:[],closedSlots:{},closedSeatings:{}},seatings:[{id:'lunch',start:'11:00',end:'14:30'},{id:'dinner',start:'17:00',end:'19:00'}],lineUseLiff:false,lineLoginChannelId:'',lineLoginCallbackUrl:'',lineLoginStartEndpoint:'',publicSiteUrl:'',lineOfficialUrl:'https://lin.ee/MOCK',storeName:'假資料',storePhone:'0000000000'}
 records.set('settings/main',settings);records.set('tables/T',{number:'T',capacity:20,isActive:true})
 const args={db,crypto,Date:Clock,Buffer,onRequest:(_,f)=>f,PUBLIC_CORS:true,TELEGRAM_BOT_TOKEN:'',TELEGRAM_CHAT_ID:'',LINE_CHANNEL_ACCESS_TOKEN:'',FieldValue:{serverTimestamp:()=>new Clock().toISOString()},COLLECTIONS:{bookings:'bookings',tables:'tables',groupReservations:'groupReservations',customers:'customers'},STORE_TZ:'Asia/Taipei',CAPACITY_EXCLUDED_STATUSES:['cancelled','noshow','completed'],DEFAULT_DINING_DURATION_MIN:90,DEFAULT_CLEANUP_BUFFER_MIN:10,NOTIFICATION_MAX_ATTEMPTS:6,NOTIFICATION_BACKOFF_MS:[60000,300000,900000,1800000,3600000,7200000],LINE_LOGIN_STATE_TTL_MS,MAX_GUEST_EDIT_HISTORY:20,guestPolicy,isBeforeGuestDeadline,submissionProof,verifyReceipt,notificationIdentity,notificationIntent,outboxFromIntent,claimNotification,deliveryUpdate,aggregateNotificationHealth,healthEntry,consumeLineLoginState,validateLineReadiness,buildAuthorizeUrl,buildBindResultUrl,parseFriendFlag,buildLineBindingRecord,isTableUsableOnDate,slotEpochMs,isOverAutoCloseThreshold,notificationStateHash,buildManageUrl,dayLabelServer,notificationIsSuperseded,bookingOccupiedTables,heldTableIdsToRelease,normalizeStoreSettings:s=>({...settings,...s,...guestPolicy()}),enforceRateLimit:async()=>{},listCollection:async name=>querySnap(name).docs.map(d=>({id:d.id,...d.data()})),errorWithStatus:(message,status)=>Object.assign(Error(message),{status}),buildTelegramBookingMessage:()=>'(MOCK_TELEGRAM)',buildBookingMessages:(booking,store,event)=>[{type:'text',text:event+' '+booking.date+' '+booking.timeSlot}],storeFromSettings:s=>s,deliverNotification:async data=>{deliveries.push({id:data.id,channel:data.channel,event:data.event});return clone(controls.result)},verifyLineIdToken:async()=>({sub:'MOCK_LINE_USER',name:'mock'}),exchangeLineLoginCode:async()=>{exchangeCount++;return {id_token:'MOCK_ID_TOKEN',access_token:'MOCK_ACCESS_TOKEN'}},fetchLineFriendFlag:async()=>true,lineLoginChannelSecret:()=>'(MOCK_SECRET)',console:{error:(...a)=>logs.push(a[0]),warn:()=>{}}}
 const sync=['digits','toMinutes','pad2','generateSlotsServer','todayServerStr','normalizeDateInput','publicStoreSettings','validateNewBooking','groupTableNumbersServer','groupOccupancyWindowServer','groupHeldSeatsServer','seatingForSlotServer','closureDayOfWeekServer','effectiveClosedSeatingsServer','isSlotClosedServer','activeTotalSeatsServer','calcSlotCapacityServer','createServerToken','safeTokenEqual','getBookingByToken','guestEditable','sanitizeGuestPatch','readHeldTableIdsForRelease','pickBookingHistory','appendGuestHistory','guestEventIntents','attachLineBindingAndPush','enqueueNotification','queueNotificationIntent','recordNotificationHealth','processNotificationIntent','sendOutboxDoc','reconcileNotificationIntents','enqueueAndTrySend','mirrorLineNotifyStatus','markLinePushBlocked','notifyLineBookingChange']
 const body=sync.map(fn).join('\n')+'\n'+['guestCreateBooking','guestGetBooking','guestGetAvailability','guestUpdateBooking','guestCancelBooking','lineBind'].map(handler).join('\n')
 const api=new Function(...Object.keys(args),body+'\nreturn {guestCreateBooking,guestGetBooking,guestGetAvailability,guestUpdateBooking,guestCancelBooking,lineBind,enqueueAndTrySend,reconcileNotificationIntents,sendOutboxDoc,notifyLineBookingChange,attachLineBindingAndPush,publicStoreSettings}')(...Object.values(args))
 return {records,db,deliveries,controls,api,settings,logs,get exchangeCount(){return exchangeCount},async call(name,body={}){const res={code:200,status(v){this.code=v;return this},json(data){this.body=data;return this},redirect(code,url){this.code=code;this.location=url;return this},send(text){this.body=text;return this}};await api[name]({method:'POST',body,query:body},res);return res}}
}
