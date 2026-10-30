// @vitest-environment jsdom
// 訂位頁「今日」統計卡（店主 2026-10-30）：拿掉「LINE 已綁」；今日訂位＋總人數合併一格。
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'

vi.mock('../../src/contexts/BookingContext', () => ({
  useBooking: () => ({ bookings: mockBookings, groupReservations: [] }),
}))
vi.mock('../../src/components/booking/BookingCard', () => ({ default: () => null }))
vi.mock('../../src/components/booking/GroupBatchCard', () => ({ default: () => null }))

import TodayView from '../../src/components/admin/TodayView'
import { todayStr } from '../../src/utils/timeSlots'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let mockBookings = []

describe('TodayView 統計卡', () => {
  let container, root
  afterEach(() => { act(() => root?.unmount()); container?.remove() })

  it('不顯示「LINE 已綁」；今日訂位與總人數合併成一格（N 組 · M 人）', () => {
    mockBookings = [
      { id: 'a', date: todayStr(), timeSlot: '11:30', guests: 4, status: 'confirmed', name: '王' },
      { id: 'b', date: todayStr(), timeSlot: '12:00', guests: 6, status: 'confirmed', name: '林' },
    ]
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => { root.render(<TodayView />) })
    const text = container.textContent
    expect(text).not.toContain('LINE 已綁')
    expect(text).not.toContain('總人數')
    // 2026-10-31 起統計卡可點，右上多了去處提示（「看全部」），數字區仍是「N 組 · M 人」
    const total = container.querySelector('[data-testid="stat-total"]')
    expect(total.textContent).toContain('今日訂位')
    expect(total.textContent).toContain('2 組 · 10 人')
    for (const label of ['未指派', '用餐中', '已到/離']) expect(text).toContain(label)
  })
})
