// night-50 P2 桌務復原：換桌（D1）／離席（D2）／批次清桌（D5）／自動清檯（D7）／散客帶位（A5）／復原鈕文案（H6）。
// 一律注入「真的」seatingService（不 mock）：只驗 mock 參數蓋不住「復原沒把桌倒回」或「復原把下一組的桌搶走」。
// 每項兩條：①復原把 booking＋table 一起倒回 ②桌已被下一組佔走 → 復原安全失敗、桌況不被覆蓋。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import * as seating from '../../src/services/seatingService'
import * as tableService from '../../src/services/tableService'
import * as bookingService from '../../src/services/bookingService'
import { computeOvertimeActions } from '../../src/utils/opsSweep'
import { toastMovedWithUndo, toastCheckoutWithUndo, clearTablesWithUndo, undoLabel } from '../../src/utils/tableUndo'
import { cancelWithUndo } from '../../src/utils/bookingActions'
import { ToastProvider, useToast } from '../../src/components/ui/Toast'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const NOW = new Date('2026-06-15T12:00:00')
const mkTable = (number, capacity = 4, over = {}) => ({
  number, capacity, floor: '1F', x: 100, y: 100, w: 80, h: 75, isActive: true, outage: null,
  status: 'vacant', currentBookingId: null, currentRef: null, seatedAt: null, mergedWith: null, blockReason: null, updatedAt: null, ...over,
})
const mkBooking = (over = {}) => bookingService.create({
  name: '王先生', phone: '0912345678', guests: 2, date: '2026-06-15', timeSlot: '12:00', source: 'phone', status: 'confirmed', ...over,
})
const makeToast = () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), action: vi.fn() })
const lastAction = (toast) => toast.action.mock.calls.at(-1)
const T = (n) => tableService.getByNumber(n)
const seated = () => {
  const b = mkBooking()
  seating.assignBookingToTable(b.id, '101')
  seating.seatBooking(b.id)
  return b
}

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(NOW)
  tableService.bulkWrite([mkTable('101'), mkTable('102'), mkTable('103'), mkTable('104'), mkTable('105'), mkTable('108', 6)])
})
afterEach(() => { vi.useRealTimers() })

describe('D1 換桌 → 復原換桌', () => {
  const move = (b, to, toast) => {
    const undo = seating.seatedMoveSnapshot(b.id)
    const r = seating.replaceSeatedBookingTables(b.id, [to], { now: NOW })
    expect(r.ok).toBe(true)
    toastMovedWithUndo({ ...r, undo }, { message: `${b.name} 已改桌至 ${to}`, name: b.name, toTables: [to], undoSeatedMove: seating.undoSeatedMove, toast })
  }

  it('復原：客人搬回原桌（用餐中、入座時間照舊），新桌回空桌、訂位桌號寫回原桌', () => {
    const b = seated()
    const seatedAt = T('101').seatedAt
    const toast = makeToast()
    move(b, '108', toast)
    expect(T('101').status).toBe('cleaning')
    const [, action, opts] = lastAction(toast)
    expect(action.label).toBe('復原換桌')
    expect(opts.duration).toBeGreaterThanOrEqual(8000)
    action.onClick()
    expect(T('101')).toMatchObject({ status: 'dining', currentBookingId: b.id, seatedAt })
    expect(T('108')).toMatchObject({ status: 'vacant', currentBookingId: null })
    expect(bookingService.getById(b.id)).toMatchObject({ status: 'arrived', assignedTableId: '101' })
    expect(toast.info).toHaveBeenCalledWith('已復原：王先生 回到 101')
  })

  it('★ 原桌已被下一組使用 → 復原安全失敗：「復原失敗：101 已被下一組使用」，兩邊桌況都不動', () => {
    const b = seated()
    const toast = makeToast()
    move(b, '108', toast)
    seating.clearTable('101')
    const next = seating.walkInSeat('101', { name: '下一組', guests: 2 })
    const [, action] = lastAction(toast)
    action.onClick()
    expect(toast.error.mock.calls[0][0]).toMatch(/^復原失敗：101 已被下一組使用/)
    expect(T('101')).toMatchObject({ status: 'dining', currentBookingId: next.booking.id })
    expect(T('108')).toMatchObject({ status: 'dining', currentBookingId: b.id })
    expect(bookingService.getById(b.id).assignedTableId).toBe('108')
  })
})

