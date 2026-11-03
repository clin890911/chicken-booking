import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { getSettings } from '../../src/services/settingsService'

// 當日排位（DaySeatingPanel）× 日期語意與復原：
//   今天走現場指派語意（鎖桌時機 lockKindFor：離用餐 ≤ 30 分 → assignBookingTablesMulti 鎖桌、只能選此刻空桌；
//   更早 → 預配），未來日維持預配；取消配桌的「復原」要重驗訂位狀態、日期、桌是否仍可用。
//   今天已鎖桌的訂位 → 「到現場頁改桌」（onMoveTable）。

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), action: vi.fn() }
const ctx = {}
let mapProps = null
vi.mock('../../src/contexts/BookingContext', () => ({ useBooking: () => ctx }))
vi.mock('../../src/contexts/AuthContext', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, useAuth: () => ({ can: (p) => actual.PERMISSIONS.manager.has(p) }) }
})
vi.mock('../../src/components/ui/Toast', () => ({ useToast: () => toast, useConfirm: () => vi.fn(async () => true) }))
vi.mock('../../src/components/admin/floormap/FloorMap', () => ({ default: (props) => { mapProps = props; return <div>FloorMapStub</div> } }))
vi.mock('../../src/components/booking/BookingDetailSheet', () => ({ default: () => null }))
vi.mock('../../src/components/booking/EditBookingModal', () => ({ default: () => null }))

const DaySeatingPanel = (await import('../../src/components/admin/planning/DaySeatingPanel')).default

// 今天＝2026-11-02，現在 11:40：12:00 的訂位離用餐 20 分（鎖桌型）、18:00 的訂位較早（預配型）
const NOW = new Date(2026, 10, 2, 11, 40)
const TODAY = '2026-11-02'
const FUTURE = '2026-11-06'
const TABLE = (number, extra = {}) => ({ number, capacity: 4, floor: '1F', isActive: true, status: 'vacant', currentBookingId: null, x: 100, y: 100, w: 80, h: 75, ...extra })
const BK = (id, name, date, timeSlot, extra = {}) => ({ id, name, phone: '', guests: 2, date, timeSlot, status: 'confirmed', assignedTableId: null, extraTableIds: [], notes: {}, ...extra })

let container, root, curProps
const render = (props) => { curProps = props; act(() => { root.render(<DaySeatingPanel onShiftDay={() => {}} {...props} />) }) }
const mount = (props) => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  render(props)
}
const rerender = () => render(curProps)
const btns = () => [...container.querySelectorAll('button')]
const btn = (t) => btns().find(b => b.textContent.trim() === t)
const rowOf = (name) => btns().find(b => b.dataset.key && b.textContent.includes(name))
const clickTable = (n) => act(() => { mapProps.onSelectTable(n) })
const undoOf = (i = 0) => toast.action.mock.calls[i][1].onClick

const setup = ({ bookings, tables }) => {
  const base = getSettings()
  Object.assign(ctx, {
    settings: {
      ...base,
      seatings: [
        { id: 'lunch', name: '午餐', start: '11:00', end: '14:30' },
        { id: 'dinner', name: '晚餐', start: '17:00', end: '21:00' },
      ],
      closures: { closedDates: [], closedSlots: {}, closedSeatings: {} },
    },
    tables, bookings, groupReservations: [], fixtures: undefined, zones: [],
    preassignBookingTable: vi.fn(() => ({})), preassignBookingTables: vi.fn(() => ({})), clearBookingPreassign: vi.fn(() => ({})),
    assignBookingTablesMulti: vi.fn(() => ({ ok: true })),
    replacePendingBookingTables: vi.fn(() => ({ ok: true })),
    releaseOverriddenAssignment: vi.fn(() => ({ ok: true, released: [] })),
    restoreOverriddenAssignment: vi.fn(() => ({ ok: true })),
    // 現場口徑的可選桌（與 seatingService 同義的最小替身）：鎖桌型＝此刻空桌；預配型＝此刻空桌或本筆持有
    findSuitableTables: vi.fn(() => ctx.tables.filter(t => t.status === 'vacant')),
    preassignableTables: vi.fn((_, { bookingId }) => ctx.tables.filter(t => t.status === 'vacant' || t.currentBookingId === bookingId)),
    seatBooking: vi.fn(), undoSeatBooking: vi.fn(), checkoutBooking: vi.fn(), finalizeBooking: vi.fn(),
    cancelBooking: vi.fn(), undoCancelBooking: vi.fn(), setStatus: vi.fn(), markBookingNoshow: vi.fn(), undoMarkBookingNoshow: vi.fn(),
    releaseCheckedOutTables: vi.fn(), findReserveCandidates: vi.fn(() => ({ kind: 'hold', tables: [] })),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  mapProps = null
})
afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  vi.useRealTimers()
})

