import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'

// 日曆分頁「＋ 新增訂位」入口（2026-08）。
// 背景：店主回報「在訂位>日曆中，我選定日期後沒有一個可以新增當天訂位的按鈕」——
// 要新增當天訂位得自己切到「新增」分頁再手動改日期，容易忘了改、訂到錯的日期。
// 這裡驗證 CalendarView 自己的呈現邏輯：未來/今天日期才給入口、過去日期不給、
// 空狀態也要有入口（不能只有「有訂位的那天」才給得了）。
// 實際切分頁＋預填日期的串接邏輯在 BookingsView，見 bookingsViewAddFlow.test.jsx。

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let bookingCtx = { bookings: [], groupReservations: [] }
vi.mock('../../src/contexts/BookingContext', () => ({ useBooking: () => bookingCtx }))
// BookingCard / GroupBatchCard 各自吃 useToast/useConfirm/useAuth 等一堆 context，
// 這裡只關心「有沒有進清單」，換成無依賴的樁節省 mock 面積。
vi.mock('../../src/components/booking/BookingCard', () => ({
  default: ({ booking }) => <div data-testid="booking-card">{booking.id}</div>,
}))
vi.mock('../../src/components/booking/GroupBatchCard', () => ({
  default: ({ group }) => <div data-testid="group-card">{group.id}</div>,
}))

const CalendarView = (await import('../../src/components/admin/CalendarView')).default

// 固定時鐘：2026-08-15（月中，同月同時有過去/今天/未來日可點，方便定位格子）
const NOW = new Date(2026, 7, 15, 10, 0, 0)
const TODAY = '2026-08-15'
const PAST = '2026-08-10'
const FUTURE = '2026-08-20'

describe('CalendarView：日曆選定日期後的「＋ 新增訂位」入口', () => {
  let container, root

  const dayButton = (dayNum) =>
    [...container.querySelectorAll('button')].find(
      b => b.querySelector('span.font-black')?.textContent === String(dayNum)
    )

  const render = (bookings = [], groupReservations = [], onAddBooking = vi.fn()) => {
    bookingCtx = { bookings, groupReservations }
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => { root.render(<CalendarView onAddBooking={onAddBooking} />) })
    return onAddBooking
  }

  const pickDay = (dayNum) => act(() => { dayButton(dayNum).click() })

  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW) })
  afterEach(() => {
    act(() => root?.unmount())
    container?.remove()
    vi.useRealTimers()
  })

  it('選未來日期、當天有訂位：標頭列出現「＋ 新增訂位」，點擊回傳該日期', () => {
    const onAddBooking = render([{ id: 'b1', date: FUTURE, timeSlot: '18:00', status: 'confirmed', guests: 2 }])
    pickDay(20) // FUTURE = 2026-08-20
    const btn = [...container.querySelectorAll('button')].find(b => b.textContent.includes('新增訂位'))
    expect(btn).toBeTruthy()
    act(() => btn.click())
    expect(onAddBooking).toHaveBeenCalledWith(FUTURE)
  })

  it('選今天：也出現「＋ 新增訂位」（今天不算過去）', () => {
    render([{ id: 'b1', date: TODAY, timeSlot: '12:00', status: 'confirmed', guests: 2 }])
    pickDay(15) // TODAY
    const btn = [...container.querySelectorAll('button')].find(b => b.textContent.includes('新增訂位'))
    expect(btn).toBeTruthy()
  })

  it('選過去日期（即使當天有訂位）：不顯示「＋ 新增訂位」', () => {
    render([{ id: 'b1', date: PAST, timeSlot: '18:00', status: 'confirmed', guests: 2 }])
    pickDay(10) // PAST
    expect(container.textContent).toContain('b1') // 訂位清單本身照常顯示
    const btn = [...container.querySelectorAll('button')].find(b => b.textContent.includes('新增訂位'))
    expect(btn).toBeFalsy()
  })

  it('未來日期但當天 0 筆訂位：空狀態本身要有新增入口', () => {
    const onAddBooking = render([])
    pickDay(20) // FUTURE，無訂位
    expect(container.textContent).toContain('這天沒有訂位')
    const btn = [...container.querySelectorAll('button')].find(b => b.textContent.includes('新增訂位'))
    expect(btn).toBeTruthy()
    act(() => btn.click())
    expect(onAddBooking).toHaveBeenCalledWith(FUTURE)
  })

  it('過去日期且 0 筆訂位：空狀態也不該給新增入口', () => {
    render([])
    pickDay(10) // PAST，無訂位
    expect(container.textContent).toContain('這天沒有訂位')
    const btn = [...container.querySelectorAll('button')].find(b => b.textContent.includes('新增訂位'))
    expect(btn).toBeFalsy()
  })
})
