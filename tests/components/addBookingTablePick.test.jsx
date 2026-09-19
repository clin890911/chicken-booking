import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'

// AddBookingView × 選桌（2026-09 店主回報：余先生現場訂位，輸入完資料後沒辦法選桌）。
// S5：今日訂位的指派一律走 BookingContext.assignBookingToTable（含 refresh／同步／Telegram），
//     不可直接呼叫 seatingService（存檔後卡片會有幾秒停在「建議桌 106／指派桌位」的舊畫面）。

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mkT = (number, capacity = 4, floor = '1F') => ({ number, capacity, floor, isActive: true, status: 'vacant' })
const T105 = mkT('105'), T106 = mkT('106'), T201 = mkT('201', 6, '2F')

const ctx = {}
function resetCtx() {
  Object.assign(ctx, {
    bookings: [], tables: [T105, T106, T201], groupReservations: [],
    settings: { openTime: '11:00', closeTime: '21:00', slotInterval: 30 },
    addBooking: vi.fn(d => ({ id: 'BNEW', ...d })),
    suggestTable: vi.fn(() => T105),
    findSuitableTables: vi.fn(() => [T105, T106, T201]),
    assignBookingToTable: vi.fn(() => ({ ok: true })),
  })
}
const toast = { success: vi.fn(), error: vi.fn(), action: vi.fn(), info: vi.fn() }

vi.mock('../../src/contexts/BookingContext', () => ({ useBooking: () => ctx }))
vi.mock('../../src/contexts/AuthContext', () => ({ useAuth: () => ({ user: { email: 'staff@test' } }) }))
vi.mock('../../src/services/customerService', () => ({ getByPhone: () => null, search: () => [] }))
vi.mock('../../src/services/bookingService', () => ({ getNoshowCount: () => 0 }))
vi.mock('../../src/components/ui/Toast', () => ({ useToast: () => toast }))

const AddBookingView = (await import('../../src/components/admin/AddBookingView')).default

describe('AddBookingView：今日訂位選桌', () => {
  let container, root
  const onAssignTable = vi.fn()
  const onMoveTable = vi.fn()

  const render = (props = {}) => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => { root.render(<AddBookingView onAssignTable={onAssignTable} onMoveTable={onMoveTable} {...props} />) })
  }
  const typeInto = (input, value) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    act(() => {
      setter.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }
  const buttons = () => [...container.querySelectorAll('button')]
  const btn = (pred) => buttons().find(pred)
  const click = (el) => act(() => { el.click() })
  const fillBasics = ({ phone = '0933111222', name = '余先生', slot = '11:00' } = {}) => {
    if (phone != null) typeInto(container.querySelector('input[type="tel"]'), phone)
    typeInto(container.querySelector('input[placeholder="王小姐"]'), name)
    click(btn(b => b.textContent.trim().startsWith(slot)))
  }
  const confirmBtn = () => btn(b => b.textContent.includes('確認新增'))

  beforeEach(() => { resetCtx(); vi.clearAllMocks() })
  afterEach(() => {
    act(() => root?.unmount())
    container?.remove()
  })

  it('S5：存檔後的指派走 Context 的 assignBookingToTable（帶建議桌），不直接戳 service', () => {
    render()
    fillBasics()
    click(confirmBtn())
    expect(ctx.addBooking).toHaveBeenCalledTimes(1)
    expect(ctx.assignBookingToTable).toHaveBeenCalledWith('BNEW', '105')
  })
})
