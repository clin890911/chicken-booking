import { it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'

// 現場頁接線：提示列「N 桌待清」點了 → 切到該桌樓層、打開那桌的桌況抽屜（一下就能按「清桌完成」）。
const harness = vi.hoisted(() => ({ ctx: {} }))
vi.mock('../../src/contexts/BookingContext', () => ({ useBooking: () => harness.ctx }))
vi.mock('../../src/contexts/AuthContext', () => ({ useAuth: () => ({ can: () => true, user: { role: 'floor' } }) }))
vi.mock('../../src/components/ui/Toast', () => ({ useToast: () => ({ error: vi.fn(), success: vi.fn(), info: vi.fn(), action: vi.fn() }), useConfirm: () => vi.fn() }))
vi.mock('../../src/components/admin/floormap/FloorMap', () => ({ default: ({ floor }) => <div data-floor={floor} /> }))
vi.mock('../../src/components/admin/ops/OpsRail', () => ({ default: () => <div data-rail /> }))
vi.mock('../../src/components/admin/floormap/TableDrawer', () => ({ default: ({ table }) => <div data-drawer={table.number} /> }))
vi.mock('../../src/components/admin/floormap/ArrivalStrip', () => ({ default: () => null }))
vi.mock('../../src/components/admin/floormap/StatusBar', () => ({ default: () => null }))
vi.mock('../../src/components/admin/ops/OpsHintBar', () => ({ default: ({ onOpenTable }) => <button onClick={() => onOpenTable('201')}>1 桌待清</button> }))
vi.mock('../../src/components/admin/ops/OpsLogModal', () => ({ default: () => null }))
vi.mock('../../src/components/admin/ops/HandoffPanel', () => ({ default: () => null }))
vi.mock('../../src/components/admin/LayoutEditor', () => ({ default: () => null }))
vi.mock('../../src/components/booking/BookingDetailSheet', () => ({ default: () => null }))
const OperationsView = (await import('../../src/components/admin/OperationsView')).default

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let container, root
const table = (number, floor, extra = {}) => ({ number, capacity: 4, floor, isActive: true, status: 'vacant', ...extra })
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 9, 10, 19))
  harness.ctx = {
    tables: [table('101', '1F'), table('201', '2F', { status: 'cleaning' })],
    bookings: [], waitlist: [], groupReservations: [], fixtures: {}, zones: [],
    settings: { seatings: [{ id: 'dinner', start: '17:00', end: '21:00' }], diningDurationMin: 90, cleanupBufferMin: 10 },
    findSuitableTables: () => [], preassignableTables: () => [], findReserveCandidates: () => ({ tables: [], kind: 'hold' }),
    suggestTable: () => null, suggestTableCombo: () => ({ enough: false, tableNumbers: [] }),
  }
})
afterEach(() => { act(() => root?.unmount()); container?.remove(); vi.useRealTimers() })

it('點「1 桌待清」→ 切到 2F 並打開 201 的桌況抽屜', () => {
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
  act(() => root.render(<OperationsView />))
  expect(container.querySelector('[data-drawer]')).toBeNull()
  act(() => [...container.querySelectorAll('button')].find(b => b.textContent === '1 桌待清').click())
  expect(container.querySelector('[data-drawer]').getAttribute('data-drawer')).toBe('201')
  expect(container.querySelector('[data-floor]').getAttribute('data-floor')).toBe('2F')
})
