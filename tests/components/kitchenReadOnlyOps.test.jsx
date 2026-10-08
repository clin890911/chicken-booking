import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import * as seating from '../../src/services/seatingService'
import * as bookingService from '../../src/services/bookingService'
import * as tableService from '../../src/services/tableService'
import * as groupService from '../../src/services/groupReservationService'
import * as waitlistService from '../../src/services/waitlistService'
import { getSettings } from '../../src/services/settingsService'

// 廚房（kitchen）帳號完全唯讀：整個「現場」頁（真實 OperationsView＋真實 service＋真實 PERMISSIONS）
// 不得出現任何寫入入口——帶位籤／確認入座、新增今日訂位、訂位卡動作、候位取號與叫號、編輯佈局。
// 同一份資料跑 manager／host／floor 證明他們原有的入口一個都沒少。
// 其他頁（訂位／規劃／名冊／設定）見 kitchenReadOnlyPages.test.jsx。

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), action: vi.fn(), warning: vi.fn() }
const noop = () => ({ ok: true })
const ctx = {
  get tables() { return tableService.listAll() },
  get bookings() { return bookingService.listAll() },
  get waitlist() { return waitlistService.listAll() },
  get groupReservations() { return groupService.listAll() },
  get settings() { return getSettings() },
  fixtures: undefined, zones: [],
  addBooking: vi.fn(noop), assignBookingToTable: vi.fn(noop), preassignBookingTable: vi.fn(noop),
  findSuitableTables: (g, o) => seating.findSuitableTables(g, o),
  suggestTable: (g, o) => seating.suggestTable(g, o),
  suggestTableCombo: (g) => seating.suggestTableCombo(g),
  findReserveCandidates: (g, o) => seating.findReserveCandidates(g, o),
  preassignableTables: (g, o) => seating.preassignableTables(g, o),
  assignBookingTablesMulti: vi.fn(noop), seatWaitlist: vi.fn(noop), seatWaitlistMulti: vi.fn(noop),
  walkInSeat: vi.fn(noop), walkInSeatMulti: vi.fn(noop), moveTable: vi.fn(noop), reseatGroupBatchTable: vi.fn(noop),
  cancelBooking: vi.fn(noop), undoCancelBooking: vi.fn(noop),
  seatBooking: vi.fn(noop), seatBookingAllTables: vi.fn(noop), undoSeatPreassigned: vi.fn(noop),
  checkoutBooking: vi.fn(noop), finalizeBooking: vi.fn(noop), releaseCheckedOutTables: vi.fn(noop),
  clearBookingPreassign: vi.fn(noop),
  setStatus: vi.fn(), setTableStatus: vi.fn(), releaseOverriddenAssignment: vi.fn(),
  restoreOverriddenAssignment: vi.fn(), undoAssignBooking: vi.fn(), completeWithoutSeating: vi.fn(),
  undoCompleteWithoutSeating: vi.fn(), addWaitlist: vi.fn(noop), callWaitlist: vi.fn(noop),
  skipWaitlist: vi.fn(noop), returnWaitlist: vi.fn(noop), leaveWaitlist: vi.fn(noop),
  clearTable: vi.fn(noop), undoClearTable: vi.fn(noop),
  saveFloorPlan: vi.fn(), flushCloudNow: vi.fn(),
}

let currentRole = 'manager'
vi.mock('../../src/contexts/BookingContext', () => ({ useBooking: () => ctx }))
vi.mock('../../src/contexts/AuthContext', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    useAuth: () => ({
      can: (p) => actual.PERMISSIONS[currentRole].has(p),
      user: { email: 'x@test', displayName: '測試', roleLabel: currentRole },
    }),
  }
})
vi.mock('../../src/components/ui/Toast', () => ({ useToast: () => toast, useConfirm: () => vi.fn(async () => true) }))
vi.mock('../../src/components/admin/LayoutEditor', () => ({ default: () => null }))

const { default: OperationsView } = await import('../../src/components/admin/OperationsView.jsx')

const mkTable = (number, capacity = 4, over = {}) => ({
  number, capacity, floor: '1F', x: 100 + Number(number), y: 100, w: 80, h: 75, isActive: true, status: 'vacant',
  currentBookingId: null, currentRef: null, seatedAt: null, outage: null, ...over,
})

