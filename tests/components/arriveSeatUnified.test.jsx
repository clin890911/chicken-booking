import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'

// 2026-10 前台尖峰 A1＋A6：
//   A1 未配桌的訂位到店「到了 · 選桌入座」（今日訂位卡＋報到列都有入口）
//   A6 四個「客人到了」入口統一：都給 5 秒復原（共用 toastSeatedWithUndo → undoSeatBooking），
//      今日訂位卡只對「時段重疊」的預配跳確認（與報到列同一個 preassignArriveConflictLines），團保照舊確認。

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let currentAuth = { can: () => true }
vi.mock('../../src/contexts/AuthContext', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, useAuth: () => currentAuth }
})
const ctx = {}
const confirm = vi.fn(async () => true)
const toast = { success: vi.fn(), error: vi.fn(), action: vi.fn(), info: vi.fn(), warning: vi.fn() }
vi.mock('../../src/contexts/BookingContext', () => ({ useBooking: () => ctx }))
vi.mock('../../src/components/ui/Toast', () => ({ useToast: () => toast, useConfirm: () => confirm }))

const UpcomingPanel = (await import('../../src/components/admin/floormap/UpcomingPanel')).default
const TableDrawer = (await import('../../src/components/admin/floormap/TableDrawer')).default
const { default: ArrivalStrip, buildTargets, isUnassignedArriveEligible } = await import('../../src/components/admin/floormap/ArrivalStrip')
const { toastSeatedWithUndo } = await import('../../src/utils/arriveSeat')

const TODAY = '2026-09-19'
const NOW = new Date(2026, 8, 19, 10, 30, 0)
const mkT = (number, over = {}) => ({ number, capacity: 4, floor: '1F', x: 100, y: 100, w: 80, h: 75, isActive: true, outage: null,
  status: 'vacant', currentBookingId: null, currentRef: null, seatedAt: null, ...over })
const YU = { id: 'Y1', name: '余先生', phone: '0911000002', guests: 2, date: TODAY, timeSlot: '11:00', status: 'confirmed', assignedTableId: '105', extraTableIds: [], notes: {} }
const LIN = { id: 'L1', name: '林先生', phone: '0911000003', guests: 3, date: TODAY, timeSlot: '11:00', status: 'confirmed', assignedTableId: null, extraTableIds: [], notes: {} }
const other = (slot) => ({ id: 'O' + slot, name: '陳小姐', guests: 2, date: TODAY, timeSlot: slot, status: 'confirmed', assignedTableId: '105', extraTableIds: [], notes: {} })
const UNDO = { bookingId: 'Y1', tableNumbers: ['105'], restore: { 105: 'reserved' } }

let container, root
const mount = (el) => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => { root.render(el) })
}
const btn = (text) => [...document.querySelectorAll('button')].find(b => b.textContent.includes(text) || b.getAttribute('aria-label') === text)
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve() })

function setCtx({ bookings = [YU], tables = [mkT('105', { status: 'reserved', currentBookingId: 'Y1' })], groups = [] } = {}) {
  Object.keys(ctx).forEach(k => delete ctx[k])
  Object.assign(ctx, {
    bookings, tables, waitlist: [], groupReservations: groups, settings: {},
    seatBooking: vi.fn(() => ({ ok: true, tableNumber: '105', undo: UNDO })),
    undoSeatBooking: vi.fn(() => ({ ok: true, tableNumbers: ['105'] })),
    markBookingNoshow: vi.fn(), undoMarkBookingNoshow: vi.fn(), completeWithoutSeating: vi.fn(), undoCompleteWithoutSeating: vi.fn(),
    walkInSeat: vi.fn(), assignBookingToTable: vi.fn(() => ({ ok: true })), seatWaitlist: vi.fn(),
    releaseOverriddenAssignment: vi.fn(), undoAssignBooking: vi.fn(), restoreOverriddenAssignment: vi.fn(),
    blockTable: vi.fn(), unblockTable: vi.fn(), reseatBookingTables: vi.fn(), checkoutBooking: vi.fn(),
    finalizeBooking: vi.fn(), clearTable: vi.fn(), undoClearTable: vi.fn(), cancelBooking: vi.fn(),
    undoCancelBooking: vi.fn(), setTableOutage: vi.fn(), clearTableOutage: vi.fn(), releaseCheckedOutTables: vi.fn(),
  })
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); vi.clearAllMocks(); confirm.mockResolvedValue(true); currentAuth = { can: () => true } })
afterEach(() => { act(() => root?.unmount()); container?.remove(); root = null; container = null; vi.useRealTimers() })

