import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import * as seating from '../../src/services/seatingService'
import * as bookingService from '../../src/services/bookingService'
import * as tableService from '../../src/services/tableService'
import * as groupService from '../../src/services/groupReservationService'
import { getSettings } from '../../src/services/settingsService'

// 鎖桌時機（2026-09 店主拍板「接近時段才鎖」）× 新增表單的今日存檔，接真的 service 驗結果：
//   09:00 新增 18:00（離用餐 9 小時）→ 只預配：booking.assignedTableId 有值、桌況仍是空桌
//   10:40 新增 11:00（離用餐 20 分）→ 存檔即鎖桌：桌況 reserved、currentBookingId 指向這筆
// Context 只換成直通 service 的薄包裝（refresh／雲端同步／Telegram 不在這裡驗）。

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const ctx = {
  get bookings() { return bookingService.listAll() },
  get tables() { return tableService.listAll() },
  get groupReservations() { return groupService.listAll() },
  get settings() { return getSettings() },
  addBooking: (d) => bookingService.create(d),
  findReserveCandidates: (g, opts) => seating.findReserveCandidates(g, opts),
  assignBookingToTable: (id, n) => seating.assignBookingToTable(id, n),
  preassignBookingTable: (id, n) => bookingService.assignTable(id, n),
}
const toast = { success: vi.fn(), error: vi.fn(), action: vi.fn(), info: vi.fn() }

vi.mock('../../src/contexts/BookingContext', () => ({ useBooking: () => ctx }))
vi.mock('../../src/contexts/AuthContext', () => ({ useAuth: () => ({ user: { email: 'staff@test' } }) }))
vi.mock('../../src/components/ui/Toast', () => ({ useToast: () => toast }))

const AddBookingView = (await import('../../src/components/admin/AddBookingView')).default

const mkTable = (number, capacity = 4, floor = '1F', over = {}) => ({
  number, capacity, floor, x: 100, y: 100, w: 80, h: 75, isActive: true, status: 'vacant',
  currentBookingId: null, currentRef: null, seatedAt: null, outage: null, ...over,
})

describe('AddBookingView × 鎖桌時機（真 service）', () => {
  let container, root
  const render = () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => { root.render(<AddBookingView onAssignTable={vi.fn()} onMoveTable={vi.fn()} />) })
  }
  const typeInto = (input, value) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    act(() => {
      setter.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }
  const btn = (pred) => [...container.querySelectorAll('button')].find(pred)
  const click = (el) => act(() => { el.click() })
  const fill = (slot) => {
    typeInto(container.querySelector('input[type="tel"]'), '0933111222')
    typeInto(container.querySelector('input[placeholder="王小姐"]'), '余先生')
    click(btn(b => b.textContent.trim().startsWith(slot)))
  }
  const confirmBtn = () => btn(b => b.textContent.includes('確認新增'))

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    tableService.bulkWrite([mkTable('105'), mkTable('106')])
  })
  afterEach(() => {
    act(() => root?.unmount())
    container?.remove()
    vi.useRealTimers()
  })

  it('09:00 選 18:00 → 預配 105：存檔後桌況仍 vacant、booking 有 assignedTableId', () => {
    vi.setSystemTime(new Date(2026, 8, 19, 9, 0))
    render()
    fill('18:00')
    expect(confirmBtn().textContent).toContain('預配 105')
    click(confirmBtn())
    const b = bookingService.listAll().find(x => x.name === '余先生')
    expect(b.assignedTableId).toBe('105')
    const t = tableService.getByNumber('105')
    expect(t.status).toBe('vacant')
    expect(t.currentBookingId).toBeNull()
  })

  it('09:00 選 18:00：105 此刻用餐中、推估 10:40 前用畢 → 仍可預配（桌況維持用餐中）', () => {
    vi.setSystemTime(new Date(2026, 8, 19, 9, 0))
    tableService.bulkWrite([
      mkTable('105', 4, '1F', { status: 'dining', seatedAt: new Date(2026, 8, 19, 8, 50).toISOString() }),
      mkTable('106', 6),
    ])
    render()
    fill('18:00')
    expect(confirmBtn().textContent).toContain('預配 105')
    click(confirmBtn())
    expect(bookingService.listAll().find(x => x.name === '余先生').assignedTableId).toBe('105')
    expect(tableService.getByNumber('105').status).toBe('dining')
  })

  it('10:40 選 11:00 → 存檔即鎖桌：105 reserved、currentBookingId 指向這筆', () => {
    vi.setSystemTime(new Date(2026, 8, 19, 10, 40))
    render()
    fill('11:00')
    expect(confirmBtn().textContent).toContain('桌 105')
    click(confirmBtn())
    const b = bookingService.listAll().find(x => x.name === '余先生')
    expect(b.assignedTableId).toBe('105')
    const t = tableService.getByNumber('105')
    expect(t.status).toBe('reserved')
    expect(t.currentBookingId).toBe(b.id)
  })
})
