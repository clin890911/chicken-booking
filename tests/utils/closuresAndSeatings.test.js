// 測試：場次（seating）對應、關閉時段判定、容量關閉短路、統一佔用解析器。
// 對應 src/utils/timeSlots.js（seatingForSlot/slotsInSeating）與
//      src/utils/capacity.js（isSlotClosed/isSeatingClosed/calcSlotCapacity 短路/resolveSlotOccupancy）。
import { describe, it, expect } from 'vitest'
import { seatingForSlot, slotsInSeating } from '../../src/utils/timeSlots'
import {
  isSlotClosed,
  isSeatingClosed,
  calcSlotCapacity,
  resolveSlotOccupancy,
  remainingTablesForSeating,
} from '../../src/utils/capacity'

const SEATINGS = [
  { id: 'lunch1', name: '午餐第一批', start: '11:00', end: '12:30' },
  { id: 'lunch2', name: '午餐第二批', start: '12:30', end: '14:30' },
  { id: 'dinner1', name: '晚餐第一批', start: '17:00', end: '19:00' },
]
const baseSettings = (over = {}) => ({
  openTime: '11:00', closeTime: '19:00', slotInterval: 30,
  diningDurationMin: 90, cleanupBufferMin: 10,
  seatings: SEATINGS,
  closures: { closedDates: [], closedSlots: {}, closedSeatings: {} },
  ...over,
})
const DATE = '2026-06-09'

describe('seatingForSlot', () => {
  it('把抵達時段歸到所屬場次（半開區間 [start,end)）', () => {
    expect(seatingForSlot(baseSettings(), '11:00')?.id).toBe('lunch1')
    expect(seatingForSlot(baseSettings(), '12:00')?.id).toBe('lunch1')
    // 邊界 12:30 屬於 lunch2（end 為開區間，不含於 lunch1）
    expect(seatingForSlot(baseSettings(), '12:30')?.id).toBe('lunch2')
    expect(seatingForSlot(baseSettings(), '13:00')?.id).toBe('lunch2')
    expect(seatingForSlot(baseSettings(), '17:30')?.id).toBe('dinner1')
  })
  it('不在任何場次內回 null', () => {
    expect(seatingForSlot(baseSettings(), '15:00')).toBeNull()
    expect(seatingForSlot({ seatings: [] }, '11:00')).toBeNull()
  })
})

describe('slotsInSeating', () => {
  it('回傳場次涵蓋的抵達時段（依營業間隔產生、半開區間）', () => {
    expect(slotsInSeating(baseSettings(), SEATINGS[0])).toEqual(['11:00', '11:30', '12:00'])
    expect(slotsInSeating(baseSettings(), null)).toEqual([])
  })
})

describe('isSlotClosed', () => {
  it('整天公休 → 該日所有時段皆關閉', () => {
    const s = baseSettings({ closures: { closedDates: [DATE], closedSlots: {}, closedSeatings: {} } })
    expect(isSlotClosed(s, DATE, '11:00')).toBe(true)
    expect(isSlotClosed(s, DATE, '18:00')).toBe(true)
    expect(isSlotClosed(s, '2026-06-10', '11:00')).toBe(false)
  })
  it('關閉特定時段 → 僅該時段關閉', () => {
    const s = baseSettings({ closures: { closedDates: [], closedSlots: { [DATE]: ['12:00'] }, closedSeatings: {} } })
    expect(isSlotClosed(s, DATE, '12:00')).toBe(true)
    expect(isSlotClosed(s, DATE, '11:30')).toBe(false)
  })
  it('關閉整場次 → 該場次涵蓋的時段皆關閉、其他場次不受影響', () => {
    const s = baseSettings({ closures: { closedDates: [], closedSlots: {}, closedSeatings: { [DATE]: ['lunch1'] } } })
    expect(isSlotClosed(s, DATE, '11:00')).toBe(true)
    expect(isSlotClosed(s, DATE, '12:00')).toBe(true)
    expect(isSlotClosed(s, DATE, '13:00')).toBe(false) // lunch2 未關
    expect(isSlotClosed(s, DATE, '17:30')).toBe(false) // dinner1 未關
  })
  it('無關閉設定 → 一律未關閉', () => {
    expect(isSlotClosed(baseSettings(), DATE, '11:00')).toBe(false)
    expect(isSlotClosed({}, DATE, '11:00')).toBe(false)
  })
})

