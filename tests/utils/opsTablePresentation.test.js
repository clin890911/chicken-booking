import { describe, it, expect } from 'vitest'
import { buildOpsTablePresentation, getOpsTableState } from '../../src/utils/opsTablePresentation'
const date = '2026-10-04'
const now = new Date('2026-10-04T12:00:00+08:00').getTime()
const settings = { diningDurationMin: 90, cleanupBufferMin: 10 }
const table = { number: '107', capacity: 4, status: 'vacant', isActive: true }
const booking = (timeSlot, extra = {}) => ({ id: 'B1', date, timeSlot, guests: 4, status: 'confirmed', assignedTableId: '107', ...extra })
const get = options => getOpsTableState(table, { date, now, settings, ...options })

describe('餐中桌況共同呈現，沿用容量引擎時間窗', () => {
  it('12:00帶位會占到13:40，13:00預配衝突且提示下组', () => {
    const state = get({ bookings: [booking('13:00')] })
    expect(state).toMatchObject({ canSeatNow: false, hasTimeConflict: true, estimatedEnd: 820, availableUntil: 780 })
    expect(state.reservationLabel).toBe('下組 13:00')
    expect(state.availabilityLabel).toContain('13:40：時段衝突')
  })
  it('17:00預配不全天禁用，顯示現在可用至17:00', () => {
    const state = get({ bookings: [booking('17:00')] })
    expect(state.canSeatNow).toBe(true)
    expect(state.availabilityLabel).toContain('可用至 17:00')
  })
  it.each([['13:39', true], ['13:40', false]])('半開時間窗：下組%s的衝突=%s', (time, conflict) => {
    expect(get({ bookings: [booking(time)] }).hasTimeConflict).toBe(conflict)
  })
  it('使用實際用餐與清桌設定，非寫死100分鐘', () => {
    expect(get({ settings: { diningDurationMin: 45, cleanupBufferMin: 5 }, bookings: [booking('13:00')] })).toMatchObject({ canSeatNow: true, estimatedEnd: 770 })
  })
  it('副桌也顯示下次預約，排除取消、已完成、別日與用餐中客人', () => {
    const bookings = [booking('12:30', { status: 'cancelled' }), booking('12:30', { status: 'completed' }), booking('12:30', { date: '2026-10-05' }), booking('12:30', { status: 'arrived' }), booking('17:00', { assignedTableId: '101', extraTableIds: ['107'] })]
    expect(get({ bookings }).nextReservation.timeSlot).toBe('17:00')
  })
  it('團保使用同一時間窗，邊界13:40不衝突、13:00衝突', () => {
    const group = { id: 'G1', date, status: 'confirmed', agencyName: '測試團' }
    const holds = timeSlot => ({ '107': { holds: [{ group, batch: { timeSlot, guests: 20 } }] } })
    expect(get({ groupHoldTables: holds('13:00') })).toMatchObject({ canSeatNow: false, reservationLabel: '團保 13:00' })
    expect(get({ groupHoldTables: holds('13:40') }).canSeatNow).toBe(true)
    expect(get({ groupHoldTables: holds('17:00') }).canSeatNow).toBe(true)
  })
  it('已釋出與完成團保不再占位，空holds不造成全天保留', () => {
    const groupHoldTables = { '107': { holds: [{ group: { date, status: 'completed' }, batch: { timeSlot: '13:00' } }, { group: { date, status: 'confirmed' }, batch: { timeSlot: '13:00', releasedAt: 'done' } }] } }
    expect(get({ groupHoldTables })).toMatchObject({ canSeatNow: true, nextReservation: null })
    expect(get({ groupHoldTables: { '107': { holds: [] } } }).canSeatNow).toBe(true)
  })
  it('缺時段保守提示衝突，不能誤顯示可入座', () => {
    expect(get({ bookings: [booking('')] })).toMatchObject({ canSeatNow: false, hasTimeConflict: true, reservationLabel: '下組 未定時段' })
  })
  it.each(['reserved', 'dining', 'cleaning', 'blocked'])('%s不可被顯示為空桌可坐', status => {
    const state = getOpsTableState({ ...table, status, blockReason: '測試維修' }, { date, now, settings })
    expect(state.canSeatNow).toBe(false)
    if (status === 'blocked') expect(state.unavailableReason).toBe('測試維修')
  })
  it('日期停用窗只在有效日生效，過期/未開始維修仍可入座', () => {
    const state = outage => getOpsTableState({ ...table, outage }, { date, now, settings })
    expect(state({ from: date, to: date, reason: '水管維修' }).unavailableReason).toBe('水管維修')
    expect(state({ from: '2026-10-01', to: '2026-10-03' }).canSeatNow).toBe(true)
    expect(state({ from: '2026-10-05', to: '2026-10-06' }).canSeatNow).toBe(true)
    expect(getOpsTableState({ ...table, isActive: false }, { date, now }).statusLabel).toBe('停用')
  })
  it('用餐中預估清桌時間依實際入座時間且不更改來源資料', () => {
    const occupied = { ...table, status: 'dining', seatedAt: '2026-10-04T11:30:00+08:00' }
    const snapshot = JSON.stringify(occupied)
    expect(getOpsTableState(occupied, { date, now, settings }).availabilityLabel).toContain('13:10')
    expect(JSON.stringify(occupied)).toBe(snapshot)
  })
  it('字典供地圖、摘要與排程共用，接受Date或毫秒', () => {
    const input = { tables: [table], bookings: [booking('17:00')], date, now, settings }
    expect(buildOpsTablePresentation(input)['107']).toEqual(get({ bookings: input.bookings }))
    expect(buildOpsTablePresentation({ ...input, now: new Date(now) })).toEqual(buildOpsTablePresentation(input))
  })
})
