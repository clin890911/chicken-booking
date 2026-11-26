import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'

// A4（2026-11-27）：預配桌被別組佔時，今日訂位卡與桌況抽屜都統一走「到了 · 換桌入座」（與報到列一致），
// 不再顯示「客人到了」→ 確認框「仍要入座」→ 入座失敗。判斷收斂到 arriveSeat.arriveActionFor 一支。

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const ctx = {}
const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), action: vi.fn() }
const confirm = vi.fn(async () => true)
vi.mock('../../src/contexts/BookingContext', () => ({ useBooking: () => ctx }))
vi.mock('../../src/contexts/AuthContext', async (orig) => ({ ...(await orig()), useAuth: () => ({ can: () => true }) }))
vi.mock('../../src/components/ui/Toast', () => ({ useToast: () => toast, useConfirm: () => confirm }))

const UpcomingPanel = (await import('../../src/components/admin/floormap/UpcomingPanel')).default
const TableDrawer = (await import('../../src/components/admin/floormap/TableDrawer')).default

const TODAY = '2026-11-27'
const NOW = new Date(2026, 10, 27, 11, 50)
const T = (number, over = {}) => ({ number, capacity: 4, floor: '1F', isActive: true, status: 'vacant', currentBookingId: null, currentRef: null, ...over })
const WALK = { id: 'WALK', name: '現場散客', guests: 2, date: TODAY, timeSlot: '11:30', status: 'arrived', assignedTableId: '106', extraTableIds: [], source: 'walkin', notes: {} }
const CHEN = { id: 'CHEN', name: '陳小姐', phone: '0911000002', guests: 4, date: TODAY, timeSlot: '12:00', status: 'confirmed', assignedTableId: '106', extraTableIds: [], notes: {} }

const setCtx = (bookings, tables) => Object.assign(ctx, {
  bookings, tables, waitlist: [], groupReservations: [], settings: {}, store: {},
  seatBooking: vi.fn(() => ({ ok: false, error: '106 目前由 現場散客 使用，請先改桌' })), undoSeatBooking: vi.fn(),
  markBookingNoshow: vi.fn(), undoMarkBookingNoshow: vi.fn(), completeWithoutSeating: vi.fn(), undoCompleteWithoutSeating: vi.fn(),
  cancelBooking: vi.fn(), undoCancelBooking: vi.fn(), walkInSeat: vi.fn(), assignBookingToTable: vi.fn(() => ({ ok: true })),
  blockTable: vi.fn(), unblockTable: vi.fn(), reseatBookingTables: vi.fn(), checkoutBooking: vi.fn(), undoCheckoutBooking: vi.fn(),
  finalizeBooking: vi.fn(), clearTable: vi.fn(), undoClearTable: vi.fn(), setTableOutage: vi.fn(), clearTableOutage: vi.fn(),
  releaseOverriddenAssignment: vi.fn(), seatWaitlist: vi.fn(), undoAssignBooking: vi.fn(), restoreOverriddenAssignment: vi.fn(),
})

let container, root
const mount = (el) => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); act(() => root.render(el)) }
const btn = (text) => [...container.querySelectorAll('button')].find(b => b.textContent.includes(text))

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); vi.clearAllMocks() })
afterEach(() => { act(() => root?.unmount()); container?.remove(); vi.useRealTimers() })

describe('今日訂位卡：預配桌被佔 → 「到了 · 換桌入座」', () => {
  it('主鈕是「到了 · 換桌入座」、沒有「客人到了」；點了交出訂位（進選桌入座模式），不入座、不跳確認框', () => {
    setCtx([CHEN, WALK], [T('105'), T('106', { status: 'dining', currentBookingId: 'WALK' })])
    const onArriveSeat = vi.fn()
    mount(<UpcomingPanel onClickBooking={() => {}} onAssignTable={() => {}} onArriveSeat={onArriveSeat} onMoveTable={() => {}} />)
    const card = container.querySelector('[data-booking-id="CHEN"]')
    expect([...card.querySelectorAll('button')].some(b => b.textContent === '客人到了')).toBe(false)
    const reseat = card.querySelector('button[aria-label="陳小姐 到了，換桌入座"]')
    expect(reseat.textContent).toBe('到了 · 換桌入座')
    act(() => reseat.click())
    expect(onArriveSeat).toHaveBeenCalledWith(CHEN)
    expect(ctx.seatBooking).not.toHaveBeenCalled()
    expect(confirm).not.toHaveBeenCalled()
  })
  it('預配桌空著 → 照舊「客人到了」', () => {
    setCtx([CHEN], [T('105'), T('106')])
    mount(<UpcomingPanel onClickBooking={() => {}} onAssignTable={() => {}} onArriveSeat={vi.fn()} onMoveTable={() => {}} />)
    const card = container.querySelector('[data-booking-id="CHEN"]')
    expect([...card.querySelectorAll('button')].some(b => b.textContent === '客人到了')).toBe(true)
    expect(card.querySelector('button[aria-label="陳小姐 到了，換桌入座"]')).toBeNull()
  })
})

describe('桌況抽屜：預配桌被佔 → 「到了 · 換桌入座」', () => {
  it('點被佔的 106：抽屜列出預配此桌的陳小姐，按「到了 · 換桌入座」交出訂位', () => {
    const tables = [T('105'), T('106', { status: 'dining', currentBookingId: 'WALK', seatedAt: NOW.toISOString() })]
    setCtx([CHEN, WALK], tables)
    const onArriveReseat = vi.fn()
    mount(<TableDrawer table={tables[1]} booking={WALK} preassign={null} groupHold={null} onClose={() => {}} onStartMove={() => {}} onArriveReseat={onArriveReseat} mode={{}} />)
    expect(container.querySelector('[data-testid="drawer-taken-preassign"]').textContent).toContain('陳小姐')
    act(() => btn('陳小姐 到了 · 換桌入座').click())
    expect(onArriveReseat).toHaveBeenCalledWith(CHEN)
    expect(ctx.seatBooking).not.toHaveBeenCalled()
  })
  it('併桌預配（主桌 105 空、副桌 106 被佔）：空桌抽屜不給「到了，入座 105」，改給換桌入座', () => {
    const combo = { ...CHEN, guests: 8, assignedTableId: '105', extraTableIds: ['106'] }
    const tables = [T('105'), T('106', { status: 'dining', currentBookingId: 'WALK' })]
    setCtx([combo, WALK], tables)
    const onArriveReseat = vi.fn()
    mount(<TableDrawer table={tables[0]} booking={null} preassign={combo} groupHold={null} onClose={() => {}} onStartMove={() => {}} onArriveReseat={onArriveReseat} mode={{}} />)
    expect(btn('到了，入座 105')).toBeUndefined()
    act(() => btn('陳小姐 到了 · 換桌入座').click())
    expect(onArriveReseat).toHaveBeenCalledWith(combo)
    expect(confirm).not.toHaveBeenCalled()
  })
})
