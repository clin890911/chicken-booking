// night-50 P1：「到了 · 選桌／換桌入座」一次完成（arriveSeat.seatArriveSelection）。
// B5：預配桌被別組佔 → 選空桌確認＝拿掉預配＋指派＋入座；原預配桌（別組在用）不動；復原倒回原預配、新桌回空桌。
// B3：橫幅改到店人數 → 入座時一併寫回 guests（partySplit：有拆分就連 adults 一起寫）；復原人數也倒回。
// 用真的 service（localStorage），context 動作以薄包裝注入（同 BookingContext 的呼叫形狀）。
import { describe, it, expect, beforeEach } from 'vitest'
import * as seating from '../../src/services/seatingService'
import * as tableService from '../../src/services/tableService'
import * as bookingService from '../../src/services/bookingService'
import { seatArriveSelection, preassignTakenByOthers } from '../../src/utils/arriveSeat'

const mkTable = (number, capacity, over = {}) => ({
  number, capacity, floor: '1F', x: 100, y: 100, w: 80, h: 75, isActive: true, outage: null,
  status: 'vacant', currentBookingId: null, currentRef: null, seatedAt: null, mergedWith: null, blockReason: null, updatedAt: null, ...over,
})
const deps = () => ({
  tables: tableService.listAll(),
  updateBooking: (id, patch) => bookingService.updateByStaff(id, patch),
  clearBookingPreassign: (id) => bookingService.unassignTable(id),
  preassignBookingTables: (id, nums) => bookingService.assignTables(id, nums),
  assignAndSeatBooking: (id, nums) => seating.assignAndSeatBooking(id, nums),
  undoSeatBooking: (snap) => seating.undoSeatBooking(snap),
})
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }

let occ, wang
beforeEach(() => {
  localStorage.clear()
  occ = bookingService.create({ name: '佔桌', phone: '', guests: 2, date: today(), timeSlot: '17:00', source: 'walkin', status: 'confirmed' })
  wang = bookingService.create({ name: '王先生', phone: '0911000001', guests: 4, date: today(), timeSlot: '18:00', source: 'phone', status: 'confirmed' })
  bookingService.assignTables(wang.id, ['102'])
  tableService.bulkWrite([mkTable('102', 4, { status: 'dining', currentBookingId: occ.id }), mkTable('103', 4), mkTable('104', 6)])
  wang = bookingService.getById(wang.id)
})

describe('preassignTakenByOthers', () => {
  it('預配桌被別組佔 → true；桌空 → false；桌鎖給本筆 → false', () => {
    expect(preassignTakenByOthers(wang, tableService.listAll())).toBe(true)
    expect(preassignTakenByOthers(wang, [mkTable('102', 4)])).toBe(false)
    expect(preassignTakenByOthers(wang, [mkTable('102', 4, { status: 'reserved', currentBookingId: wang.id })])).toBe(false)
  })
})

describe('seatArriveSelection：B5 預配桌被佔 → 換桌入座一次完成', () => {
  it('入座 103：訂位 arrived＋主桌 103、103 用餐中指向本筆；原預配 102 仍是別組', () => {
    const res = seatArriveSelection(wang, ['103'], { need: 4, ...deps() })
    expect(res.ok).toBe(true)
    expect(res.reseatFrom).toEqual(['102'])
    expect(bookingService.getById(wang.id)).toMatchObject({ status: 'arrived', assignedTableId: '103', extraTableIds: [] })
    expect(tableService.getByNumber('103')).toMatchObject({ status: 'dining', currentBookingId: wang.id })
    expect(tableService.getByNumber('102')).toMatchObject({ status: 'dining', currentBookingId: occ.id })
  })

  it('復原：訂位回待到＋原預配 102、103 回空桌；102 仍不動', () => {
    const res = seatArriveSelection(wang, ['103'], { need: 4, ...deps() })
    const u = res.undo()
    expect(u.ok).toBe(true)
    expect(bookingService.getById(wang.id)).toMatchObject({ status: 'confirmed', assignedTableId: '102', extraTableIds: [] })
    expect(tableService.getByNumber('103')).toMatchObject({ status: 'vacant', currentBookingId: null })
    expect(tableService.getByNumber('102')).toMatchObject({ status: 'dining', currentBookingId: occ.id })
  })

  it('選到的桌不能入座（被佔）→ 失敗且預配寫回原樣', () => {
    const res = seatArriveSelection(wang, ['102'], { need: 4, ...deps() })
    expect(res.ok).toBe(false)
    expect(bookingService.getById(wang.id)).toMatchObject({ status: 'confirmed', assignedTableId: '102', guests: 4 })
  })

  it('桌已鎖給本筆 → 不走這條（請按客人到了）', () => {
    tableService.bulkWrite([mkTable('102', 4, { status: 'reserved', currentBookingId: wang.id }), mkTable('103', 4)])
    const res = seatArriveSelection(wang, ['103'], { need: 4, ...deps() })
    expect(res.ok).toBe(false)
    expect(tableService.getByNumber('102')).toMatchObject({ status: 'reserved', currentBookingId: wang.id })
  })
})

describe('seatArriveSelection：B3 到店人數改了', () => {
  it('未配桌 4→6 入座 104：guests＝6；復原後人數回 4、回未配桌', () => {
    const zhang = bookingService.create({ name: '張先生', phone: '0911000003', guests: 4, date: today(), timeSlot: '18:00', source: 'phone', status: 'confirmed' })
    const res = seatArriveSelection(zhang, ['104'], { need: 6, ...deps() })
    expect(res.ok).toBe(true)
    expect(res.guestsChanged).toBe(true)
    expect(bookingService.getById(zhang.id)).toMatchObject({ status: 'arrived', guests: 6, assignedTableId: '104' })
    expect(res.undo().ok).toBe(true)
    expect(bookingService.getById(zhang.id)).toMatchObject({ status: 'confirmed', guests: 4, assignedTableId: null })
    expect(tableService.getByNumber('104')).toMatchObject({ status: 'vacant', currentBookingId: null })
  })

  it('有大人／小孩拆分 → adults 跟著改（guests＝adults＋children）', () => {
    const fam = bookingService.create({ name: '林家', phone: '0911000009', guests: 4, adults: 3, children: 1, date: today(), timeSlot: '18:00', source: 'phone', status: 'confirmed' })
    const res = seatArriveSelection(fam, ['104'], { need: 6, ...deps() })
    expect(res.ok).toBe(true)
    const b = bookingService.getById(fam.id)
    expect(b).toMatchObject({ guests: 6, adults: 5, children: 1 })
  })

  it('預配被佔＋人數 4→6 一起改：入座 104、復原回 4 位＋原預配 102', () => {
    const res = seatArriveSelection(wang, ['104'], { need: 6, ...deps() })
    expect(res.ok).toBe(true)
    expect(bookingService.getById(wang.id)).toMatchObject({ status: 'arrived', guests: 6, assignedTableId: '104' })
    expect(res.undo().ok).toBe(true)
    expect(bookingService.getById(wang.id)).toMatchObject({ status: 'confirmed', guests: 4, assignedTableId: '102' })
    expect(tableService.getByNumber('102')).toMatchObject({ status: 'dining', currentBookingId: occ.id })
  })

  it('人數超過所選桌（擠一擠也不夠）→ 失敗，人數與預配都寫回', () => {
    const res = seatArriveSelection(wang, ['103'], { need: 8, ...deps() })
    expect(res.ok).toBe(false)
    expect(bookingService.getById(wang.id)).toMatchObject({ status: 'confirmed', guests: 4, assignedTableId: '102' })
  })
})
