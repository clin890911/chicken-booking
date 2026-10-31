import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { normalizeTwMobile, waitlistPhoneHint, waitlistSmsBadge, smsLooksActive } from '../../src/utils/waitlistSms'
import { normalizeTwMobile as backendNormalize } from '../../functions/lib/smsPhone.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const today = new Date().toISOString()
const state = vi.hoisted(() => ({ waitlist: [] }))
const addWaitlist = vi.fn(async () => ({ ok: true, item: { queueNumber: 3, estimatedMin: 10 } }))
vi.mock('../../src/contexts/AuthContext', () => ({ useAuth: () => ({ can: () => true }) }))
vi.mock('../../src/contexts/BookingContext', () => ({
  useBooking: () => ({ waitlist: state.waitlist, skipWaitlist: vi.fn(), returnWaitlist: vi.fn(), addWaitlist, callWaitlist: vi.fn(), leaveWaitlist: vi.fn() }),
}))
vi.mock('../../src/components/ui/Toast', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }), useConfirm: () => vi.fn(async () => true) }))
const WaitlistPanel = (await import('../../src/components/admin/ops/WaitlistPanel')).default

describe('前端手機判斷與後端同口徑', () => {
  it.each(['0912345678', '0912-345-678', '+886 912 345 678', '886912345678', '0492753377', '', '091234', 'abc'])('%s', v => {
    expect(normalizeTwMobile(v)).toBe(backendNormalize(v))
  })
})

describe('取號表單電話提示', () => {
  it('市話或非 09 → 提示不會發簡訊；09 開頭輸入中或完整手機 → 不提示', () => {
    expect(waitlistPhoneHint('0492753377')).toMatch(/不會發簡訊/)
    expect(waitlistPhoneHint('12345')).toMatch(/不會發簡訊/)
    for (const v of ['', '0', '09', '0912', '0912345678']) expect(waitlistPhoneHint(v)).toBeNull()
  })
})

describe('候位卡簡訊徽章', () => {
  const called = (extra = {}) => ({ id: 'W', status: 'called', calledAt: today, phone: '0912345678', ...extra })
  it.each([
    ['sent', '簡訊已送出', 'ok'],
    ['dry-run', '簡訊乾跑（未實送）', 'neutral'],
    ['retrying', '簡訊發送中', 'neutral'],
    ['failed', '簡訊失敗・請打電話', 'bad'],
    ['skipped-unconfigured', '簡訊失敗・請打電話', 'bad'],
    ['unknown', '簡訊狀態不明・請打電話', 'bad'],
  ])('%s → %s', (stateName, label, tone) => {
    expect(waitlistSmsBadge(called({ smsStatus: { state: stateName, calledAt: today } }))).toEqual({ label, tone })
  })
  it('開關關閉（skipped-disabled）／已過時 → 不顯示', () => {
    expect(waitlistSmsBadge(called({ smsStatus: { state: 'skipped-disabled', calledAt: today } }), { smsActive: true })).toBeNull()
    expect(waitlistSmsBadge(called({ smsStatus: { state: 'superseded', calledAt: today } }))).toBeNull()
  })
  it('沒有運作證據時，無手機不顯示；有證據時顯示「無手機・請喊號」', () => {
    expect(waitlistSmsBadge(called({ phone: '' }))).toBeNull()
    expect(waitlistSmsBadge(called({ phone: '0492753377' }), { smsActive: true })).toEqual({ label: '無手機・請喊號', tone: 'neutral' })
  })
  it('上一次叫號留下的舊狀態不算；未叫號不顯示', () => {
    expect(waitlistSmsBadge(called({ smsStatus: { state: 'failed', calledAt: '2026-01-01T00:00:00.000Z' } }))).toBeNull()
    expect(waitlistSmsBadge({ status: 'waiting', smsStatus: { state: 'sent' } })).toBeNull()
  })
  it('smsLooksActive：skipped-disabled 不算運作證據', () => {
    expect(smsLooksActive([{ smsStatus: { state: 'skipped-disabled' } }])).toBe(false)
    expect(smsLooksActive([{ smsStatus: { state: 'dry-run' } }])).toBe(true)
  })
})

describe('WaitlistPanel 畫面', () => {
  let container, root
  beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container) })
  afterEach(() => { act(() => root.unmount()); container.remove(); document.body.innerHTML = ''; state.waitlist = [] })
  const base = { takenAt: today, queueVersion: 2, partySize: 2, children: 0, name: '王先生' }

  it('已叫號卡片顯示簡訊狀態；開關關閉的卡片不顯示', () => {
    state.waitlist = [
      { ...base, id: 'A', queueNumber: 1, status: 'called', calledAt: today, phone: '0912345678', smsStatus: { state: 'failed', calledAt: today } },
      { ...base, id: 'B', queueNumber: 2, status: 'called', calledAt: today, phone: '0912000111', smsStatus: { state: 'skipped-disabled', calledAt: today } },
    ]
    act(() => root.render(<WaitlistPanel />))
    const badges = [...document.querySelectorAll('[data-sms-badge]')]
    expect(badges.map(b => b.textContent)).toEqual(['簡訊失敗・請打電話'])
  })
  it('電話欄改為「手機（叫號簡訊用，選填）」；輸入市話顯示提示，但仍可取號', async () => {
    act(() => root.render(<WaitlistPanel />))
    act(() => { [...document.querySelectorAll('button')].find(b => b.textContent.includes('新增取號')).click() })
    expect(document.body.textContent).toContain('手機（叫號簡訊用，選填）')
    const input = document.querySelector('input[aria-label="手機（叫號簡訊用，選填）"]')
    expect(input).toBeTruthy()
    act(() => { input.click() })
    const keypad = document.querySelector('[role="dialog"][aria-label="電話數字鍵盤"]')
    for (const d of '0492753377') act(() => { [...keypad.querySelectorAll('button')].find(b => b.textContent === d).click() })
    expect(document.getElementById('waitlist-phone-hint')?.textContent).toMatch(/不會發簡訊/)
    act(() => { [...keypad.querySelectorAll('button')].find(b => b.textContent === 'OK').click() })
    await act(async () => { [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '取號').click() })
    expect(addWaitlist).toHaveBeenCalledWith(expect.objectContaining({ phone: '0492753377' }))
  })
})
