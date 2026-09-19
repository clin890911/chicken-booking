import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'

// 驗收問題 4：桌況抽屜的「散客直接入座」、候選名單（TableCandidatePanel）的指派／入座／候位入座，
// 覆蓋預配時要跟現場指派／帶位同一個 helper：與新佔用區間重疊才解除＋toast；不重疊保留。
// 時間固定在 12:20（vitest TZ=Asia/Taipei）。

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const TODAY = '2026-09-19'
const NOW = new Date(2026, 8, 19, 12, 20)
const ctx = {}
const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), action: vi.fn() }
vi.mock('../../src/contexts/BookingContext', () => ({ useBooking: () => ctx }))
vi.mock('../../src/contexts/AuthContext', () => ({ useAuth: () => ({ can: () => true }) }))
vi.mock('../../src/components/ui/Toast', () => ({ useToast: () => toast, useConfirm: () => vi.fn(async () => true) }))

const TableDrawer = (await import('../../src/components/admin/floormap/TableDrawer')).default
const TableCandidatePanel = (await import('../../src/components/admin/floormap/TableCandidatePanel')).default

const T105 = { number: '105', capacity: 4, floor: '1F', isActive: true, status: 'vacant', currentBookingId: null, currentRef: null }
const yuAt = (slot) => ({ id: 'YU', name: '余先生', phone: '', guests: 2, date: TODAY, timeSlot: slot, status: 'confirmed', assignedTableId: '105', extraTableIds: [], notes: {} })
const CHEN = { id: 'CHEN', name: '陳小姐', phone: '', guests: 2, date: TODAY, timeSlot: '12:00', status: 'confirmed', assignedTableId: null, extraTableIds: [], notes: {} }

function setCtx(bookings) {
  Object.assign(ctx, {
    bookings, waitlist: [], tables: [T105], groupReservations: [], settings: {},
    walkInSeat: vi.fn(() => ({ ok: true, booking: { id: 'W1', name: '散客' } })),
    assignBookingToTable: vi.fn(() => ({ ok: true })),
    seatBooking: vi.fn(() => ({ ok: true })),
    seatWaitlist: vi.fn(() => ({ ok: true })),
    releaseOverriddenAssignment: vi.fn(() => ({ ok: true, tableNumbers: ['105'], released: [] })),
    undoAssignBooking: vi.fn(() => ({ ok: true })),
    restoreOverriddenAssignment: vi.fn(() => ({ ok: true, tableNumbers: ['105'], relocked: [], notRelocked: [] })),
    blockTable: vi.fn(), unblockTable: vi.fn(), reseatBookingTables: vi.fn(), checkoutBooking: vi.fn(),
    finalizeBooking: vi.fn(), clearTable: vi.fn(), undoClearTable: vi.fn(), cancelBooking: vi.fn(),
    undoCancelBooking: vi.fn(), setTableOutage: vi.fn(), clearTableOutage: vi.fn(),
  })
}

describe('抽屜路徑覆蓋預配：重疊才解除', () => {
  let container, root
  const mount = (el) => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => { root.render(el) })
  }
  const btn = (text) => [...document.querySelectorAll('button')].find(b => b.textContent.trim().startsWith(text))

  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); vi.clearAllMocks() })
  afterEach(() => { act(() => root?.unmount()); container?.remove(); vi.useRealTimers() })

  it('TableDrawer 散客直接入座：12:30 余先生重疊 → 提示「將解除」，入座後解除＋toast', () => {
    const yu = yuAt('12:30')
    setCtx([yu])
    mount(<TableDrawer table={T105} booking={null} preassign={yu} groupHold={null} onClose={() => {}} onStartMove={() => {}} mode={{}} />)
    expect(container.textContent).toContain('入座後這筆預配將解除')
    act(() => { btn('散客直接入座').click() })
    act(() => { btn('確認入座').click() })
    expect(ctx.walkInSeat).toHaveBeenCalled()
    expect(ctx.releaseOverriddenAssignment).toHaveBeenCalledWith('YU')
    expect(toast.info).toHaveBeenCalledWith('余先生原本的預配 105 已解除，請重新指派', { duration: 8000 })
  })

  it('TableDrawer 散客直接入座：20:30 余先生不重疊 → 提示「會保留」，入座後不解除', () => {
    const yu = yuAt('20:30')
    setCtx([yu])
    mount(<TableDrawer table={T105} booking={null} preassign={yu} groupHold={null} onClose={() => {}} onStartMove={() => {}} mode={{}} />)
    expect(container.textContent).toContain('這筆預配會保留')
    act(() => { btn('散客直接入座').click() })
    act(() => { btn('確認入座').click() })
    expect(ctx.walkInSeat).toHaveBeenCalled()
    expect(ctx.releaseOverriddenAssignment).not.toHaveBeenCalled()
  })

  it('TableCandidatePanel「入座」（現在入座）：12:30 的預配重疊 → 解除', () => {
    setCtx([yuAt('12:30'), CHEN])
    mount(<TableCandidatePanel table={T105} onPicked={() => {}} />)
    act(() => { btn('入座').click() })
    expect(ctx.assignBookingToTable).toHaveBeenCalledWith('CHEN', '105')
    expect(ctx.releaseOverriddenAssignment).toHaveBeenCalledWith('YU')
  })

  it('TableCandidatePanel「預訂」（現在就鎖桌）：20:30 的預配不重疊 → 保留', () => {
    setCtx([yuAt('20:30'), CHEN])
    mount(<TableCandidatePanel table={T105} onPicked={() => {}} />)
    act(() => { btn('預訂').click() })
    expect(ctx.assignBookingToTable).toHaveBeenCalledWith('CHEN', '105')
    expect(ctx.releaseOverriddenAssignment).not.toHaveBeenCalled()
  })

  it('TableCandidatePanel 候位入座：12:30 的預配重疊 → 解除', () => {
    setCtx([yuAt('12:30')])
    ctx.waitlist = [{ id: 'W9', name: '候位客', partySize: 2, status: 'waiting', queueNumber: 9, takenAt: NOW.toISOString() }]
    mount(<TableCandidatePanel table={T105} onPicked={() => {}} />)
    act(() => { btn('入座').click() })
    expect(ctx.seatWaitlist).toHaveBeenCalledWith('W9', '105')
    expect(ctx.releaseOverriddenAssignment).toHaveBeenCalledWith('YU')
  })
})

