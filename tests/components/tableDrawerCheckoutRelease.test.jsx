import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'

// D2（night-50）：桌況抽屜「客人已離席」後 toast 改給「復原離席」（原「一鍵釋出」拿掉：抽屜仍開著、
// 下方就是「清桌完成」；多張用頂列待清清單的「全部清桌」）。
// 復原走 context.undoCheckoutBooking（service 層守門：桌仍是本筆待清桌才倒回）；失敗只報錯、不動任何桌。

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const NOW = new Date(2026, 8, 19, 12, 20)
const ctx = {}
const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), action: vi.fn() }
vi.mock('../../src/contexts/BookingContext', () => ({ useBooking: () => ctx }))
vi.mock('../../src/contexts/AuthContext', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, useAuth: () => ({ can: () => true }) }
})
vi.mock('../../src/components/ui/Toast', () => ({ useToast: () => toast, useConfirm: () => vi.fn(async () => true) }))
vi.mock('../../src/contexts/HandoffContext', () => ({ useHandoff: () => ({ canWrite: false }) }))

const TableDrawer = (await import('../../src/components/admin/floormap/TableDrawer')).default

const table = { number: '105', capacity: 6, floor: '1F', isActive: true, status: 'dining', currentBookingId: 'B1', currentRef: null, seatedAt: new Date(2026, 8, 19, 11, 0).toISOString() }
const booking = { id: 'B1', name: '余先生', phone: '0912', guests: 4, date: '2026-09-19', timeSlot: '11:00', status: 'arrived', assignedTableId: '105', extraTableIds: [], notes: {} }

describe('TableDrawer：離席後「復原離席」走 service 守門', () => {
  let container, root
  beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(NOW); vi.clearAllMocks()
    Object.assign(ctx, {
      bookings: [booking], waitlist: [], tables: [table], groupReservations: [], settings: {},
      checkoutBooking: vi.fn(() => ({ ok: true, undo: { bookingId: 'B1', prevStatus: 'arrived', tables: [{ number: '105', seatedAt: table.seatedAt }] } })),
      undoCheckoutBooking: vi.fn(() => ({ ok: false, code: 'table-occupied', error: '105 已被下一組使用（用餐中），未復原' })), finalizeBooking: vi.fn(() => ({ ok: true })),
      clearTable: vi.fn(), undoClearTable: vi.fn(), reseatBookingTables: vi.fn(),
      releaseCheckedOutTables: vi.fn(() => ({ ok: true, released: [], skipped: ['105'] })),
      cancelBooking: vi.fn(), undoCancelBooking: vi.fn(), blockTable: vi.fn(), unblockTable: vi.fn(),
      walkInSeat: vi.fn(), assignBookingToTable: vi.fn(), seatBooking: vi.fn(), setTableOutage: vi.fn(),
      clearTableOutage: vi.fn(), releaseOverriddenAssignment: vi.fn(),
    })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => { root.render(<TableDrawer table={table} booking={booking} preassign={null} groupHold={null} onClose={() => {}} onStartMove={() => {}} mode={{}} />) })
  })
  afterEach(() => { act(() => root?.unmount()); container?.remove(); vi.useRealTimers() })

  it('離席 toast 帶「復原離席」；桌已被下一組坐走 → 復原安全失敗、不直接動桌', async () => {
    const btn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('客人已離席'))
    expect(btn).toBeTruthy()
    await act(async () => { btn.click() })
    expect(ctx.checkoutBooking).toHaveBeenCalledWith('B1')
    const [msg, action, opts] = toast.action.mock.calls[0]
    expect(msg).toContain('余先生 已離席')
    expect(action.label).toBe('復原離席')
    expect(opts.duration).toBeGreaterThanOrEqual(8000)
    act(() => { action.onClick() })
    expect(ctx.undoCheckoutBooking).toHaveBeenCalledWith({ bookingId: 'B1', prevStatus: 'arrived', tables: [{ number: '105', seatedAt: table.seatedAt }] })
    expect(ctx.clearTable).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith('復原失敗：105 已被下一組使用（用餐中），未復原')
  })
})
