import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import GuestCountField from '../../src/components/admin/GuestCountField'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const addWaitlist = vi.fn(() => ({ queueNumber: 7, estimatedMin: 10 }))
const toast = { success: vi.fn(), error: vi.fn(), warning: vi.fn() }
vi.mock('../../src/contexts/AuthContext', () => ({ useAuth: () => ({ can: () => true }) }))
vi.mock('../../src/contexts/BookingContext', () => ({
  useBooking: () => ({ waitlist: [], skipWaitlist: vi.fn(), returnWaitlist: vi.fn(), addWaitlist, callWaitlist: vi.fn(), leaveWaitlist: vi.fn() }),
}))
vi.mock('../../src/components/ui/Toast', () => ({ useToast: () => toast, useConfirm: () => vi.fn(async () => true) }))
const WaitlistPanel = (await import('../../src/components/admin/ops/WaitlistPanel')).default

describe('候位大組人數', () => {
  let container, root
  const click = (el) => act(() => { el.click() })
  const btn = (pred, scope = document) => [...scope.querySelectorAll('button')].find(pred)
  const typeCustom = (value) => {
    const input = document.querySelector('input[aria-label="自訂人數"]')
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }
  beforeEach(() => {
    vi.clearAllMocks()
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
    act(() => root.render(<WaitlistPanel />))
    click(btn(b => b.textContent.includes('新增取號')))
  })
  afterEach(() => { act(() => root.unmount()); container.remove(); document.body.innerHTML = '' })

  it('輸入 20 位不再被夾成 12，存進候位的是 20，並顯示「大組，入座時需併桌」', () => {
    click(btn(b => b.textContent.includes('9+')))
    typeCustom('20')
    expect(document.querySelector('input[aria-label="自訂人數"]').value).toBe('20')
    expect(document.body.textContent).toContain('大組，入座時需併桌')
    click(btn(b => b.textContent.trim() === '取號'))
    expect(addWaitlist).toHaveBeenCalledTimes(1)
    expect(addWaitlist.mock.calls[0][0].partySize).toBe(20)
  })

  it('12 位以內不顯示大組提示', () => {
    click(btn(b => b.textContent.includes('9+')))
    typeCustom('12')
    expect(document.body.textContent).not.toContain('大組，入座時需併桌')
    click(btn(b => b.getAttribute('aria-label') === '4 位'))
    expect(document.body.textContent).not.toContain('大組，入座時需併桌')
  })
})

describe('GuestCountField 不變量（候位放寬後仍須成立）', () => {
  it('chips aria-label 維持「N 位」；預設 max 仍是 200；明確傳 max=12 的呼叫端（線上訂位等）仍是 12', () => {
    const html = renderToStaticMarkup(<GuestCountField value={2} onChange={() => {}} />)
    for (let n = 1; n <= 8; n++) expect(html).toContain(`aria-label="${n} 位"`)
    expect(renderToStaticMarkup(<GuestCountField value={10} onChange={() => {}} />)).toContain('max="200"')
    expect(renderToStaticMarkup(<GuestCountField value={10} max={12} onChange={() => {}} />)).toContain('max="12"')
  })
})
