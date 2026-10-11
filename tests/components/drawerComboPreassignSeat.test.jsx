import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'

// 桌況抽屜「X 到了，入座」：併桌預配（主桌＋副桌）不可先走單桌指派——
// bookingService.assignTable 會重設 extraTableIds，副桌就掉了；要直接 seatBooking 整組入座。

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const TODAY = '2026-09-19'
const NOW = new Date(2026, 8, 19, 12, 20)
const ctx = {}
const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), action: vi.fn() }
vi.mock('../../src/contexts/BookingContext', () => ({ useBooking: () => ctx }))
vi.mock('../../src/contexts/AuthContext', () => ({ useAuth: () => ({ can: () => true }) }))
vi.mock('../../src/components/ui/Toast', () => ({ useToast: () => toast, useConfirm: () => vi.fn(async () => true) }))

const TableDrawer = (await import('../../src/components/admin/floormap/TableDrawer')).default

const T105 = { number: '105', capacity: 6, floor: '1F', isActive: true, status: 'vacant', currentBookingId: null, currentRef: null }
const T106 = { number: '106', capacity: 6, floor: '1F', isActive: true, status: 'vacant', currentBookingId: null, currentRef: null }
const mk = (extra) => ({ id: 'YU', name: '余先生', phone: '', guests: 10, date: TODAY, timeSlot: '12:30', status: 'confirmed', assignedTableId: '105', extraTableIds: extra, notes: {} })

function setCtx(bookings) {
  Object.assign(ctx, {
    bookings, waitlist: [], tables: [T105, T106], groupReservations: [], settings: {},
    walkInSeat: vi.fn(), assignBookingToTable: vi.fn(() => ({ ok: true })),
    seatBooking: vi.fn(() => ({ ok: true, tableNumber: '105', tableNumbers: ['105', '106'] })),
    seatWaitlist: vi.fn(), releaseOverriddenAssignment: vi.fn(), undoAssignBooking: vi.fn(), restoreOverriddenAssignment: vi.fn(),
    blockTable: vi.fn(), unblockTable: vi.fn(), reseatBookingTables: vi.fn(), checkoutBooking: vi.fn(),
    finalizeBooking: vi.fn(), clearTable: vi.fn(), undoClearTable: vi.fn(), cancelBooking: vi.fn(),
    undoCancelBooking: vi.fn(), setTableOutage: vi.fn(), clearTableOutage: vi.fn(),
  })
}

describe('TableDrawer 預配客人到了：併桌整組入座、不走單桌指派', () => {
  let container, root
  const mount = (el) => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => { root.render(el) })
  }
  const btn = (text) => [...document.querySelectorAll('button')].find(b => b.textContent.includes(text))

  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); vi.clearAllMocks() })
  afterEach(() => { act(() => root?.unmount()); container?.remove(); vi.useRealTimers() })

  it('併桌預配 → 直接 seatBooking（整組），不呼叫 assignBookingToTable', () => {
    const yu = mk(['106'])
    setCtx([yu])
    mount(<TableDrawer table={T105} booking={null} preassign={yu} groupHold={null} onClose={() => {}} onStartMove={() => {}} mode={{}} />)
    act(() => { btn('余先生 到了，入座 105').click() })
    expect(ctx.assignBookingToTable).not.toHaveBeenCalled()
    expect(ctx.seatBooking).toHaveBeenCalledWith('YU')
    expect(toast.action).toHaveBeenCalledWith('余先生（10 位）入座 105、106', expect.objectContaining({ label: '復原' }), { duration: 5000 })
  })

  it('單桌預配 → 照舊先 assignBookingToTable 再 seatBooking', () => {
    const yu = mk([])
    setCtx([yu])
    ctx.seatBooking = vi.fn(() => ({ ok: true, tableNumber: '105' }))
    mount(<TableDrawer table={T105} booking={null} preassign={yu} groupHold={null} onClose={() => {}} onStartMove={() => {}} mode={{}} />)
    act(() => { btn('余先生 到了，入座 105').click() })
    expect(ctx.assignBookingToTable).toHaveBeenCalledWith('YU', '105')
    expect(ctx.seatBooking).toHaveBeenCalledWith('YU')
  })
})
