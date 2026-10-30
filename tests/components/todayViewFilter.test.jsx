// @vitest-environment jsdom
// 訂位「今日」：一顆「篩選」鈕（來源多選＋隱藏已離）取代分段鈕＋勾選框；統計卡可點（Barry 2026-10-31）。
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'

let mockBookings = []
let mockTables = []
let mockGroups = []
vi.mock('../../src/contexts/BookingContext', () => ({
  useBooking: () => ({ bookings: mockBookings, groupReservations: mockGroups, tables: mockTables }),
}))
vi.mock('../../src/components/booking/BookingCard', () => ({ default: ({ booking }) => <div data-card={booking.id}>{booking.name}</div> }))
vi.mock('../../src/components/booking/GroupBatchCard', () => ({ default: ({ group }) => <div data-group={group.id} /> }))

import TodayView from '../../src/components/admin/TodayView'
import { todayStr } from '../../src/utils/timeSlots'
import { computeStoreStats } from '../../src/utils/opsAlerts'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const T = todayStr()
const mk = (id, source, status, extra = {}) => ({ id, name: id, phone: '0912', guests: 2, date: T, timeSlot: '12:00', source, status, ...extra })

let container, root
const mount = (props = {}) => {
  container = document.createElement('div'); document.body.appendChild(container)
  root = createRoot(container)
  act(() => { root.render(<TodayView {...props} />) })
}
const cards = () => [...container.querySelectorAll('[data-card]')].map(e => e.dataset.card)
const groupCards = () => [...container.querySelectorAll('[data-group]')].map(e => e.dataset.group)
const summary = () => container.querySelector('[data-testid="today-filter"] summary')
const checkbox = (label) => [...container.querySelectorAll('label')].find(l => l.textContent.startsWith(label)).querySelector('input')
const click = (el) => act(() => { el.click() })
const stat = (id) => container.querySelector(`[data-testid="stat-${id}"]`)

beforeEach(() => {
  mockBookings = [
    mk('P1', 'phone', 'confirmed', { guests: 3 }),
    mk('P2', 'phone', 'arrived', { assignedTableId: '101', guests: 4 }),
    mk('O1', 'online', 'confirmed', { assignedTableId: '102' }),
    mk('L1', 'line', 'completed', { guests: 5 }),
    mk('W1', 'walkin', 'arrived', { assignedTableId: '103' }),
    mk('G0', 'guest', 'confirmed', { guests: 6 }),
    mk('X1', 'phone', 'cancelled'),
  ]
  mockTables = [
    { id: 't101', number: '101', floor: '1F', capacity: 4, status: 'dining', currentBookingId: 'P2' },
    { id: 't103', number: '103', floor: '1F', capacity: 4, status: 'dining', currentBookingId: 'W1' },
    { id: 't201', number: '201', floor: '2F', capacity: 6, status: 'dining', currentRef: 'grp' },
    { id: 't104', number: '104', floor: '1F', capacity: 4, status: 'vacant' },
  ]
  mockGroups = [{ id: 'GR1', date: T, status: 'confirmed', batches: [{ id: 'b1', timeSlot: '12:00', guests: 10 }] }]
})
afterEach(() => { act(() => root?.unmount()); container?.remove() })

describe('篩選鈕', () => {
  it('取代舊控制項：沒有分段鈕、沒有搜尋列外的「隱藏已離」；預設清單＝全部來源＋隱藏已離', () => {
    mount()
    expect(container.querySelector('[aria-label="來源篩選"]')).toBeNull()
    expect(summary().textContent).toContain('篩選')
    expect(summary().getAttribute('aria-label')).toBe('篩選：全部來源；隱藏已離')
    expect(container.querySelector('details[data-popover]')).not.toBeNull()
    // 改動前預設：今日、非取消、非已離，任何來源（含 guest）
    expect(cards().sort()).toEqual(['G0', 'O1', 'P1', 'P2', 'W1'])
    expect(groupCards()).toEqual(['GR1'])
  })

  it('勾選：取消「電話」以外 → 摘要「電話」＋徽章；團體卡隱藏；只剩一個時那格不可取消', () => {
    mount()
    for (const l of ['線上', '現場', '團體', 'LINE']) act(() => { checkbox(l).click() })
    expect(cards().sort()).toEqual(['P1', 'P2'])
    expect(groupCards()).toEqual([])
    expect(summary().textContent).toContain('電話')
    expect(summary().textContent).toMatch(/1$/)
    expect(checkbox('電話').disabled).toBe(true)
    // 再勾團體 → 團體卡回來
    act(() => { checkbox('團體').click() })
    expect(groupCards()).toEqual(['GR1'])
    expect(checkbox('電話').disabled).toBe(false)
  })

  it('「只看」＝舊版單選；「全部來源」一鍵全勾；「重設」回預設', () => {
    mount()
    click(container.querySelector('button[aria-label="只看LINE"]'))
    expect(cards()).toEqual([]) // L1 已離 → 被隱藏
    act(() => { checkbox('隱藏已離').click() })
    expect(cards()).toEqual(['L1'])
    expect(summary().textContent).toContain('LINE・含已離')
    act(() => { checkbox('全部來源').click() })
    expect(cards().sort()).toEqual(['G0', 'L1', 'O1', 'P1', 'P2', 'W1'])
    click([...container.querySelectorAll('button')].find(b => b.textContent === '重設'))
    expect(cards().sort()).toEqual(['G0', 'O1', 'P1', 'P2', 'W1'])
    expect(summary().textContent).toBe('篩選')
  })

  it('勾選項目與按鈕觸控高度 ≥44px（min-h-[44px]）', () => {
    mount()
    const menu = container.querySelector('[data-testid="today-filter"] > div')
    for (const l of menu.querySelectorAll('label')) expect(l.className).toContain('min-h-[44px]')
    for (const b of menu.querySelectorAll('button')) expect(b.className).toContain('min-h-[44px]')
    expect(summary().className).toContain('min-h-[44px]')
  })
})

