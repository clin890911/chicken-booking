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
