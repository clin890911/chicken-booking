import { describe, it, expect, vi, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'

// U4 的延伸：新增時沒留電話的現場訂位，打開「編輯」不可被「還差：電話」卡住（與新增表單同口徑）；
// 其他來源仍要求電話。

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const ctx = {
  settings: { openTime: '11:00', closeTime: '21:00', slotInterval: 30 },
  tables: [{ number: '105', capacity: 4, isActive: true, floor: '1F', status: 'vacant' }],
  bookings: [], groupReservations: [],
  updateBooking: vi.fn(),
}
vi.mock('../../src/contexts/BookingContext', () => ({ useBooking: () => ctx }))
vi.mock('../../src/components/ui/Toast', () => ({ useToast: () => ({ success: vi.fn(), info: vi.fn(), error: vi.fn() }) }))

const EditBookingModal = (await import('../../src/components/booking/EditBookingModal')).default

const base = { id: 'B1', name: '余先生', phone: '', guests: 2, date: '2099-12-31', timeSlot: '11:00', notes: {} }

describe('EditBookingModal：現場訂位電話選填', () => {
  let container, root
  const render = (booking) => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => { root.render(<EditBookingModal booking={booking} onClose={() => {}} />) })
  }
  const saveBtn = () => [...document.querySelectorAll('button')].find(b => /儲存變更|還差/.test(b.textContent))
  afterEach(() => { act(() => root?.unmount()); container?.remove(); vi.clearAllMocks() })

  it('來源＝現場、電話空白 → 可直接儲存', () => {
    render({ ...base, source: 'walkin' })
    expect(saveBtn().textContent).toBe('儲存變更')
    act(() => { saveBtn().click() })
    expect(ctx.updateBooking).toHaveBeenCalledWith('B1', expect.objectContaining({ phone: '', source: 'walkin' }))
  })

  it('來源＝電話、電話空白 → 仍要求電話', () => {
    render({ ...base, source: 'phone' })
    expect(saveBtn().textContent).toContain('還差：電話')
  })
})

describe('EditBookingModal：大人／小孩', () => {
  let container, root
  const render = (booking) => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => { root.render(<EditBookingModal booking={booking} onClose={() => {}} />) })
  }
  const btn = (pred) => [...document.querySelectorAll('button')].find(pred)
  const saveBtn = () => btn(b => /儲存變更|還差/.test(b.textContent))
  afterEach(() => { act(() => root?.unmount()); container?.remove(); vi.clearAllMocks() })

  it('舊單（無拆分）預填 大人＝guests、小孩＝0；不改就存不會多寫拆分欄位', () => {
    render({ ...base, source: 'walkin', guests: 4 })
    expect(btn(b => b.getAttribute('aria-label') === '4 位').getAttribute('aria-pressed')).toBe('true')
    expect(document.querySelector('input[aria-label="小孩人數"]').value).toBe('0')
    act(() => { saveBtn().click() })
    const patch = ctx.updateBooking.mock.calls[0][1]
    expect(patch.guests).toBe(4)
    expect('children' in patch).toBe(false)
  })

  it('加一位小孩 → guests＝大人＋小孩，寫入 adults/children', () => {
    render({ ...base, source: 'walkin', guests: 4 })
    act(() => { btn(b => b.getAttribute('aria-label') === '小孩人數 加 1').click() })
    act(() => { saveBtn().click() })
    expect(ctx.updateBooking.mock.calls[0][1]).toMatchObject({ guests: 5, adults: 4, children: 1 })
  })

  it('原單有拆分 → 預填拆分；小孩減回 0 也會寫回 children:0', () => {
    render({ ...base, source: 'walkin', guests: 5, adults: 3, children: 2 })
    expect(btn(b => b.getAttribute('aria-label') === '3 位').getAttribute('aria-pressed')).toBe('true')
    expect(document.querySelector('input[aria-label="小孩人數"]').value).toBe('2')
    const minus = btn(b => b.getAttribute('aria-label') === '小孩人數 減 1')
    act(() => { minus.click() }); act(() => { minus.click() })
    act(() => { saveBtn().click() })
    expect(ctx.updateBooking.mock.calls[0][1]).toMatchObject({ guests: 3, adults: 3, children: 0 })
  })
})

// 2026-10 尖峰優化：改日期時，原時段在新日期仍可訂就保留（不逼店員重選）；不可訂才清空。
describe('EditBookingModal：換日期保留仍可訂的時段', () => {
  let container, root
  const render = (booking) => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => { root.render(<EditBookingModal booking={booking} onClose={() => {}} />) })
  }
  const btn = (pred) => [...document.querySelectorAll('button')].find(pred)
  const saveBtn = () => btn(b => /儲存變更|還差/.test(b.textContent))
  afterEach(() => { act(() => root?.unmount()); container?.remove(); vi.clearAllMocks(); vi.useRealTimers(); ctx.bookings = [] })

  it('明天 18:00 → 改後天：仍是 18:00，可直接存', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 9, 9, 9, 0))
    const b = { ...base, source: 'walkin', date: '2026-10-10', timeSlot: '18:00' }
    ctx.bookings = [b]                                   // 自己那筆不算佔用
    render(b)
    act(() => { btn(x => x.textContent.startsWith('後天')).click() })
    expect(saveBtn().textContent).toBe('儲存變更')
    act(() => { saveBtn().click() })
    expect(ctx.updateBooking).toHaveBeenCalledWith('B1', expect.objectContaining({ date: '2026-10-11', timeSlot: '18:00' }))
  })

  it('新日期該時段已滿 → 清空、要求重選', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 9, 9, 9, 0))
    const b = { ...base, source: 'walkin', date: '2026-10-10', timeSlot: '18:00' }
    ctx.bookings = [b, { id: 'X', date: '2026-10-11', timeSlot: '18:00', guests: 4, status: 'confirmed' }]
    render(b)
    act(() => { btn(x => x.textContent.startsWith('後天')).click() })
    expect(saveBtn().textContent).toContain('還差：時段')
  })
})
