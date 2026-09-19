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

const { default: OperationsView, saveQuickReserve } = await import('../../src/components/admin/OperationsView.jsx')

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

  it('＋新增 → 左欄原地換成面板（不呼叫 AdminPage 的跳頁入口），預設人數 2、下一個時段 13:30、建議桌', () => {
    openPanel()
    expect(panel()).toBeTruthy()
    expect(onAddBooking).not.toHaveBeenCalled()
    expect(byLabel('2 位').getAttribute('aria-pressed')).toBe('true')
    expect(byLabel('13:30').getAttribute('aria-pressed')).toBe('true')
    // 13:30 離現在 20 分 → 鎖桌型：建議此刻空桌 105
    expect(panel().querySelector('[data-testid="reserve-table"]').textContent).toContain('桌 105')
    expect(container.querySelector('svg')).toBeTruthy()                 // 桌況圖仍在
  })

  it('點地圖選桌：候選 → 選取；非候選（此刻用餐、鎖桌型只能選空桌）→ toast 說明、不選取', () => {
    openPanel()
    click(mapTable('106'))
    expect(panel().querySelector('[data-testid="reserve-table"]').textContent).toContain('桌 106')
    click(mapTable('107'))
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('107 目前用餐中'))
    expect(panel().querySelector('[data-testid="reserve-table"]').textContent).toContain('桌 106')
    expect(panel()).toBeTruthy()          // 不開桌況抽屜（抽屜會把整個左欄連同面板換掉）
  })

  it('預配型（15:00）：此刻用餐中、屆時會空的 107 也可選；存檔 → addBooking＋preassignBookingTable，回今日訂位籤、新卡閃一下', () => {
    openPanel()
    click(byLabel('15:00'))
    click(mapTable('107'))
    expect(panel().querySelector('[data-testid="reserve-table"]').textContent).toContain('預配 107')
    click(byLabel('王'))
    click(byLabel('來源：現場'))
    const confirmBtn = byStart('確認新增')
    expect(confirmBtn.textContent).toBe('確認新增 · 15:00 · 2 位 · 預配 107')
    click(confirmBtn)

    expect(ctx.addBooking).toHaveBeenCalledWith(expect.objectContaining({
      name: '王先生', guests: 2, timeSlot: '15:00', date: '2026-09-19', status: 'confirmed', source: 'walkin',
    }))
    const b = bookingService.listAll().find(x => x.name === '王先生')
    expect(ctx.preassignBookingTable).toHaveBeenCalledWith(b.id, '107')
    expect(ctx.assignBookingToTable).not.toHaveBeenCalled()
    expect(tableService.getByNumber('107').status).toBe('dining')     // 預配不動桌況
    expect(toast.success).toHaveBeenCalledWith('已新增 王先生 15:00 · 預配 107')
    // 回今日訂位籤：面板收起、＋新增鈕回來、新卡帶閃爍標記
    expect(panel()).toBeNull()
    expect(byText('＋ 新增今日訂位')).toBeTruthy()
    const card = container.querySelector(`[data-booking-id="${b.id}"]`)
    expect(card?.getAttribute('data-flash')).toBe('true')
    act(() => { vi.advanceTimersByTime(2500) })
    expect(container.querySelector(`[data-booking-id="${b.id}"]`).getAttribute('data-flash')).toBeNull()
  })

  it('鎖桌型（13:30）存檔 → assignBookingToTable（桌況 reserved）', () => {
    openPanel()
    click(byLabel('林'))
    click(byLabel('來源：現場'))
    click(byStart('確認新增'))
    const b = bookingService.listAll().find(x => x.name === '林先生')
    expect(ctx.assignBookingToTable).toHaveBeenCalledWith(b.id, '105')
    expect(tableService.getByNumber('105')).toMatchObject({ status: 'reserved', currentBookingId: b.id })
  })

  // 驗收 v4-4：面板開著跨過時段 → 所選時段已過就自動改選目前時段並說明；存檔不會存成已過時段
  it('16:55 開面板（預設 17:00）→ 開著到 17:31：自動改選 17:30 並說明，存檔存 17:30', () => {
    vi.setSystemTime(new Date(2026, 8, 19, 16, 55))
    openPanel()
    expect(byLabel('17:00').getAttribute('aria-pressed')).toBe('true')
    act(() => { vi.advanceTimersByTime(36 * 60 * 1000) })
    expect(byLabel('17:30').getAttribute('aria-pressed')).toBe('true')
    expect(panel().querySelector('[data-testid="slot-notice"]').textContent).toBe('17:00 已經過了，已改選目前時段 17:30')
    click(byLabel('王'))
    click(byLabel('來源：現場'))
    const btn = byStart('確認新增')
    expect(btn.textContent).toContain('17:30')
    click(btn)
    expect(bookingService.listAll().find(x => x.name === '王先生').timeSlot).toBe('17:30')
  })

  // 驗收 v4-5：面板開著時，先前 toast 上的「改桌」不可進模式／卸載面板
  it('面板開著時按先前 toast 的「改桌」→ 不進換桌模式、面板留著，提示先完成或返回', () => {
    vi.setSystemTime(new Date(2026, 8, 19, 11, 40))
    const occ = bookingService.create({ name: '別組', phone: '', guests: 2, date: '2026-09-19', timeSlot: '11:00', source: 'walkin', status: 'arrived' })
    tableService.bulkWrite([mkTable('105', 4, { status: 'dining', currentBookingId: occ.id, seatedAt: new Date(2026, 8, 19, 11, 5).toISOString() }), mkTable('106')])
    const yu = bookingService.create({ name: '余先生', phone: '0911', guests: 2, date: '2026-09-19', timeSlot: '12:00', source: 'phone', status: 'confirmed' })
    bookingService.assignTable(yu.id, '105')
    render()
    click(container.querySelector('button[aria-label="余先生 到了，入座 105"]'))
    const [msg, action] = toast.action.mock.calls.at(-1)
    expect(msg).toContain('入座失敗：105 目前由 別組 使用')
    expect(action.label).toBe('改桌')
    click(byStart('今日訂位'))
    click(byText('＋ 新增今日訂位'))
    act(() => { action.onClick() })
    expect(toast.info).toHaveBeenCalledWith('新增訂位中，請先完成或返回')
    expect(panel()).toBeTruthy()
    expect(container.textContent).not.toContain('換桌：余先生')
  })

  it('返回：沒填東西直接回今日訂位籤', () => {
    openPanel()
    click(byText('返回今日訂位'))
    expect(panel()).toBeNull()
    expect(byText('＋ 新增今日訂位')).toBeTruthy()
  })
})

