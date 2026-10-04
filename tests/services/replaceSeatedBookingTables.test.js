import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as seating from '../../src/services/seatingService'
import * as tables from '../../src/services/tableService'
import * as bookings from '../../src/services/bookingService'
import * as groups from '../../src/services/groupReservationService'
import { getSettings } from '../../src/services/settingsService'
import { seatedMoveWarningSignature } from '../../src/utils/seatedMoveWarnings'
const mk=(number,capacity,extra={})=>({number,capacity,floor:'1F',isActive:true,status:'vacant',currentBookingId:null,currentRef:null,seatedAt:null,...extra})
const start='2026-10-04T03:15:00.000Z'
let b
const snapshot=()=>['chicken_tables_v3','chicken_bookings_v1'].map(k=>localStorage.getItem(k))
beforeEach(()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date(2026,9,4,12))
 b=bookings.create({name:'九位測試',guests:9,date:'2026-10-04',timeSlot:'11:30',status:'arrived'})
 bookings.update(b.id,{assignedTableId:'103',extraTableIds:['113'],actualArrivalTime:start,customTimer:'preserved'})
 tables.bulkWrite([mk('103',6,{status:'dining',currentBookingId:b.id,seatedAt:start}),mk('113',4,{status:'reserved',currentBookingId:b.id}),mk('C',6),mk('D',4),mk('E',10),mk('F',4,{floor:'2F'})])
})
afterEach(()=>vi.useRealTimers())
describe('已入座整組換桌',()=>{
 it('legacy dining＋reserved → 整組新桌，保留訂位/arrival/計時，旧桌清潔無links',()=>{
  expect(seating.replaceSeatedBookingTables(b.id,['C','D']).ok).toBe(true)
  expect(bookings.getById(b.id)).toMatchObject({id:b.id,status:'arrived',actualArrivalTime:start,customTimer:'preserved',assignedTableId:'C',extraTableIds:['D']})
  for(const n of ['C','D'])expect(tables.getByNumber(n)).toMatchObject({status:'dining',seatedAt:start,currentBookingId:b.id})
  for(const n of ['103','113'])expect(tables.getByNumber(n)).toMatchObject({status:'cleaning',currentBookingId:null,currentRef:null,seatedAt:null})
 })
 it('保留副桌轉主桌與修正legacy reserved，撤出主桌不重置計時',()=>{
  expect(seating.replaceSeatedBookingTables(b.id,['113','C']).ok).toBe(true)
  expect(tables.getByNumber('113')).toMatchObject({status:'dining',seatedAt:start})
  expect(bookings.getById(b.id).assignedTableId).toBe('113')
 })
 it('併→單→併及重複桌號去重',()=>{
  expect(seating.replaceSeatedBookingTables(b.id,['E','E']).ok).toBe(true)
  expect(bookings.getById(b.id).extraTableIds).toEqual([])
  tables.clearTable('103');tables.clearTable('113')
  expect(seating.replaceSeatedBookingTables(b.id,['103','113']).ok).toBe(true)
  expect(tables.getByNumber('113').seatedAt).toBe(start)
 })
 it.each([[],['C'],['C','F'],['MISSING']])('非法目標%s完整不動',(...nums)=>{
  const before=snapshot();expect(seating.replaceSeatedBookingTables(b.id,nums).ok).toBe(false);expect(snapshot()).toEqual(before)
 })
 it.each([{status:'cleaning'},{currentBookingId:'OTHER'},{currentRef:{type:'group',groupId:'other'}},{status:'vacant'}])('来源被改%s拒绝',patch=>{
  tables.setStatus('113',patch.status||'reserved',patch);const before=snapshot();expect(seating.replaceSeatedBookingTables(b.id,['E']).ok).toBe(false);expect(snapshot()).toEqual(before)
 })
 it.each([{isActive:false},{status:'cleaning'},{currentBookingId:'OTHER'},{currentRef:{type:'group',groupId:'other'}},{outage:{from:'2026-10-04',to:'2026-10-04'}}])('目标被改%s拒绝',patch=>{
  tables.bulkWrite(tables.listAll().map(t=>t.number==='E'?{...t,...patch}:t));const before=snapshot();expect(seating.replaceSeatedBookingTables(b.id,['E']).ok).toBe(false);expect(snapshot()).toEqual(before)
 })
 it('來源桌組被另次換桌更動時拒絕舊UI',()=>{
  const before=snapshot();expect(seating.replaceSeatedBookingTables(b.id,['E'],{originalTableNumbers:['103']}).ok).toBe(false);expect(snapshot()).toEqual(before)
 })
 it.each(['chicken_tables_v3','chicken_bookings_v1'])('寫%s失敗回滾',key=>{
  const before=snapshot(),write=localStorage.setItem.bind(localStorage);let failed=false
  vi.spyOn(localStorage,'setItem').mockImplementation((k,v)=>{if(k===key&&!failed){failed=true;throw Error('failed')}write(k,v)})
  expect(seating.replaceSeatedBookingTables(b.id,['E']).ok).toBe(false);expect(snapshot()).toEqual(before)
 })
 it('按now重驗下一組預配，確認快照後整組覆蓋同一交易；晚餐預配保留',()=>{
  const other=bookings.create({name:'下一組',guests:4,date:'2026-10-04',timeSlot:'12:30',assignedTableId:'E'})
  const late=bookings.create({name:'晚餐',guests:4,date:'2026-10-04',timeSlot:'18:00',assignedTableId:'E'})
  const before=snapshot();expect(seating.replaceSeatedBookingTables(b.id,['E']).ok).toBe(false);expect(snapshot()).toEqual(before)
  const signature=seatedMoveWarningSignature(b.id,['E'],{bookings:bookings.listAll(),groups:groups.listAll(),tables:tables.listAll(),settings:getSettings()})
  expect(seating.replaceSeatedBookingTables(b.id,['E'],{confirmedConflictTables:['E'],confirmedWarningSignature:signature}).ok).toBe(true)
  expect(bookings.getById(other.id).assignedTableId).toBe(null);expect(bookings.getById(late.id).assignedTableId).toBe('E')
 })
 it('確認後同桌新增他人預配，舊確認失效',()=>{
  bookings.create({name:'下一組',guests:4,date:'2026-10-04',timeSlot:'12:30',assignedTableId:'E'})
  const signature=seatedMoveWarningSignature(b.id,['E'],{bookings:bookings.listAll(),groups:groups.listAll(),tables:tables.listAll(),settings:getSettings()})
  bookings.create({name:'新預配',guests:4,date:'2026-10-04',timeSlot:'12:30',assignedTableId:'E'})
  const before=snapshot();expect(seating.replaceSeatedBookingTables(b.id,['E'],{confirmedConflictTables:['E'],confirmedWarningSignature:signature}).ok).toBe(false);expect(snapshot()).toEqual(before)
 })
 it('預配解除写失败，全组和被覆盖booking一起回滚',()=>{
  bookings.create({name:'下一組',guests:4,date:'2026-10-04',timeSlot:'12:30',assignedTableId:'E'})
  const signature=seatedMoveWarningSignature(b.id,['E'],{bookings:bookings.listAll(),groups:groups.listAll(),tables:tables.listAll(),settings:getSettings()})
  const before=snapshot(),write=localStorage.setItem.bind(localStorage);let writes=0
  vi.spyOn(localStorage,'setItem').mockImplementation((k,v)=>{if(k==='chicken_bookings_v1'&&++writes===2)throw Error('failed');write(k,v)})
  expect(seating.replaceSeatedBookingTables(b.id,['E'],{confirmedConflictTables:['E'],confirmedWarningSignature:signature}).ok).toBe(false);expect(snapshot()).toEqual(before)
 })
 it('一般入座入口整组dining且不能重复arrival',()=>{
  bookings.setStatus(b.id,'confirmed');tables.reserveTable('103',b.id)
  expect(seating.seatBooking(b.id).ok).toBe(true);expect(tables.getByNumber('113').status).toBe('dining')
  const before=snapshot();expect(seating.seatBooking(b.id).ok).toBe(false);expect(snapshot()).toEqual(before)
 })
})
