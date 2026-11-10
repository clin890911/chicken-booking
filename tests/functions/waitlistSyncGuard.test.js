import {describe,it,expect} from 'vitest'
import {guardOperationalSync,settleGuardResults} from '../../functions/lib/waitlistSyncGuard.js'
const op=(data,path='tables/101')=>({ref:{path},data})
describe('server operational occupancy fence',()=>{
 it('rejects an old layout snapshot which would clear an occupied command table',()=>{
  expect(()=>guardOperationalSync(op({status:'vacant',currentBookingId:null}),{status:'dining',currentBookingId:'WLB_A',operationalVersion:1})).toThrow('operational-state-changed')
 })
 it('allows layout edits with matching occupancy without resetting server version',()=>{
  const current={status:'dining',currentBookingId:'WLB_A',seatedAt:'now',currentRef:null,waitlistId:'W1',operationalVersion:2}
  expect(guardOperationalSync(op({...current,x:200,operationalVersion:1}),current).data).toMatchObject({...current,x:200})
 })
 it('preserves existing checkout and move flows with a current version and advances fence',()=>{
  expect(guardOperationalSync(op({status:'cleaning',currentBookingId:null,operationalVersion:2}),{status:'dining',currentBookingId:'B1',operationalVersion:2}).data.operationalVersion).toBe(3)
 })
 it('rejects invented derived bookings and deletion of protected tables',()=>{
  expect(()=>guardOperationalSync(op({waitlistId:'W1'},'bookings/NEW'),null)).toThrow()
  expect(()=>guardOperationalSync({ref:{path:'tables/101'},delete:true},{status:'dining',operationalVersion:1})).toThrow()
 })
})

