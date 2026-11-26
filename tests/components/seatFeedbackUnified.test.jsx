// B1 入座回饋統一：抽屜散客入座、候選名單入座補上 8 秒復原（含「桌已被佔 → 復原安全失敗」），
// toast 落點（placement:'seat'）、TableDrawer 不顯示負分鐘、圖例「選中」與地圖同一份樣式。
// 抽屜／候選名單的動作接「真的」seatingService（不 mock）：只驗 mock 參數蓋不住「復原沒把桌倒回」或「復原搶了別人的桌」。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import * as seating from '../../src/services/seatingService'
import * as tableService from '../../src/services/tableService'
import * as bookingService from '../../src/services/bookingService'
import { seatedText, movedText, joinTables, toastGroupSeated, SEAT_UNDO_MS } from '../../src/utils/seatFeedback'
import { SELECTION_STYLE } from '../../src/components/admin/floormap/statusColors'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const TODAY = '2026-09-19'
const NOW = new Date(2026, 8, 19, 12, 20)
const ctx = {}
const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), action: vi.fn() }
let canDelete = true
vi.mock('../../src/contexts/BookingContext', () => ({ useBooking: () => ctx }))
vi.mock('../../src/contexts/AuthContext', () => ({ useAuth: () => ({ can: (p) => (p === 'booking.delete' ? canDelete : true) }) }))
vi.mock('../../src/components/ui/Toast', () => ({ useToast: () => toast, useConfirm: () => vi.fn(async () => true) }))

const TableDrawer = (await import('../../src/components/admin/floormap/TableDrawer')).default
const TableCandidatePanel = (await import('../../src/components/admin/floormap/TableCandidatePanel')).default
const { SelectedLegendSwatch } = await import('../../src/components/admin/OperationsView')

const mkTable = (number, over = {}) => ({
  number, capacity: 4, floor: '1F', x: 100, y: 100, w: 80, h: 75, isActive: true, outage: null,
  status: 'vacant', currentBookingId: null, currentRef: null, seatedAt: null, mergedWith: null, blockReason: null, updatedAt: null, ...over,
})
const T = (n) => tableService.getByNumber(n)

// ctx 的資料從 localStorage 讀當下值；動作直接是 seatingService（本測試不看雲端同步）
function wireCtx() {
  // getter 要用 defineProperty（Object.assign 只會複製當下的值）
  Object.defineProperty(ctx, 'bookings', { get: () => bookingService.listAll(), configurable: true })
  Object.defineProperty(ctx, 'tables', { get: () => tableService.listAll(), configurable: true })
  Object.assign(ctx, {
    waitlist: [], groupReservations: [], settings: {},
    walkInSeat: seating.walkInSeat, undoWalkInSeat: seating.undoWalkInSeat,
    assignBookingToTable: seating.assignBookingToTable, assignAndSeatBooking: seating.assignAndSeatBooking,
    seatBooking: seating.seatBooking, undoSeatBooking: seating.undoSeatBooking,
    releaseOverriddenAssignment: seating.releaseOverriddenAssignment, restoreOverriddenAssignment: seating.restoreOverriddenAssignment,
    undoAssignBooking: seating.undoAssignBooking,
    seatWaitlist: vi.fn(), undoWaitlistSeat: vi.fn(),
    blockTable: vi.fn(), unblockTable: vi.fn(), reseatBookingTables: vi.fn(), checkoutBooking: vi.fn(), undoCheckoutBooking: vi.fn(),
    finalizeBooking: vi.fn(), clearTable: vi.fn(), undoClearTable: vi.fn(), cancelBooking: vi.fn(),
    undoCancelBooking: vi.fn(), setTableOutage: vi.fn(), clearTableOutage: vi.fn(),
  })
}

let container, root
const mount = (el) => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => { root.render(el) })
}
const btn = (text) => [...document.querySelectorAll('button')].find(b => b.textContent.trim().startsWith(text))
const lastAction = () => toast.action.mock.calls.at(-1)

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(NOW); vi.clearAllMocks(); canDelete = true
  tableService.bulkWrite([mkTable('105'), mkTable('106')])
  wireCtx()
})
afterEach(() => { act(() => root?.unmount()); container?.remove(); vi.useRealTimers() })

