import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act, useState } from 'react'
import PartySizeField from '../../src/components/admin/PartySizeField'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const addWaitlist = vi.fn(() => ({ queueNumber: 3, estimatedMin: 10 }))
vi.mock('../../src/contexts/AuthContext', () => ({ useAuth: () => ({ can: () => true }) }))
vi.mock('../../src/contexts/BookingContext', () => ({
  useBooking: () => ({
    waitlist: [
      { id: 'w1', queueNumber: 1, status: 'waiting', name: '王先生', phone: '0912345678', partySize: 5, adults: 3, children: 2, takenAt: new Date().toISOString() },
      { id: 'w2', queueNumber: 2, status: 'waiting', name: '林小姐', phone: '', partySize: 2, takenAt: new Date().toISOString() },
      { id: 'w3', queueNumber: 3, status: 'skipped', name: '陳先生', phone: '0223456789', partySize: 4, takenAt: new Date().toISOString() },
    ],
    skipWaitlist: vi.fn(), returnWaitlist: vi.fn(), addWaitlist, callWaitlist: vi.fn(), leaveWaitlist: vi.fn(),
  }),
}))
vi.mock('../../src/components/ui/Toast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }),
  useConfirm: () => vi.fn(async () => true),
}))
const WaitlistPanel = (await import('../../src/components/admin/ops/WaitlistPanel')).default

let container, root
const click = (el) => act(() => { el.click() })
const btn = (pred, scope = document) => [...scope.querySelectorAll('button')].find(pred)
beforeEach(() => {
  vi.clearAllMocks()
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
})
afterEach(() => { act(() => root.unmount()); container.remove(); document.body.innerHTML = '' })

function Harness({ onChange, initial = 2, size }) {
  const [total, setTotal] = useState(initial)
  const [kids, setKids] = useState(0)
  return <PartySizeField total={total} kids={kids} size={size}
    onChange={(t, c) => { setTotal(t); setKids(c); onChange?.(t, c) }} />
}

describe('PartySizeField 大人＋小孩', () => {
  it('預設小孩 0、不顯示「共 N 位」；大人 chips aria-label 維持「N 位」', () => {
    act(() => root.render(<Harness />))
    expect(container.querySelector('input[aria-label="小孩人數"]').value).toBe('0')
    expect(container.querySelector('[data-testid="party-total"]')).toBeNull()
    expect(btn(b => b.getAttribute('aria-label') === '2 位', container).getAttribute('aria-pressed')).toBe('true')
    expect(container.textContent).toContain('大人')
  })

  it('加小孩：總數＝大人＋小孩，顯示「共 N 位」；減到 0 不可再減', () => {
    const onChange = vi.fn()
    act(() => root.render(<Harness onChange={onChange} />))
    click(btn(b => b.getAttribute('aria-label') === '3 位', container))
    expect(onChange).toHaveBeenLastCalledWith(3, 0)
    const plus = btn(b => b.getAttribute('aria-label') === '小孩人數 加 1', container)
    click(plus); click(plus)
    expect(onChange).toHaveBeenLastCalledWith(5, 2)
    expect(container.querySelector('[data-testid="party-total"]').textContent).toBe('共 5 位')
    // 大人仍選在 3（小孩不吃掉大人）
    expect(btn(b => b.getAttribute('aria-label') === '3 位', container).getAttribute('aria-pressed')).toBe('true')
    const minus = btn(b => b.getAttribute('aria-label') === '小孩人數 減 1', container)
    click(minus); click(minus)
    expect(onChange).toHaveBeenLastCalledWith(3, 0)
    expect(minus.disabled).toBe(true)
  })

  it('小孩步進器按鈕 ≥44px（w-11 h-11），lg 版也有', () => {
    act(() => root.render(<Harness size="lg" />))
    const plus = btn(b => b.getAttribute('aria-label') === '小孩人數 加 1', container)
    expect(plus.className).toContain('w-11')
    expect(plus.className).toContain('h-11')
  })
})

describe('WaitlistPanel 大人／小孩＋完整電話', () => {
  it('取號存 partySize＝大人＋小孩，並帶 children', () => {
    act(() => root.render(<WaitlistPanel />))
    click(btn(b => b.textContent.includes('新增取號')))
    const modal = document.body
    click(btn(b => b.getAttribute('aria-label') === '4 位', modal))
    click(btn(b => b.getAttribute('aria-label') === '小孩人數 加 1', modal))
    click(btn(b => b.textContent.trim() === '取號', modal))
    expect(addWaitlist).toHaveBeenCalledTimes(1)
    expect(addWaitlist.mock.calls[0][0]).toMatchObject({ partySize: 5, children: 1 })
  })

  it('只選大人：children 為 0（service 不會寫拆分欄位）', () => {
    act(() => root.render(<WaitlistPanel />))
    click(btn(b => b.textContent.includes('新增取號')))
    click(btn(b => b.getAttribute('aria-label') === '3 位', document.body))
    click(btn(b => b.textContent.trim() === '取號', document.body))
    expect(addWaitlist.mock.calls[0][0]).toMatchObject({ partySize: 3, children: 0 })
  })

  it('候位卡與暫過號區顯示完整電話與拆分；無電話不顯示', () => {
    act(() => root.render(<WaitlistPanel />))
    const phones = [...container.querySelectorAll('[data-testid="phone-full"]')].map(a => a.textContent)
    expect(phones).toEqual(['0912-345-678', '02-2345-6789'])
    expect(container.textContent).toContain('5 位（大3・小2）')
  })
})
