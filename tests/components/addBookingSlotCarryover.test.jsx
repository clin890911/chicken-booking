import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'

// 後台新增訂位：「今天自動預選的時段」不可被沿用到別天（接電話時會訂錯時間、缺時段提示也不再出現）。
// 只有店員真的點過的時段，才走「新日期同時段仍可訂就保留」。從日曆帶非今天日期進來時，不預選時段。
// 用「送出時 addBooking 有沒有被呼叫、帶什麼 timeSlot」判斷：時段空 → 被缺漏守門擋下、不會呼叫。

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const toast = { success: vi.fn(), error: vi.fn(), action: vi.fn(), info: vi.fn() }
const bookingCtx = {
  bookings: [], groupReservations: [],
  tables: ['105', '106', '107', '108'].map(number => ({ number, capacity: 4, floor: '1F', x: 100, y: 100, w: 80, h: 75, isActive: true, status: 'vacant', currentBookingId: null, currentRef: null, seatedAt: null, outage: null })),
  settings: { openTime: '11:00', closeTime: '21:00', slotInterval: 30 },
  addBooking: vi.fn((d) => ({ id: 'new1', ...d })),
  findReserveCandidates: vi.fn(() => ({ kind: null, tables: [] })),
  assignBookingToTable: vi.fn(() => ({ ok: true })),
  preassignBookingTable: vi.fn(),
}
vi.mock('../../src/contexts/BookingContext', () => ({ useBooking: () => bookingCtx }))
vi.mock('../../src/contexts/AuthContext', () => ({ useAuth: () => ({ user: { email: 'staff@test' } }) }))
vi.mock('../../src/services/customerService', () => ({ getByPhone: () => null, search: () => [] }))
vi.mock('../../src/services/bookingService', () => ({ getNoshowCount: () => 0 }))
vi.mock('../../src/components/ui/Toast', () => ({ useToast: () => toast }))

const AddBookingView = (await import('../../src/components/admin/AddBookingView')).default

describe('AddBookingView：今天自動預選的時段不沿用到別天', () => {
  let container, root
  const render = (props = {}) => {
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
    act(() => root.render(<AddBookingView {...props} />))
  }
  const type = (input, value) => act(() => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  const btn = (pred) => [...container.querySelectorAll('button')].find(pred)
  const click = (el) => act(() => { el.click() })
  const fill = () => {
    type(container.querySelector('input[type="tel"]'), '0933111222')
    type(container.querySelector('input[placeholder="王小姐"]'), '余先生')
  }
  const fillAndSubmit = () => { fill(); click(btn(b => b.textContent.includes('確認新增'))) }
  // 時段空 → 底部操作列收成「還差：時段」pill、沒有確認鈕（缺漏提示回來）
  const expectSlotMissing = () => {
    fill()
    expect(btn(b => b.textContent.includes('確認新增'))).toBeUndefined()
    expect(btn(b => b.textContent.trim() === '時段')).toBeDefined()
    expect(bookingCtx.addBooking).not.toHaveBeenCalled()
  }
  const chip = (hhmm) => btn(b => b.textContent.trim().startsWith(hhmm))

  // 2026-10-09 09:00：今天預選的是下一個可訂時段 11:00
  beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 9, 9, 9, 0)) })
  afterEach(() => { act(() => root?.unmount()); container?.remove(); vi.useRealTimers() })

  it('對照：今天預選的時段，不換日直接送出 → 帶 11:00（確認預選真的存在）', () => {
    render({})
    fillAndSubmit()
    expect(bookingCtx.addBooking).toHaveBeenCalledTimes(1)
    expect(bookingCtx.addBooking.mock.calls[0][0]).toMatchObject({ date: '2026-10-09', timeSlot: '11:00' })
  })

  it('今天預選、店員沒點過時段，換到明天 → 時段清空（缺時段提示回來）', () => {
    render({})
    click(btn(b => b.textContent.startsWith('明天')))
    expectSlotMissing()
  })

  it('店員手選 18:00 後換到明天、同時段仍可訂 → 保留', () => {
    render({})
    click(chip('18:00'))
    click(btn(b => b.textContent.startsWith('明天')))
    fillAndSubmit()
    expect(bookingCtx.addBooking).toHaveBeenCalledTimes(1)
    expect(bookingCtx.addBooking.mock.calls[0][0]).toMatchObject({ date: '2026-10-10', timeSlot: '18:00' })
  })

  it('從日曆帶明天進來（initial.date）→ 不預選時段，缺時段提示在', () => {
    render({ initial: { date: '2026-10-10', seq: 1 } })
    expectSlotMissing()
  })

  it('先在今天預選、再由日曆帶明天進來（元件已掛載）→ 一樣清空', () => {
    render({ initial: null })
    act(() => root.render(<AddBookingView initial={{ date: '2026-10-10', seq: 2 }} />))
    expectSlotMissing()
  })

  it('預選清空後換回今天 → 重新預選下一個可訂時段', () => {
    render({})
    click(btn(b => b.textContent.startsWith('明天')))
    click(btn(b => b.textContent.startsWith('今天')))
    fillAndSubmit()
    expect(bookingCtx.addBooking.mock.calls[0][0]).toMatchObject({ date: '2026-10-09', timeSlot: '11:00' })
  })
})