describe('報到列：時間窗內未配桌的訂位也列（A1）', () => {
  it('isUnassignedArriveEligible：今天、待到、無桌、前 60／後 60 分', () => {
    expect(isUnassignedArriveEligible(LIN, NOW.getTime())).toBe(true)
    expect(isUnassignedArriveEligible({ ...LIN, timeSlot: '12:00' }, NOW.getTime())).toBe(false)   // 前 90 分
    expect(isUnassignedArriveEligible({ ...LIN, date: '2026-09-20' }, NOW.getTime())).toBe(false)
    expect(isUnassignedArriveEligible({ ...LIN, status: 'arrived' }, NOW.getTime())).toBe(false)
    expect(isUnassignedArriveEligible({ ...LIN, assignedTableId: '106' }, NOW.getTime())).toBe(false)
  })

  it('buildTargets：鎖桌＋未配桌合計，未配桌那筆 unassigned、沒有桌', () => {
    const list = buildTargets([mkT('105', { status: 'reserved', currentBookingId: 'Y1' })], [YU, LIN], NOW.getTime())
    expect(list.map(x => x.booking.id).sort()).toEqual(['L1', 'Y1'])
    expect(list.find(x => x.booking.id === 'L1')).toMatchObject({ unassigned: true, table: null })
  })

  it('chip 標「未配桌」、等報到 N 含它；按「到了 · 選桌」交給 onArriveUnassigned（不呼叫 onArrive）', () => {
    const onArrive = vi.fn()
    const onArriveUnassigned = vi.fn()
    mount(<ArrivalStrip tables={[mkT('105', { status: 'reserved', currentBookingId: 'Y1' })]} bookings={[YU, LIN]}
      onSelectTable={() => {}} onArrive={onArrive} onArriveUnassigned={onArriveUnassigned} now={NOW.getTime()} />)
    expect(container.textContent).toContain('等報到 2')
    const chip = container.querySelector('[data-unassigned="true"]')
    expect(chip.textContent).toContain('林先生')
    expect(chip.textContent).toContain('未配桌')
    act(() => { btn('林先生 到了，選桌入座').click() })
    expect(onArriveUnassigned).toHaveBeenCalledWith(LIN)
    expect(onArrive).not.toHaveBeenCalled()
  })
})

describe('今日訂位卡（A1＋A6）', () => {
  const render = (onArriveSeat = vi.fn()) => {
    mount(<UpcomingPanel onClickBooking={() => {}} onAssignTable={() => {}} onArriveSeat={onArriveSeat} onMoveTable={() => {}} />)
    return onArriveSeat
  }

  it('未配桌：卡片有「到了 · 選桌入座」，按了交給 onArriveSeat；「指派桌位」仍在', () => {
    setCtx({ bookings: [LIN], tables: [mkT('105')] })
    const onArriveSeat = render()
    expect(btn('指派桌位')).toBeTruthy()
    act(() => { btn('到了 · 選桌入座').click() })
    expect(onArriveSeat).toHaveBeenCalledWith(LIN)
  })

  it('唯讀角色（kitchen）不給「到了 · 選桌入座」', () => {
    currentAuth = { can: () => false }
    setCtx({ bookings: [LIN], tables: [mkT('105')] })
    render()
    expect(btn('到了 · 選桌入座')).toBeUndefined()
  })

  it('他筆預配不重疊（18:00）→ 不跳確認，直接入座；toast 帶 5 秒復原，按了交 undoSeatBooking', async () => {
    setCtx({ bookings: [YU, other('18:00')] })
    render()
    act(() => { btn('客人到了').click() })
    await flush()
    expect(confirm).not.toHaveBeenCalled()
    expect(ctx.seatBooking).toHaveBeenCalledWith('Y1')
    const [msg, action, opts] = toast.action.mock.calls[0]
    expect(msg).toBe('余先生 已入座 105')
    expect(action.label).toBe('復原')
    expect(opts).toEqual({ duration: 5000 })
    action.onClick()
    expect(ctx.undoSeatBooking).toHaveBeenCalledWith(UNDO)
  })

  it('他筆預配與現在入座重疊（11:30）→ 跳確認；取消就不入座', async () => {
    setCtx({ bookings: [YU, other('11:30')] })
    confirm.mockResolvedValue(false)
    render()
    act(() => { btn('客人到了').click() })
    await flush()
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('105 已預先配給 陳小姐（2 位 · 11:30），用餐時段重疊'), expect.objectContaining({ title: '桌位有預留' }))
    expect(ctx.seatBooking).not.toHaveBeenCalled()
  })

  it('團保桌 → 照舊跳確認', async () => {
    setCtx({
      bookings: [YU],
      tables: [mkT('105')],
      groups: [{ id: 'G', schemaVersion: 2, date: TODAY, agencyName: '甲旅行社', status: 'confirmed',
        batches: [{ id: 'B1', label: '第一梯', timeSlot: '12:30', tableNumbers: ['105'], guests: 4 }] }],
    })
    render()
    act(() => { btn('客人到了').click() })
    await flush()
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('105 為今日團體「甲旅行社」預留'), expect.anything())
    expect(ctx.seatBooking).toHaveBeenCalledWith('Y1')
  })
})

