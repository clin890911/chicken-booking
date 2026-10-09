import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { todayStr } from '../../src/utils/timeSlots'

const now = new Date().toISOString()
const waitlist = [
  { id: 'a', queueNumber: 1, name: '王先生', phone: '0912345678', partySize: 2, status: 'waiting', takenAt: now, date: todayStr() },
  { id: 'b', queueNumber: 2, name: '陳小姐', phone: '0987654321', partySize: 4, status: 'skipped', takenAt: now, date: todayStr() },
  { id: 'c', queueNumber: 3, name: '', phone: '', partySize: 3, status: 'waiting', takenAt: now, date: todayStr() },
]
vi.mock('../../src/contexts/AuthContext', () => ({ useAuth: () => ({ can: () => true }) }))
vi.mock('../../src/contexts/BookingContext', () => ({
  useBooking: () => ({ waitlist, skipWaitlist: vi.fn(), returnWaitlist: vi.fn(), addWaitlist: vi.fn(), callWaitlist: vi.fn(), leaveWaitlist: vi.fn() }),
}))
vi.mock('../../src/components/ui/Toast', () => ({ useToast: () => ({}), useConfirm: () => vi.fn() }))
const WaitlistPanel = (await import('../../src/components/admin/ops/WaitlistPanel')).default

describe('候位名單顯示客人電話', () => {
  it('候位中與暫過號都顯示可撥打的電話；沒留電話的不顯示', () => {
    const html = renderToStaticMarkup(<WaitlistPanel />)
    expect(html).toContain('href="tel:0912345678"')
    expect(html).toContain('0912345678')
    expect(html).toContain('href="tel:0987654321"')
    expect(html.match(/href="tel:/g)).toHaveLength(2)
  })
})
