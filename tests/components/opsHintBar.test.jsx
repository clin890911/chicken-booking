import { describe, it, expect, vi, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'

// 現場頁頂端「一條」（Barry 2026-10-30）：常駐「可入座 N 桌 · 可坐 M 位｜用餐中 N 桌 · M 人」，
// 有事才接「需要處理」（數字 0 的不出現），點了帶到那件事。
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const state = vi.hoisted(() => ({ tables: [], bookings: [], waitlist: [] }))
vi.mock('../../src/contexts/BookingContext', () => ({ useBooking: () => ({ tables: state.tables, bookings: state.bookings, waitlist: state.waitlist, settings: { diningDurationMin: 90, cleanupBufferMin: 10 }, groupReservations: [] }) }))
const { default: OpsHintBar } = await import('../../src/components/admin/ops/OpsHintBar')

const NOW = new Date(2026, 9, 10, 19, 0).getTime()
const iso = (h, m = 0) => new Date(2026, 9, 10, h, m).toISOString()
const T = (number, extra = {}) => ({ number, capacity: 4, floor: '1F', isActive: true, status: 'vacant', ...extra })

describe('OpsHintBar：常駐一條＋有事才出現的提示', () => {
  let container, root
  afterEach(() => { act(() => root?.unmount()); container?.remove(); vi.useRealTimers() })
  const mount = (props = {}) => {
    vi.useFakeTimers(); vi.setSystemTime(NOW)
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
    act(() => root.render(<OpsHintBar {...props} />))
  }
  const alertBtn = key => container.querySelector(`[data-alert="${key}"]`)

  it('沒事：只有常駐兩格（可入座／用餐中），沒有「需要處理」區塊', () => {
    state.tables = [T('101'), T('102', { capacity: 6 }), T('103', { status: 'dining', currentBookingId: 'B', seatedAt: iso(18, 30) })]
    state.bookings = [{ id: 'B', guests: 3, status: 'arrived', date: '2026-10-10', timeSlot: '18:30', assignedTableId: '103' }]
    state.waitlist = []
    mount({ tablePresentation: { 101: { canSeatNow: true }, 102: { canSeatNow: true }, 103: { canSeatNow: false } } })
    expect(container.querySelector('[data-stat="vacant"]').textContent).toBe('可入座2桌 · 可坐 10 位')
    expect(container.querySelector('[data-stat="dining"]').textContent).toBe('用餐中1桌 · 3 人')
    expect(container.querySelector('[aria-label="需要處理"]')).toBeNull()
  })

  it('有事：只列非 0 項，依急迫度排序；點每一項帶到對的地方', () => {
    state.tables = [
      T('105', { status: 'cleaning', updatedAt: iso(18, 50) }),
      T('203', { status: 'cleaning', updatedAt: iso(18, 20) }),
      T('107', { status: 'dining', seatedAt: iso(16, 0) }),
    ]
    state.bookings = [
      { id: 'S1', guests: 4, status: 'confirmed', date: '2026-10-10', timeSlot: '19:30' },
      { id: 'S2', guests: 2, status: 'confirmed', date: '2026-10-10', timeSlot: '20:00' },
    ]
    state.waitlist = [{ id: 'W1', status: 'waiting', partySize: 4 }, { id: 'W2', status: 'seated', partySize: 2 }]
    const onOpenTable = vi.fn(), onOpenUpcoming = vi.fn(), onOpenWaitlist = vi.fn()
    mount({ onOpenTable, onOpenUpcoming, onOpenWaitlist })
    const keys = [...container.querySelectorAll('[data-alert]')].map(b => b.dataset.alert)
    expect(keys).toEqual(['overtime', 'soon', 'cleaning', 'waitlist'])
    expect(alertBtn('soon').textContent).toBe('將到2組 · 6 人')
    expect(alertBtn('cleaning').textContent).toBe('待清2桌')
    expect(alertBtn('waitlist').textContent).toBe('候位1組 · 4 人')
    expect(alertBtn('overtime').className).toContain('min-h-[44px]')
    act(() => alertBtn('cleaning').click()); expect(onOpenTable).toHaveBeenLastCalledWith('203')
    act(() => alertBtn('overtime').click()); expect(onOpenTable).toHaveBeenLastCalledWith('107')
    act(() => alertBtn('soon').click()); expect(onOpenUpcoming).toHaveBeenCalledTimes(1)
    act(() => alertBtn('waitlist').click()); expect(onOpenWaitlist).toHaveBeenCalledTimes(1)
  })
})
