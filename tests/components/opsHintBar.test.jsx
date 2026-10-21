import { describe, it, expect, vi, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'

// 頂部「N 桌待清」「N 桌超時」過去看起來像按鈕、點了沒反應。
// 現在點了 → onOpenTable(最該先處理的那桌)：超時＝坐最久的、待清＝最早變待清的。
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const state = vi.hoisted(() => ({ tables: [] }))
vi.mock('../../src/contexts/BookingContext', () => ({ useBooking: () => ({ tables: state.tables, bookings: [], settings: { diningDurationMin: 90, cleanupBufferMin: 10 }, groupReservations: [] }) }))
vi.mock('../../src/services/opsLogService', () => ({ listToday: () => [] }))
const { default: OpsHintBar, pickHints } = await import('../../src/components/admin/ops/OpsHintBar')

const NOW = new Date(2026, 9, 10, 19, 0).getTime()
const emptyPulse = { overdue: [], soon: [], later: [] }
const iso = (h, m = 0) => new Date(2026, 9, 10, h, m).toISOString()

describe('pickHints：待清／超時帶出要處理的桌', () => {
  it('待清：action open-table，桌號＝最早變待清的（updatedAt 最舊）', () => {
    const tables = [
      { number: '105', status: 'cleaning', updatedAt: iso(18, 50) },
      { number: '203', status: 'cleaning', updatedAt: iso(18, 20) },
      { number: '101', status: 'vacant' },
    ]
    const h = pickHints({ pulse: emptyPulse, tables, settings: {}, groups: [], autoCount: 0, now: NOW })
    expect(h[0]).toMatchObject({ text: '2 桌待清', action: 'open-table', tableNumber: '203' })
  })
  it('超時：action open-table，桌號＝坐最久的', () => {
    const tables = [
      { number: '106', status: 'dining', seatedAt: iso(16, 30) },
      { number: '107', status: 'dining', seatedAt: iso(16, 0) },
      { number: '108', status: 'dining', seatedAt: iso(18, 40) },  // 剛入座，不算超時
    ]
    const h = pickHints({ pulse: emptyPulse, tables, settings: { diningDurationMin: 90, cleanupBufferMin: 10 }, groups: [], autoCount: 0, now: NOW })
    expect(h[0]).toMatchObject({ action: 'open-table', tableNumber: '107' })
    expect(h[0].text).toMatch(/^2 桌已超時/)
  })
})

describe('OpsHintBar：點提示打開那桌', () => {
  let container, root
  afterEach(() => { act(() => root?.unmount()); container?.remove(); vi.useRealTimers() })
  it('點「N 桌待清」→ onOpenTable(最舊的待清桌)', () => {
    vi.useFakeTimers(); vi.setSystemTime(NOW)
    state.tables = [
      { number: '105', status: 'cleaning', updatedAt: iso(18, 50) },
      { number: '203', status: 'cleaning', updatedAt: iso(18, 20) },
    ]
    const onOpenTable = vi.fn()
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
    act(() => root.render(<OpsHintBar onOpenTable={onOpenTable} />))
    const b = [...container.querySelectorAll('button')].find(x => x.textContent === '2 桌待清')
    expect(b.className).toContain('cursor-pointer')
    act(() => b.click())
    expect(onOpenTable).toHaveBeenCalledWith('203')
  })
})
