// @vitest-environment jsdom
// 訂位頁「今日」統計卡：店主指示「LINE 已綁」不在這裡呈現（2026-10-30），只留散客營運數字。
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'

vi.mock('../../src/contexts/BookingContext', () => ({
  useBooking: () => ({ bookings: [], groupReservations: [] }),
}))
vi.mock('../../src/components/booking/BookingCard', () => ({ default: () => null }))
vi.mock('../../src/components/booking/GroupBatchCard', () => ({ default: () => null }))

import TodayView from '../../src/components/admin/TodayView'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

describe('TodayView 統計卡', () => {
  let container, root
  afterEach(() => { act(() => root?.unmount()); container?.remove() })

  it('不顯示「LINE 已綁」，其餘五張統計卡仍在', () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => { root.render(<TodayView />) })
    const text = container.textContent
    expect(text).not.toContain('LINE 已綁')
    for (const label of ['今日訂位', '總人數', '未指派', '用餐中', '已到/離']) {
      expect(text).toContain(label)
    }
  })
})