describe('saveQuickReserve（存檔語意）', () => {
  const mk = (over = {}) => ({
    date: '2026-09-19', kind: 'preassign', table: { number: '105' }, needsCombo: false, createdBy: 'staff@test',
    addBooking: vi.fn(d => ({ id: 'B1', ...d })),
    assignBookingToTable: vi.fn(() => ({ ok: true })),
    preassignBookingTable: vi.fn(() => ({ id: 'B1' })),
    toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), action: vi.fn() },
    onAssignLater: vi.fn(),
    now: new Date(2026, 8, 19, 9, 0),     // 固定時間：18:00 未過
    ...over,
  })
  const payload = { name: '王先生', phone: '0912', source: 'phone', guests: 2, timeSlot: '18:00', notes: {} }

  it('preassign → 只預配，不鎖桌', () => {
    const d = mk()
    const r = saveQuickReserve(payload, d)
    expect(d.addBooking).toHaveBeenCalledWith({ ...payload, date: '2026-09-19', status: 'confirmed', createdBy: 'staff@test' })
    expect(d.preassignBookingTable).toHaveBeenCalledWith('B1', '105')
    expect(d.assignBookingToTable).not.toHaveBeenCalled()
    expect(d.toast.success).toHaveBeenCalledWith('已新增 王先生 18:00 · 預配 105')
    expect(r).toMatchObject({ ok: true, tableNumber: '105' })
  })

  it('hold → 鎖桌；鎖桌失敗仍算已建單（不可留在面板重建），toast 帶「指派桌位」出口', () => {
    const ok = mk({ kind: 'hold' })
    saveQuickReserve(payload, ok)
    expect(ok.assignBookingToTable).toHaveBeenCalledWith('B1', '105')
    expect(ok.toast.success).toHaveBeenCalledWith('已新增 王先生 18:00 · 桌 105')

    const fail = mk({ kind: 'hold', assignBookingToTable: vi.fn(() => ({ ok: false, error: '105 目前不是空桌' })) })
    const r = saveQuickReserve(payload, fail)
    expect(r).toMatchObject({ ok: true, tableNumber: null })
    const [msg, action] = fail.toast.action.mock.calls[0]
    expect(msg).toContain('鎖桌 105 失敗：105 目前不是空桌')
    action.onClick()
    expect(fail.onAssignLater).toHaveBeenCalledWith(expect.objectContaining({ id: 'B1' }))
    expect(fail.toast.success).toHaveBeenCalledWith('已新增 王先生 18:00')
  })

  it('時段已過（早於目前這個 30 分時段）→ 不建單；目前時段本身可以', () => {
    const d = mk({ now: new Date(2026, 8, 19, 17, 31) })
    expect(saveQuickReserve({ ...payload, timeSlot: '17:00' }, d)).toEqual({ ok: false })
    expect(d.toast.error).toHaveBeenCalledWith('17:00 已經過了，請改選目前或之後的時段')
    expect(d.addBooking).not.toHaveBeenCalled()
    expect(saveQuickReserve({ ...payload, timeSlot: '17:30' }, d).ok).toBe(true)
  })

  it('建單失敗（例外）→ ok:false、toast.error，不碰桌', () => {
    const d = mk({ addBooking: vi.fn(() => { throw new Error('儲存空間不足') }) })
    expect(saveQuickReserve(payload, d)).toEqual({ ok: false })
    expect(d.toast.error).toHaveBeenCalledWith('新增失敗：儲存空間不足')
    expect(d.preassignBookingTable).not.toHaveBeenCalled()
  })

  it('不帶桌（先不指派／大組）→ 不指派；大組多一則併桌提醒', () => {
    const d = mk({ table: null, needsCombo: true })
    saveQuickReserve(payload, d)
    expect(d.preassignBookingTable).not.toHaveBeenCalled()
    expect(d.assignBookingToTable).not.toHaveBeenCalled()
    expect(d.toast.info).toHaveBeenCalledWith('大組請接近時段再到今日訂位指派併桌', { duration: 8000 })
  })
})

