import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { saveGuestDraft, prepareGuestDraft, loadGuestDraft } from '../../src/utils/guestDraft'
import { getSettings } from '../../src/services/settingsService'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const mocks = vi.hoisted(() => ({ create: vi.fn(), available: vi.fn(), navigate: vi.fn(), getBooking: vi.fn(), authorize: vi.fn(), location: {}, id: 'FAKE' }))
vi.mock('react-router-dom', () => ({ useNavigate: () => mocks.navigate, useParams: () => ({ id: mocks.id }), useLocation: () => mocks.location, useSearchParams: () => [new URLSearchParams(), vi.fn()], Link: ({ to, children, ...props }) => <a href={to} {...props}>{children}</a> }))
vi.mock('../../src/services/cloudDataService', () => ({ guestCreateBooking: mocks.create, guestGetAvailability: mocks.available, guestGetBooking: mocks.getBooking }))
vi.mock('../../src/contexts/BookingContext', () => ({ useBooking: () => ({ settings: getSettings() }) }))
vi.mock('../../src/hooks/useLiffIdentity', () => ({ useLiffIdentity: () => null }))
vi.mock('../../src/hooks/useLineAuthorizeUrl', () => ({ useLineAuthorizeUrl: (...args) => { mocks.authorize(...args); return '' } }))
const BookingPage = (await import('../../src/pages/BookingPage')).default
const ConfirmPage = (await import('../../src/pages/ConfirmPage')).default
const payload = { name: '訪客', phone: '0912345678', guests: 2, date: '2026-10-06', timeSlot: '11:00', notes: {} }
const booking = { ...payload, id: 'FAKE', manageToken: 'FAKE_MANAGE', status: 'confirmed' }
const flush = () => new Promise(r => setTimeout(r, 0))
let root, el
const buttons = text => [...el.querySelectorAll('button')].filter(b => b.textContent.includes(text))
const mount = async Component => { await act(async () => { root.render(<Component />); await flush() }) }
beforeEach(() => {
  vi.clearAllMocks(); sessionStorage.clear(); localStorage.clear()
  mocks.available.mockResolvedValue({ ok: true, slots: [], settings: { lineLoginReady: false } })
  mocks.location = {}; window.scrollTo = vi.fn()
  el = document.createElement('div'); document.body.appendChild(el); root = createRoot(el)
})
afterEach(() => { act(() => root.unmount()); el.remove() })
describe('mounted guest booking recovery', () => {
  it('lost response keeps the key and retry retrieves the original booking then clears draft', async () => {
    const draft = saveGuestDraft(prepareGuestDraft(payload, null, 'pending'))
    mocks.create.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce({ ok: true, booking, store: { lineLoginReady: false }, recovered: true })
    await mount(BookingPage)
    await act(async () => { buttons('確認同一筆訂位')[0].click(); await flush() })
    expect(loadGuestDraft().submissionKey).toBe(draft.submissionKey)
    expect(el.querySelector('input').disabled).toBe(true)
    await act(async () => { buttons('確認同一筆訂位')[0].click(); await flush() })
    expect(mocks.create.mock.calls.map(([body]) => body.submissionKey)).toEqual([draft.submissionKey, draft.submissionKey])
    expect(loadGuestDraft()).toBeNull()
    expect(mocks.navigate).toHaveBeenCalledWith('/confirm/FAKE?token=FAKE_MANAGE', expect.objectContaining({ state: expect.objectContaining({ booking }) }))
    expect(JSON.stringify(mocks.navigate.mock.calls)).not.toContain(draft.submissionKey)
  })
  it('two submit buttons in the same event cannot issue two POSTs or modify intent in flight', async () => {
    saveGuestDraft(prepareGuestDraft(payload, null, 'pending'))
    let finish; mocks.create.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    await mount(BookingPage)
    act(() => { const [a,b] = buttons('確認同一筆訂位'); a.click(); b.click() })
    expect(mocks.create).toHaveBeenCalledTimes(1)
    expect(el.querySelector('input').disabled).toBe(true)
    await act(async () => { finish({ ok: true, booking, store: { lineLoginReady: false } }); await flush() })
  })
  it('server-confirmed pre-write rejection unlocks editing but preserves the key until intent changes', async () => {
    const draft=saveGuestDraft(prepareGuestDraft(payload,null,'pending'))
    mocks.create.mockRejectedValue(Object.assign(new Error('時段已截止'), { status:400, bookingOutcome:'not-created' }))
    await mount(BookingPage)
    await act(async()=>{ buttons('確認同一筆訂位')[0].click(); await flush() })
    expect(loadGuestDraft().phase).toBe('editing')
    expect(loadGuestDraft().submissionKey).toBe(draft.submissionKey)
    expect(el.querySelector('input').disabled).toBe(false)
  })
  it('explicit server deadline rejection refreshes slots and clears only the invalid selection', async () => {
    saveGuestDraft(prepareGuestDraft(payload,null,'pending'))
    mocks.available.mockResolvedValueOnce({ok:true,slots:[{time:'11:00',remaining:10}],settings:{}}).mockResolvedValueOnce({ok:true,slots:[{time:'11:30',remaining:10}],settings:{}})
    mocks.create.mockRejectedValue(Object.assign(new Error('deadline'),{status:400,bookingOutcome:'not-created',reasonCode:'booking-deadline-passed'}))
    await mount(BookingPage)
    await act(async()=>{buttons('確認同一筆訂位')[0].click();await flush()})
    expect(mocks.available).toHaveBeenCalledTimes(2)
    expect(loadGuestDraft().payload).toEqual({...prepareGuestDraft(payload,null).payload,timeSlot:''})
    expect(el.textContent).toContain('請選擇較晚時段')
    expect(el.textContent).toContain('11:30')
    expect(buttons('填寫聯絡資訊')).toHaveLength(0)
    act(()=>buttons('11:30')[0].click())
    expect(el.textContent).not.toContain('請選擇較晚時段')
    expect(loadGuestDraft().payload.timeSlot).toBe('11:30')
  })
  it('unrelated input rejection does not refresh or remove the selected time', async () => {
    saveGuestDraft(prepareGuestDraft(payload,null,'pending'))
    mocks.create.mockRejectedValue(Object.assign(new Error('電話格式不正確'),{status:400,bookingOutcome:'not-created',reasonCode:'invalid-phone'}))
    await mount(BookingPage)
    await act(async()=>{buttons('確認同一筆訂位')[0].click();await flush()})
    expect(mocks.available).toHaveBeenCalledTimes(1)
    expect(loadGuestDraft().payload.timeSlot).toBe('11:00')
    expect(el.querySelector('input').disabled).toBe(false)
  })
  it('payload conflict never unlocks an uncertain original receipt', async () => {
    saveGuestDraft(prepareGuestDraft(payload,null,'pending'))
    mocks.create.mockRejectedValue(Object.assign(new Error('submission-payload-conflict'),{status:409}))
    await mount(BookingPage)
    await act(async()=>{buttons('確認同一筆訂位')[0].click();await flush()})
    expect(loadGuestDraft().phase).toBe('unknown')
    expect(el.querySelector('input').disabled).toBe(true)
  })
  it('storage failure before retry cannot unlock or discard an already uncertain intent', async () => {
    const draft=saveGuestDraft(prepareGuestDraft(payload,null,'unknown'))
    await mount(BookingPage)
    const deny=vi.spyOn(Object.getPrototypeOf(window.sessionStorage),'setItem').mockImplementation(()=>{throw new Error('storage-denied')})
    await act(async()=>{buttons('確認同一筆訂位')[0].click();await flush()})
    expect(mocks.create).not.toHaveBeenCalled()
    expect(el.querySelector('input').disabled).toBe(true)
    expect(loadGuestDraft().submissionKey).toBe(draft.submissionKey)
    deny.mockRestore()
  })
  it('a 503 response preserves the submitted intent and key for a safe retry', async () => {
    const draft=saveGuestDraft(prepareGuestDraft(payload,null,'pending'))
    mocks.create.mockRejectedValue(Object.assign(new Error('server-unavailable'),{status:503}))
    await mount(BookingPage)
    await act(async()=>{buttons('確認同一筆訂位')[0].click();await flush()})
    expect(loadGuestDraft()).toEqual({...draft,phase:'unknown'})
  })
  it('confirmation uses server readiness and does not promise LINE delivery when unopened', async () => {
    mocks.location = { state: { booking, store: { lineLoginReady: false } } }
    await mount(ConfirmPage)
    expect(el.textContent).toContain('訂位已成立，LINE通知尚未開通')
    expect(el.textContent).not.toContain('加入並綁定 LINE 通知')
    expect(el.textContent).not.toContain('或綁定下方 LINE 通知')
    expect(el.textContent).toContain('請保存此頁或管理連結')
    expect(mocks.authorize.mock.calls.every(args => args[2] === false)).toBe(true)
  })
  it('recovered cancelled booking shows current state instead of a new success', async () => {
    mocks.location = { state: { booking: { ...booking, status:'cancelled' }, store: { lineLoginReady:false } } }
    await mount(ConfirmPage)
    expect(el.textContent).toContain('訂位已取消')
    expect(el.textContent).not.toContain('訂位成功！')
  })
})
