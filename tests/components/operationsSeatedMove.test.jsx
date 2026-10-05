import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import * as seating from '../../src/services/seatingService'
import * as bookingService from '../../src/services/bookingService'
import * as tableService from '../../src/services/tableService'
import * as groupService from '../../src/services/groupReservationService'
import * as waitlistService from '../../src/services/waitlistService'
import { getSettings } from '../../src/services/settingsService'

// 現場「今日訂位 → ＋新增今日訂位」× OperationsView（掛載整個現場頁，Context 換成直通真 service 的薄包裝）：
//   ＋新增 → 左欄原地換成面板（不切 AdminPage 分頁）→ 預設（人數 2、下一個時段、建議桌）
//   → 點地圖選桌（非候選 toast 說明、不選取）→ 存檔：addBooking ＋ 依鎖桌時機預配／鎖桌
//   → 回「今日訂位」籤、新卡閃一下。
// 另測 saveQuickReserve 純函式（存檔語意、失敗留在面板、鎖桌失敗仍算已建單）。

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), action: vi.fn(), warning: vi.fn() }
const confirmMock = vi.fn(async () => true)

const ctx = {
  get tables() { return tableService.listAll() },
  get bookings() { return bookingService.listAll() },
  get waitlist() { return waitlistService.listAll() },
  get groupReservations() { return groupService.listAll() },
  get settings() { return getSettings() },
  fixtures: undefined, zones: [],
  addBooking: vi.fn((d) => bookingService.create(d)),
  assignBookingToTable: vi.fn((id, n) => seating.assignBookingToTable(id, n)),
  preassignBookingTable: vi.fn((id, n) => bookingService.assignTable(id, n)),
  findSuitableTables: (g, o) => seating.findSuitableTables(g, o),
  suggestTable: (g, o) => seating.suggestTable(g, o),
  suggestTableCombo: (g) => seating.suggestTableCombo(g),
  findReserveCandidates: (g, o) => seating.findReserveCandidates(g, o),
  preassignableTables: (g, o) => seating.preassignableTables(g, o),
  assignBookingTablesMulti: vi.fn(), seatWaitlist: vi.fn(), seatWaitlistMulti: vi.fn(), walkInSeat: vi.fn(),
  replaceSeatedBookingTables: vi.fn((id,nums,opts) => seating.replaceSeatedBookingTables(id,nums,opts)),
  walkInSeatMulti: vi.fn(), moveTable: vi.fn(), reseatGroupBatchTable: vi.fn(), cancelBooking: vi.fn(),
  seatBooking: vi.fn((id) => seating.seatBooking(id)),
  seatBookingAllTables: vi.fn((id) => seating.seatBookingAllTables(id)),
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

describe('OperationsView × 內嵌新增今日訂位', () => {
  let container, root
  const onAddBooking = vi.fn()
  const render = () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => { root.render(<OperationsView onAddBooking={onAddBooking} />) })
  }
  const btns = () => [...container.querySelectorAll('button')]
  const byText = (t) => btns().find(b => b.textContent.trim() === t)
  const byStart = (t) => btns().find(b => b.textContent.trim().startsWith(t))
  const byLabel = (l) => container.querySelector(`button[aria-label="${l}"]`)
  const panel = () => container.querySelector('[data-testid="quick-reserve-panel"]')
  const click = (el) => act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  // 桌況圖上的桌：SVG <g> 內有桌號文字，點最外層有 onClick 的 <g>
  const mapTable = (n) => [...container.querySelectorAll('svg text')].find(t => t.textContent === n)?.closest('g[style]')
  const openPanel = () => {
    render()
    click(byStart('今日訂位'))
    click(byText('＋ 新增今日訂位'))
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 8, 19, 13, 10))
    tableService.bulkWrite([
      mkTable('105'), mkTable('106'),
      mkTable('107', 4, { status: 'dining', seatedAt: new Date(2026, 8, 19, 13, 0).toISOString() }),  // 推估 14:40 用畢
    ])
  })
  afterEach(() => {
    act(() => root?.unmount())
    container?.remove()
    vi.useRealTimers()
  })

  it('帶位草稿在桌位抽屜返回與改桌取消後保留，隱藏時不可交互', () => {
    render(); click(byText('林'))
    const setInput = (input, value) => act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value); input.dispatchEvent(new Event('input', { bubbles:true })) })
    setInput(container.querySelector('input[aria-label="電話"]'), '0911222333')
    const notes = container.querySelector('input[placeholder="例：靠窗、慶生、過敏"]')
    setInput(notes, '靠窗測試')
    click(byStart('摘要'))
    click(container.querySelector('button[aria-label^="105桌"]') || btns().find(b => b.textContent.startsWith('105')))
    expect(container.querySelector('input[aria-label="電話"]').closest('[hidden]')).toBeTruthy()
    // Escape 關閉抽屜，回到原本同一份帶位草稿
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key:'Escape' })))
    expect(container.querySelector('input[aria-label="電話"]').value).toBe('0911222333')
    expect(container.querySelector('input[placeholder="例：靠窗、慶生、過敏"]').value).toBe('靠窗測試')
    expect(byText('林').getAttribute('aria-pressed')).toBe('true')
    const b = {id:'P',name:'未到測試',guests:4,date:'2026-09-19',timeSlot:'13:30',status:'confirmed',assignedTableId:'106'}
    act(() => root.render(<OperationsView pendingMove={{booking:b,seq:1}}/>))
    expect(container.querySelector('input[aria-label="電話"]').closest('[hidden]')).toBeTruthy()
    click(byText('取消並返回'))
    expect(container.querySelector('input[aria-label="電話"]').value).toBe('0911222333')
    expect(container.querySelector('input[placeholder="例：靠窗、慶生、過敏"]').value).toBe('靠窗測試')
    expect(byText('林').getAttribute('aria-pressed')).toBe('true')
  })

  it('已入座副桌抽屜顯示用餐，整組換桌保留到確認、成功保留計時', () => {
    const start = new Date(2026,8,19,13).toISOString()
    const b = bookingService.create({name:'九位已到',guests:9,date:'2026-09-19',timeSlot:'13:00',status:'arrived',assignedTableId:'105',extraTableIds:['106']})
    bookingService.update(b.id,{actualArrivalTime:start})
    tableService.bulkWrite([mkTable('105',6,{status:'dining',currentBookingId:b.id,seatedAt:start}),mkTable('106',4,{status:'reserved',currentBookingId:b.id}),mkTable('108',6),mkTable('109',4)])
    render(); click(mapTable('106'))
    expect(byText('客人到了 — 入座')).toBeUndefined()
    const move=byText('↔ 換桌');expect(move.disabled).toBe(false);click(move)
    expect(container.querySelector('[aria-label="目前選桌任務"]').textContent).toContain('九位已到')
    expect(container.querySelector('[aria-label="目前選桌任務"]').textContent).toContain('尚未選桌')
    click(mapTable('108')); click(mapTable('109'))
    expect(bookingService.getById(b.id).assignedTableId).toBe('105')
    click(byStart('✓ 確認'))
    expect(ctx.replaceSeatedBookingTables).toHaveBeenCalledTimes(1)
    expect(bookingService.getById(b.id)).toMatchObject({status:'arrived',assignedTableId:'108',extraTableIds:['109'],actualArrivalTime:start})
    expect(tableService.getByNumber('108').seatedAt).toBe(start)
  })
  it('跨頁已入座單桌可自由改併桌，取消不寫任何資料', () => {
    const b = bookingService.create({name:'已到單桌',guests:4,date:'2026-09-19',timeSlot:'13:00',status:'arrived',assignedTableId:'105'})
    tableService.seatTable('105',b.id)
    render();act(() => root.render(<OperationsView pendingMove={{booking:b,seq:2}}/>))
    click(mapTable('106'));click(byText('取消並返回'))
    expect(bookingService.getById(b.id).assignedTableId).toBe('105')
    expect(ctx.replaceSeatedBookingTables).not.toHaveBeenCalled()
  })
  it('鎖桌組從抽屜入座入口整組dining', () => {
    const b = bookingService.create({name:'九位待到',guests:9,date:'2026-09-19',timeSlot:'13:30',assignedTableId:'105',extraTableIds:['106']})
    tableService.reserveTable('105',b.id);tableService.reserveTable('106',b.id)
    render();click(mapTable('106'));click(byText('客人到了 — 入座'))
    expect(tableService.getByNumber('105').status).toBe('dining');expect(tableService.getByNumber('106').status).toBe('dining')
    expect(bookingService.getById(b.id).status).toBe('arrived')
  })
})
