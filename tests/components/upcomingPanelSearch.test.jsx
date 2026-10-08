import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import ArrivalStrip from '../../src/components/admin/floormap/ArrivalStrip'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const bookingCtx = { bookings: [], tables: [], groupReservations: [], setStatus: vi.fn(), seatBooking: vi.fn(), completeWithoutSeating: vi.fn(), undoCompleteWithoutSeating: vi.fn() }
vi.mock('../../src/contexts/AuthContext', () => ({ useAuth: () => ({ can: () => true }) }))
vi.mock('../../src/contexts/BookingContext', () => ({ useBooking: () => bookingCtx }))
vi.mock('../../src/components/ui/Toast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), action: vi.fn(), info: vi.fn() }),
  useConfirm: () => vi.fn(async () => true),
}))
const UpcomingPanel = (await import('../../src/components/admin/floormap/UpcomingPanel')).default

const NOW = new Date(2026, 9, 9, 18, 0, 0)
const TODAY = '2026-10-09'
const bk = (over) => ({ id: 'x', name: '陳先生', phone: '', guests: 2, date: TODAY, timeSlot: '19:00', status: 'confirmed', assignedTableId: null, notes: {}, ...over })
const setValue = (el, v) => act(() => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v)
  el.dispatchEvent(new Event('input', { bubbles: true }))
})

describe('UpcomingPanel 搜尋＋電話末碼', () => {
  let container, root
  const render = (bookings) => {
    bookingCtx.bookings = bookings
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
    act(() => root.render(<UpcomingPanel onClickBooking={() => {}} />))
  }
  const input = () => container.querySelector('input[aria-label="搜尋今日訂位"]')
  const cards = () => [...container.querySelectorAll('[data-booking-id]')].map(e => e.getAttribute('data-booking-id'))
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW) })
  afterEach(() => { act(() => root?.unmount()); container?.remove(); vi.useRealTimers() })

  const data = () => [
    bk({ id: 'a', name: '陳先生', phone: '0912-345-678', assignedTableId: '101' }),
    bk({ id: 'b', name: '陳先生', phone: '0922111999', timeSlot: '18:40', assignedTableId: '205' }),
    bk({ id: 'c', name: '林小姐', phone: '', timeSlot: '19:20' }),
  ]

  it('搜尋框 ≥44px 高；依姓名／電話末碼／桌號過濾', () => {
    render(data())
    expect(input().className).toContain('min-h-[44px]')
    expect(cards()).toEqual(['b', 'a', 'c'])
    setValue(input(), '林'); expect(cards()).toEqual(['c'])
    setValue(input(), '678'); expect(cards()).toEqual(['a'])
    setValue(input(), '0922'); expect(cards()).toEqual(['b'])
    setValue(input(), '205'); expect(cards()).toEqual(['b'])
  })

  it('空結果顯示提示；清除鈕（≥44px）還原整份清單', () => {
    render(data())
    setValue(input(), '不存在')
    expect(container.textContent).toContain('找不到符合「不存在」的今日訂位')
    const clear = container.querySelector('button[aria-label="清除搜尋"]')
    expect(clear.className).toContain('min-w-[44px]')
    act(() => clear.click())
    expect(input().value).toBe('')
    expect(cards()).toEqual(['b', 'a', 'c'])
  })

  it('卡片顯示電話末 3 碼；無電話不顯示', () => {
    render(data())
    const tail = id => container.querySelector(`[data-booking-id="${id}"] [data-testid="phone-tail"]`)
    expect(tail('a').textContent).toBe('…678')
    expect(tail('b').textContent).toBe('…999')
    expect(tail('c')).toBeNull()
  })
})

describe('ArrivalStrip chip 電話末碼', () => {
  it('有電話顯示小字末 3 碼；無電話不顯示', () => {
    const container = document.createElement('div'); document.body.appendChild(container)
    const root = createRoot(container)
    const t = (n, id) => ({ number: n, capacity: 4, floor: '1F', x: 1, y: 1, w: 80, h: 75, rotation: 0, isActive: true, outage: null, status: 'reserved', currentBookingId: id })
    const bookings = [
      { id: 'b1', name: '陳先生', phone: '0912345678', status: 'confirmed', timeSlot: '18:00' },
      { id: 'b2', name: '林小姐', phone: '', status: 'confirmed', timeSlot: '18:00' },
    ]
    act(() => root.render(<ArrivalStrip tables={[t('101', 'b1'), t('102', 'b2')]} bookings={bookings} onSelectTable={() => {}} onArrive={() => {}} now={new Date(2026, 6, 1, 18, 0, 0).getTime()} />))
    const chips = container.querySelectorAll('[role="listitem"]')
    expect(chips).toHaveLength(2)
    const withTail = [...chips].filter(c => c.querySelector('[data-testid="phone-tail"]'))
    expect(withTail).toHaveLength(1)
    expect(withTail[0].textContent).toContain('…678')
    expect(withTail[0].querySelector('[data-testid="phone-tail"]').className).toContain('text-[10px]')
    act(() => root.unmount()); container.remove()
  })
})
