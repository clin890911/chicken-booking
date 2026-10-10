import { describe, it, expect, vi, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'

// A2／A3：現場直接改單
//   - 已入座（arrived）只開放人數＋備註；送出的 patch 不含日期／時段／電話／姓名／來源
//   - 待到訂位只改人數：坐得下預告「桌位保留」、坐不下預告「會解除」；存檔後依 service 回傳據實提示

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const toast = { success: vi.fn(), info: vi.fn(), error: vi.fn() }
const ctx = {
  settings: { openTime: '11:00', closeTime: '21:00', slotInterval: 30 },
  tables: [{ number: '105', capacity: 6, isActive: true, floor: '1F', status: 'reserved', currentBookingId: 'B1' }],
  bookings: [], groupReservations: [],
  updateBooking: vi.fn(),
}
vi.mock('../../src/contexts/BookingContext', () => ({ useBooking: () => ctx }))
vi.mock('../../src/components/ui/Toast', () => ({ useToast: () => toast }))

const EditBookingModal = (await import('../../src/components/booking/EditBookingModal')).default

const base = { id: 'B1', name: '余先生', phone: '0912345678', guests: 4, date: '2099-12-31', timeSlot: '11:00', source: 'phone', notes: {}, status: 'confirmed', assignedTableId: '105', extraTableIds: [] }

let container, root
const render = (booking) => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => { root.render(<EditBookingModal booking={booking} onClose={() => {}} />) })
}
const btn = (pred) => [...document.querySelectorAll('button')].find(pred)
const saveBtn = () => btn(b => /儲存變更|還差/.test(b.textContent))
const note = () => document.querySelector('[data-testid="edit-table-note"]')?.textContent || ''
afterEach(() => { act(() => root?.unmount()); container?.remove(); vi.clearAllMocks() })

describe('EditBookingModal：已入座只改人數＋備註', () => {
  it('不顯示日期／時段／電話欄；patch 只有人數與備註', () => {
    render({ ...base, status: 'arrived' })
    expect(document.body.textContent).toContain('改人數／備註')
    expect(document.body.textContent).not.toContain('時段（')
    expect(document.querySelector('input[type="tel"]')).toBeNull()
    expect(btn(b => b.textContent === '今天')).toBeUndefined()
    ctx.updateBooking.mockReturnValue({ ...base, status: 'arrived', guests: 9 })
    act(() => { btn(b => b.getAttribute('aria-label') === '8 位')?.click() })
    act(() => { saveBtn().click() })
    const patch = ctx.updateBooking.mock.calls[0][1]
    expect(patch.guests).toBe(8)
    expect(patch).toHaveProperty('notes')
    ;['date', 'timeSlot', 'phone', 'name', 'source'].forEach(k => expect(patch).not.toHaveProperty(k))
  })

  it('人數超過擠一擠上限 → 黃字提示桌位不變', () => {
    render({ ...base, status: 'arrived' })
    act(() => { btn(b => b.getAttribute('aria-label') === '8 位')?.click() })
    expect(note()).toContain('最多 7 位')
    expect(note()).toContain('桌位不變')
  })
})

describe('EditBookingModal：只改人數的桌位預告', () => {
  it('坐得下 → 「坐得下，桌位保留」；存檔後桌仍在 → 一般成功訊息', () => {
    render(base)
    act(() => { btn(b => b.getAttribute('aria-label') === '6 位')?.click() })
    expect(note()).toContain('坐得下，桌位保留')
    ctx.updateBooking.mockReturnValue({ ...base, guests: 6 })
    act(() => { saveBtn().click() })
    expect(toast.success).toHaveBeenCalled()
    expect(toast.info).not.toHaveBeenCalled()
  })

  it('坐不下 → 預告會解除；存檔後桌被解除 → 明確提示「已解除桌位，請重新指派」', () => {
    render(base)
    act(() => { btn(b => b.getAttribute('aria-label') === '8 位')?.click() })
    expect(note()).toContain('會解除桌位')
    ctx.updateBooking.mockReturnValue({ ...base, guests: 8, assignedTableId: null })
    act(() => { saveBtn().click() })
    expect(toast.info.mock.calls[0][0]).toContain('已解除桌位 105，請重新指派')
  })
})
