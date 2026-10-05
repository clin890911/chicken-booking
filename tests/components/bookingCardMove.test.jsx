import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { todayStr } from '../../src/utils/timeSlots'

// U2／U3（2026-09 店主回報：余先生現場訂位，指派後就再也改不了桌）。
// U2：今日待到、已有桌的訂位卡要有「改桌」→ 觸發容器給的 onMove（AdminPage 跨頁進現場 move 模式）；
//     併桌訂位停用並說明；入座被擋（S1）時 toast 帶「改桌」。
// U3：桌號徽章分 held（綠「桌 105」）與預配（藍「預配 105」），口徑＝utils/tableStatus.assignmentKind。

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const ctx = {}
const toast = { success: vi.fn(), error: vi.fn(), action: vi.fn(), info: vi.fn() }
vi.mock('../../src/contexts/BookingContext', () => ({ useBooking: () => ctx }))
vi.mock('../../src/components/ui/Toast', () => ({ useToast: () => toast, useConfirm: () => vi.fn(async () => true) }))

const BookingCard = (await import('../../src/components/booking/BookingCard')).default

const TODAY = todayStr()
const mkBooking = (over = {}) => ({
  id: 'B1', name: '余先生', phone: '0933111222', guests: 2, date: TODAY, timeSlot: '11:00',
  status: 'confirmed', source: 'walkin', assignedTableId: '105', extraTableIds: [], notes: {}, ...over,
})
const mkTable = (over = {}) => ({ number: '105', capacity: 4, floor: '1F', isActive: true, status: 'vacant', currentBookingId: null, ...over })

