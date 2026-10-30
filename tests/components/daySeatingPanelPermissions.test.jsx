import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { getSettings } from '../../src/services/settingsService'
import { todayStr, addDays, formatDate } from '../../src/utils/timeSlots'

// 當日排位（DaySeatingPanel）× 角色權限：每顆鈕照 can(...)／seatingPerms／useBookingActions.show 顯示或隱藏。
//   kitchen（唯讀）：看得到當天訂位與桌況、可「聯絡」與看詳情，但沒有配桌／改桌／取消配桌／編輯／取消訂位，也不會自動進排位。
//   manager／floor／host：有配桌（自動進排位）、改桌、取消配桌、編輯、取消訂位。
//   今天已在現場鎖桌的訂位：這裡不給改桌／取消配桌（預配路徑只改 booking，會留下孤兒鎖桌），改桌走現場頁。
// 角色表用 AuthContext 的真實 PERMISSIONS（不自己抄一份）。

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), action: vi.fn() }
const ctx = {}
let currentRole = 'manager'
vi.mock('../../src/contexts/BookingContext', () => ({ useBooking: () => ctx }))
vi.mock('../../src/contexts/AuthContext', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, useAuth: () => ({ can: (p) => actual.PERMISSIONS[currentRole].has(p) }) }
})
vi.mock('../../src/components/ui/Toast', () => ({ useToast: () => toast, useConfirm: () => vi.fn(async () => true) }))
vi.mock('../../src/components/admin/floormap/FloorMap', () => ({ default: () => <div>FloorMapStub</div> }))
vi.mock('../../src/components/booking/BookingDetailSheet', () => ({ default: () => null }))
vi.mock('../../src/components/booking/EditBookingModal', () => ({ default: () => <div>EditModalStub</div> }))

const DaySeatingPanel = (await import('../../src/components/admin/planning/DaySeatingPanel')).default

const FUTURE = formatDate(addDays(new Date(todayStr() + 'T00:00:00'), 3))
const TABLE = (number, extra = {}) => ({ number, capacity: 4, floor: '1F', isActive: true, status: 'vacant', currentBookingId: null, x: 100, y: 100, w: 80, h: 75, ...extra })
let container, root
const mount = (props = {}) => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => { root.render(<DaySeatingPanel date={FUTURE} onShiftDay={() => {}} {...props} />) })
}
const btns = () => [...container.querySelectorAll('button')]
const btn = (t) => btns().find(b => b.textContent.trim() === t)
const rowOf = (name) => btns().find(b => b.dataset.key && b.textContent.includes(name))

const setup = ({ date = FUTURE, bookings, tables } = {}) => {
  const settings = getSettings()
  const slot = settings.seatings[0].start
  Object.assign(ctx, {
    settings,
    tables: tables || [TABLE('105'), TABLE('106')],
    bookings: bookings || [
      { id: 'B1', name: '未配桌客', phone: '0911000111', guests: 2, date, timeSlot: slot, status: 'confirmed', assignedTableId: null, extraTableIds: [], notes: {} },
      { id: 'B2', name: '已配桌客', phone: '0911000222', guests: 2, date, timeSlot: slot, status: 'confirmed', assignedTableId: '106', extraTableIds: [], notes: {} },
    ],
    groupReservations: [], fixtures: undefined, zones: [],
    preassignBookingTable: vi.fn(() => ({})), preassignBookingTables: vi.fn(() => ({})), clearBookingPreassign: vi.fn(() => ({})),
    seatBooking: vi.fn(), undoSeatBooking: vi.fn(), checkoutBooking: vi.fn(), finalizeBooking: vi.fn(),
    cancelBooking: vi.fn(), undoCancelBooking: vi.fn(), setStatus: vi.fn(), markBookingNoshow: vi.fn(), undoMarkBookingNoshow: vi.fn(),
    releaseCheckedOutTables: vi.fn(), findReserveCandidates: vi.fn(() => ({ kind: 'hold', tables: [] })),
  })
}

beforeEach(() => { vi.clearAllMocks(); setup() })
afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  currentRole = 'manager'
})

describe('DaySeatingPanel × 角色', () => {
  it('kitchen：唯讀——看得到訂位，沒有任何配桌／改桌／編輯／取消入口，也不自動進排位', () => {
    currentRole = 'kitchen'
    mount()
    expect(container.textContent).toContain('未配桌客')
    expect(container.textContent).toContain('唯讀：你的帳號只能查看')
    expect(container.querySelector('[data-testid="seat-banner"]')).toBeNull()

    // 選中未配桌那筆：沒有「配桌」，但有聯絡與「更多 → 訂位詳情」
    act(() => { rowOf('未配桌客').click() })
    expect(btn('配桌')).toBeUndefined()
    expect(container.querySelector('a[href="tel:0911000111"]')).toBeTruthy()
    expect(btn('訂位詳情（顧客紀錄）')).toBeTruthy()
    expect(btn('編輯')).toBeUndefined()
    expect(btn('取消訂位')).toBeUndefined()
    expect(btn('交班事項')).toBeUndefined()

    // 選中已配桌那筆：沒有改桌／取消配桌
    act(() => { rowOf('已配桌客').click() })
    expect(btn('改桌')).toBeUndefined()
    expect(btn('取消配桌')).toBeUndefined()
    expect(container.querySelector('[data-testid="seat-banner"]')).toBeNull()
    expect(ctx.preassignBookingTable).not.toHaveBeenCalled()
    expect(ctx.clearBookingPreassign).not.toHaveBeenCalled()
  })

  it.each(['manager', 'floor', 'host'])('%s：自動進排位；已配桌可改桌／取消配桌；訂位卡動作（編輯、取消訂位）都在', (role) => {
    currentRole = role
    mount()
    expect(container.textContent).not.toContain('唯讀：')
    expect(container.querySelector('[data-testid="seat-banner"]')?.textContent).toContain('排位：未配桌客')

    act(() => { rowOf('已配桌客').click() })
    expect(btn('改桌')).toBeTruthy()
    expect(btn('取消配桌')).toBeTruthy()
    expect(btn('編輯')).toBeTruthy()
    expect(btn('取消訂位')).toBeTruthy()
    act(() => { btn('取消配桌').click() })
    expect(ctx.clearBookingPreassign).toHaveBeenCalledWith('B2')
  })

  it('今天已在現場鎖桌的訂位：不給改桌／取消配桌，提示到現場頁', () => {
    const today = todayStr()
    setup({
      date: today,
      tables: [TABLE('105'), TABLE('106', { status: 'reserved', currentBookingId: 'B2' })],
    })
    currentRole = 'manager'
    mount({ date: today })
    act(() => { rowOf('已配桌客').click() })
    expect(btn('改桌')).toBeUndefined()
    expect(btn('取消配桌')).toBeUndefined()
    expect(container.textContent).toContain('今天已在現場鎖桌')
  })

  it('過去日期：只能看，不自動進排位、沒有配桌', () => {
    const past = formatDate(addDays(new Date(todayStr() + 'T00:00:00'), -2))
    setup({ date: past })
    mount({ date: past })
    expect(container.textContent).toContain('過去的日期：只能看')
    expect(container.querySelector('[data-testid="seat-banner"]')).toBeNull()
    act(() => { rowOf('未配桌客').click() })
    expect(btn('配桌')).toBeUndefined()
  })
})
