import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'

// A2 現場散客帶位（FastWalkInPanel）的點桌行為與選桌入座模式一致：單選改選、＋再加一桌才多選、大組自動多選。
// A1 選桌模式中報到列照樣佔位（disabled），地圖尺寸不因模式改變。

const harness = vi.hoisted(() => ({ ctx: {}, rail: {}, toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), action: vi.fn() } }))
vi.mock('../../src/contexts/BookingContext', () => ({ useBooking: () => harness.ctx }))
vi.mock('../../src/contexts/AuthContext', () => ({ useAuth: () => ({ can: () => true, user: { role: 'manager' } }) }))
vi.mock('../../src/components/ui/Toast', () => ({ useToast: () => harness.toast, useConfirm: () => vi.fn() }))
vi.mock('../../src/components/admin/floormap/FloorMap', () => ({ default: ({ tables, onSelectTable, selectedTableNumbers = [] }) => <div>{tables.map(t => <button key={t.number} data-table={t.number} data-selected={selectedTableNumbers.includes(t.number)} onClick={() => onSelectTable(t.number)}>{t.number}</button>)}</div> }))
vi.mock('../../src/components/admin/ops/OpsRail', () => ({ default: (p) => { harness.rail = p; return <div data-rail={p.activeTab} data-walkin={p.walkinTables.map(t => t.number).join(',')} data-multi={String(p.walkinMulti)} data-auto={String(p.walkinAutoMulti)} data-excess={p.walkinExcess?.text || ''} /> } }))
vi.mock('../../src/components/admin/floormap/TableDrawer', () => ({ default: () => null }))
vi.mock('../../src/components/admin/floormap/ArrivalStrip', () => ({ default: ({ disabled }) => <div data-testid="strip" data-disabled={String(!!disabled)} /> }))
vi.mock('../../src/components/admin/ops/OpsHintBar', () => ({ default: () => null }))
vi.mock('../../src/components/admin/ops/OpsLogModal', () => ({ default: () => null }))
vi.mock('../../src/components/booking/BookingDetailSheet', () => ({ default: () => null }))
const OperationsView = (await import('../../src/components/admin/OperationsView')).default

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let container, root
const table = (number, capacity, extra = {}) => ({ number, capacity, floor: '1F', isActive: true, status: 'vacant', ...extra })
const mount = el => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); act(() => root.render(el)) }
const pick = n => act(() => container.querySelector(`[data-table="${n}"]`).click())
const rail = () => container.querySelector('[data-rail]')

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 9, 4, 12))
  const ctx = { tables: [table('101', 6), table('103', 6), table('105', 4), table('201', 4, { floor: '2F' })], bookings: [], waitlist: [], groupReservations: [], fixtures: {}, zones: [], settings: { seatings: [{ id: 'lunch', start: '11:00', end: '14:30' }], diningDurationMin: 90, cleanupBufferMin: 10 } }
  ctx.findSuitableTables = vi.fn(size => ctx.tables.filter(t => t.status === 'vacant' && t.capacity >= size))
  ctx.preassignableTables = ctx.findSuitableTables
  ctx.findReserveCandidates = () => ({ tables: [ctx.tables[0]], kind: 'hold' })
  ctx.suggestTable = () => ctx.tables[0]
  ctx.suggestTableCombo = () => ({ enough: true, tableNumbers: ['101', '103'], seats: 12 })
  for (const k of ['assignBookingToTable', 'assignBookingTablesMulti', 'releaseOverriddenAssignment', 'preassignBookingTable']) ctx[k] = vi.fn(() => ({ ok: true }))
  harness.ctx = ctx
})
afterEach(() => { act(() => root?.unmount()); container?.remove(); vi.useRealTimers() })

describe('帶位面板 A2：點桌＝改選', () => {
  it('點 103 再點 101 → 只選 101；點 101 → 取消', () => {
    mount(<OperationsView />)
    pick('103'); expect(rail().dataset.walkin).toBe('103')
    pick('101'); expect(rail().dataset.walkin).toBe('101')
    pick('101'); expect(rail().dataset.walkin).toBe('')
  })
  it('按「＋再加一桌」後點 101 → 103 + 101，並出黃字「一張就夠」（2 位用 12 席）', () => {
    mount(<OperationsView />)
    act(() => harness.rail.onWalkinGuestsChange(2)) // 載入時人數未選（C 包驗收 F7）
    pick('103'); act(() => harness.rail.onToggleWalkinMulti())
    expect(rail().dataset.multi).toBe('true')
    pick('101'); expect(rail().dataset.walkin).toBe('103,101')
    expect(rail().dataset.excess).toContain('2 位用了 2 桌 12 席')
    // 多選時跨樓層照舊擋
    pick('201'); expect(harness.toast.error).toHaveBeenCalledWith(expect.stringContaining('同一樓層'))
    expect(rail().dataset.walkin).toBe('103,101')
  })
  it('大組（沒有單桌坐得下）→ 自動多選：連點兩張都加進去', () => {
    mount(<OperationsView />)
    act(() => harness.rail.onWalkinGuestsChange(10))
    expect(rail().dataset.auto).toBe('true')
    pick('101'); pick('103'); expect(rail().dataset.walkin).toBe('101,103')
    expect(rail().dataset.excess).toBe('')
  })
})

describe('A1：選桌模式中報到列照樣佔位但不可按', () => {
  it('進指派模式前後報到列都在；模式中 disabled', () => {
    const b = { id: 'B1', name: '林先生', guests: 3, date: '2026-10-04', timeSlot: '12:00', status: 'confirmed' }
    harness.ctx.bookings = [b]
    mount(<OperationsView />)
    expect(container.querySelector('[data-testid="strip"]').dataset.disabled).toBe('false')
    act(() => root.render(<OperationsView pendingAssign={b} />))
    expect(container.querySelector('[data-testid="mode-banner"]').dataset.layout).toBe('rail')
    expect(container.querySelector('[data-testid="strip"]').dataset.disabled).toBe('true')
  })
})