describe('D2 離席 → 復原離席', () => {
  const checkout = (b, toast) => {
    const undo = seating.checkoutSnapshot(b.id)
    const r = seating.checkoutBooking(b.id)
    toastCheckoutWithUndo({ ...r, undo }, { message: `${b.name} 已離席`, name: b.name, undoCheckoutBooking: seating.undoCheckoutBooking, toast })
  }

  it('復原：桌倒回用餐中、currentBookingId 回原筆、入座時間照舊；訂位回 arrived 且保留到店時間', () => {
    const b = seated()
    const { seatedAt } = T('101')
    const arrivedAt = bookingService.getById(b.id).actualArrivalTime
    const toast = makeToast()
    checkout(b, toast)
    expect(T('101').status).toBe('cleaning')
    expect(bookingService.getById(b.id).status).toBe('completed')
    const [, action] = lastAction(toast)
    expect(action.label).toBe('復原離席')
    action.onClick()
    expect(T('101')).toMatchObject({ status: 'dining', currentBookingId: b.id, seatedAt })
    expect(bookingService.getById(b.id)).toMatchObject({ status: 'arrived', actualArrivalTime: arrivedAt })
  })

  it('★ 桌已清好並帶了下一組 → 復原安全失敗、不覆蓋', () => {
    const b = seated()
    const toast = makeToast()
    checkout(b, toast)
    seating.clearTable('101')
    const next = seating.walkInSeat('101', { name: '下一組', guests: 2 })
    lastAction(toast)[1].onClick()
    expect(toast.error.mock.calls[0][0]).toMatch(/^復原失敗：101 已被下一組使用/)
    expect(T('101')).toMatchObject({ status: 'dining', currentBookingId: next.booking.id })
    expect(bookingService.getById(b.id).status).toBe('completed')
  })
})

describe('D5 待清桌批次清桌 → 復原清桌（全部倒回待清）', () => {
  const deps = (toast) => ({ clearTable: seating.clearTable, clearGroupTable: seating.clearGroupTable, undoClearTable: seating.undoClearTable, undoClearGroupTable: seating.undoClearGroupTable, toast })
  const seedCleaning = () => ['101', '102', '103', '104', '105'].forEach(n => tableService.setStatus(n, 'cleaning', { currentBookingId: 'X' + n }))

  it('五張一次清完；復原把五張全部倒回待清（原 currentBookingId 保留）', () => {
    seedCleaning()
    const toast = makeToast()
    const r = clearTablesWithUndo(tableService.listAll(), deps(toast))
    expect(r.cleared.map(c => c.tableNumber)).toEqual(['101', '102', '103', '104', '105'])
    expect(tableService.listAll().filter(t => t.status === 'cleaning')).toHaveLength(0)
    const [msg, action] = lastAction(toast)
    expect(msg).toBe('101、102、103、104、105 已清桌完成')
    expect(action.label).toBe('↩ 復原清桌（5）')
    action.onClick()
    ;['101', '102', '103', '104', '105'].forEach(n => expect(T(n)).toMatchObject({ status: 'cleaning', currentBookingId: 'X' + n }))
  })

  it('★ 其中一張已帶下一組 → 那張安全失敗不覆蓋，其他照常倒回', () => {
    seedCleaning()
    const toast = makeToast()
    clearTablesWithUndo(tableService.listAll(), deps(toast))
    const next = seating.walkInSeat('103', { name: '下一組', guests: 2 })
    lastAction(toast)[1].onClick()
    expect(T('103')).toMatchObject({ status: 'dining', currentBookingId: next.booking.id })
    ;['101', '102', '104', '105'].forEach(n => expect(T(n).status).toBe('cleaning'))
    expect(toast.success.mock.calls[0][0]).toMatch(/^已復原 101、102、104、105 為等待清桌；103 已被下一組使用/)
  })

  it('只清「此刻仍是待清」的桌：傳進來的舊物件若桌已有人，不清', () => {
    tableService.setStatus('101', 'cleaning', { currentBookingId: 'X101' })
    const stale = { ...T('101') }
    seating.clearTable('101')
    const next = seating.walkInSeat('101', { name: '下一組', guests: 2 })
    // 呼叫端（OperationsView.clearCleaning）會先換成最新桌況；這裡驗 helper 本身也只清 status==='cleaning'
    clearTablesWithUndo([T('101')], deps(makeToast()))
    expect(T('101')).toMatchObject({ status: 'dining', currentBookingId: next.booking.id })
    expect(stale.status).toBe('cleaning')
  })
})