describe('桌抽屜「客人到了」（A6）', () => {
  it('入座成功 → toast 帶 5 秒復原，按了交 undoSeatBooking；復原被擋 → 說明原因', () => {
    setCtx()
    const t = mkT('105', { status: 'reserved', currentBookingId: 'Y1' })
    mount(<TableDrawer table={t} booking={YU} preassign={null} groupHold={null} onClose={() => {}} onStartMove={() => {}} mode={{}} />)
    act(() => { btn('客人到了 — 入座').click() })
    const [msg, action, opts] = toast.action.mock.calls[0]
    expect(msg).toBe('余先生 已入座 105')
    expect(opts).toEqual({ duration: 5000 })
    ctx.undoSeatBooking.mockReturnValueOnce({ ok: false, error: '105 已被別組使用，無法復原' })
    action.onClick()
    expect(ctx.undoSeatBooking).toHaveBeenCalledWith(UNDO)
    expect(toast.error).toHaveBeenCalledWith('復原失敗：105 已被別組使用，無法復原')
  })
})

describe('toastSeatedWithUndo：選桌入座時解除的他筆預配，復原時一併還回去', () => {
  it('復原成功 → restoreOverriddenAssignment 逐筆寫回，toast 附註', () => {
    const t = { action: vi.fn(), error: vi.fn(), info: vi.fn() }
    const undoSeatBooking = vi.fn(() => ({ ok: true }))
    const restoreOverriddenAssignment = vi.fn(() => ({ ok: true }))
    const released = [{ bookingId: 'O', name: '陳小姐', tableNumbers: ['105'], released: [] }]
    toastSeatedWithUndo({ undo: { bookingId: 'L1' } }, { message: 'm', name: '林先生', undoSeatBooking, toast: t, releasedPreassigns: released, restoreOverriddenAssignment })
    t.action.mock.calls[0][1].onClick()
    expect(undoSeatBooking).toHaveBeenCalledWith({ bookingId: 'L1' })
    expect(restoreOverriddenAssignment).toHaveBeenCalledWith(released[0])
    expect(t.info).toHaveBeenCalledWith('已復原：林先生 回到待到（陳小姐 的預配 105 已還原）')
  })

  it('復原被擋 → 不還原他筆預配（桌仍是本筆在用）', () => {
    const t = { action: vi.fn(), error: vi.fn(), info: vi.fn() }
    const restoreOverriddenAssignment = vi.fn()
    toastSeatedWithUndo({ undo: {} }, { message: 'm', name: '林', undoSeatBooking: () => ({ ok: false, error: 'x' }), toast: t,
      releasedPreassigns: [{ bookingId: 'O', name: '陳', tableNumbers: ['105'] }], restoreOverriddenAssignment })
    t.action.mock.calls[0][1].onClick()
    expect(restoreOverriddenAssignment).not.toHaveBeenCalled()
    expect(t.error).toHaveBeenCalledWith('復原失敗：x')
  })
})