describe('BookingCard：改桌入口與桌號徽章', () => {
  let container, root
  const onMove = vi.fn()
  const onAssign = vi.fn()

  const render = (booking, { tables = [mkTable()], move = onMove } = {}) => {
    Object.assign(ctx, {
      tables, bookings: [booking], groupReservations: [], settings: {},
      seatBooking: vi.fn(() => ({ ok: true })), findReserveCandidates: vi.fn(() => ({ kind: 'hold', tables: [] })),
      checkoutBooking: vi.fn(), finalizeBooking: vi.fn(), cancelBooking: vi.fn(), undoCancelBooking: vi.fn(),
      setStatus: vi.fn(), clearTable: vi.fn(), clearBookingPreassign: vi.fn(),
    })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => { root.render(<BookingCard booking={booking} onAssign={onAssign} onMove={move} />) })
  }
  const openMore = () => act(() => { container.querySelector('summary')?.click() })
  const btn = (text) => [...container.querySelectorAll('button')].find(b => b.textContent.includes(text))

  beforeEach(() => { vi.clearAllMocks() })
  afterEach(() => {
    act(() => root?.unmount())
    container?.remove()
  })

  it('U2：今日待到、已有桌 → 出現「改桌」，點下去把這筆訂位交給 onMove', () => {
    const b = mkBooking()
    render(b)
    expect(btn('客人到了')).toBeTruthy()
    openMore()
    expect(container.querySelector('details').open).toBe(true)
    act(() => { btn('改桌').click() })
    expect(onMove).toHaveBeenCalledWith(b)
  })

  it.each([[], ['106']])('今日已入座單桌/併桌%s，更多改桌入口可用且只傳原訂位', extraTableIds => {
    const b=mkBooking({status:'arrived',extraTableIds,actualArrivalTime:'2026-10-04T03:15:00.000Z'})
    render(b);openMore()
    const move=btn('改桌');expect(move).toBeTruthy();expect(move.getAttribute('aria-disabled')).not.toBe('true')
    act(()=>move.click());expect(onMove).toHaveBeenCalledWith(b)
    expect(ctx.seatBooking).not.toHaveBeenCalled();expect(ctx.setStatus).not.toHaveBeenCalled()
  })
  it.each(['cancelled','completed','noshow'])('%s不提供改桌入口', status => {
    render(mkBooking({status}));openMore();expect(btn('改桌')).toBeUndefined()
  })
  it('已入座未來日仍不允許改桌',()=>{
    render(mkBooking({status:'arrived',date:'2099-12-31'}));openMore();expect(btn('改桌')).toBeUndefined()
  })
  it('U2：容器沒給 onMove／未來日／未指派 → 不出現改桌', () => {
    render(mkBooking(), { move: null })
    expect(btn('改桌')).toBeUndefined()
    act(() => root.unmount()); container.remove()
    render(mkBooking({ date: '2099-12-31' }))
    expect(btn('改桌')).toBeUndefined()
    act(() => root.unmount()); container.remove()
    render(mkBooking({ assignedTableId: null }))
    expect(btn('改桌')).toBeUndefined()
  })

  it('U2：未到併桌訂位可交給 onMove 整組重選，保留原訂位', () => {
    const booking = mkBooking({ extraTableIds: ['106'] })
    render(booking)
    openMore()
    const b = btn('改桌')
    expect(b.getAttribute('aria-disabled')).not.toBe('true')
    act(() => { b.click() })
    expect(onMove).toHaveBeenCalledWith(booking)
  })

  it('U2：入座被擋（桌被別組佔用）→ toast 帶「改桌」出口', () => {
    const b = mkBooking()
    render(b)
    ctx.seatBooking.mockReturnValue({ ok: false, code: 'table-occupied', error: '105 目前由 陳小姐 使用，請先改桌' })
    act(() => { btn('客人到了').click() })
    const [msg, action] = toast.action.mock.calls.at(-1)
    expect(msg).toBe('入座失敗：105 目前由 陳小姐 使用，請先改桌')
    expect(action.label).toBe('改桌')
    action.onClick()
    expect(onMove).toHaveBeenCalledWith(b)
  })

  it('D8：電話可直接聯絡，高風險操作預設收起，Escape 返回更多入口', () => {
    render(mkBooking())
    expect(container.querySelector('a[href="tel:0933111222"]')).toBeTruthy()
    const details = container.querySelector('details')
    expect(details.open).toBe(false)
    expect(btn('標 No-show').closest('details')).toBe(details)
    expect(btn('取消訂位').closest('details')).toBe(details)
    openMore()
    act(() => btn('標 No-show').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    expect(details.open).toBe(false)
    expect(document.activeElement).toBe(details.querySelector('summary'))
  })

  it('U3：現場指派鎖桌（held）→ 綠色「桌 105」', () => {
    render(mkBooking(), { tables: [mkTable({ status: 'reserved', currentBookingId: 'B1' })] })
    const badge = container.querySelector('[data-kind]')
    expect(badge.dataset.kind).toBe('held')
    expect(badge.textContent.trim()).toBe('桌 105')
    expect(badge.className).toContain('bg-emerald-600')
  })

  it('U3：預配（桌況仍空）→ 藍色「預配 105」（與現場頁同一支藍）', () => {
    render(mkBooking(), { tables: [mkTable()] })
    const badge = container.querySelector('[data-kind]')
    expect(badge.dataset.kind).toBe('preassign')
    expect(badge.textContent.trim()).toBe('預配 105')
    expect(badge.style.background).toBe('rgb(29, 78, 216)')   // PREASSIGN_COLOR.badge #1d4ed8
  })

  // 驗收問題 2：只有待到類（confirmed/pending）才分 held／預配；其他狀態維持原本的綠「桌 N」
  // （已到店維持原本的橘），不能出現「別人仍坐得進去」的藍色預配徽章。
  it.each([
    ['completed', mkTable({ status: 'cleaning', currentBookingId: 'B1' }), 'bg-emerald-600'],
    ['completed', mkTable(), 'bg-emerald-600'],
    ['noshow', mkTable(), 'bg-emerald-600'],
    ['cancelled', mkTable(), 'bg-emerald-600'],
    ['arrived', mkTable({ status: 'dining', currentBookingId: 'B1' }), 'bg-orange-600'],
  ])('U3：%s（桌況 %#）→ 原本的「桌 105」徽章，不顯示預配', (status, table, cls) => {
    render(mkBooking({ status }), { tables: [table] })
    const badge = container.querySelector('[data-kind]')
    expect(badge.dataset.kind).toBe('plain')
    expect(badge.textContent.trim()).toBe('桌 105')
    expect(badge.className).toContain(cls)
    expect(container.textContent).not.toContain('預配 105')
    expect(container.innerHTML).not.toContain('別人仍坐得進去')
  })

  it('U3：pending（待確認）也分：桌況仍空 → 預配', () => {
    render(mkBooking({ status: 'pending' }), { tables: [mkTable()] })
    expect(container.querySelector('[data-kind]').dataset.kind).toBe('preassign')
  })

  it('U3：桌被別筆鎖走 → 仍是預配（桌並不屬於這筆）', () => {
    render(mkBooking(), { tables: [mkTable({ status: 'reserved', currentBookingId: 'B9' })] })
    expect(container.querySelector('[data-kind]').dataset.kind).toBe('preassign')
  })
})