describe('isSeatingClosed', () => {
  it('整天公休或該場次被關 → true', () => {
    expect(isSeatingClosed(baseSettings({ closures: { closedDates: [DATE], closedSlots: {}, closedSeatings: {} } }), DATE, SEATINGS[0])).toBe(true)
    expect(isSeatingClosed(baseSettings({ closures: { closedDates: [], closedSlots: {}, closedSeatings: { [DATE]: ['lunch2'] } } }), DATE, SEATINGS[1])).toBe(true)
    expect(isSeatingClosed(baseSettings(), DATE, SEATINGS[0])).toBe(false)
  })
})

describe('calcSlotCapacity 關閉短路', () => {
  const tables = [{ number: '101', capacity: 6, isActive: true }, { number: '102', capacity: 4, isActive: true }]
  it('未關閉 → 正常計算剩餘', () => {
    expect(calcSlotCapacity(tables, [], DATE, '11:00', baseSettings(), [])).toBe(10)
  })
  it('時段被關 → 直接回 0（即使有空位）', () => {
    const s = baseSettings({ closures: { closedDates: [], closedSlots: { [DATE]: ['11:00'] }, closedSeatings: {} } })
    expect(calcSlotCapacity(tables, [], DATE, '11:00', s, [])).toBe(0)
  })
  it('整場次被關 → 該場次時段回 0', () => {
    const s = baseSettings({ closures: { closedDates: [], closedSlots: {}, closedSeatings: { [DATE]: ['lunch1'] } } })
    expect(calcSlotCapacity(tables, [], DATE, '11:30', s, [])).toBe(0)
    expect(calcSlotCapacity(tables, [], DATE, '13:00', s, [])).toBe(10) // lunch2 未關
  })
})

describe('resolveSlotOccupancy', () => {
  const tables = [
    { number: '101', capacity: 6, isActive: true },
    { number: '102', capacity: 6, isActive: true },
    { number: '107', capacity: 4, isActive: true },
    { number: '201', capacity: 6, isActive: true },
  ]
  const bookings = [
    { id: 'b1', date: DATE, timeSlot: '11:00', guests: 4, status: 'confirmed', assignedTableId: '107' }, // lunch1 已配桌
    { id: 'b2', date: DATE, timeSlot: '11:30', guests: 3, status: 'confirmed', assignedTableId: null },   // lunch1 未配桌
    { id: 'b3', date: DATE, timeSlot: '13:00', guests: 2, status: 'confirmed', assignedTableId: null },   // lunch2，不屬 lunch1
    { id: 'b4', date: DATE, timeSlot: '11:00', guests: 9, status: 'cancelled', assignedTableId: null },   // 已取消，排除
  ]
  const groups = [
    { id: 'g1', date: DATE, status: 'confirmed', agencyName: '幸福旅行社', batches: [
      { id: 'gb1', label: '第一梯', timeSlot: '11:00', tableNumbers: ['101', '102'], guests: 12 },
    ] },
    { id: 'g2', date: DATE, status: 'confirmed', agencyName: '大來', batches: [
      { id: 'gb2', label: '第一梯', timeSlot: '17:00', tableNumbers: ['201'], guests: 6 }, // dinner1，不屬 lunch1
    ] },
  ]

  it('lunch1：散客已配桌落桌、未配桌進摘要、團客整桌落桌、其他場次不混入', () => {
    const { byTable, summary } = resolveSlotOccupancy(tables, bookings, groups, DATE, SEATINGS[0], baseSettings())
    expect(byTable['107']).toMatchObject({ kind: 'walkin' })
    expect(byTable['101']).toMatchObject({ kind: 'group' })
    expect(byTable['102']).toMatchObject({ kind: 'group' })
    expect(byTable['201']).toBeUndefined() // dinner1 團不入 lunch1
    expect(summary.walkinGuests).toBe(7)            // b1(4)+b2(3)，b3 屬 lunch2、b4 取消
    expect(summary.unassignedWalkinGuests).toBe(3)  // b2
    expect(summary.walkinAssignedTables).toBe(1)    // 107
    expect(summary.groupHeldSeats).toBe(12)         // 101(6)+102(6)
    expect(summary.groupTableCount).toBe(2)
    expect(summary.totalSeats).toBe(22)
    expect(summary.remaining).toBe(22 - 7 - 12)     // 3
    expect(summary.closed).toBe(false)
  })

  it('同團跨梯重用同桌：只算一次座位', () => {
    const g = [{ id: 'g', date: DATE, status: 'confirmed', batches: [
      { id: 'a', timeSlot: '11:00', tableNumbers: ['101'], guests: 6 },
      { id: 'b', timeSlot: '12:00', tableNumbers: ['101'], guests: 6 }, // 同桌、同屬 lunch1
    ] }]
    const { summary } = resolveSlotOccupancy(tables, [], g, DATE, SEATINGS[0], baseSettings())
    expect(summary.groupTableCount).toBe(1)
    expect(summary.groupHeldSeats).toBe(6)
  })

  it('場次被關 → closed=true 且 remaining=0', () => {
    const s = baseSettings({ closures: { closedDates: [], closedSlots: {}, closedSeatings: { [DATE]: ['lunch1'] } } })
    const { summary } = resolveSlotOccupancy(tables, bookings, groups, DATE, SEATINGS[0], s)
    expect(summary.closed).toBe(true)
    expect(summary.remaining).toBe(0)
  })

  it('summary 帶 totalTables / occupiedTables / remainingTables', () => {
    const { summary } = resolveSlotOccupancy(tables, bookings, groups, DATE, SEATINGS[0], baseSettings())
    expect(summary.totalTables).toBe(4)       // 101,102,107,201 皆 active
    expect(summary.occupiedTables).toBe(3)    // 107(walkin)+101,102(group)
    expect(summary.remainingTables).toBe(1)
  })
})

