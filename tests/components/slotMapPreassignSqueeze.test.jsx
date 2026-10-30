// 規劃 → 排位地圖「散客預先配桌」套用擠一擠（capacity.squeezeSeats，每桌可多坐 1 位）。
// 根因：PR #165 做擠一擠時漏了規劃頁，Barry 線上遇到「林老師 11 位選 105(4)+108(6) 還差 1 席、確認鈕灰」。
// 口徑與現場 ModeBanner 一致：超過原席數、擠一擠夠 → 黃字「擠一擠 · 超坐 N 位」、可確認；
// 擠一擠也不夠才「擠一擠也還差 N 位」並鎖住。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'

const harness = vi.hoisted(() => ({ ctx: {}, toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), action: vi.fn() } }))
vi.mock('../../src/contexts/BookingContext', () => ({ useBooking: () => harness.ctx }))
vi.mock('../../src/contexts/AuthContext', () => ({ useAuth: () => ({ can: () => true, user: { role: 'manager' } }) }))
vi.mock('../../src/components/ui/Toast', () => ({ useToast: () => harness.toast, useConfirm: () => vi.fn() }))
vi.mock('../../src/components/admin/floormap/FloorMap', () => ({ default: ({ tables, onSelectTable }) => <div>{tables.map(t => <button key={t.number} data-table={t.number} onClick={() => onSelectTable(t.number)}>{t.number}</button>)}</div> }))
vi.mock('../../src/components/booking/BookingDetailSheet', () => ({ default: () => null }))
const SlotMapPanel = (await import('../../src/components/admin/planning/SlotMapPanel')).default

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let container, root, booking
const table = (number, capacity, extra = {}) => ({ number, capacity, floor: '1F', isActive: true, status: 'vacant', ...extra })
const pick = n => act(() => container.querySelector(`[data-table="${n}"]`).click())
const confirmBtn = () => [...container.querySelectorAll('button')].find(b => /確認(併桌)?預配/.test(b.textContent))
const badge = () => container.querySelector('[data-testid="squeeze-badge"]')
const begin = (guests) => {
  booking.guests = guests
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
  act(() => root.render(<SlotMapPanel date={booking.date} assignRequest={{ bookingId: booking.id }} />))
}

beforeEach(() => {
  vi.clearAllMocks()
  booking = { id: 'B1', name: '林老師', guests: 11, date: '2026-10-31', timeSlot: '12:00', status: 'confirmed' }
  harness.ctx = {
    tables: [table('105', 4), table('108', 6), table('109', 6)],
    bookings: [booking], groupReservations: [], fixtures: {}, zones: [],
    settings: { seatings: [{ id: 'lunch', name: '午餐', start: '11:00', end: '14:30' }], diningDurationMin: 90, cleanupBufferMin: 10 },
    preassignBookingTable: vi.fn(() => ({ id: 'B1' })), preassignBookingTables: vi.fn(() => ({ id: 'B1' })), clearBookingPreassign: vi.fn(),
  }
})
afterEach(() => { act(() => root?.unmount()); container?.remove() })

describe('規劃頁散客預配：擠一擠', () => {
  it('11 位選 105(4)+108(6)：原席 10、擠一擠 12 → 黃字超坐 1 位、可確認並寫入', () => {
    begin(11); pick('105'); pick('108')
    expect(container.textContent).toContain('已選 10/11 席')
    expect(badge()?.textContent).toBe('擠一擠 · 超坐 1 位')
    expect(container.textContent).not.toMatch(/還差/)
    expect(confirmBtn().disabled).toBe(false)
    act(() => confirmBtn().click())
    expect(harness.ctx.preassignBookingTables).toHaveBeenCalledWith('B1', ['105', '108'])
    expect(harness.toast.success).toHaveBeenCalledWith(expect.stringContaining('擠一擠超坐 1 位'))
    expect(harness.toast.error).not.toHaveBeenCalled()
  })

  it('12 位選同兩桌：擠一擠剛好 12 → 可確認（超坐 2 位）', () => {
    begin(12); pick('105'); pick('108')
    expect(badge()?.textContent).toBe('擠一擠 · 超坐 2 位')
    expect(confirmBtn().disabled).toBe(false)
    act(() => confirmBtn().click())
    expect(harness.ctx.preassignBookingTables).toHaveBeenCalledWith('B1', ['105', '108'])
  })

  it('13 位選同兩桌：擠一擠 12 也不夠 → 「還差 1」、鎖住、不寫入', () => {
    begin(13); pick('105'); pick('108')
    expect(container.textContent).toContain('擠一擠也還差 1 位')
    expect(badge()).toBeNull()
    expect(confirmBtn().disabled).toBe(true)
    act(() => confirmBtn().click())
    expect(harness.ctx.preassignBookingTables).not.toHaveBeenCalled()
  })

  it('單桌：7 位選 108(6) → 擠一擠 7 夠，可確認走單桌預配', () => {
    begin(7); pick('108')
    expect(container.textContent).toContain('已選 6/7 席')
    expect(badge()?.textContent).toBe('擠一擠 · 超坐 1 位')
    expect(confirmBtn().disabled).toBe(false)
    act(() => confirmBtn().click())
    expect(harness.ctx.preassignBookingTable).toHaveBeenCalledWith('B1', '108')
  })

  it('單桌：8 位選 108(6) → 擠一擠也還差 1 位，鎖住', () => {
    begin(8); pick('108')
    expect(container.textContent).toContain('擠一擠也還差 1 位')
    expect(confirmBtn().disabled).toBe(true)
  })

  it('原席就夠（10 位選 105+108）→ 不出擠一擠黃字', () => {
    begin(10); pick('105'); pick('108')
    expect(badge()).toBeNull()
    expect(confirmBtn().disabled).toBe(false)
  })
})
