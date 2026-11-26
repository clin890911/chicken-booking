// B6「點錯修正」：已入座改桌時，原桌入座未滿 5 分鐘 → 直接回空桌（不變待清）；滿 5 分鐘照舊待清。
// 一律用真的 seatingService（不 mock）：要驗的是桌況真的變成什麼，以及只動本筆持有的桌。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as seating from '../../src/services/seatingService'
import * as tableService from '../../src/services/tableService'
import * as bookingService from '../../src/services/bookingService'

const NOW = new Date('2026-06-15T12:00:00')
const minAgo = (m) => new Date(NOW.getTime() - m * 60000).toISOString()
const mkTable = (number, capacity = 4, over = {}) => ({
  number, capacity, floor: '1F', x: 100, y: 100, w: 80, h: 75, isActive: true, outage: null,
  status: 'vacant', currentBookingId: null, currentRef: null, seatedAt: null, mergedWith: null, blockReason: null, updatedAt: null, ...over,
})
const T = (n) => tableService.getByNumber(n)
const arrived = (over = {}) => bookingService.create({
  name: '王先生', phone: '0912345678', guests: 2, date: '2026-06-15', timeSlot: '12:00', source: 'phone', status: 'arrived', ...over,
})

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(NOW)
})
afterEach(() => { vi.useRealTimers() })

describe('isQuickFixMove', () => {
  it('用餐中、入座 2 分鐘 → true；10 分鐘 → false；剛好 5 分鐘 → false（滿 5 分鐘算用過）', () => {
    expect(seating.isQuickFixMove({ status: 'dining', seatedAt: minAgo(2) }, NOW)).toBe(true)
    expect(seating.isQuickFixMove({ status: 'dining', seatedAt: minAgo(10) }, NOW)).toBe(false)
    expect(seating.isQuickFixMove({ status: 'dining', seatedAt: minAgo(5) }, NOW)).toBe(false)
  })
  it('沒有 seatedAt／非用餐中（舊資料 reserved 鎖桌）→ false（保守：照舊待清）；時鐘差造成未來時間 → true', () => {
    expect(seating.isQuickFixMove({ status: 'dining', seatedAt: null }, NOW)).toBe(false)
    expect(seating.isQuickFixMove({ status: 'reserved', seatedAt: null }, NOW)).toBe(false)
    expect(seating.isQuickFixMove({ status: 'dining', seatedAt: 'not-a-date' }, NOW)).toBe(false)
    expect(seating.isQuickFixMove({ status: 'dining', seatedAt: new Date(NOW.getTime() + 3000).toISOString() }, NOW)).toBe(true)
  })
})

describe('replaceSeatedBookingTables × B6', () => {
  it('入座 2 分鐘改桌：原桌回空桌（無 currentBookingId／seatedAt），新桌用餐中且保留原入座時間', () => {
    const b = arrived({ assignedTableId: '101' })
    tableService.bulkWrite([mkTable('101', 4, { status: 'dining', currentBookingId: b.id, seatedAt: minAgo(2) }), mkTable('108', 6)])
    const r = seating.replaceSeatedBookingTables(b.id, ['108'], { now: NOW })
    expect(r).toMatchObject({ ok: true, freedTables: ['101'], cleaningTables: [] })
    expect(T('101')).toMatchObject({ status: 'vacant', currentBookingId: null, currentRef: null, seatedAt: null })
    expect(T('108')).toMatchObject({ status: 'dining', currentBookingId: b.id, seatedAt: minAgo(2) })
  })

  it('入座 10 分鐘改桌：原桌照舊變待清', () => {
    const b = arrived({ assignedTableId: '101' })
    tableService.bulkWrite([mkTable('101', 4, { status: 'dining', currentBookingId: b.id, seatedAt: minAgo(10) }), mkTable('108', 6)])
    const r = seating.replaceSeatedBookingTables(b.id, ['108'], { now: NOW })
    expect(r).toMatchObject({ ok: true, freedTables: [], cleaningTables: ['101'] })
    expect(T('101').status).toBe('cleaning')
  })

  it('單桌 moveTable（已入座）走同一條：2 分鐘回空桌', () => {
    const b = arrived({ assignedTableId: '101' })
    tableService.bulkWrite([mkTable('101', 4, { status: 'dining', currentBookingId: b.id, seatedAt: minAgo(2) }), mkTable('108', 6)])
    const r = seating.moveTable(b.id, '108')
    expect(r).toMatchObject({ ok: true, freedTables: ['101'] })
    expect(T('101').status).toBe('vacant')
  })

  it('併桌：每張原桌各看自己的 seatedAt（主桌坐 10 分→待清、後加的副桌 2 分→回空桌）；別組的桌完全不動', () => {
    const b = arrived({ guests: 6, assignedTableId: '101', extraTableIds: ['102'] })
    const other = arrived({ name: '隔壁', assignedTableId: '103' })
    tableService.bulkWrite([
      mkTable('101', 4, { status: 'dining', currentBookingId: b.id, seatedAt: minAgo(10) }),
      mkTable('102', 4, { status: 'dining', currentBookingId: b.id, seatedAt: minAgo(2) }),
      mkTable('103', 4, { status: 'dining', currentBookingId: other.id, seatedAt: minAgo(1) }),
      mkTable('108', 8),
    ])
    const r = seating.replaceSeatedBookingTables(b.id, ['108'], { now: NOW })
    expect(r).toMatchObject({ ok: true, freedTables: ['102'], cleaningTables: ['101'] })
    expect(T('101').status).toBe('cleaning')
    expect(T('102').status).toBe('vacant')
    expect(T('103')).toMatchObject({ status: 'dining', currentBookingId: other.id, seatedAt: minAgo(1) })
  })

  it('原桌其中一張已被別組佔（不屬於本筆）→ 整筆拒絕、桌況不動（只放 currentBookingId＝本筆的桌）', () => {
    const b = arrived({ guests: 6, assignedTableId: '101', extraTableIds: ['102'] })
    tableService.bulkWrite([
      mkTable('101', 4, { status: 'dining', currentBookingId: b.id, seatedAt: minAgo(2) }),
      mkTable('102', 4, { status: 'dining', currentBookingId: 'OTHER', seatedAt: minAgo(2) }),
      mkTable('108', 8),
    ])
    const before = JSON.stringify(tableService.listAll())
    expect(seating.replaceSeatedBookingTables(b.id, ['108'], { now: NOW }).ok).toBe(false)
    expect(JSON.stringify(tableService.listAll())).toBe(before)
  })

  it('點錯修正後復原：原桌（空桌、沒人持有）搶回用餐中＋原入座時間，新桌回空桌', () => {
    const b = arrived({ assignedTableId: '101' })
    tableService.bulkWrite([mkTable('101', 4, { status: 'dining', currentBookingId: b.id, seatedAt: minAgo(2) }), mkTable('108', 6)])
    const snap = seating.seatedMoveSnapshot(b.id)
    seating.replaceSeatedBookingTables(b.id, ['108'], { now: NOW })
    const u = seating.undoSeatedMove(snap, ['108'])
    expect(u).toMatchObject({ ok: true, tableNumbers: ['101'] })
    expect(T('101')).toMatchObject({ status: 'dining', currentBookingId: b.id, seatedAt: minAgo(2) })
    expect(T('108')).toMatchObject({ status: 'vacant', currentBookingId: null })
    expect(bookingService.getById(b.id).assignedTableId).toBe('101')
  })
})
