import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'

// U2：現場「今日訂位」籤的桌號徽章（✓ 已指派 105／已預配 105）變成可點的「改桌」→ onMoveTable。
// 權限沿用既有口徑：booking.update + table.update 都有才給（唯讀角色仍是唯讀徽章）。

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let currentAuth = null
vi.mock('../../src/contexts/AuthContext', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, useAuth: () => currentAuth }
})
const ctx = {
  bookings: [], tables: [], groupReservations: [],
  setStatus: vi.fn(), seatBooking: vi.fn(() => ({ ok: true })),
  completeWithoutSeating: vi.fn(), undoCompleteWithoutSeating: vi.fn(),
}
const toast = { success: vi.fn(), error: vi.fn(), action: vi.fn(), info: vi.fn() }
vi.mock('../../src/contexts/BookingContext', () => ({ useBooking: () => ctx }))
vi.mock('../../src/components/ui/Toast', () => ({ useToast: () => toast, useConfirm: () => vi.fn(async () => true) }))

const { PERMISSIONS } = await import('../../src/contexts/AuthContext')
const UpcomingPanel = (await import('../../src/components/admin/floormap/UpcomingPanel')).default
const roleCan = (role) => (a) => PERMISSIONS[role].has(a)

const NOW = new Date(2026, 8, 19, 10, 30, 0)
const TODAY = '2026-09-19'
const YU = { id: 'Y1', name: '余先生', phone: '', guests: 2, date: TODAY, timeSlot: '11:00', status: 'confirmed', assignedTableId: '105', extraTableIds: [], notes: {} }

describe('UpcomingPanel：桌號徽章＝改桌入口', () => {
  let container, root
  const onMoveTable = vi.fn()
  const render = (can, bookings = [YU], tables = [{ number: '105', status: 'reserved', currentBookingId: 'Y1' }]) => {
    currentAuth = { can }
    ctx.bookings = bookings
    ctx.tables = tables
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => { root.render(<UpcomingPanel onClickBooking={() => {}} onAssignTable={() => {}} onMoveTable={onMoveTable} />) })
  }
  const btn = (text) => [...container.querySelectorAll('button')].find(b => b.textContent.includes(text))

  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); vi.clearAllMocks() })
  afterEach(() => { act(() => root?.unmount()); container?.remove(); vi.useRealTimers() })

  it('host：「✓ 已指派 105 · ↔ 改桌」是按鈕，點了呼叫 onMoveTable（且不觸發卡片本身的點擊）', () => {
    render(roleCan('host'))
    const b = btn('改桌')
    expect(b.textContent).toContain('✓ 已指派 105')
    act(() => { b.click() })
    expect(onMoveTable).toHaveBeenCalledWith(YU)
  })

  it('預配也能改桌（「已預配 105 · ↔ 改桌」）', () => {
    render(roleCan('host'), [YU], [{ number: '105', status: 'vacant', currentBookingId: null }])
    expect(btn('改桌').textContent).toContain('已預配 105')
  })

  it('kitchen（唯讀）：徽章維持唯讀、沒有改桌', () => {
    render(roleCan('kitchen'))
    expect(btn('改桌')).toBeUndefined()
    expect(container.textContent).toContain('✓ 已指派 105')
  })

  it('併桌訂位：改桌呈停用並寫原因，點了只說明、不進改桌（與訂位卡一致）', () => {
    render(roleCan('host'), [{ ...YU, extraTableIds: ['106'] }])
    const b = btn('改桌')
    expect(b.getAttribute('aria-disabled')).toBe('true')
    expect(b.textContent).toContain('105 + 106')
    expect(b.textContent).toContain('併桌不支援')
    act(() => { b.click() })
    expect(onMoveTable).not.toHaveBeenCalled()
    expect(toast.info).toHaveBeenCalledWith(expect.stringContaining('併桌訂位不支援單桌改桌'))
  })

  it('電話空白的現場客：人數後面不留「 · 」尾巴', () => {
    render(roleCan('host'))
    expect(container.textContent).toContain('2 位')
    expect(container.textContent).not.toContain('2 位 · ')
  })
})
