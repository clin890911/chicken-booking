import { describe, it, expect, vi, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'

// AddBookingView：prefill 的欄位級守門（2026-08，日曆「＋ 新增訂位」新增）。
// 背景：日曆選定日期後點「＋ 新增訂位」只帶 { date, seq }，不該把使用者已經在
// 新增表單打好的姓名／電話洗掉；但名冊「➕ 新增訂位」原本就會連 phone/name/source
// 一起送（含刻意送空字串代表「不預填顧客」的現場頁「＋新增今日訂位」），這條路的
// 清空語意不能退化。用「欄位是否存在於 initial」而非「truthy」判斷是否覆蓋。

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const bookingCtx = {
  bookings: [], tables: [], groupReservations: [],
  settings: { openTime: '11:00', closeTime: '21:00', slotInterval: 30 },
  addBooking: vi.fn(),
  suggestTable: vi.fn(() => null),
}
vi.mock('../../src/contexts/BookingContext', () => ({ useBooking: () => bookingCtx }))
vi.mock('../../src/contexts/AuthContext', () => ({ useAuth: () => ({ user: { email: 'staff@test' } }) }))
vi.mock('../../src/services/customerService', () => ({
  getByPhone: () => null,
  search: () => [],
}))
vi.mock('../../src/services/bookingService', () => ({ getNoshowCount: () => 0 }))
vi.mock('../../src/services/seatingService', () => ({ assignBookingToTable: vi.fn(() => ({ ok: true })) }))
vi.mock('../../src/components/ui/Toast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), action: vi.fn() }),
}))

const AddBookingView = (await import('../../src/components/admin/AddBookingView')).default

describe('AddBookingView：prefill 欄位級守門', () => {
  let container, root

  const phoneInput = () => container.querySelector('input[placeholder="0912345678"]')
  const nameInput = () => container.querySelector('input[placeholder="王小姐"]')

  const render = (props = {}) => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => { root.render(<AddBookingView {...props} />) })
  }
  const rerender = (props) => act(() => { root.render(<AddBookingView {...props} />) })

  const typeInto = (input, value) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    act(() => {
      setter.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }

  afterEach(() => {
    act(() => root?.unmount())
    container?.remove()
  })

  it('名冊路徑（帶真實顧客）：phone/name/source 照樣預填，行為不退化', () => {
    render({ initial: null })
    rerender({ initial: { phone: '0933111222', name: '陳先生', source: 'walkin', seq: 1 } })
    expect(phoneInput().value).toBe('0933111222')
    expect(nameInput().value).toBe('陳先生')
    // 來源 chip 選中態：walkin 對應「🚶 現場」
    const walkinChip = [...container.querySelectorAll('button')].find(b => b.textContent.trim() === '現場')
    expect(walkinChip.className).toContain('border-chicken-red')
  })

  it('名冊路徑（現場頁「＋新增今日訂位」傳空顧客）：仍會清空 phone/name，清空語意不退化', () => {
    render({ initial: null })
    typeInto(phoneInput(), '0955555555')
    typeInto(nameInput(), '殘留草稿')
    expect(phoneInput().value).toBe('0955555555')

    rerender({ initial: { phone: '', name: '', source: 'phone', seq: 2 } })
    expect(phoneInput().value).toBe('')
    expect(nameInput().value).toBe('')
  })

  it('日曆路徑：只帶 { date, seq } 不會洗掉使用者已填的姓名電話', () => {
    render({ initial: null })
    typeInto(phoneInput(), '0966777888')
    typeInto(nameInput(), '王小姐')
    expect(phoneInput().value).toBe('0966777888')
    expect(nameInput().value).toBe('王小姐')

    rerender({ initial: { date: '2026-09-12', seq: 3 } })
    expect(phoneInput().value).toBe('0966777888')
    expect(nameInput().value).toBe('王小姐')
    // 日期文案（時段標籤帶日期）反映預填的日期，確認 date 真的吃進去了
    expect(container.textContent).toContain('9/12')
  })
})