// 重驗 verify-2 問題 A：抽屜提示用「現在入座」算，但「預訂」是「現在就鎖桌」——兩者結果可能相反。
// 修正後：提示分開講入座／預訂；每顆「預訂」鈕在按下前就標明會不會解除；解除後給「↩ 復原」。
describe('抽屜「入座」與「預訂」分開據實（12:00，P 18:00 預配 105）', () => {
  let container, root
  const NOON = new Date(2026, 8, 19, 12, 0)
  const P = { ...yuAt('18:00'), id: 'P', name: 'P' }
  const Q = { ...CHEN, id: 'Q', name: 'Q', timeSlot: '17:30' }
  const Q2 = { ...CHEN, id: 'Q2', name: 'Q2', timeSlot: '12:30' }
  const rowOf = (name) => [...container.querySelectorAll('.rounded-lg.p-2')]
    .find(r => r.querySelector('span.truncate')?.textContent === name)
  const rowBtn = (name, label) => [...rowOf(name).querySelectorAll('button')].find(b => b.textContent.startsWith(label))

  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOON); vi.clearAllMocks() })
  afterEach(() => { act(() => root?.unmount()); container?.remove(); vi.useRealTimers() })
  const mountDrawer = () => {
    setCtx([P, Q, Q2])
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => { root.render(<TableDrawer table={T105} booking={null} preassign={P} groupHold={null} onClose={() => {}} onStartMove={() => {}} mode={{}} />) })
  }

  it('提示分開講：入座→會保留；預訂→看鈕上的標示。Q 17:30 的「預訂」事先標明「將解除 P 18:00 的預配」，「入座」不標', () => {
    mountDrawer()
    expect(container.textContent).toContain('入座：現在讓別組入座不會撞到其用餐時段，這筆預配會保留')
    expect(container.textContent).toContain('預訂：會從現在鎖桌到那組用完餐')
    expect(rowBtn('Q', '預訂').textContent).toBe('預訂（將解除 P 18:00 的預配）')
    expect(rowBtn('Q', '入座').textContent).toBe('入座')
    expect(rowBtn('Q2', '預訂').textContent).toBe('預訂')            // 12:30 鎖到 14:10，不撞 18:00
  })

  it('按標了「將解除」的預訂 → 真的解除 P，toast 帶「↩ 復原」：撤回預訂並寫回 P 的預配', () => {
    mountDrawer()
    act(() => { rowBtn('Q', '預訂').click() })
    expect(ctx.assignBookingToTable).toHaveBeenCalledWith('Q', '105')
    expect(ctx.releaseOverriddenAssignment).toHaveBeenCalledWith('P')
    const [msg, action] = toast.action.mock.calls.at(-1)
    expect(msg).toContain('Q 已預訂 105')
    expect(action.label).toBe('↩ 復原')
    action.onClick()
    expect(ctx.undoAssignBooking).toHaveBeenCalledWith('Q', '105')
    expect(ctx.restoreOverriddenAssignment).toHaveBeenCalledWith(expect.objectContaining({ bookingId: 'P', tableNumbers: ['105'] }))
    expect(toast.info).toHaveBeenLastCalledWith('已復原：Q 回到未配桌（P 的預配 105 已還原）')
  })

  it('按沒標示的預訂（Q2）→ 不解除 P、一般成功 toast', () => {
    mountDrawer()
    act(() => { rowBtn('Q2', '預訂').click() })
    expect(ctx.assignBookingToTable).toHaveBeenCalledWith('Q2', '105')
    expect(ctx.releaseOverriddenAssignment).not.toHaveBeenCalled()
    expect(toast.success).toHaveBeenCalledWith('Q2 已預訂 105（12:30）')
  })
})