describe('現場頁 × 角色：kitchen 無任何寫入入口、其他三角色入口不變', () => {
  let container, root
  const render = () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => { root.render(<OperationsView onAddBooking={vi.fn()} />) })
  }
  const btns = () => [...container.querySelectorAll('button')]
  const has = (text) => btns().some(b => b.textContent.includes(text))
  const click = (el) => act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  const tab = (label) => btns().find(b => b.textContent.trim().startsWith(label))

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 8, 19, 13, 10))
    tableService.bulkWrite([mkTable('105'), mkTable('106'), mkTable('107')])
    // 一筆未指派的待到、一筆已指派預配的待到、一組等候中
    bookingService.create({ name: '未指派客', phone: '0911000111', guests: 2, date: '2026-09-19', timeSlot: '13:30', source: 'phone', status: 'confirmed' })
    bookingService.create({ name: '已預配客', phone: '0911000222', guests: 2, date: '2026-09-19', timeSlot: '13:30', source: 'phone', status: 'confirmed', assignedTableId: '106' })
    waitlistService.create({ name: '候位客', phone: '0911000333', partySize: 2, status: 'waiting' })
  })
  afterEach(() => {
    act(() => root?.unmount())
    container?.remove()
    vi.useRealTimers()
    currentRole = 'manager'
  })

  it.each(['manager', 'host', 'floor'])('%s：帶位籤、確認入座、今日訂位動作、候位取號／叫號都在', (role) => {
    currentRole = role
    render()
    expect(tab('帶位')).toBeTruthy()
    expect(container.querySelector('[data-testid="walkin-seat"]')).toBeTruthy()
    click(tab('今日訂位'))
    expect(has('＋ 新增今日訂位')).toBe(true)
    expect(has('指派桌位')).toBe(true)
    click(tab('候位'))
    const addWait = btns().find(b => b.textContent.includes('取號') || b.textContent.includes('候位登記') || b.textContent.includes('＋'))
    expect(addWait).toBeTruthy()
    expect(has('入座')).toBe(true)
    expect(has('叫號')).toBe(true)
    if (role !== 'host') expect(has('編輯佈局')).toBe(role === 'manager')
  })

  it('kitchen：沒有帶位籤與確認入座、點空桌不會累積已選桌；今日訂位無新增／指派；候位無寫入鈕；無編輯佈局', () => {
    currentRole = 'kitchen'
    render()
    // 帶位籤整個不存在，預設落在第一個可用籤（今日訂位）
    expect(tab('帶位')).toBeUndefined()
    expect(container.querySelector('[data-testid="walkin-seat"]')).toBeNull()
    expect(container.querySelector('input[aria-label="電話"]')).toBeNull()
    expect(has('確認入座')).toBe(false)
    // 今日訂位籤：看得到卡片（唯讀資訊），沒有新增／指派／客人到了／No-show／已完成
    expect(has('＋ 新增今日訂位')).toBe(false)
    for (const t of ['指派桌位', '客人到了', '標 No-show', '✓ 已完成', '改桌']) expect(has(t), t).toBe(false)
    expect(container.textContent).toContain('未指派客')
    // 候位籤：看得到候位客，沒有入座／叫號／暫過號／棄號；取號鈕 disabled
    click(tab('候位'))
    expect(container.textContent).toContain('候位客')
    for (const t of ['入座', '叫號', '暫過號', '棄號']) expect(has(t), t).toBe(false)
    const addWait = btns().find(b => b.textContent.includes('取號'))
    if (addWait) expect(addWait.disabled).toBe(true)
    // 頂列：沒有編輯佈局
    expect(has('編輯佈局')).toBe(false)
    // 沒有任何寫入類 context 函式被呼叫
    for (const fn of ['walkInSeat', 'walkInSeatMulti', 'seatWaitlist', 'addWaitlist', 'callWaitlist', 'addBooking', 'seatBooking']) {
      expect(ctx[fn], fn).not.toHaveBeenCalled()
    }
  })

  it('kitchen：切到摘要、點桌開抽屜 — 抽屜裡沒有任何動作鈕（散客入座／清桌／維修／交班）', () => {
    currentRole = 'kitchen'
    render()
    click(btns().find(b => b.textContent.trim().startsWith('摘要')))
    const t105 = btns().find(b => b.textContent.startsWith('105'))
    click(t105)
    for (const t of ['散客直接入座', '設不可用', '維修停用', '清桌完成', '客人到了', '取消訂位', '桌位交班', '客人交班']) {
      expect(has(t), t).toBe(false)
    }
  })

  it('kitchen：在桌況圖點空桌＝開抽屜查看（不會偷偷累積帶位已選桌）；manager 同一操作＝加入帶位已選桌', () => {
    const mapTable = (n) => [...container.querySelectorAll('svg text')].find(t => t.textContent === n)?.closest('g[style]')
    currentRole = 'kitchen'
    render()
    click(mapTable('105'))
    expect(container.textContent).toContain('此桌目前可使用')
    expect(has('散客直接入座')).toBe(false)
    act(() => root.unmount()); container.remove()
    currentRole = 'manager'
    render()
    click(mapTable('105'))
    expect(container.querySelector('[data-testid="walkin-seat"]')).toBeTruthy()
    expect(container.textContent).not.toContain('此桌目前可使用')
    expect(container.querySelector('button[aria-label="移除桌 105"]')).toBeTruthy()
  })
})
