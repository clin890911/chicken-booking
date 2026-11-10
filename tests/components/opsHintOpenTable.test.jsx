import { it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'

// 現場頁接線：提示列「N 桌待清」點了 → 打開待清清單（D5：每桌清桌完成＋全部清桌）。
const harness = vi.hoisted(() => ({ ctx: {}, role: null }))
vi.mock('../../src/contexts/BookingContext', () => ({ useBooking: () => harness.ctx }))
// role=null → 全開（既有測試）；指定角色 → 用 AuthContext 的真實 PERMISSIONS（不自己抄一份）
vi.mock('../../src/contexts/AuthContext', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, useAuth: () => ({ can: (p) => (harness.role ? actual.PERMISSIONS[harness.role].has(p) : true), user: { role: harness.role || 'floor' } }) }
})
vi.mock('../../src/components/ui/Toast', () => ({ useToast: () => ({ error: vi.fn(), success: vi.fn(), info: vi.fn(), action: vi.fn() }), useConfirm: () => vi.fn() }))
vi.mock('../../src/components/admin/floormap/FloorMap', () => ({ default: ({ floor, locateTableNumber, locateRequestId }) => <div data-floor={floor} data-locate={locateTableNumber ?? ''} data-locate-seq={locateRequestId} /> }))
vi.mock('../../src/components/admin/ops/OpsRail', () => ({ default: ({ onAddBooking, activeTab }) => <div data-rail={activeTab}>{onAddBooking && <button onClick={onAddBooking}>開內嵌新增</button>}</div> }))
vi.mock('../../src/components/admin/floormap/TableDrawer', () => ({ default: ({ table }) => <div data-drawer={table.number} /> }))
vi.mock('../../src/components/admin/floormap/ArrivalStrip', () => ({ default: () => null }))
vi.mock('../../src/components/admin/ops/OpsHintBar', () => ({ default: ({ onOpenTable, onOpenWaitlist, onOpenUpcoming }) => <>
  <button onClick={() => onOpenTable('201')}>1 桌待清</button>
  <button onClick={() => onOpenWaitlist()}>候位 1 組</button>
  <button onClick={() => onOpenUpcoming()}>將到 3 組</button>
</> }))
vi.mock('../../src/components/admin/ops/OpsLogModal', () => ({ default: () => null }))
vi.mock('../../src/components/admin/ops/HandoffPanel', () => ({ default: () => null }))
vi.mock('../../src/components/admin/LayoutEditor', () => ({ default: () => null }))
vi.mock('../../src/components/booking/BookingDetailSheet', () => ({ default: () => null }))
const OperationsView = (await import('../../src/components/admin/OperationsView')).default

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let container, root
const table = (number, floor, extra = {}) => ({ number, capacity: 4, floor, isActive: true, status: 'vacant', ...extra })
beforeEach(() => {
  harness.role = null
  vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 9, 10, 19))
  harness.ctx = {
    tables: [table('101', '1F'), table('201', '2F', { status: 'cleaning' })],
    bookings: [], waitlist: [], groupReservations: [], fixtures: {}, zones: [],
    settings: { seatings: [{ id: 'dinner', start: '17:00', end: '21:00' }], diningDurationMin: 90, cleanupBufferMin: 10 },
    findSuitableTables: () => [], preassignableTables: () => [], findReserveCandidates: () => ({ tables: [], kind: 'hold' }),
    suggestTable: () => null, suggestTableCombo: () => ({ enough: false, tableNumbers: [] }),
    clearTable: vi.fn(), clearGroupTable: vi.fn(), undoClearTable: vi.fn(), undoClearGroupTable: vi.fn(),
  }
})
afterEach(() => { act(() => root?.unmount()); container?.remove(); vi.useRealTimers() })

// D5（night-50）：點「待清」改開待清清單（每桌清桌完成＋全部清桌），不再只開最早那一桌的抽屜。
it('點「1 桌待清」→ 打開待清清單（列出 201、有「清桌完成 201」），不開抽屜', () => {
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
  act(() => root.render(<OperationsView />))
  expect(container.querySelector('[data-drawer]')).toBeNull()
  act(() => [...container.querySelectorAll('button')].find(b => b.textContent === '1 桌待清').click())
  expect(container.querySelector('[data-drawer]')).toBeNull()
  const list = document.querySelector('ul[aria-label="待清桌清單"]')
  expect(list).not.toBeNull()
  expect(list.textContent).toContain('201')
  expect(document.querySelector('button[aria-label="清桌完成 201"]')).not.toBeNull()
})

