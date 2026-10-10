import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'

// 候位取號的電話：iPad 系統鍵盤會整個蓋住 Modal 底部的「取號」鈕 →
// 改用與帶位面板同款的漂浮數字鍵盤（FloatingPhoneKeypad）：欄位 inputMode="none"、點了才浮出。
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const addWaitlist = vi.fn(() => ({ queueNumber: 3, estimatedMin: 10 }))
vi.mock('../../src/contexts/AuthContext', () => ({ useAuth: () => ({ can: () => true }) }))
vi.mock('../../src/contexts/BookingContext', () => ({
  useBooking: () => ({ waitlist: [], skipWaitlist: vi.fn(), returnWaitlist: vi.fn(), addWaitlist, callWaitlist: vi.fn(), leaveWaitlist: vi.fn() }),
}))
vi.mock('../../src/components/ui/Toast', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }), useConfirm: () => vi.fn(async () => true) }))
const WaitlistPanel = (await import('../../src/components/admin/ops/WaitlistPanel')).default

describe('候位取號：電話用漂浮數字鍵盤', () => {
  let container, root
  const click = (el) => act(() => { el.click() })
  const btn = (pred) => [...document.querySelectorAll('button')].find(pred)
  const phone = () => document.querySelector('input[aria-label="電話（選填）"]')
  const keypad = () => document.querySelector('[role="dialog"][aria-label="電話數字鍵盤"]')
  beforeEach(() => {
    vi.clearAllMocks()
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
    act(() => root.render(<WaitlistPanel />))
    click(btn(b => b.textContent.includes('新增取號')))
  })
  afterEach(() => { act(() => root.unmount()); container.remove(); document.body.innerHTML = '' })

  it('電話欄不叫系統鍵盤（inputMode=none）；點了浮出數字鍵盤，按鍵填號，OK 收起，取號帶出電話', () => {
    expect(phone().getAttribute('inputmode')).toBe('none')
    expect(keypad()).toBeNull()
    click(phone())
    expect(keypad()).toBeTruthy()
    for (const d of '0912345678') click([...keypad().querySelectorAll('button')].find(b => b.textContent === d))
    expect(phone().value).toBe('0912345678')
    click([...keypad().querySelectorAll('button')].find(b => b.textContent === 'OK'))
    expect(keypad()).toBeNull()
    // Modal 還開著（點鍵盤不會冒泡關掉取號單），「取號」可按
    click(btn(b => b.textContent.trim() === '取號'))
    expect(addWaitlist).toHaveBeenCalledWith(expect.objectContaining({ phone: '0912345678' }))
  })

  it('點遮罩收起鍵盤，取號單不會被關掉', () => {
    click(phone())
    const backdrop = document.querySelector('.fixed.inset-0.z-\\[70\\]')
    click(backdrop)
    expect(keypad()).toBeNull()
    expect(btn(b => b.textContent.trim() === '取號')).toBeTruthy()
  })
})
