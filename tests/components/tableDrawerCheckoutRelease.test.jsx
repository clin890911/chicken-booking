import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'

// R2：桌況抽屜「客人已離席」後 toast 的「一鍵釋出」。
// 過去直接對快照的桌號無條件 clearTable：toast 按鈕可能幾秒後才按，期間桌已清好、甚至已帶下一組，
// 會把剛入座那組從桌況圖抹掉。改走 releaseAfterCheckout → releaseCheckedOutTables（只清仍是待清桌、
// 且仍由這筆持有的桌），與訂位卡（useBookingActions）同一條路。

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

describe('TableDrawer：離席後「一鍵釋出」走持有者守門', () => {
  let container, root
  beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(NOW); vi.clearAllMocks()
    Object.assign(ctx, {
      bookings: [booking], waitlist: [], tables: [table], groupReservations: [], settings: {},
      checkoutBooking: vi.fn(() => ({ ok: true })), finalizeBooking: vi.fn(() => ({ ok: true })),
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

  it('按「一鍵釋出」時桌已被下一組坐走 → 呼叫 releaseCheckedOutTables、不直接 clearTable', async () => {
    const btn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('客人已離席'))
    expect(btn).toBeTruthy()
    await act(async () => { btn.click() })
    expect(ctx.checkoutBooking).toHaveBeenCalledWith('B1')
    const [, action] = toast.action.mock.calls[0]
    expect(action.label).toBe('一鍵釋出')
    act(() => { action.onClick() })
    expect(ctx.releaseCheckedOutTables).toHaveBeenCalledWith('B1')
    expect(ctx.clearTable).not.toHaveBeenCalled()                  // ★ 不再無條件清桌
    expect(toast.info).toHaveBeenCalledWith('105 已清好或已有下一組，無需釋出')
  })
})
