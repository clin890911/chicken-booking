import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { todayStr } from '../../src/utils/timeSlots'
import { buildBookingsCSV } from '../../src/utils/exportData'

// 大組併桌（8 位＝主桌 101＋副桌 107）的「顯示層」回歸：
// 卡片徽章／toast／詳情的改桌鈕／現場換桌提示過去只讀 assignedTableId，副桌被漏掉，
// 店員看到「桌 101」就以為只有一張桌（E2E 實測發現）。

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const ctx = {}
const toast = { success: vi.fn(), error: vi.fn(), action: vi.fn(), info: vi.fn() }
vi.mock('../../src/contexts/BookingContext', () => ({ useBooking: () => ctx }))
vi.mock('../../src/contexts/AuthContext', () => ({ useAuth: () => ({ can: () => true }) }))
vi.mock('../../src/components/ui/Toast', () => ({ useToast: () => toast, useConfirm: () => vi.fn(async () => true) }))

const BookingCard = (await import('../../src/components/booking/BookingCard')).default
const ModeBanner = (await import('../../src/components/admin/ops/ModeBanner')).default

const TODAY = todayStr()
const mkBooking = (over = {}) => ({
  id: 'B8', name: '大組', phone: '0933111222', guests: 8, date: TODAY, timeSlot: '11:00',
  status: 'confirmed', source: 'phone', assignedTableId: '101', extraTableIds: ['107'], notes: {}, ...over,
})
const mkTable = (number, over = {}) => ({ number, capacity: 4, floor: '1F', isActive: true, status: 'vacant', currentBookingId: null, ...over })

describe('併桌訂位（101＋107）顯示', () => {
  let container, root
  const render = (booking, tables) => {
    Object.assign(ctx, {
      tables, bookings: [booking], groupReservations: [], settings: {}, customers: [],
      seatBooking: vi.fn(() => ({ ok: true })), findReserveCandidates: vi.fn(() => ({ kind: 'hold', tables: [] })),
      checkoutBooking: vi.fn(), finalizeBooking: vi.fn(), cancelBooking: vi.fn(), undoCancelBooking: vi.fn(),
      setStatus: vi.fn(), clearTable: vi.fn(), clearBookingPreassign: vi.fn(),
    })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => { root.render(<BookingCard booking={booking} onAssign={vi.fn()} onMove={vi.fn()} />) })
  }
  const badge = () => container.querySelector('[data-kind]')

  beforeEach(() => { vi.clearAllMocks() })
  afterEach(() => { act(() => root?.unmount()); container?.remove(); document.body.innerHTML = '' })

  it('鎖桌（held）徽章 → 「桌 101 + 107」', () => {
    render(mkBooking(), [mkTable('101', { status: 'reserved', currentBookingId: 'B8' }), mkTable('107', { status: 'reserved', currentBookingId: 'B8' })])
    expect(badge().dataset.kind).toBe('held')
    expect(badge().textContent.trim()).toBe('桌 101 + 107')
  })

  it('預配徽章 → 「預配 101 + 107」', () => {
    render(mkBooking(), [mkTable('101'), mkTable('107')])
    expect(badge().dataset.kind).toBe('preassign')
    expect(badge().textContent.trim()).toBe('預配 101 + 107')
  })

  it('已入座（arrived）徽章 → 「桌 101 + 107」', () => {
    render(mkBooking({ status: 'arrived', actualArrivalTime: new Date().toISOString() }), [mkTable('101', { status: 'dining', currentBookingId: 'B8' }), mkTable('107', { status: 'dining', currentBookingId: 'B8' })])
    expect(badge().textContent.trim()).toBe('桌 101 + 107')
  })

  it('單桌訂位徽章不變（桌 105）', () => {
    render(mkBooking({ assignedTableId: '105', extraTableIds: [], guests: 2 }), [mkTable('105', { status: 'reserved', currentBookingId: 'B8' })])
    expect(badge().textContent.trim()).toBe('桌 105')
  })

  it('「客人到了」入座 toast 列出所有桌', () => {
    render(mkBooking(), [mkTable('101', { status: 'reserved', currentBookingId: 'B8' }), mkTable('107', { status: 'reserved', currentBookingId: 'B8' })])
    const seat = [...container.querySelectorAll('button')].find(b => b.textContent.includes('客人到了'))
    act(() => { seat.click() })
    // 2026-10 起「客人到了」統一帶 5 秒復原（toast.action）
    expect(toast.action).toHaveBeenCalledWith('大組 已入座 101 + 107', expect.objectContaining({ label: '復原' }), { duration: 5000 })
  })

  it('詳情表「改桌」鈕列出所有桌', () => {
    render(mkBooking(), [mkTable('101', { status: 'reserved', currentBookingId: 'B8' }), mkTable('107', { status: 'reserved', currentBookingId: 'B8' })])
    act(() => { container.querySelector('button[title="點擊看完整詳情"]').click() })
    expect(document.body.textContent).toContain('改桌（目前 101 + 107）')
  })

  it('現場換桌模式橫幅列出原本所有桌', () => {
    act(() => {
      container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
      root.render(<ModeBanner tables={[]} mode={{ type: 'move', booking: mkBooking() }} pendingConfirm="105" onCancel={() => {}} onConfirm={() => {}} onClearPending={() => {}} />)
    })
    expect(container.textContent).toContain('從 101 + 107')
  })

  it('CSV「指派桌」欄含副桌', () => {
    const csv = buildBookingsCSV([mkBooking()], {})
    expect(csv).toContain('101 + 107')
  })
})
