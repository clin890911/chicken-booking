import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { getSettings } from '../../src/services/settingsService'
import { todayStr, addDays, formatDate } from '../../src/utils/timeSlots'

// 規劃「排位地圖」的預先配桌：唯讀角色（kitchen）看得到地圖與未配桌清單，但沒有「配桌」「解除預先配桌」，
// 跨頁導向（assignRequest）也不會把他送進預配模式。manager／host／floor 的入口不變。

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

const SlotMapPanel = (await import('../../src/components/admin/planning/SlotMapPanel')).default

const DATE = formatDate(addDays(new Date(todayStr() + 'T00:00:00'), 3))
let container, root
const mount = (props = {}) => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => { root.render(<SlotMapPanel date={DATE} {...props} />) })
}
const btns = () => [...container.querySelectorAll('button')]
const hasExact = (t) => btns().some(b => b.textContent.trim() === t)

beforeEach(() => {
  const settings = getSettings()
  const firstSeating = settings.seatings[0]
  Object.assign(ctx, {
    settings,
    tables: [{ number: '105', capacity: 4, floor: '1F', isActive: true, status: 'vacant', x: 100, y: 100, w: 80, h: 75 }],
    bookings: [{ id: 'B1', name: '未配桌客', phone: '0911', guests: 2, date: DATE, timeSlot: firstSeating.start, status: 'confirmed', assignedTableId: null }],
    groupReservations: [], fixtures: undefined, zones: [],
    preassignBookingTable: vi.fn(), preassignBookingTables: vi.fn(), clearBookingPreassign: vi.fn(),
  })
})
afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  currentRole = 'manager'
})

describe('SlotMapPanel 預先配桌入口 × 角色', () => {
  it.each(['manager', 'host', 'floor'])('%s：未配桌散客有「配桌」鈕；跨頁導向會進預配模式', (role) => {
    currentRole = role
    mount()
    expect(container.textContent).toContain('未配桌客')
    expect(hasExact('配桌')).toBe(true)
    act(() => root.unmount()); container.remove()
    mount({ assignRequest: { bookingId: 'B1', seatingId: ctx.settings.seatings[0].id }, onAssignHandled: vi.fn() })
    expect(container.textContent).toContain('預先配桌')
  })

  it('kitchen：看得到未配桌散客，但沒有「配桌」鈕，跨頁導向也進不了預配模式', () => {
    currentRole = 'kitchen'
    mount()
    expect(container.textContent).toContain('未配桌客')
    expect(hasExact('配桌')).toBe(false)
    act(() => root.unmount()); container.remove()
    const handled = vi.fn()
    mount({ assignRequest: { bookingId: 'B1', seatingId: ctx.settings.seatings[0].id }, onAssignHandled: handled })
    expect(container.textContent).not.toContain('預先配桌：')
    expect(hasExact('配桌中')).toBe(false)
    expect(handled).toHaveBeenCalled()   // 請求照樣被消費，不會殘留
    expect(ctx.preassignBookingTable).not.toHaveBeenCalled()
  })
})
