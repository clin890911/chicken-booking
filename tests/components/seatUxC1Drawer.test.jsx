import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'

// 選客入座 C 包 #13（2026-11-27）：用餐中的桌抽屜主鈕
//   入座未滿 5 分鐘 → 主鈕「換桌」、「客人已離席」降為次要；滿 5 分鐘照舊「客人已離席」為主。
//   5 分鐘與 seatingService.isQuickFixMove（改桌原桌直接回空桌）同一條線：QUICK_FIX_MOVE_MS。

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const NOW = new Date(2026, 10, 27, 12, 20)
const ctx = {}
vi.mock('../../src/contexts/BookingContext', () => ({ useBooking: () => ctx }))
vi.mock('../../src/contexts/AuthContext', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, useAuth: () => ({ can: () => true }) }
})
vi.mock('../../src/components/ui/Toast', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), action: vi.fn() }), useConfirm: () => vi.fn(async () => true) }))
vi.mock('../../src/contexts/HandoffContext', () => ({ useHandoff: () => ({ canWrite: false }) }))

const { default: TableDrawer, diningPrimaryAction } = await import('../../src/components/admin/floormap/TableDrawer')
const { QUICK_FIX_MOVE_MS } = await import('../../src/services/seatingService')

const minsAgo = (m) => new Date(NOW.getTime() - m * 60000).toISOString()
const mkTable = (seatedAt) => ({ number: '105', capacity: 6, floor: '1F', isActive: true, status: 'dining', currentBookingId: 'B1', currentRef: null, seatedAt })
const booking = { id: 'B1', name: '余先生', phone: '0912', guests: 4, date: '2026-11-27', timeSlot: '12:00', status: 'arrived', assignedTableId: '105', extraTableIds: [], notes: {} }

describe('diningPrimaryAction（純函式）', () => {
  it('與 isQuickFixMove 同一條 5 分鐘線', () => {
    expect(QUICK_FIX_MOVE_MS).toBe(5 * 60 * 1000)
    const at = (ms) => ({ status: 'dining', seatedAt: new Date(NOW.getTime() - ms).toISOString() })
    expect(diningPrimaryAction(at(0), { now: NOW })).toBe('move')
    expect(diningPrimaryAction(at(QUICK_FIX_MOVE_MS - 1000), { now: NOW })).toBe('move')
    expect(diningPrimaryAction(at(QUICK_FIX_MOVE_MS), { now: NOW })).toBe('checkout')
    expect(diningPrimaryAction(at(30 * 60000), { now: NOW })).toBe('checkout')
    // 沒有入座時間、或沒有換桌入口 → 照舊離席為主
    expect(diningPrimaryAction({ status: 'dining', seatedAt: null }, { now: NOW })).toBe('checkout')
    expect(diningPrimaryAction(at(0), { now: NOW, canMove: false })).toBe('checkout')
  })
})

describe('TableDrawer 用餐中主鈕', () => {
  let container, root
  const onStartMove = vi.fn()
  const render = (table) => {
    Object.assign(ctx, {
      bookings: [booking], waitlist: [], tables: [table], groupReservations: [], settings: {},
      checkoutBooking: vi.fn(() => ({ ok: true, undo: null })), undoCheckoutBooking: vi.fn(), finalizeBooking: vi.fn(() => ({ ok: true })),
      clearTable: vi.fn(), undoClearTable: vi.fn(), reseatBookingTables: vi.fn(), cancelBooking: vi.fn(), undoCancelBooking: vi.fn(),
      blockTable: vi.fn(), unblockTable: vi.fn(), walkInSeat: vi.fn(), seatBooking: vi.fn(), setTableOutage: vi.fn(),
      clearTableOutage: vi.fn(), releaseOverriddenAssignment: vi.fn(),
    })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => { root.render(<TableDrawer table={table} booking={booking} preassign={null} groupHold={null} onClose={() => {}} onStartMove={onStartMove} mode={{}} />) })
  }
  const primary = () => container.querySelector('[data-testid="drawer-primary"]')
  const byText = (t) => [...container.querySelectorAll('button')].find(b => b.textContent.trim() === t)
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); onStartMove.mockClear() })
  afterEach(() => { act(() => root?.unmount()); container?.remove(); vi.useRealTimers() })

  it('剛入座 2 分鐘：主鈕是「換桌」（主樣式），「客人已離席」是次要鈕', () => {
    render(mkTable(minsAgo(2)))
    expect(primary().textContent).toContain('換桌')
    expect(primary().className).toContain('bg-emerald-700')
    const out = byText('客人已離席')
    expect(out).toBeTruthy()
    expect(out.className).toContain('bg-white')
    expect(out.className).not.toContain('bg-emerald-700')
    act(() => { primary().click() })
    expect(onStartMove).toHaveBeenCalledTimes(1)
  })

  it('入座 6 分鐘：主鈕照舊「客人已離席」，「換桌」是次要', () => {
    render(mkTable(minsAgo(6)))
    expect(primary().textContent.trim()).toBe('客人已離席')
    const move = [...container.querySelectorAll('button')].find(b => b.textContent.includes('換桌') && b !== primary())
    expect(move.className).toContain('bg-white')
  })

  it('抽屜開著跨過 5 分鐘：主鈕自動換回「客人已離席」（每秒 tick）', () => {
    render(mkTable(new Date(NOW.getTime() - QUICK_FIX_MOVE_MS + 2000).toISOString()))
    expect(primary().textContent).toContain('換桌')
    act(() => { vi.advanceTimersByTime(3000) })
    expect(primary().textContent.trim()).toBe('客人已離席')
  })

  // C 包驗收 F3：兩顆鈕位置永遠固定（換桌在左、客人已離席在右，同一個 grid），只換強調樣式
  it('未滿／滿 5 分鐘：「換桌」永遠是第 1 格、「客人已離席」永遠是第 2 格，只有強調樣式交換', () => {
    const slots = () => {
      const els = [...container.querySelectorAll('[data-drawer-slot]')]
      return { order: els.map(e => e.dataset.drawerSlot), text: els.map(e => e.textContent.replace('↔', '').trim()), parentSame: els[0].parentElement === els[1].parentElement, cls: els.map(e => e.className) }
    }
    render(mkTable(minsAgo(2)))
    const a = slots()
    expect(a.order).toEqual(['move', 'checkout'])
    expect(a.text).toEqual(['換桌', '客人已離席'])
    expect(a.parentSame).toBe(true)
    expect(a.cls[0]).toContain('bg-emerald-700')
    expect(a.cls[1]).not.toContain('bg-emerald-700')
    act(() => root.unmount()); container.remove()
    render(mkTable(minsAgo(6)))
    const b = slots()
    expect(b.order).toEqual(['move', 'checkout'])
    expect(b.text).toEqual(['換桌', '客人已離席'])
    expect(b.cls[0]).not.toContain('bg-emerald-700')
    expect(b.cls[1]).toContain('bg-emerald-700')
    // 尺寸 class 相同（只差強調）：兩顆都 w-full min-h-[56px]
    for (const c of [...a.cls, ...b.cls]) expect(c).toContain('min-h-[56px]')
    // 說明列兩種時間都在（只換文字），下方按鈕不會因此上下移
    expect(container.querySelector('[data-testid="drawer-dining-hint"]').textContent).toContain('5 分鐘')
  })
})