// 情境 A7：兩台 iPad 同時帶同一桌。一般帶位／「到了」不寫 operationalVersion，靠搶桌守門擋第二筆。
describe('unversioned table steal fence (A7: two devices seat the same table)',()=>{
 const t=(data)=>op({number:'102',...data},'tables/102')
 const dining={number:'102',status:'dining',currentBookingId:'WALKIN_A',currentRef:null,seatedAt:'t1'}
 const withPush=(o,bookings)=>({...o,syncContext:{pushedBookings:new Map(Object.entries(bookings))}})
 it('rejects a second booking overwriting a table another booking is dining at',()=>{
  // 第一台：空桌 → A 入座，放行
  expect(guardOperationalSync(t({status:'dining',currentBookingId:'WALKIN_A',seatedAt:'t1'}),{number:'102',status:'vacant',currentBookingId:null}).data.currentBookingId).toBe('WALKIN_A')
  // 第二台（舊快照以為 102 空）：B 入座，拒絕
  let err
  try{guardOperationalSync(t({status:'dining',currentBookingId:'WALKIN_B',seatedAt:'t2'}),dining)}catch(e){err=e}
  expect(err?.message).toBe('table-occupied-elsewhere')
  expect(err?.status).toBe(409)
  expect(err?.tables).toEqual(['102'])
  // 字串／數字 id 混用仍判為不同訂位
  expect(()=>guardOperationalSync(t({status:'dining',currentBookingId:77}),{...dining,currentBookingId:'76'})).toThrow('table-occupied-elsewhere')
 })
 it('rejects even when the push carries the owner booking but it still holds this table',()=>{
  expect(()=>guardOperationalSync(withPush(t({status:'dining',currentBookingId:'WALKIN_B'}),{WALKIN_A:{status:'seated',assignedTableId:'102'}}),dining)).toThrow('table-occupied-elsewhere')
 })
 it('allows updates by the same booking (string/number id mix included)',()=>{
  expect(guardOperationalSync(t({...dining,notes:'加湯'}),dining).data.notes).toBe('加湯')
  expect(()=>guardOperationalSync(t({status:'dining',currentBookingId:5}),{...dining,currentBookingId:'5'})).not.toThrow()
 })
 it('allows releasing the table (checkout to cleaning, clear to vacant)',()=>{
  expect(guardOperationalSync(t({status:'vacant',currentBookingId:null,currentRef:null,seatedAt:null}),dining).data.status).toBe('vacant')
  expect(guardOperationalSync(t({status:'cleaning',currentBookingId:null}),dining).data.status).toBe('cleaning')
  // 結帳離席保留 currentBookingId（checkoutTable 不清），不是改成別筆
  expect(guardOperationalSync(t({status:'cleaning',currentBookingId:'WALKIN_A',seatedAt:null}),dining).data.status).toBe('cleaning')
 })
 it('allows group-held tables (currentBookingId null on both sides)',()=>{
  const held={number:'102',status:'reserved',currentBookingId:null,currentRef:{type:'group',groupId:'G1',batchId:'B1'}}
  expect(()=>guardOperationalSync(t({...held,status:'dining',seatedAt:'t3'}),held)).not.toThrow()
  const groupDining={...held,status:'dining',seatedAt:'t3'}
  expect(()=>guardOperationalSync(t({...groupDining,currentRef:{type:'group',groupId:'G1',batchId:'B2'}}),groupDining)).not.toThrow()
 })
 it('allows outage maintenance updates that keep the current occupant',()=>{
  const outage={from:'2026-11-11',until:'2026-11-12',reason:'椅子壞'}
  expect(guardOperationalSync(t({...dining,outage}),dining).data.outage).toEqual(outage)
  expect(guardOperationalSync(t({...dining,outage:null}),{...dining,outage}).data.outage).toBeNull()
  // 只帶 outage 欄位的局部寫入（沒有 currentBookingId 鍵）也照舊放行
  expect(()=>guardOperationalSync(t({outage}),dining)).not.toThrow()
 })
 it('allows overriding a reserved (pre-assigned) or cleaning table, which staff may legitimately re-seat',()=>{
  expect(()=>guardOperationalSync(t({status:'dining',currentBookingId:'WALKIN_B'}),{...dining,status:'reserved'})).not.toThrow()
  expect(()=>guardOperationalSync(t({status:'dining',currentBookingId:'WALKIN_B'}),{...dining,status:'cleaning'})).not.toThrow()
 })
 it('allows re-seating when the same push finishes or moves the previous booking (offline clear-then-seat)',()=>{
  for(const owner of [{status:'completed',assignedTableId:'102'},{status:'cancelled',assignedTableId:null},{status:'noshow'},{status:'seated',assignedTableId:'105'}]){
   expect(()=>guardOperationalSync(withPush(t({status:'dining',currentBookingId:'WALKIN_B'}),{WALKIN_A:owner}),dining)).not.toThrow()
  }
 })
 it('leaves versioned tables to the existing version fence (matching version passes)',()=>{
  const v={...dining,operationalVersion:3}
  expect(guardOperationalSync(t({status:'dining',currentBookingId:'WALKIN_B',operationalVersion:3}),v).data.operationalVersion).toBe(4)
  expect(()=>guardOperationalSync(t({status:'dining',currentBookingId:'WALKIN_B',operationalVersion:2}),v)).toThrow('operational-state-changed')
 })
})

describe('settleGuardResults（一包推送的逐筆守門結果彙整）',()=>{
 const steal=n=>Object.assign(Error('table-occupied-elsewhere'),{status:409,tables:[n]})
 it('all pass → values',()=>{
  expect(settleGuardResults([{status:'fulfilled',value:1},{status:'fulfilled',value:2}])).toEqual([1,2])
 })
 it('only steals → one 409 listing every stolen table',()=>{
  let err;try{settleGuardResults([{status:'rejected',reason:steal('102')},{status:'fulfilled',value:1},{status:'rejected',reason:steal('105')}])}catch(e){err=e}
  expect(err).toMatchObject({message:'table-occupied-elsewhere',status:409,tables:['102','105']})
 })
 it('any non-steal rejection wins (version fence keeps its own code)',()=>{
  const fence=Object.assign(Error('operational-state-changed'),{status:409})
  expect(()=>settleGuardResults([{status:'rejected',reason:steal('102')},{status:'rejected',reason:fence}])).toThrow('operational-state-changed')
 })
})
