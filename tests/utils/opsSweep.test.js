import { describe, it, expect } from 'vitest'
import { computeOvertimeActions, computeDayRolloverActions } from '../../src/utils/opsSweep'

const NOW = new Date(2026, 5, 10, 18, 0, 0, 0).getTime()
const TODAY = '2026-06-10'
const minAgo = (m) => new Date(NOW - m * 60000).toISOString()
const mkT = (number, overrides = {}) => ({
  number, capacity: 4, isActive: true, status: 'vacant',
  currentBookingId: null, currentRef: null, seatedAt: null, ...overrides,
})

describe('computeOvertimeActions（超時釋桌）', () => {
  const settings = { autoReleaseEnabled: true, autoReleaseAfterMin: 300 }

  it('散客桌 301 分 → finalize-booking；299 分 → 不動（邊界）', () => {
    const tables = [
      mkT('101', { status: 'dining', currentBookingId: 'B1', seatedAt: minAgo(301) }),
      mkT('102', { status: 'dining', currentBookingId: 'B2', seatedAt: minAgo(299) }),
    ]
    const acts = computeOvertimeActions({ tables, settings, now: NOW })
    expect(acts).toEqual([
      { type: 'finalize-booking', bookingId: 'B1', tableNumber: '101', minutes: 301 },
    ])
  })

  it('團體桌超時 → 只做 checkout-group-table（保留接梯），不產生 clear/complete-group', () => {
    const tables = [
      mkT('105', { status: 'dining', currentRef: { type: 'group', groupId: 'G1', batchId: 'BT1' }, seatedAt: minAgo(400) }),
    ]
    const acts = computeOvertimeActions({ tables, settings, now: NOW })
    expect(acts).toEqual([
      { type: 'checkout-group-table', tableNumber: '105', groupId: 'G1', batchId: 'BT1', minutes: 400 },
    ])
  })

  it('孤兒 dining（無 booking 無 group）→ clear-table', () => {
    const tables = [mkT('108', { status: 'dining', seatedAt: minAgo(400) })]
    const acts = computeOvertimeActions({ tables, settings, now: NOW })
    expect(acts[0].type).toBe('clear-table')
  })

  it('關閉開關 → 空；reserved/cleaning/blocked 不動；停用但用餐中的桌「照掃」（殭屍桌防線）', () => {
    const tables = [
      mkT('101', { status: 'dining', currentBookingId: 'B1', seatedAt: minAgo(400) }),
      mkT('102', { status: 'reserved' }),
      mkT('103', { status: 'cleaning' }),
      mkT('104', { status: 'blocked' }),
      // 停用/維修中但仍在用餐（同步進來的不一致狀態）：必須被掃到，否則永遠不會釋出
      mkT('105', { status: 'dining', isActive: false, seatedAt: minAgo(400) }),
    ]
    expect(computeOvertimeActions({ tables, settings: { ...settings, autoReleaseEnabled: false }, now: NOW })).toEqual([])
    const acts = computeOvertimeActions({ tables, settings, now: NOW })
    expect(acts.map(a => a.tableNumber)).toEqual(['101', '105'])
  })
})

describe('computeDayRolloverActions（換日掃除）', () => {
  const settings = { dayRolloverEnabled: true, autoNoshowOnRollover: false }

  it('昨日散客桌（arrived）→ complete-booking + clear-table；今日資料零誤殺', () => {
    const tables = [
      mkT('101', { status: 'dining', currentBookingId: 'B-old', seatedAt: '2026-06-09T19:00:00.000Z' }),
      mkT('102', { status: 'dining', currentBookingId: 'B-today', seatedAt: minAgo(60) }),
    ]
    const bookings = [
      { id: 'B-old', date: '2026-06-09', status: 'arrived' },
      { id: 'B-today', date: TODAY, status: 'arrived' },
    ]
    const acts = computeDayRolloverActions({ tables, bookings, groupReservations: [], settings, today: TODAY })
    expect(acts).toEqual([
      { type: 'complete-booking', bookingId: 'B-old', tableNumber: '101' },
      { type: 'clear-table', tableNumber: '101', reason: 'stale-day' },
    ])
  })

  it('昨日 arrived 團 → complete-group；昨日 confirmed/planned 團不動（留給人判斷）', () => {
    const groups = [
      { id: 'G-arr', date: '2026-06-09', status: 'arrived' },
      { id: 'G-conf', date: '2026-06-09', status: 'confirmed' },
      { id: 'G-plan', date: '2026-06-09', status: 'planned' },
      { id: 'G-today', date: TODAY, status: 'arrived' },
    ]
    const acts = computeDayRolloverActions({ tables: [], bookings: [], groupReservations: groups, settings, today: TODAY })
    expect(acts).toEqual([{ type: 'complete-group', groupId: 'G-arr' }])
  })

  it('昨日殘留 cleaning/reserved 桌也清；無連結資料時以 seatedAt 日期判斷', () => {
    const tables = [
      mkT('103', { status: 'cleaning', currentRef: { type: 'group', groupId: 'G1' } }),
      mkT('104', { status: 'reserved', seatedAt: '2026-06-09T12:00:00.000Z' }),
    ]
    const groups = [{ id: 'G1', date: '2026-06-09', status: 'arrived' }]
    const acts = computeDayRolloverActions({ tables, bookings: [], groupReservations: groups, settings, today: TODAY })
    expect(acts.filter(a => a.type === 'clear-table').map(a => a.tableNumber)).toEqual(['103', '104'])
  })

  it('autoNoshowOnRollover：關 → 不產生；開 → 昨日 confirmed 訂位標 noshow', () => {
    const bookings = [
      { id: 'B1', date: '2026-06-09', status: 'confirmed' },
      { id: 'B2', date: TODAY, status: 'confirmed' },
    ]
    const off = computeDayRolloverActions({ tables: [], bookings, groupReservations: [], settings, today: TODAY })
    expect(off.some(a => a.type === 'mark-noshow-auto')).toBe(false)
    const on = computeDayRolloverActions({
      tables: [], bookings, groupReservations: [],
      settings: { ...settings, autoNoshowOnRollover: true }, today: TODAY,
    })
    expect(on).toEqual([{ type: 'mark-noshow-auto', bookingId: 'B1' }])
  })

  it('dayRolloverEnabled 關 → 空', () => {
    const acts = computeDayRolloverActions({
      tables: [mkT('101', { status: 'dining', seatedAt: '2026-06-09T12:00:00.000Z' })],
      bookings: [], groupReservations: [],
      settings: { dayRolloverEnabled: false }, today: TODAY,
    })
    expect(acts).toEqual([])
  })
})
