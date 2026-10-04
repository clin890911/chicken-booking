import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { replacePendingBookingTables } from '../../src/services/seatingService'
import * as tables from '../../src/services/tableService'
import * as bookings from '../../src/services/bookingService'
const mk=(number,capacity,extra={})=>({number,capacity,floor:'1F',isActive:true,status:'vacant',currentBookingId:null,currentRef:null,seatedAt:null,mergedWith:null,blockReason:null,...extra})
let b
const setup=(held=true,extra={})=>{
  b=bookings.create({name:'測試客',phone:'0900000000',guests:8,date:'2026-10-04',timeSlot:held?'12:00':'17:00',...extra})
  bookings.assignTables(b.id,['A','B'])
  tables.bulkWrite([mk('A',6,held?{status:'reserved',currentBookingId:b.id}:{}),mk('B',4,held?{status:'reserved',currentBookingId:b.id}:{}),mk('C',4),mk('D',4),mk('E',8),mk('F',4,{floor:'2F'}),mk('X',6,{status:'dining',currentBookingId:'OTHER'})])
}
const snapshot=()=>({tables:localStorage.getItem('chicken_tables_v3'),bookings:localStorage.getItem('chicken_bookings_v1')})
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(new Date(2026,9,4,12));setup()})
afterEach(()=>vi.useRealTimers())
describe('未到整組改桌，保留原訂位直到完整成功',()=>{
 it('多→多4+4：釋舊桌並鎖新桌，原訂位仍confirmed',()=>{
  expect(replacePendingBookingTables(b.id,['C','D']).ok).toBe(true)
  expect(bookings.getById(b.id)).toMatchObject({status:'confirmed',assignedTableId:'C',extraTableIds:['D']})
  expect(tables.getByNumber('A').status).toBe('vacant');expect(tables.getByNumber('B').status).toBe('vacant')
  expect(tables.getByNumber('C')).toMatchObject({status:'reserved',currentBookingId:b.id})
 })
 it('可保留本人reserved主桌，6+4重選且只釋不再選的副桌',()=>{
  expect(replacePendingBookingTables(b.id,['A','C']).ok).toBe(true)
  expect(tables.getByNumber('A').status).toBe('reserved');expect(tables.getByNumber('B').status).toBe('vacant')
 })
 it('多→單8席：清掉extraTableIds與兩張舊鎖桌',()=>{
  expect(replacePendingBookingTables(b.id,['E']).ok).toBe(true)
  expect(bookings.getById(b.id).extraTableIds).toEqual([])
  expect(tables.getByNumber('A').status).toBe('vacant')
 })
 it('單→多：保留同一booking ID，不取消訂位',()=>{
  bookings.assignTables(b.id,['E']);tables.clearTable('A');tables.clearTable('B');tables.reserveTable('E',b.id)
  expect(replacePendingBookingTables(b.id,['C','D']).ok).toBe(true)
  expect(tables.getByNumber('E').status).toBe('vacant');expect(bookings.getById(b.id).status).toBe('confirmed')
 })
 it.each([['X','C'],['C','F'],['C'],[],['MISSING','C']])('不合法選擇%s不寫任何半套資料',(...nums)=>{
  const before=snapshot();expect(replacePendingBookingTables(b.id,nums).ok).toBe(false);expect(snapshot()).toEqual(before)
 })
 it('停用桌擋下、原配桌完整保留',()=>{
  tables.setActive('C',false);const before=snapshot();expect(replacePendingBookingTables(b.id,['C','D']).ok).toBe(false);expect(snapshot()).toEqual(before)
 })
 it('原預配桌已被另一組占用，改到別桌不清掉另一組',()=>{
  setup(false);tables.seatTable('A','OTHER')
  expect(replacePendingBookingTables(b.id,['C','D']).ok).toBe(true)
  expect(tables.getByNumber('A')).toMatchObject({status:'dining',currentBookingId:'OTHER'})
  expect(tables.getByNumber('C').status).toBe('vacant')
 })
 it('預配在近時段改桌時鎖新桌，較早時段維持預配',()=>{
  setup(false);expect(replacePendingBookingTables(b.id,['C','D']).kind).toBe('preassign');expect(tables.getByNumber('C').status).toBe('vacant')
  vi.setSystemTime(new Date(2026,9,4,16,40));expect(replacePendingBookingTables(b.id,['E']).kind).toBe('hold');expect(tables.getByNumber('E').status).toBe('reserved')
 })
 it('pending可重選；arrived不可，甚至booking誤留confirmed但桌已dining亦不可',()=>{
  bookings.setStatus(b.id,'pending');expect(replacePendingBookingTables(b.id,['E']).ok).toBe(true)
  bookings.setStatus(b.id,'arrived');let before=snapshot();expect(replacePendingBookingTables(b.id,['C','D']).ok).toBe(false);expect(snapshot()).toEqual(before)
  bookings.setStatus(b.id,'confirmed');tables.seatTable('E',b.id);before=snapshot();expect(replacePendingBookingTables(b.id,['C','D']).ok).toBe(false);expect(snapshot()).toEqual(before)
 })
 it('第二份儲存失敗，兩份資料回滾為完整原配桌',()=>{
  const before=snapshot();const write=localStorage.setItem.bind(localStorage);let failed=false
  vi.spyOn(localStorage,'setItem').mockImplementation((key,value)=>{if(key==='chicken_bookings_v1'&&!failed){failed=true;throw new Error('storage failure')}write(key,value)})
  expect(replacePendingBookingTables(b.id,['C','D'])).toMatchObject({ok:false,error:expect.stringContaining('原配桌已保留')})
  expect(snapshot()).toEqual(before)
 })
})