describe('remainingTablesForSeating', () => {
  const tables = [
    { number: '101', capacity: 6, isActive: true },
    { number: '102', capacity: 6, isActive: true },
    { number: '107', capacity: 4, isActive: true },
    { number: '201', capacity: 6, isActive: true },
  ]
  const bookings = [
    { id: 'b1', date: DATE, timeSlot: '11:00', guests: 4, status: 'confirmed', assignedTableId: '107' },
  ]
  const groups = [
    { id: 'g1', date: DATE, status: 'confirmed', batches: [
      { id: 'gb1', timeSlot: '11:00', tableNumbers: ['101', '102'], guests: 12 },
    ] },
  ]

  it('空日：剩餘桌=全部桌、剩餘席=全部席', () => {
    const r = remainingTablesForSeating(tables, [], [], DATE, SEATINGS[0], baseSettings())
    expect(r.remainingTables).toBe(4)
    expect(r.remainingSeats).toBe(22)
    expect(r.closed).toBe(false)
  })

  it('lunch1 佔用：107 散客 + 101/102 團 → 剩 1 桌 / 6 席', () => {
    const r = remainingTablesForSeating(tables, bookings, groups, DATE, SEATINGS[0], baseSettings())
    expect(r.occupiedTables).toBe(3)
    expect(r.remainingTables).toBe(1)
    expect(r.remainingSeats).toBe(22 - 4 - 12) // 6
  })

  it('大桌被小散客佔仍算 1 桌占用（桌保守、席嚴格）', () => {
    const oneWalkin = [{ id: 'w', date: DATE, timeSlot: '11:00', guests: 2, status: 'confirmed', assignedTableId: '101' }]
    const r = remainingTablesForSeating(tables, oneWalkin, [], DATE, SEATINGS[0], baseSettings())
    expect(r.occupiedTables).toBe(1)            // 101 一桌
    expect(r.remainingTables).toBe(3)
    expect(r.remainingSeats).toBe(22 - 2)       // 席只扣 2
  })

  it('其他場次佔用不外溢到 lunch1', () => {
    const dinnerGroup = [{ id: 'gd', date: DATE, status: 'confirmed', batches: [
      { id: 'x', timeSlot: '17:00', tableNumbers: ['201'], guests: 6 },
    ] }]
    const r = remainingTablesForSeating(tables, [], dinnerGroup, DATE, SEATINGS[0], baseSettings())
    expect(r.remainingTables).toBe(4)
    expect(r.remainingSeats).toBe(22)
  })

  it('場次關閉 → 剩餘桌/席皆 0', () => {
    const s = baseSettings({ closures: { closedDates: [], closedSlots: {}, closedSeatings: { [DATE]: ['lunch1'] } } })
    const r = remainingTablesForSeating(tables, bookings, groups, DATE, SEATINGS[0], s)
    expect(r.closed).toBe(true)
    expect(r.remainingTables).toBe(0)
    expect(r.remainingSeats).toBe(0)
  })
})
