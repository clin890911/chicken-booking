const fail=()=>{throw Object.assign(Error('operational-state-changed'),{status:409})}
const equal=(a,b)=>JSON.stringify(a??null)===JSON.stringify(b??null)
// Merge layout edits while fencing stale occupancy snapshots. Versions are server-owned.
const RELEASED_BOOKING_STATUSES=['cancelled','completed','noshow']
const bookingTables=b=>[b?.assignedTableId,...(Array.isArray(b?.extraTableIds)?b.extraTableIds:[])].filter(n=>n!=null&&n!=='').map(String)
// 無版本桌的跨裝置搶桌（情境 A7）：雲端這張桌正被訂位 X 用餐中，這次寫入卻要把它改成另一筆訂位 Y。
// 一般帶位／「到了」路徑不寫 operationalVersion，下方版本圍欄管不到，後寫者會把 X 變孤兒——在此拒絕（409）。
// 只擋這一種形狀：釋桌（currentBookingId 清空）、同一筆更新、團體桌（currentBookingId 為 null）、
// 非用餐中（reserved 預配可被現場覆蓋、cleaning 客人已離席）一律照舊放行。
// 例外：同一包推送也送了 X，且 X 已結束（取消／完成／No-show）或已不再持有這張桌——那是這台離線期間
// 自己清桌再帶下一組，雲端只是還沒收到前半段，不是搶桌。
// pushedBookings：同一包推送的 bookings（id → 寫入資料），由 adminPushData 掛在 op.syncContext。
function stealsOccupiedTable(op,current,pushedBookings){
  const item=op.data||{},owner=current?.currentBookingId,next=item.currentBookingId
  if(op.delete||current?.status!=='dining'||owner==null||owner===''||!Object.hasOwn(item,'currentBookingId'))return false
  if(next==null||next===''||String(next)===String(owner))return false
  const ownerWrite=pushedBookings?.get?.(String(owner))
  if(ownerWrite){
    const tableNo=String(item.number??current.number??op.ref.path.split('/')[1])
    if(RELEASED_BOOKING_STATUSES.includes(ownerWrite.status)||!bookingTables(ownerWrite).includes(tableNo))return false
  }
  return true
}
// 搶桌拒絕用專用 code（HTTP 仍 409），與版本圍欄／候位的 operational-state-changed 分開：前端只對這個 code
// 做「改採雲端桌、訂位退回待到」自癒並跳專用提示。tables＝被拒的桌號（回應 body 一併帶回，前端只記這些桌）。
export const TABLE_STEAL_CODE='table-occupied-elsewhere'
const failSteal=tableNo=>{throw Object.assign(Error(TABLE_STEAL_CODE),{status:409,tables:[String(tableNo)]})}
// 一包推送逐筆守門的結果（Promise.allSettled 形狀）：全部通過回傳值陣列；有失敗時——
// 只要有任何非搶桌錯誤就丟第一個非搶桌錯誤（行為同舊的 Promise.all）；全是搶桌就合併成一個、tables 列出全部被搶的桌。
export function settleGuardResults(results){
  const failed=results.filter(r=>r.status==='rejected').map(r=>r.reason)
  if(!failed.length)return results.map(r=>r.value)
  const other=failed.find(e=>e?.message!==TABLE_STEAL_CODE)
  if(other)throw other
  throw Object.assign(Error(TABLE_STEAL_CODE),{status:409,tables:[...new Set(failed.flatMap(e=>e.tables||[]))]})
}
export function guardOperationalSync(op,current,{pushedBookings}=op.syncContext||{}){
  const kind=op.ref.path.split('/')[0],item=op.data||{}
  if(kind==='bookings'&&!current&&(item.createdBy==='waitlist'||item.waitlistId||item.waitlistCommandId))fail()
  if(!current?.operationalVersion){
    if(kind==='tables'&&stealsOccupiedTable(op,current,pushedBookings))failSteal(item.number??current?.number??op.ref.path.split('/')[1])
    const {operationalVersion,waitlistId,waitlistCommandId,...data}=item;return {...op,data}
  }
  if(op.delete){
    if(kind==='tables'&&current.status==='vacant'&&!current.currentBookingId&&!current.currentRef)return op
    if(kind==='bookings'&&['cancelled','completed','noshow'].includes(current.status))return op
    fail()
  }
  const keys=kind==='tables'?['status','currentBookingId','currentRef','seatedAt','waitlistId']:kind==='bookings'?['status','assignedTableId','extraTableIds','actualArrivalTime']:[]
  const changed=keys.some(k=>Object.hasOwn(item,k)&&!equal(item[k],current[k]))
  if(changed&&item.operationalVersion!==current.operationalVersion)fail()
  const data={...item,operationalVersion:current.operationalVersion+(changed?1:0)}
  if(kind==='bookings')for(const k of ['waitlistId','waitlistCommandId'])data[k]=current[k]||null
  if(!changed)for(const k of keys)data[k]=current[k]??null
  return {...op,data}
}
