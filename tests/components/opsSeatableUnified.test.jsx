import { it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'

// 「可入座」口徑統一（Barry 2026-10-30）：頂端常駐「可入座 N 桌」＝樓層鈕「1F 可坐 a」＋「2F 可坐 b」。
// 以前帶位籤的樓層鈕顯示「依目前人數可選的桌」（findSuitableTables），會把「空桌但 30 分內有下一組」這種
// 時段衝突桌也算進去，於是 demo 出現常駐 45、樓層 8＋38＝46 對不上。
// 現在只改「顯示的數字」：帶位面板的選桌池照舊走 findSuitableTables（本測試也驗它沒被改掉）。
const harness = vi.hoisted(() => ({ ctx: {} }))
vi.mock('../../src/contexts/BookingContext', () => ({ useBooking: () => harness.ctx }))
vi.mock('../../src/contexts/AuthContext', () => ({ useAuth: () => ({ can: () => true, user: { role: 'floor' } }) }))
vi.mock('../../src/components/ui/Toast', () => ({ useToast: () => ({ error: vi.fn(), success: vi.fn(), info: vi.fn(), action: vi.fn() }), useConfirm: () => vi.fn() }))
vi.mock('../../src/components/admin/floormap/FloorMap', () => ({ default: ({ floor }) => <div data-floor={floor} /> }))
vi.mock('../../src/components/admin/ops/OpsRail', () => ({ default: ({ activeTab }) => <div data-rail={activeTab} /> }))
vi.mock('../../src/components/admin/floormap/TableDrawer', () => ({ default: () => null }))
vi.mock('../../src/components/admin/floormap/ArrivalStrip', () => ({ default: () => null }))
vi.mock('../../src/components/admin/ops/OpsLogModal', () => ({ default: () => null }))
vi.mock('../../src/components/admin/ops/HandoffPanel', () => ({ default: () => null }))
vi.mock('../../src/components/admin/LayoutEditor', () => ({ default: () => null }))
vi.mock('../../src/components/booking/BookingDetailSheet', () => ({ default: () => null }))
const OperationsView = (await import('../../src/components/admin/OperationsView')).default

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let container, root
const table = (number, floor, extra = {}) => ({ number, capacity: 4, floor, isActive: true, status: 'vacant', ...extra })
const findSuitableTables = vi.fn()
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 9, 10, 19))
  const tables = [
    table('101', '1F'),
    table('102', '1F', { capacity: 6 }), // 空桌但 19:15 有下一組 → 時段衝突，現在不能坐
    table('103', '1F', { status: 'dining', currentBookingId: 'D1', seatedAt: new Date(2026, 9, 10, 18, 30).toISOString() }),
    table('104', '1F', { isActive: false }), // 停用
    table('201', '2F'),
    table('202', '2F', { capacity: 6 }),
    table('203', '2F', { status: 'cleaning' }),
  ]
  // 選桌池（依人數可選）刻意與「現在就能坐」不同：含時段衝突的 102
  findSuitableTables.mockImplementation(() => tables.filter(t => ['101', '102', '201', '202'].includes(t.number)))
  harness.ctx = {
    tables,
    bookings: [
      { id: 'D1', guests: 3, status: 'arrived', date: '2026-10-10', timeSlot: '18:30', assignedTableId: '103', extraTableIds: [] },
      { id: 'N1', guests: 5, status: 'confirmed', date: '2026-10-10', timeSlot: '19:15', assignedTableId: '102', extraTableIds: [] },
    ],
    waitlist: [], groupReservations: [], fixtures: {}, zones: [],
    settings: { seatings: [{ id: 'dinner', start: '17:00', end: '21:00' }], diningDurationMin: 90, cleanupBufferMin: 10 },
    findSuitableTables, preassignableTables: () => [], findReserveCandidates: () => ({ tables: [], kind: 'hold' }),
    suggestTable: () => null, suggestTableCombo: () => ({ enough: false, tableNumbers: [] }),
  }
})
afterEach(() => { act(() => root?.unmount()); container?.remove(); vi.useRealTimers() })

const floorTab = f => [...container.querySelectorAll('[role="tab"]')].find(b => b.textContent.startsWith(f))
const floorCount = f => Number(floorTab(f).textContent.match(/可坐 (\d+)/)[1])
const vacantFigure = () => Number(container.querySelector('[data-stat="vacant"]').textContent.match(/可入座(\d+)桌/)[1])

it('帶位籤：常駐「可入座」＝ 1F「可坐」＋ 2F「可坐」，時段衝突桌兩邊都不算', () => {
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
  act(() => root.render(<OperationsView />))
  expect(container.querySelector('[data-rail]').getAttribute('data-rail')).toBe('walkin')
  expect(floorCount('1F')).toBe(1) // 101（102 衝突、103 用餐、104 停用）
  expect(floorCount('2F')).toBe(2) // 201、202（203 待清）
  expect(vacantFigure()).toBe(3)
  expect(floorCount('1F') + floorCount('2F')).toBe(vacantFigure())
  expect(container.querySelector('[data-stat="vacant"]').textContent).toContain('· 14 人') // 101(4)+201(4)+202(6)
  // 選桌邏輯不動：帶位面板的選桌池仍來自 findSuitableTables（人數 1 起算）
  expect(findSuitableTables).toHaveBeenCalledWith(1)
})

it('摘要分頁：全店「可入座」與樓層鈕同一個數字；本樓層「可入座」清單＝本樓層可坐數', () => {
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
  act(() => root.render(<OperationsView />))
  act(() => [...container.querySelectorAll('button, [role="radio"], [role="tab"]')].find(b => b.textContent === '摘要').click())
  expect(container.querySelector('[data-store-stats]').textContent).toContain('可入座3 桌 · 14 人')
  expect(container.textContent).toContain(`可入座（${floorCount('1F')} 桌`)
})