describe('今天：走現場指派語意', () => {
  it('開桌前 30 分內配桌 → assignBookingTablesMulti 鎖桌（不走預配）', () => {
    setup({ tables: [TABLE('105'), TABLE('106')], bookings: [BK('B1', '近客', TODAY, '12:00')] })
    mount({ date: TODAY })
    act(() => { rowOf('近客').click() }) // 不自動選人：先點客人
    expect(container.querySelector('[data-testid="hold-badge"]')).toBeTruthy()
    clickTable('105')
    act(() => { btn('確認').click() })
    expect(ctx.assignBookingTablesMulti).toHaveBeenCalledWith('B1', ['105'])
    expect(ctx.preassignBookingTable).not.toHaveBeenCalled()
    expect(toast.success.mock.calls[0][0]).toContain('指派並鎖桌 105')
  })

  it('開桌前 30 分內：非空桌（用餐中、別筆鎖著）不能選，地圖也不框', () => {
    setup({
      tables: [TABLE('105'), TABLE('106', { status: 'dining', currentBookingId: 'X' }), TABLE('107', { status: 'reserved', currentBookingId: 'Y' })],
      bookings: [BK('B1', '近客', TODAY, '12:00')],
    })
    mount({ date: TODAY })
    act(() => { rowOf('近客').click() })
    expect(mapProps.scopedHighlightTables).toEqual(['105'])
    clickTable('106')
    expect(toast.error.mock.calls.at(-1)[0]).toMatch(/106 此刻不是空桌（用餐中）/)
    clickTable('107')
    expect(toast.error.mock.calls.at(-1)[0]).toMatch(/107 此刻不是空桌/)
    expect(container.querySelector('[data-testid="seat-banner"]').textContent).toContain('已選 0/2 席 · 0 桌')
    expect(ctx.assignBookingTablesMulti).not.toHaveBeenCalled()
  })

  it('#191 收尾：選桌時還是預配、按確認時已跨過 30 分門檻 → 不以舊口徑寫入，重算可選桌、要求再按一次；再按才鎖桌', () => {
    // 11:40 時 12:15 的訂位離用餐 35 分 → 預配型
    setup({ tables: [TABLE('105'), TABLE('106')], bookings: [BK('B1', '跨門檻', TODAY, '12:15')] })
    mount({ date: TODAY })
    act(() => { rowOf('跨門檻').click() })
    expect(container.querySelector('[data-testid="hold-badge"]')).toBeNull()
    clickTable('105')
    ctx.findSuitableTables.mockClear()
    // 店員選好桌後拖到 11:46（離用餐 29 分）才按確認
    vi.setSystemTime(new Date(2026, 10, 2, 11, 46))
    act(() => { btn('確認').click() })
    expect(toast.info).toHaveBeenCalledWith(expect.stringContaining('已接近用餐時段，配桌將鎖桌'))
    expect(ctx.preassignBookingTable).not.toHaveBeenCalled()
    expect(ctx.preassignBookingTables).not.toHaveBeenCalled()
    expect(ctx.assignBookingTablesMulti).not.toHaveBeenCalled()
    expect(toast.success).not.toHaveBeenCalled()
    // 重算：改成鎖桌口徑（hold 徽章出現、可選桌改走現場 findSuitableTables＝此刻空桌）
    expect(container.querySelector('[data-testid="hold-badge"]')).toBeTruthy()
    expect(ctx.findSuitableTables).toHaveBeenCalled()
    // 再按一次 → 鎖桌寫入（assignBookingTablesMulti），仍不走預配
    act(() => { btn('確認').click() })
    expect(ctx.assignBookingTablesMulti).toHaveBeenCalledWith('B1', ['105'])
    expect(ctx.preassignBookingTable).not.toHaveBeenCalled()
    expect(toast.success.mock.calls[0][0]).toContain('指派並鎖桌 105')
  })

  it('今天但離用餐還早 → 預配（不鎖桌），可選桌帶現場口徑 preassignableTables', () => {
    setup({ tables: [TABLE('105'), TABLE('106')], bookings: [BK('B1', '晚客', TODAY, '18:00')] })
    mount({ date: TODAY })
    expect(ctx.preassignableTables).not.toHaveBeenCalled() // 還沒選人＝還沒排位，不算可選桌
    act(() => { rowOf('晚客').click() })
    expect(container.querySelector('[data-testid="hold-badge"]')).toBeNull()
    expect(ctx.preassignableTables).toHaveBeenCalled()
    clickTable('105')
    act(() => { btn('確認').click() })
    expect(ctx.preassignBookingTable).toHaveBeenCalledWith('B1', '105')
    expect(ctx.assignBookingTablesMulti).not.toHaveBeenCalled()
  })

  it('今天改桌 → replacePendingBookingTables（現場改桌同一支）', () => {
    setup({ tables: [TABLE('105'), TABLE('106')], bookings: [BK('B2', '已預配', TODAY, '18:00', { assignedTableId: '106' })] })
    mount({ date: TODAY })
    act(() => { rowOf('已預配').click() })
    act(() => { btn('改桌').click() })
    clickTable('106') // 移除舊桌
    clickTable('105')
    act(() => { btn('確認').click() })
    expect(ctx.replacePendingBookingTables).toHaveBeenCalledWith('B2', ['105'])
    expect(ctx.preassignBookingTable).not.toHaveBeenCalled()
  })

  it('今天取消配桌 → releaseOverriddenAssignment（只釋放本筆持有的桌）；復原走 restoreOverriddenAssignment', () => {
    setup({ tables: [TABLE('105'), TABLE('106')], bookings: [BK('B2', '已預配', TODAY, '18:00', { assignedTableId: '106' })] })
    mount({ date: TODAY })
    act(() => { rowOf('已預配').click() })
    act(() => { btn('取消配桌').click() })
    expect(ctx.releaseOverriddenAssignment).toHaveBeenCalledWith('B2')
    expect(ctx.clearBookingPreassign).not.toHaveBeenCalled()
    ctx.bookings = [BK('B2', '已預配', TODAY, '18:00')]
    rerender()
    act(() => { undoOf()() })
    expect(ctx.restoreOverriddenAssignment).toHaveBeenCalledWith({ bookingId: 'B2', tableNumbers: ['106'], released: [] })
  })

  it('今天已鎖桌的訂位：有「到現場頁改桌」，按了交給 onMoveTable（規劃頁也有這個入口）', () => {
    const held = BK('B3', '已鎖桌', TODAY, '12:00', { assignedTableId: '105' })
    setup({ tables: [TABLE('105', { status: 'reserved', currentBookingId: 'B3' })], bookings: [held] })
    const onMoveTable = vi.fn()
    mount({ date: TODAY, onMoveTable })
    act(() => { rowOf('已鎖桌').click() })
    expect(container.textContent).toContain('今天已在現場鎖桌')
    expect(btn('取消配桌')).toBeUndefined()
    act(() => { btn('到現場頁改桌').click() })
    expect(onMoveTable).toHaveBeenCalledWith(expect.objectContaining({ id: 'B3' }))
  })
})