describe('seatFeedback 文字', () => {
  it('入座：「✓ 林先生 3 位 → 105 已入座」；多桌用「＋」；人數不明不寫；換桌「✓ 林先生 改到 103」', () => {
    expect(seatedText({ name: '林先生', guests: 3, tables: ['105'] })).toBe('✓ 林先生 3 位 → 105 已入座')
    expect(seatedText({ name: '大組', guests: 10, tables: ['105', '106', '105'] })).toBe('✓ 大組 10 位 → 105＋106 已入座')
    expect(seatedText({ name: '王', tables: ['A2'] })).toBe('✓ 王 → A2 已入座')
    expect(movedText({ name: '林先生', tables: ['103'] })).toBe('✓ 林先生 改到 103')
    expect(movedText({ name: '林先生', guests: 3, tables: ['103'] })).toBe('✓ 林先生 3 位 改到 103')
    expect(joinTables(['101', '', null, '102'])).toBe('101＋102')
    expect(SEAT_UNDO_MS).toBe(8000)
  })

  it('團體整梯：有快照給 8 秒復原；沒快照（接走前梯待清桌）同文字、不給復原鈕', () => {
    const g = { agencyName: '山城旅遊' }, b = { label: '第一梯', guests: 11, tableNumbers: ['101', '102'] }
    const undo = vi.fn(() => ({ ok: true, tableNumbers: ['101', '102'] }))
    toastGroupSeated({ ok: true, tableNumbers: ['101', '102'], undo: { groupId: 'G' } }, { group: g, batch: b, undoSeatGroupBatch: undo, toast })
    const [msg, action, opts] = lastAction()
    expect(msg).toBe('✓ 山城旅遊 第一梯 11 位 → 101＋102 已入座')
    expect(opts).toEqual({ duration: 8000, placement: 'seat' })
    expect(action).toMatchObject({ label: '復原', ariaLabel: '復原入座 山城旅遊 第一梯' })
    action.onClick()
    expect(undo).toHaveBeenCalledWith({ groupId: 'G' })
    toastGroupSeated({ ok: true, tableNumbers: ['101', '102'] }, { group: g, batch: b, undoSeatGroupBatch: undo, toast })
    expect(toast.success).toHaveBeenCalledWith('✓ 山城旅遊 第一梯 11 位 → 101＋102 已入座', { duration: 8000, placement: 'seat' })
  })
})

describe('抽屜「散客直接入座」：8 秒復原', () => {
  const seatWalkIn = () => {
    mount(<TableDrawer table={T('105')} booking={null} preassign={null} groupHold={null} onClose={() => {}} onStartMove={() => {}} mode={{}} />)
    act(() => { btn('散客直接入座').click() })
    act(() => { btn('確認入座').click() })
  }

  it('成功 → 統一格式、「復原帶位 105」、8 秒；復原把散客單刪掉、105 回空桌', () => {
    seatWalkIn()
    expect(T('105').status).toBe('dining')
    const [msg, action, opts] = lastAction()
    expect(msg).toBe('✓ 散客 2 位 → 105 已入座')
    expect(action.label).toBe('復原')
    expect(action.ariaLabel).toBe('復原帶位 105')
    expect(opts).toEqual({ duration: 8000, placement: 'seat' })
    const id = T('105').currentBookingId
    action.onClick()
    expect(T('105')).toMatchObject({ status: 'vacant', currentBookingId: null })
    expect(bookingService.getById(id)).toBeFalsy()
    expect(toast.info).toHaveBeenCalledWith('已復原：105 回到空桌')
  })

  it('沒有刪除權 → 復原改成取消（不刪單）、桌回空桌', () => {
    canDelete = false
    seatWalkIn()
    const id = T('105').currentBookingId
    lastAction()[1].onClick()
    expect(T('105').status).toBe('vacant')
    expect(bookingService.getById(id)).toMatchObject({ status: 'cancelled', autoFlag: 'walkin-undo' })
  })

  it('★ 復原前 105 已被別組坐走 → 安全失敗、說明原因，別組的桌不動', () => {
    seatWalkIn()
    const id = T('105').currentBookingId
    tableService.setStatus('105', 'dining', { currentBookingId: 'OTHER' })
    lastAction()[1].onClick()
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('105 已被別組使用'))
    expect(T('105')).toMatchObject({ status: 'dining', currentBookingId: 'OTHER' })
    expect(bookingService.getById(id)).toMatchObject({ status: 'arrived' })
  })
})