// P6 權限門：kitchen（唯讀、無 table.update）點頂列「待清」不可開待清清單（裡面的「全部清桌」會改桌況），
// 維持原行為只開那桌的抽屜看；也不會出現任何清桌鈕、clearTable 不被呼叫、桌況不變。
it('kitchen 點「1 桌待清」→ 不出現待清清單／「全部清桌」，只開 201 抽屜，桌況不變', () => {
  harness.role = 'kitchen'
  harness.ctx.tables = [table('101', '1F'), table('201', '2F', { status: 'cleaning' }), table('202', '2F', { status: 'cleaning' })]
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
  act(() => root.render(<OperationsView />))
  act(() => [...container.querySelectorAll('button')].find(b => b.textContent === '1 桌待清').click())
  expect(document.querySelector('ul[aria-label="待清桌清單"]')).toBeNull()
  expect([...document.querySelectorAll('button')].some(b => b.textContent.includes('全部清桌'))).toBe(false)
  expect(document.querySelector('button[aria-label^="清桌完成"]')).toBeNull()
  expect(container.querySelector('[data-drawer]')?.getAttribute('data-drawer')).toBe('201')
  expect(harness.ctx.clearTable).not.toHaveBeenCalled()
  expect(harness.ctx.tables.filter(t => t.status === 'cleaning').map(t => t.number)).toEqual(['201', '202'])
})

// OperationsView.jsx openHintTable 的分支：內嵌新增（選桌）面板開著時，點「待清／超時」只切樓層＋定位、
// 不開抽屜（否則抽屜蓋住面板、中斷店員正在打的訂位）。刪掉 `if (mode || reserveOpenRef.current) return locateSuggestion(...)` 這行，這支就會紅。
it('內嵌新增面板開著時點「1 桌待清」→ 只切到 2F 並定位 201，不開抽屜', () => {
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
  act(() => root.render(<OperationsView />))
  act(() => [...container.querySelectorAll('button')].find(b => b.textContent === '開內嵌新增').click())
  act(() => [...container.querySelectorAll('button')].find(b => b.textContent === '1 桌待清').click())
  expect(container.querySelector('[data-drawer]')).toBeNull()
  const map = container.querySelector('[data-floor]')
  expect(map.getAttribute('data-floor')).toBe('2F')
  expect(map.getAttribute('data-locate')).toBe('201')
})

// 頂端「需要處理」：候位 → 左欄切到候位籤；將到 → 切回地圖（報到列在地圖下方）並切到今日訂位籤
it('點「候位 1 組」→ 左欄切到候位籤；點「將到 3 組」→ 今日訂位籤＋地圖視圖', () => {
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
  act(() => root.render(<OperationsView />))
  expect(container.querySelector('[data-rail]').getAttribute('data-rail')).toBe('walkin')
  act(() => [...container.querySelectorAll('button')].find(b => b.textContent === '候位 1 組').click())
  expect(container.querySelector('[data-rail]').getAttribute('data-rail')).toBe('waitlist')
  // 先切到摘要，再點將到 → 回地圖（FloorMap mock 出現）且今日訂位籤
  act(() => [...container.querySelectorAll('button, [role="radio"], [role="tab"]')].find(b => b.textContent === '摘要').click())
  expect(container.querySelector('[data-floor]')).toBeNull()
  act(() => [...container.querySelectorAll('button')].find(b => b.textContent === '將到 3 組').click())
  expect(container.querySelector('[data-rail]').getAttribute('data-rail')).toBe('upcoming')
  expect(container.querySelector('[data-floor]')).not.toBeNull()
})

it('摘要分頁顯示全店管理數字（用餐中＋在席人數）', () => {
  harness.ctx = { ...harness.ctx, tables: [table('101', '1F', { status: 'dining', currentBookingId: 'B1', seatedAt: new Date(2026, 9, 10, 18, 30).toISOString() }), table('201', '2F', { status: 'cleaning' })],
    bookings: [{ id: 'B1', guests: 3, status: 'arrived', date: '2026-10-10', timeSlot: '18:30', assignedTableId: '101', extraTableIds: [] }] }
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
  act(() => root.render(<OperationsView />))
  act(() => [...container.querySelectorAll('button, [role="radio"], [role="tab"]')].find(b => b.textContent === '摘要').click())
  const card = container.querySelector('[data-store-stats]')
  expect(card.textContent).toContain('用餐中1 桌 · 3 人')
  expect(card.textContent).toContain('在席人數3 人')
  expect(card.textContent).toContain('待清桌1 桌')
})