describe('未來日：維持預配，不碰現場桌況', () => {
  it('配桌走 preassignBookingTable，不呼叫鎖桌／現場可選桌', () => {
    setup({ tables: [TABLE('105', { status: 'dining', currentBookingId: 'X' }), TABLE('106')], bookings: [BK('B1', '未來客', FUTURE, '12:00')] })
    mount({ date: FUTURE })
    act(() => { rowOf('未來客').click() })
    expect(container.querySelector('[data-testid="hold-badge"]')).toBeNull()
    expect(mapProps.scopedHighlightTables).toEqual(['105', '106']) // 今天的用餐中與未來日無關
    clickTable('105')
    act(() => { btn('確認').click() })
    expect(ctx.preassignBookingTable).toHaveBeenCalledWith('B1', '105')
    expect(ctx.assignBookingTablesMulti).not.toHaveBeenCalled()
    expect(ctx.findSuitableTables).not.toHaveBeenCalled()
    expect(ctx.preassignableTables).not.toHaveBeenCalled()
  })
})

describe('取消配桌的復原：toast 還在期間資料變了 → 安全失敗', () => {
  const start = () => {
    setup({ tables: [TABLE('105'), TABLE('106')], bookings: [BK('B2', '已配桌', FUTURE, '12:00', { assignedTableId: '106' })] })
    mount({ date: FUTURE })
    act(() => { rowOf('已配桌').click() })
    act(() => { btn('取消配桌').click() })
    expect(ctx.clearBookingPreassign).toHaveBeenCalledWith('B2')
  }

  it('已取消 → 不寫回', () => {
    start()
    ctx.bookings = [BK('B2', '已配桌', FUTURE, '12:00', { status: 'cancelled' })]
    rerender()
    act(() => { undoOf()() })
    expect(toast.error.mock.calls.at(-1)[0]).toMatch(/已取消/)
    expect(ctx.preassignBookingTable).not.toHaveBeenCalled()
  })

  it('改到別天 → 不寫回', () => {
    start()
    ctx.bookings = [BK('B2', '已配桌', '2026-11-09', '12:00')]
    rerender()
    act(() => { undoOf()() })
    expect(toast.error.mock.calls.at(-1)[0]).toMatch(/已改到 2026-11-09/)
    expect(ctx.preassignBookingTable).not.toHaveBeenCalled()
  })

  it('桌子已被別筆佔走（lost）→ 不搶', () => {
    start()
    ctx.bookings = [BK('B2', '已配桌', FUTURE, '12:00'), BK('B9', '搶先', FUTURE, '12:00', { assignedTableId: '106' })]
    rerender()
    act(() => { undoOf()() })
    expect(toast.error.mock.calls.at(-1)[0]).toMatch(/桌 106 已被佔用或停用/)
    expect(ctx.preassignBookingTable).not.toHaveBeenCalled()
  })

  it('都沒變 → 寫回原預配', () => {
    start()
    ctx.bookings = [BK('B2', '已配桌', FUTURE, '12:00')]
    rerender()
    act(() => { undoOf()() })
    expect(ctx.preassignBookingTable).toHaveBeenCalledWith('B2', '106')
    expect(toast.success.mock.calls.at(-1)[0]).toContain('已復原')
  })
})