describe('統計卡：組數＋人數、可點、不受篩選影響', () => {
  it('四格都是「N 組 · M 人」（用餐中＝現場口徑 N 桌 · M 人）', () => {
    mount({ onOpenSeating: () => {}, onGoOps: () => {} })
    expect(stat('total').textContent).toContain('6 組 · 22 人')
    expect(stat('unassigned').textContent).toContain('2 組 · 9 人') // P1(3)+G0(6)
    const s = computeStoreStats({ tables: mockTables, bookings: mockBookings, today: T })
    expect(stat('dining').textContent).toContain(`${s.dining} 桌 · ${s.occSeats} 人`)
    expect(stat('dining').textContent).toContain('3 桌 · 12 人') // P2 4 + W1 2 + 團體桌容量 6
    expect(stat('arrived').textContent).toContain('3 組 · 11 人')
    expect(stat('unassigned').getAttribute('aria-label')).toBe('未指派 2 組 9 人，前往排位')
    // 篩選不影響統計
    click(container.querySelector('button[aria-label="只看線上"]'))
    expect(stat('total').textContent).toContain('6 組 · 22 人')
  })

  it('未指派 → onOpenSeating(今天)；用餐中 → onGoOps；跳頁用箭頭、本頁篩選用漏斗', () => {
    const onOpenSeating = vi.fn(); const onGoOps = vi.fn()
    mount({ onOpenSeating, onGoOps })
    click(stat('unassigned'))
    expect(onOpenSeating).toHaveBeenCalledWith(T)
    click(stat('dining'))
    expect(onGoOps).toHaveBeenCalledTimes(1)
    expect(stat('unassigned').querySelector('[data-kind-icon="nav"]')).not.toBeNull()
    expect(stat('dining').querySelector('[data-kind-icon="nav"]')).not.toBeNull()
    expect(stat('total').querySelector('[data-kind-icon="filter"]')).not.toBeNull()
    expect(stat('arrived').querySelector('[data-kind-icon="filter"]')).not.toBeNull()
    for (const id of ['total', 'unassigned', 'dining', 'arrived']) {
      expect(stat(id).tagName).toBe('BUTTON')
      expect(stat(id).className).toContain('min-h-[44px]')
      expect(stat(id).className).toContain('focus-visible:ring-2')
    }
  })

  it('未指派 0 → 不是按鈕、提示「都排好了」', () => {
    mockBookings = mockBookings.filter(b => b.id !== 'P1' && b.id !== 'G0')
    const onOpenSeating = vi.fn()
    mount({ onOpenSeating })
    expect(stat('unassigned').tagName).toBe('DIV')
    expect(stat('unassigned').textContent).toContain('都排好了')
    click(stat('unassigned'))
    expect(onOpenSeating).not.toHaveBeenCalled()
  })

  it('已到/離 → 原地只看已到＋已離（含已離、不列團體），摘要反映；再點一次回原狀', () => {
    mount()
    click(stat('arrived'))
    expect(cards().sort()).toEqual(['L1', 'P2', 'W1'])
    expect(groupCards()).toEqual([])
    expect(stat('arrived').getAttribute('aria-pressed')).toBe('true')
    expect(summary().textContent).toContain('已到/離')
    expect(checkbox('隱藏已離').checked).toBe(false)
    expect(checkbox('只看已到').checked).toBe(true)
    click(stat('arrived'))
    expect(cards().sort()).toEqual(['G0', 'O1', 'P1', 'P2', 'W1'])
    expect(summary().textContent).toBe('篩選')
  })

  it('今日訂位 → 篩選與搜尋都回預設、清單捲回頂端', () => {
    mount()
    click(container.querySelector('button[aria-label="只看電話"]'))
    const input = container.querySelector('input[type="search"]')
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    act(() => { setter.call(input, 'P1'); input.dispatchEvent(new Event('input', { bubbles: true })) })
    expect(cards()).toEqual(['P1'])
    const list = container.querySelector('[data-testid="today-list"]')
    list.scrollTop = 200
    click(stat('total'))
    expect(input.value).toBe('')
    expect(cards().sort()).toEqual(['G0', 'O1', 'P1', 'P2', 'W1'])
    expect(summary().textContent).toBe('篩選')
    expect(list.scrollTop).toBe(0)
  })
})
