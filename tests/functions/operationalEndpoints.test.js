import {describe,it,expect,beforeEach,afterEach,vi} from 'vitest'
import {readFileSync} from 'node:fs'
import crypto from 'node:crypto'
import {roleCan,classifyDatasetByPermission} from '../../functions/lib/staffAccess'
import {buildHandoffCommand,buildQueueCommand,protectQueueUpsert,checkCommand} from '../../functions/lib/operationalCommands'
// 執行真handler source，所有Firestore/Auth/通知均注入in-memory fake，無Firebase/HTTP。
const source=readFileSync('functions/index.js','utf8')
let records,writes,failCommit,notifications,lock,handlers
const errorWithStatus=(message,status)=>Object.assign(Error(message),{status})
const ref=path=>({path,collection:name=>({doc:id=>ref(path+'/'+name+'/'+id)})})
const snap=path=>({exists:records.has(path),data:()=>structuredClone(records.get(path))})
const db={collection:name=>({doc:id=>ref(name+'/'+id)}),runTransaction:fn=>{
 const run=lock.then(async()=>{
  const staged=[]
  const result=await fn({get:async r=>snap(r.path),set:(r,data,options)=>staged.push({path:r.path,data,merge:options?.merge}),delete:r=>staged.push({path:r.path,delete:true})})
  if(failCommit){failCommit=false;throw Error('storage-failed')}
  for(const op of staged){if(op.delete)records.delete(op.path);else records.set(op.path,structuredClone(op.merge?{...(records.get(op.path)||{}),...op.data}:op.data))}
  writes+=staged.length;return result
 });lock=run.catch(()=>{});return run
}}
const requireStaff=async req=>{if(!req.auth)throw errorWithStatus('missing-auth-token',401);return {uid:'SERVER_ACTOR',role:req.role||'floor'}}
const collectionNames={bookings:'id',tables:'number',waitlist:'id',customers:'phone',agencies:'id',guides:'id',groupReservations:'id'}
const datasetPermissions=(dataset,role,names)=>({rejected:{},writable:role==='kitchen'?{}:dataset,message:'',hasRejection:role==='kitchen'&&Object.keys(dataset).length>0})
const call=async(handler,body=null,{method='POST',role='floor',auth=true}={})=>{
 const response={code:200,status(n){this.code=n;return this},json(data){this.body=data;return this}}
 await handler({method,body,role,auth},response);return response
}
beforeEach(()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date(2026,9,5,12));records=new Map();writes=0;failCommit=false;notifications=0;lock=Promise.resolve()
 const opSource=source.slice(source.indexOf('const operationalEndpoint ='),source.indexOf('export const adminPullData')).replaceAll('export const ','const ')
 const pushSource=source.slice(source.indexOf('export const adminPushData'),source.indexOf('\n//',source.indexOf('export const adminPushData')+1000)).replace('export const','const')
 // API block ends at its next declaration; avoid importing Firebase runtime or running any real service.
 const pushStart=source.indexOf('export const adminPushData'),pushEnd=source.indexOf('\n})',pushStart)+3
 const push=source.slice(pushStart,pushEnd).replace('export const','const')
 handlers=new Function('onRequest','db','requireStaff','listCollection','roleCan','buildHandoffCommand','buildQueueCommand','protectQueueUpsert','checkCommand','errorWithStatus','crypto','PUBLIC_CORS','TELEGRAM_BOT_TOKEN','TELEGRAM_CHAT_ID','LINE_CHANNEL_ACCESS_TOKEN','SYNC_COLLECTION_IDKEYS','classifyDatasetByPermission','snapshotBookingsByIds','COLLECTIONS','buildBookingUpsertData','createServerToken','stripServerOwnedCustomerFields','upsertOps','deleteOps','normalizeStoreSettings','readSettingsForAdminNotify','commitInChunks','notifyAdminBookingChanges','notifyAdminBookingTelegram',opSource+'\n'+push+'\nreturn {adminHandoff,adminWaitlistTransition,adminPushData}')(
  (_,fn)=>fn,db,requireStaff,async name=>[...records.entries()].filter(([p])=>p.startsWith(name+'/')&&p.split('/').length===2).map(([,v])=>structuredClone(v)),roleCan,buildHandoffCommand,buildQueueCommand,protectQueueUpsert,checkCommand,errorWithStatus,crypto,true,'','', '',collectionNames,classifyDatasetByPermission,async()=>new Map(),{bookings:'bookings',tables:'tables',waitlist:'waitlist',customers:'customers'},item=>item,()=>'',item=>item,(name,items,idKey)=>(items||[]).map(item=>({ref:ref(name+'/'+item[idKey]),data:item})),(name,ids)=>(ids||[]).map(id=>({ref:ref(name+'/'+id),delete:true})),s=>s,async()=>({}),async ops=>{for(const op of ops){if(op.delete)records.delete(op.ref.path);else records.set(op.ref.path,op.data)}writes+=ops.length},async()=>{notifications++},async()=>{notifications++})
 records.set('tables/103',{number:'103'});records.set('bookings/B1',{id:'B1'})
})
afterEach(()=>vi.useRealTimers())
const command=(action,expectedVersion=0,extra={})=>({id:'T1',action,expectedVersion,commandId:'command_'+action+'_'+expectedVersion,...extra})
describe('專用交班/過號真API transaction',()=>{
 it('server權限與認證不能繞過UI',async()=>{
  expect((await call(handlers.adminHandoff,command('create',0,{label:'需回電',tableNumber:'103'}),{auth:false})).code).toBe(401)
  expect((await call(handlers.adminHandoff,command('create',0,{label:'需回電',tableNumber:'103'}),{role:'kitchen'})).code).toBe(403)
  expect(writes).toBe(0)
 })
 it('並發兩台同版本complete只一勝、stale reopen不能復活',async()=>{
  await call(handlers.adminHandoff,command('create',0,{label:'需回電',bookingId:'B1'}))
  const results=await Promise.all(['A','B'].map(id=>call(handlers.adminHandoff,command('complete',1,{commandId:'command_complete_'+id}))))
  expect(results.map(r=>r.code).sort()).toEqual([200,409]);expect(records.get('handoffTasks/T1').status).toBe('completed')
  expect((await call(handlers.adminHandoff,command('reopen',1))).code).toBe(409)
 })
 it('回應遺失重試同命令只寫一次，不同body重用commandId拒絕；已前進回最新record',async()=>{
  const create=command('create',0,{label:'需回電',tableNumber:'103'})
  await call(handlers.adminHandoff,create);const count=writes
  expect((await call(handlers.adminHandoff,create)).body.item.version).toBe(1);expect(writes).toBe(count)
  expect((await call(handlers.adminHandoff,{...create,label:'需協助'})).code).toBe(409)
  await call(handlers.adminHandoff,command('complete',1))
  expect((await call(handlers.adminHandoff,create)).body.item.status).toBe('completed')
 })
 it('不存在reference或commit失敗不留記錄/receipt，重試可建立',async()=>{
  expect((await call(handlers.adminHandoff,command('create',0,{label:'需回電',bookingId:'MISSING'}))).code).toBe(404);expect(writes).toBe(0)
  failCommit=true;const create=command('create',0,{label:'需協助',tableNumber:'103'})
  expect((await call(handlers.adminHandoff,create)).code).toBe(500);expect(records.has('handoffTasks/T1')).toBe(false)
  expect((await call(handlers.adminHandoff,create)).code).toBe(200)
 })
 it('首讀空集合不seed或刪其他task，kitchen可讀；genericAPI不允task寫/刪',async()=>{
  expect((await call(handlers.adminHandoff,null,{method:'GET',role:'kitchen'})).body.items).toEqual([]);expect(writes).toBe(0)
  expect((await call(handlers.adminPushData,{dataset:{handoffTasks:[{id:'X'}]}})).code).toBe(403)
  expect((await call(handlers.adminPushData,{dataset:{deletedIds:{handoffTasks:['X']}}})).code).toBe(403)
 })
 it('候位skip/return同命令去重与终止状态守门',async()=>{
  records.set('waitlist/W1',{id:'W1',status:'called',queueVersion:0,queueNumber:1,takenAt:'2026-10-05T03:00:00Z'})
  const skip=command('skip',0,{id:'W1'});await call(handlers.adminWaitlistTransition,skip);const count=writes
  await call(handlers.adminWaitlistTransition,skip);expect(writes).toBe(count)
  await call(handlers.adminWaitlistTransition,command('return',1,{id:'W1'}));expect(records.get('waitlist/W1').status).toBe('waiting')
  expect((await call(handlers.adminWaitlistTransition,skip)).body.item.queueVersion).toBe(2)
 })
})
describe('generic候位與帶位同transaction、重試與通知去重',()=>{
 const w=(id,status='waiting',version=0)=>({id,status,queueVersion:version,takenAt:'2026-10-05T03:00:00Z',queueNumber:1})
 it('任一候位版本衝突整包不寫tables/bookings/其他候位',async()=>{
  records.set('waitlist/W1',w('W1'));records.set('waitlist/W2',w('W2','seated',1))
  const before=structuredClone([...records])
  const response=await call(handlers.adminPushData,{dataset:{tables:[{number:'103',status:'dining'}],bookings:[{id:'B1',status:'arrived'}],waitlist:[w('W1','called'),w('W2')]}})
  expect(response.code).toBe(409);expect([...records]).toEqual(before);expect(notifications).toBe(0)
 })
 it('正常帶位+queue提交、lostresponse相同payload重試零write零通知；前進後舊receipt409',async()=>{
  records.set('waitlist/W1',w('W1'))
  const body={dataset:{tables:[{number:'103',status:'dining'}],bookings:[{id:'B1',status:'arrived'}],waitlist:[w('W1','called')]}}
  expect((await call(handlers.adminPushData,body)).code).toBe(200)
  const count=writes,notify=notifications
  expect((await call(handlers.adminPushData,body)).body.waitlistUpdates[0].queueVersion).toBe(1);expect(writes).toBe(count);expect(notifications).toBe(notify)
  records.set('waitlist/W1',w('W1','seated',2));expect((await call(handlers.adminPushData,body)).code).toBe(409);expect(writes).toBe(count)
 })
 it('duplicate canonical queueID拒绝整包，0版terminal仍不可被stale復活',async()=>{
  expect((await call(handlers.adminPushData,{dataset:{waitlist:[w('W1'),w(' W1 ')]}})).code).toBe(400);expect(writes).toBe(0)
  records.set('waitlist/W1',w('W1','left'));expect((await call(handlers.adminPushData,{dataset:{waitlist:[w('W1')]}})).code).toBe(409);expect(writes).toBe(0)
 })
})
