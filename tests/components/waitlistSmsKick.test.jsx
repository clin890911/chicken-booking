import { beforeEach, afterEach, it, expect, vi, describe } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'

// 叫號成功後「不等待」踢簡訊送出端；kick 任何失敗都不影響叫號結果與待確認區。
const state = vi.hoisted(() => ({ owner: 'staff-a', can: () => true }))
vi.mock('../../src/contexts/AuthContext', () => ({ useAuth: () => ({ user: { email: state.owner }, can: state.can, usingFirebase: false }) }))
vi.mock('../../src/contexts/HandoffContext', () => ({ HandoffProvider: ({ children }) => children }))
vi.mock('../../src/components/ui/Toast', () => ({ useToast: () => ({ error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() }) }))
vi.mock('../../src/services/telegramService', () => ({ notifyWaitlistCreated: vi.fn(), notifyWaitlistSeated: vi.fn() }))
import { BookingProvider, useBooking } from '../../src/contexts/BookingContext'
import * as cloud from '../../src/services/cloudDataService'

let root, container, api
const now = new Date().toISOString()
const wait = { id: 'W1', queueNumber: 1, partySize: 2, children: 0, name: '測試', phone: '0912345678', status: 'waiting', takenAt: now, queueVersion: 1 }
function Probe() { api = useBooking(); return <div>{api.waitlist.map(w => w.status).join(',')}</div> }
const mount = async () => { container = document.createElement('div'); document.body.append(container); root = createRoot(container); await act(async () => root.render(<BookingProvider><Probe /></BookingProvider>)) }
const ack = () => ({ ok: true, item: { ...wait, status: 'called', calledAt: now, queueVersion: 2 }, bookings: [], tables: [] })
beforeEach(() => {
  state.owner = 'staff-a'
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('network forbidden') }))
  vi.spyOn(cloud, 'pullCloudData').mockResolvedValue({ waitlist: [wait], bookings: [], tables: [] })
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
})
afterEach(() => { act(() => root?.unmount()); container?.remove(); root = null; vi.unstubAllGlobals() })

describe('callWaitlist → smsKick（fire-and-forget）', () => {
  it('叫號成功後呼叫一次 smsKick(waitlistId)', async () => {
    vi.spyOn(cloud, 'operationalRequest').mockResolvedValue(ack())
    const kick = vi.spyOn(cloud, 'smsKick').mockResolvedValue({ ok: true })
    await mount()
    let result
    await act(async () => { result = await api.callWaitlist('W1') })
    expect(result.ok).toBe(true)
    expect(kick).toHaveBeenCalledTimes(1)
    expect(kick).toHaveBeenCalledWith('W1')
    expect(api.waitlist[0].status).toBe('called')
  })
  it('kick 永不回應也不會卡住叫號（不 await）', async () => {
    vi.spyOn(cloud, 'operationalRequest').mockResolvedValue(ack())
    vi.spyOn(cloud, 'smsKick').mockImplementation(() => new Promise(() => {}))
    await mount()
    let result
    await act(async () => { result = await api.callWaitlist('W1') })
    expect(result.ok).toBe(true)
    expect(api.pendingWaitlistCommands).toHaveLength(0)
  })
  it.each([
    ['reject（404 未部署）', () => Promise.reject(Object.assign(new Error('request-failed-404'), { status: 404 }))],
    ['同步 throw', () => { throw new Error('boom') }],
  ])('kick %s → 叫號結果仍成功、狀態已叫號、無待確認', async (_, impl) => {
    vi.spyOn(cloud, 'operationalRequest').mockResolvedValue(ack())
    vi.spyOn(cloud, 'smsKick').mockImplementation(impl)
    await mount()
    let result
    await act(async () => { result = await api.callWaitlist('W1') })
    expect(result.ok).toBe(true)
    expect(api.waitlist[0].status).toBe('called')
    expect(api.pendingWaitlistCommands).toHaveLength(0)
  })
  it('叫號失敗（未確認）→ 不踢簡訊', async () => {
    vi.spyOn(cloud, 'operationalRequest').mockRejectedValue(new Error('lost ack'))
    const kick = vi.spyOn(cloud, 'smsKick').mockResolvedValue({ ok: true })
    await mount()
    await act(async () => { await api.callWaitlist('W1') })
    expect(kick).not.toHaveBeenCalled()
  })
  it('待確認的叫號重試成功後也會踢一次', async () => {
    const request = vi.spyOn(cloud, 'operationalRequest').mockRejectedValue(new Error('lost ack'))
    const kick = vi.spyOn(cloud, 'smsKick').mockResolvedValue({ ok: true })
    await mount()
    await act(async () => { await api.callWaitlist('W1') })
    request.mockResolvedValue(ack())
    await act(async () => { await api.retryWaitlistCommands() })
    expect(kick).toHaveBeenCalledWith('W1')
  })
  it('其他命令（暫過號、棄號）不踢', async () => {
    vi.spyOn(cloud, 'operationalRequest').mockResolvedValue({ ok: true, item: { ...wait, status: 'left', queueVersion: 2 }, bookings: [], tables: [] })
    const kick = vi.spyOn(cloud, 'smsKick').mockResolvedValue({ ok: true })
    await mount()
    await act(async () => { await api.leaveWaitlist('W1') })
    expect(kick).not.toHaveBeenCalled()
  })
})
