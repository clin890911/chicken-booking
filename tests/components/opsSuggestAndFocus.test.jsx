import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import * as seating from '../../src/services/seatingService'
import * as bookingService from '../../src/services/bookingService'
import * as tableService from '../../src/services/tableService'
import * as groupService from '../../src/services/groupReservationService'
import * as waitlistService from '../../src/services/waitlistService'
import { getSettings } from '../../src/services/settingsService'

// OperationsView（掛整個現場頁，Context 換成直通真 service 的薄包裝）：
//   #171-1 帶位面板「用建議桌」：建議組合裡有一張已不可帶位 → 不選任何桌、toast「建議桌已變動，請自行選桌」
//   #171-3 訂位詳情「在地圖標示」：關掉詳情、切到那筆主桌的樓層並定位

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), action: vi.fn(), warning: vi.fn() }
const confirmMock = vi.fn(async () => true)
const h = vi.hoisted(() => ({ combo: null }))

const ctx = {
  get tables() { return tableService.listAll() },
  get bookings() { return bookingService.listAll() },
  get waitlist() { return waitlistService.listAll() },
  get groupReservations() { return groupService.listAll() },
  get settings() { return getSettings() },
  fixtures: undefined, zones: [], customers: [],
  addBooking: vi.fn((d) => bookingService.create(d)),
  assignBookingToTable: vi.fn((id, n) => seating.assignBookingToTable(id, n)),
  preassignBookingTable: vi.fn((id, n) => bookingService.assignTable(id, n)),
  findSuitableTables: (g, o) => seating.findSuitableTables(g, o),
  suggestTable: (g, o) => (h.combo ? null : seating.suggestTable(g, o)),
  suggestTableCombo: (g, o) => (h.combo || seating.suggestTableCombo(g, o)),
  findReserveCandidates: (g, o) => seating.findReserveCandidates(g, o),
  preassignableTables: (g, o) => seating.preassignableTables(g, o),
  assignBookingTablesMulti: vi.fn(), seatWaitlist: vi.fn(), seatWaitlistMulti: vi.fn(), walkInSeat: vi.fn(),
  walkInSeatMulti: vi.fn(), moveTable: vi.fn(), reseatGroupBatchTable: vi.fn(), cancelBooking: vi.fn(),
  seatBooking: vi.fn((id) => seating.seatBooking(id)),
  seatBookingAllTables: vi.fn((id) => seating.seatBookingAllTables(id)),
  undoSeatBooking: vi.fn((s) => seating.undoSeatBooking(s)),
  undoSeatPreassigned: vi.fn((id, n) => seating.undoSeatPreassigned(id, n)),
  setStatus: vi.fn(), setTableStatus: vi.fn(), releaseOverriddenAssignment: vi.fn(),
  restoreOverriddenAssignment: vi.fn(), undoAssignBooking: vi.fn(), completeWithoutSeating: vi.fn(),
  undoCompleteWithoutSeating: vi.fn(), addWaitlist: vi.fn(), callWaitlist: vi.fn(), leaveWaitlist: vi.fn(),
  saveFloorPlan: vi.fn(), flushCloudNow: vi.fn(),
}

vi.mock('../../src/contexts/BookingContext', () => ({ useBooking: () => ctx }))
vi.mock('../../src/contexts/AuthContext', () => ({
  useAuth: () => ({ can: () => true, user: { email: 'host@test', displayName: '領檯', roleLabel: '外場' } }),
}))
vi.mock('../../src/components/ui/Toast', () => ({ useToast: () => toast, useConfirm: () => confirmMock }))

const { default: OperationsView } = await import('../../src/components/admin/OperationsView.jsx')

const mkTable = (number, capacity = 4, over = {}) => ({
  number, capacity, floor: '1F', x: 100 + Number(number), y: 100, w: 80, h: 75, isActive: true, status: 'vacant',
  currentBookingId: null, currentRef: null, seatedAt: null, outage: null, ...over,
})

let container, root
const render = () => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => { root.render(<OperationsView />) })
}
const btns = () => [...document.querySelectorAll('button')]
const byStart = (t) => btns().find(b => b.textContent.trim().startsWith(t))
const click = (el) => act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
const mapNums = () => [...container.querySelectorAll('svg text')].map(t => t.textContent)

beforeEach(() => {
  vi.clearAllMocks()
  h.combo = null
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 8, 19, 13, 10))
})
afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  vi.useRealTimers()
})

describe('帶位面板「用建議桌」：建議組合不完整 → 一張都不選', () => {
  it('併桌建議 105＋107，107 已在用餐（不可帶位）→ toast「建議桌已變動，請自行選桌」，已選桌仍為空', () => {
    tableService.bulkWrite([
      mkTable('105'), mkTable('106'),
      mkTable('107', 4, { status: 'dining', seatedAt: new Date(2026, 8, 19, 13, 0).toISOString() }),
    ])
    h.combo = { enough: true, floor: '1F', tableNumbers: ['105', '107'] }
    render()
    const apply = container.querySelector('[data-testid="walkin-apply-suggestion"]')
    expect(apply.textContent).toContain('105 + 107')
    click(apply)
    expect(toast.error).toHaveBeenCalledWith('建議桌已變動，請自行選桌')
    // 沒有選任何桌：確認入座鈕仍是未選桌的引導文字（不含 105）
    expect(container.querySelector('[data-testid="walkin-seat"]').textContent).not.toContain('105')
    expect(container.querySelector('[data-testid="walkin-seat"]').disabled).toBe(true)
  })

  it('對照：建議組合整組可帶位 → 整組選好（確認鈕列出兩張桌）', () => {
    tableService.bulkWrite([mkTable('105'), mkTable('106')])
    h.combo = { enough: true, floor: '1F', tableNumbers: ['105', '106'] }
    render()
    click(container.querySelector('[data-testid="walkin-apply-suggestion"]'))
    expect(toast.error).not.toHaveBeenCalled()
    expect(container.querySelector('[data-testid="walkin-seat"]').textContent).toContain('105 + 106')
  })
})

describe('訂位詳情「在地圖標示」（OperationsView 有傳 onFocusTable）', () => {
  it('2F 的訂位：關掉詳情、桌況圖切到 2F 並顯示該桌', () => {
    tableService.bulkWrite([mkTable('105'), mkTable('201', 4, { floor: '2F' })])
    const b = bookingService.create({ name: '余先生', phone: '0911000002', guests: 2, date: '2026-09-19', timeSlot: '13:30', source: 'phone', status: 'confirmed' })
    seating.assignBookingToTable(b.id, '201')
    render()
    click(byStart('今日訂位'))
    expect(mapNums()).toContain('105')
    expect(mapNums()).not.toContain('201')
    click(btns().find(x => x.textContent.includes('詳情')))
    const focus = byStart('在地圖標示')
    expect(focus).toBeTruthy()
    click(focus)
    expect(byStart('在地圖標示')).toBeUndefined()      // 詳情已關
    expect(mapNums()).toContain('201')                 // 已切到 2F
    expect(mapNums()).not.toContain('105')
  })
})
