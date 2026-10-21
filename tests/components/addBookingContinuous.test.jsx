import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'

// 電話訂位連續新增：BookingsView 的「新增」入口存檔後留在新增畫面，保留日期＋時段，
// 清空姓名／電話／人數／備註；其他入口（不傳 continuous）行為不變。

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

describe('AddBookingView continuous（電話訂位連續新增）', () => {
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
  const phone = () => container.querySelector('input[type="tel"]')
  const name = () => container.querySelector('input[placeholder="王小姐"]')
  const fillAndSave = () => {
    click(btn(b => b.textContent.startsWith('明天')))
    type(phone(), '0933111222'); type(name(), '余先生')
    click(btn(b => b.textContent.trim().startsWith('18:00')))
    click(btn(b => b.textContent.includes('確認新增')))
  }
  beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 9, 9, 9, 0)) })
  afterEach(() => { act(() => root?.unmount()); container?.remove(); vi.useRealTimers() })

  it('continuous：存檔後保留日期與時段、清空姓名電話', () => {
    const onCreated = vi.fn()
    render({ continuous: true, onCreated })
    fillAndSave()
    expect(bookingCtx.addBooking).toHaveBeenCalledTimes(1)
    expect(bookingCtx.addBooking.mock.calls[0][0]).toMatchObject({ date: '2026-10-10', timeSlot: '18:00', name: '余先生' })
    expect(onCreated).toHaveBeenCalledTimes(1)
    expect(phone().value).toBe('')
    expect(name().value).toBe('')
    // 日期、時段仍被選中：確認鈕可直接再送（只缺姓名電話），且再填就能用同一天同時段新增第二筆
    type(phone(), '0944555666'); type(name(), '第二位')
    click(btn(b => b.textContent.includes('確認新增')))
    expect(bookingCtx.addBooking).toHaveBeenCalledTimes(2)
    expect(bookingCtx.addBooking.mock.calls[1][0]).toMatchObject({ date: '2026-10-10', timeSlot: '18:00', name: '第二位' })
  })

  it('未傳 continuous（其他入口）：時段照舊清空', () => {
    render({})
    fillAndSave()
    type(phone(), '0944555666'); type(name(), '第二位')
    // 時段被清掉 → 缺時段，不顯示確認新增鈕
    expect(btn(b => b.textContent.includes('確認新增'))).toBeUndefined()
  })

  it('今天：預選下一個可訂時段（09:00 開表單 → 11:00），只要再填客人就能存', () => {
    render({ continuous: true })
    type(phone(), '0933111222'); type(name(), '早鳥')
    const confirm = btn(b => b.textContent.includes('確認新增'))
    expect(confirm.textContent).toMatch(/11:00 · 2 位/)
    click(confirm)
    expect(bookingCtx.addBooking.mock.calls[0][0]).toMatchObject({ date: '2026-10-09', timeSlot: '11:00' })
  })

  it('換日期：新日期同一時段仍可訂 → 保留不清空（明天 18:00 → 改後天仍是 18:00）', () => {
    render({ continuous: true })
    click(btn(b => b.textContent.startsWith('明天')))
    click(btn(b => b.textContent.trim().startsWith('18:00')))
    click(btn(b => b.textContent.startsWith('後天')))
    type(phone(), '0933111222'); type(name(), '改日客')
    click(btn(b => b.textContent.includes('確認新增')))
    expect(bookingCtx.addBooking.mock.calls[0][0]).toMatchObject({ date: '2026-10-11', timeSlot: '18:00' })
  })

  it('姓名用稱謂＋姓氏快選：點「陳」→ 陳先生；稱謂循環到小姐 → 陳小姐；手打全名不接稱謂', () => {
    render({ continuous: true })
    click(btn(b => b.getAttribute('aria-label') === '陳'))
    expect(container.textContent).toContain('將登記為：陳先生')
    click(btn(b => (b.getAttribute('aria-label') || '').startsWith('稱謂：先生')))
    expect(container.textContent).toContain('將登記為：陳小姐')
    type(phone(), '0933111222')
    click(btn(b => b.textContent.includes('確認新增')))
    expect(bookingCtx.addBooking.mock.calls[0][0]).toMatchObject({ name: '陳小姐' })
    // 手打全名 → 原樣，不變成「王小明小姐」
    type(phone(), '0944555666'); type(name(), '王小明')
    expect(container.textContent).toContain('將登記為：王小明')
    expect(container.textContent).not.toContain('王小明小姐')
  })

  it('日期快選涵蓋 0–6 天：第 4 天起標 M/D(週X)', () => {
    render({})
    const labels = [...container.querySelectorAll('button')].map(b => b.textContent)
    expect(labels.some(t => t.startsWith('今天'))).toBe(true)
    expect(labels.some(t => t.startsWith('後天'))).toBe(true)
    // 2026-10-09 週五 → +3 = 10/12 週一、+6 = 10/15 週四
    expect(labels.some(t => t.startsWith('10/12(週一)'))).toBe(true)
    expect(labels.some(t => t.startsWith('10/15(週四)'))).toBe(true)
    expect(labels.some(t => t.startsWith('10/16'))).toBe(false)
  })
})