// 驗收 v4-1 重現：105 被今日團體 12:30 梯圈走、12:00 訂位預配 105、11:50 在報到列按「到了」→ 必須先確認
describe('報到列：預配訂位遇團保先確認（掛整個 OperationsView）', () => {
  let container, root
  afterEach(() => { act(() => root?.unmount()); container?.remove(); vi.useRealTimers() })

  it('取消 → 不入座；確認 → 入座', async () => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 8, 19, 11, 50))
    tableService.bulkWrite([mkTable('105'), mkTable('106')])
    groupService.create({ date: '2026-09-19', status: 'confirmed', agencyName: '甲旅行社',
      batches: [{ label: '第一梯', timeSlot: '12:30', tableNumbers: ['105'], guests: 4 }] })
    const b = bookingService.create({ name: '余先生', phone: '0911', guests: 2, date: '2026-09-19', timeSlot: '12:00', source: 'phone', status: 'confirmed' })
    bookingService.assignTable(b.id, '105')
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => { root.render(<OperationsView onAddBooking={vi.fn()} />) })
    const arrive = () => container.querySelector('button[aria-label="余先生 到了，入座 105"]')

    confirmMock.mockResolvedValueOnce(false)
    await act(async () => { arrive().dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(confirmMock).toHaveBeenCalledWith(expect.stringContaining('105 為今日團體「甲旅行社」預留（第一梯 12:30）'),
      expect.objectContaining({ title: '桌位有預留' }))
    expect(tableService.getByNumber('105').status).toBe('vacant')
    expect(bookingService.getById(b.id).status).toBe('confirmed')

    confirmMock.mockResolvedValueOnce(true)
    await act(async () => { arrive().dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(tableService.getByNumber('105')).toMatchObject({ status: 'dining', currentBookingId: b.id })
    expect(bookingService.getById(b.id).status).toBe('arrived')
  })
})