describe('不自動帶客人、不給建議桌（店主 2026-11-03）', () => {
  const banner = () => container.querySelector('[data-testid="seat-banner"]')
  const hint = () => container.querySelector('[data-testid="seat-hint"]')
  const noSuggest = () => {
    expect(container.textContent).not.toContain('建議')
    expect(btn('套用建議')).toBeUndefined()
  }
  const threeBookings = () => setup({
    tables: [TABLE('105'), TABLE('106'), TABLE('201', { floor: '2F' })],
    bookings: [BK('B1', '早客', FUTURE, '11:30'), BK('B2', '次客', FUTURE, '12:00'), BK('B3', '晚客', FUTURE, '18:00')],
  })

  it('進來：沒有任何選中的客人、沒有排位橫幅、沒有建議；有未配桌時給引導；地圖不框桌', () => {
    threeBookings()
    mount({ date: FUTURE })
    expect(container.querySelectorAll('[data-key][aria-pressed="true"]')).toHaveLength(0)
    expect(banner()).toBeNull()
    expect(hint()?.textContent).toContain('點清單上的客人開始排位')
    expect(mapProps.scopedHighlightTables).toEqual([])
    expect(mapProps.floor).toBe('1F')
    noSuggest()
  })

  it('場次預設保留（導覽）：午餐都配好 → 帶到有未配桌的晚餐場次，但仍不選人', () => {
    setup({
      tables: [TABLE('105')],
      bookings: [BK('B1', '午客', FUTURE, '12:00', { assignedTableId: '105' }), BK('B3', '晚客', FUTURE, '18:00')],
    })
    mount({ date: FUTURE })
    expect(rowOf('晚客')).toBeTruthy()
    expect(rowOf('午客')).toBeUndefined()
    expect(container.querySelectorAll('[data-key][aria-pressed="true"]')).toHaveLength(0)
    expect(banner()).toBeNull()
    expect(hint()).toBeTruthy()
    // 引導只看目前場次：切到都配好的午餐（別場還有未配桌）就不該叫人點清單
    act(() => { btns().find(b => b.textContent.trim().startsWith('午餐')).click() })
    expect(rowOf('午客')).toBeTruthy()
    expect(hint()).toBeNull()
  })

  it('沒有未配桌（或唯讀／過去日期）→ 不顯示引導', () => {
    setup({ tables: [TABLE('105')], bookings: [BK('B1', '午客', FUTURE, '12:00', { assignedTableId: '105' })] })
    mount({ date: FUTURE })
    expect(hint()).toBeNull()
    act(() => root.unmount()); container.remove()
    threeBookings()
    mount({ date: '2026-11-01' })
    expect(hint()).toBeNull()
  })

  it('點客人才進排位：橫幅「排位：XXX」＋「點地圖上框起來的空桌」，沒有建議桌文字與套用建議；地圖框出可選桌、不切樓層', () => {
    threeBookings()
    mount({ date: FUTURE })
    act(() => { rowOf('次客').click() })
    expect(banner().textContent).toContain('排位：次客')
    expect(banner().textContent).toContain('點地圖上框起來的空桌')
    expect(hint()).toBeNull()
    noSuggest()
    expect(mapProps.scopedHighlightTables).toEqual(['105', '106', '201'])
    expect(mapProps.floor).toBe('1F') // 不因任何「建議」切到 2F
  })

  it('未配桌客人不切樓層：先切 2F 再點客人，地圖留在 2F', () => {
    threeBookings()
    mount({ date: FUTURE })
    act(() => { btns().find(b => b.textContent.trim() === '2F').click() })
    act(() => { rowOf('次客').click() })
    expect(banner().textContent).toContain('排位：次客')
    expect(mapProps.floor).toBe('2F')
  })

  it('沒選人時點空桌：提示先點客人，不進排位', () => {
    threeBookings()
    mount({ date: FUTURE })
    clickTable('105')
    expect(toast.info).toHaveBeenCalledWith('先點清單上的客人，再選桌')
    expect(banner()).toBeNull()
  })

  it('換場次、換日：都不自動選人，也清掉前一個選取', () => {
    threeBookings()
    mount({ date: FUTURE })
    act(() => { rowOf('早客').click() })
    expect(banner()).toBeTruthy()
    act(() => { btns().find(b => b.textContent.trim().startsWith('晚餐')).click() })
    expect(banner()).toBeNull()
    expect(container.querySelectorAll('[data-key][aria-pressed="true"]')).toHaveLength(0)
    act(() => { rowOf('晚客').click() })
    expect(banner().textContent).toContain('排位：晚客')
    curProps = { ...curProps, date: '2026-11-07' }
    rerender()
    expect(banner()).toBeNull()
    expect(container.querySelectorAll('[data-key][aria-pressed="true"]')).toHaveLength(0)
  })

  it('已配桌那筆：仍跳到自己桌所在樓層（顯示它自己的桌）', () => {
    setup({ tables: [TABLE('105'), TABLE('201', { floor: '2F' })], bookings: [BK('B1', '二樓客', FUTURE, '12:00', { assignedTableId: '201' }), BK('B2', '待排', FUTURE, '12:30')] })
    mount({ date: FUTURE })
    expect(mapProps.floor).toBe('1F')
    act(() => { rowOf('二樓客').click() })
    expect(mapProps.floor).toBe('2F')
  })

  it('排完一筆：不跳下一筆、回到未選取，留在原場次；確認 toast 與復原照舊', () => {
    threeBookings()
    mount({ date: FUTURE })
    act(() => { rowOf('早客').click() })
    clickTable('105')
    act(() => { btn('確認').click() })
    expect(ctx.preassignBookingTable).toHaveBeenCalledWith('B1', '105')
    expect(toast.success.mock.calls[0][0]).toContain('早客（2 位）已配到 105')
    expect(banner()).toBeNull()
    expect(container.querySelectorAll('[data-key][aria-pressed="true"]')).toHaveLength(0)
    expect(rowOf('次客')).toBeTruthy() // 還在午餐場次，沒被帶去晚餐
    expect(toast.info).not.toHaveBeenCalled() // 還有未配桌，不說「都配好了」
  })

  it('排完最後一筆未配桌：回到未選取並提示都配好了', () => {
    setup({ tables: [TABLE('105')], bookings: [BK('B1', '唯一', FUTURE, '12:00')] })
    mount({ date: FUTURE })
    act(() => { rowOf('唯一').click() })
    clickTable('105')
    act(() => { btn('確認').click() })
    expect(banner()).toBeNull()
    expect(toast.info).toHaveBeenCalledWith('這天的散客都配好桌了')
  })

  it('改桌流程不變：確認後仍留在原筆，不跳別筆', () => {
    setup({ tables: [TABLE('105'), TABLE('106')], bookings: [BK('B1', '已配', FUTURE, '12:00', { assignedTableId: '106' }), BK('B2', '待排', FUTURE, '12:30')] })
    mount({ date: FUTURE })
    act(() => { rowOf('已配').click() })
    act(() => { btn('改桌').click() })
    clickTable('106'); clickTable('105')
    act(() => { btn('確認').click() })
    expect(ctx.preassignBookingTable).toHaveBeenCalledWith('B1', '105')
    expect(rowOf('已配').getAttribute('aria-pressed')).toBe('true')
    expect(rowOf('待排').getAttribute('aria-pressed')).toBe('false')
  })
})