describe('候選名單「入座」：指派＋入座一步完成、8 秒復原', () => {
  const chen = () => bookingService.create({ name: '陳小姐', phone: '', guests: 2, date: TODAY, timeSlot: '12:00', status: 'confirmed', source: 'phone' })

  it('成功 → 統一格式、8 秒；復原：訂位回待到＋未配桌、105 回空桌', () => {
    const b = chen()
    mount(<TableCandidatePanel table={T('105')} onPicked={() => {}} />)
    act(() => { btn('入座').click() })
    expect(bookingService.getById(b.id)).toMatchObject({ status: 'arrived', assignedTableId: '105' })
    const [msg, action, opts] = lastAction()
    expect(msg).toBe('✓ 陳小姐 2 位 → 105 已入座')
    expect(action.label).toBe('復原')
    expect(opts).toEqual({ duration: 8000, placement: 'seat' })
    action.onClick()
    expect(bookingService.getById(b.id)).toMatchObject({ status: 'confirmed', assignedTableId: null })
    expect(T('105')).toMatchObject({ status: 'vacant', currentBookingId: null })
  })

  it('★ 復原前 105 已被別組坐走 → 安全失敗（不搶桌），訂位維持已入座', () => {
    const b = chen()
    mount(<TableCandidatePanel table={T('105')} onPicked={() => {}} />)
    act(() => { btn('入座').click() })
    tableService.setStatus('105', 'dining', { currentBookingId: 'OTHER' })
    lastAction()[1].onClick()
    expect(toast.error).toHaveBeenCalledWith('復原失敗：105 已被別組使用，無法復原')
    expect(T('105')).toMatchObject({ status: 'dining', currentBookingId: 'OTHER' })
    expect(bookingService.getById(b.id).status).toBe('arrived')
  })

  it('入座失敗 → 不留半套：桌與訂位都沒動（過去會「已指派但入座失敗」、桌被鎖成 reserved）', () => {
    const b = chen()
    const assignAndSeat = vi.spyOn(ctx, 'assignAndSeatBooking').mockImplementation(() => ({ ok: false, error: '105 停用/維修中，請先改派其他桌再入座' }))
    mount(<TableCandidatePanel table={T('105')} onPicked={() => {}} />)
    act(() => { btn('入座').click() })
    expect(assignAndSeat).toHaveBeenCalledWith(b.id, ['105'])
    expect(toast.warning).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith('入座失敗：105 停用/維修中，請先改派其他桌再入座')
    expect(T('105').status).toBe('vacant')
    expect(bookingService.getById(b.id)).toMatchObject({ status: 'confirmed', assignedTableId: null })
  })
})

describe('TableDrawer 已用餐分鐘（留尾 a）', () => {
  it('入座時間比畫面時鐘新（另一台 iPad 時鐘快 40 秒）→ 顯示「剛入座」，不出現「-1 分」', () => {
    const b = bookingService.create({ name: '王先生', guests: 2, date: TODAY, timeSlot: '12:00', status: 'arrived', assignedTableId: '105' })
    tableService.setStatus('105', 'dining', { currentBookingId: b.id, seatedAt: new Date(NOW.getTime() + 40000).toISOString() })
    mount(<TableDrawer table={T('105')} booking={bookingService.getById(b.id)} preassign={null} groupHold={null} onClose={() => {}} onStartMove={() => {}} mode={{}} />)
    expect(container.textContent).toContain('剛入座')
    expect(container.textContent).not.toMatch(/-\d+\s*分/)
  })
})

describe('圖例「選中」（留尾 b）', () => {
  it('與地圖同一份 SELECTION_STYLE.selected：紅粗框＋右上 ✓ 徽章', () => {
    mount(<SelectedLegendSwatch />)
    const svg = container.querySelector('[data-testid="legend-selected"] svg')
    expect(svg.querySelector('rect').getAttribute('stroke')).toBe(SELECTION_STYLE.selected.stroke)
    expect(svg.querySelector('circle').getAttribute('fill')).toBe(SELECTION_STYLE.selected.badgeFill)
    expect(svg.querySelector('path')).toBeTruthy()
    expect(container.textContent).toContain('選中')
  })
})