describe('D7 超時自動清檯 → 復原釋出', () => {
  const sweep = () => {
    const actions = computeOvertimeActions({ tables: tableService.listAll(), settings: {}, now: Date.now() })
    const snaps = seating.autoReleaseSnapshots(actions)
    seating.executeSweepActions(actions)
    return snaps
  }

  it('復原：桌倒回用餐中（重新計時，下一輪掃除不會又清掉），訂位回 arrived', () => {
    const b = seated()
    vi.setSystemTime(new Date(NOW.getTime() + 301 * 60000))
    const snaps = sweep()
    expect(snaps).toMatchObject([{ type: 'finalize-booking', bookingId: b.id, name: '王先生', tableNumber: '101', tables: ['101'] }])
    expect(T('101').status).toBe('vacant')
    expect(bookingService.getById(b.id).status).toBe('completed')
    const u = seating.undoAutoRelease(snaps[0])
    expect(u.ok).toBe(true)
    expect(T('101')).toMatchObject({ status: 'dining', currentBookingId: b.id, seatedAt: new Date().toISOString() })
    expect(bookingService.getById(b.id).status).toBe('arrived')
    expect(computeOvertimeActions({ tables: tableService.listAll(), settings: {}, now: Date.now() })).toEqual([])
  })

  it('★ 桌已被下一組使用 → 復原安全失敗、不覆蓋', () => {
    const b = seated()
    vi.setSystemTime(new Date(NOW.getTime() + 301 * 60000))
    const snaps = sweep()
    const next = seating.walkInSeat('101', { name: '下一組', guests: 2 })
    const u = seating.undoAutoRelease(snaps[0])
    expect(u).toMatchObject({ ok: false, code: 'table-occupied' })
    expect(u.error).toMatch(/^101 已被下一組使用/)
    expect(T('101')).toMatchObject({ status: 'dining', currentBookingId: next.booking.id })
    expect(bookingService.getById(b.id).status).toBe('completed')
  })
})

describe('A5 散客帶位復原不留 cancelled', () => {
  it('有刪除權：桌回空桌、那筆散客 booking 直接刪除', () => {
    const r = seating.walkInSeat('102', { name: '散客', guests: 2 })
    const u = seating.undoWalkInSeat(r.booking.id, { remove: true })
    expect(u).toMatchObject({ ok: true, removed: true })
    expect(T('102')).toMatchObject({ status: 'vacant', currentBookingId: null })
    expect(bookingService.getById(r.booking.id)).toBeFalsy()
    expect(bookingService.listAll().some(x => x.id === r.booking.id)).toBe(false)
  })

  it('無刪除權：退回取消並標 autoFlag walkin-undo（供統計排除）', () => {
    const r = seating.walkInSeat('102', { name: '散客', guests: 2 })
    const u = seating.undoWalkInSeat(r.booking.id, { remove: false })
    expect(u).toMatchObject({ ok: true, removed: false })
    expect(bookingService.getById(r.booking.id)).toMatchObject({ status: 'cancelled', autoFlag: 'walkin-undo', assignedTableId: null })
  })

  it('★ 預訂客（非 walkin）不走這條：擋下、不刪', () => {
    const b = seated()
    expect(seating.undoWalkInSeat(b.id).ok).toBe(false)
    expect(bookingService.getById(b.id).status).toBe('arrived')
  })
})

describe('H6 兩顆復原鈕的無障礙名稱不同', () => {
  let container, root, api
  function Probe() { api = useToast(); return null }
  afterEach(() => { act(() => root?.unmount()); container?.remove() })

  it('取消訂位的「復原取消」與帶位的「復原帶位 105」同時出現時，accessible name 不同', () => {
    container = document.createElement('div'); document.body.appendChild(container)
    root = createRoot(container)
    act(() => root.render(<ToastProvider><Probe /></ToastProvider>))
    const b = mkBooking()
    seating.assignBookingToTable(b.id, '105')
    act(() => { cancelWithUndo(b, { cancelBooking: seating.cancelBooking, undoCancelBooking: seating.undoCancelBooking, toast: api }) })
    act(() => { api.action('散客（2 位）入座 105 · 可帶下一組', { label: undoLabel.walkInSeat(['105']), onClick: () => {} }, { duration: 8000 }) })
    const names = [...container.querySelectorAll('[data-testid="toast-action"]')].map(el => el.textContent.trim())
    expect(names).toHaveLength(2)
    expect(names[0]).toContain('復原取消')
    expect(names[1]).toBe('復原帶位 105')
    expect(new Set(names).size).toBe(2)
  })
})
