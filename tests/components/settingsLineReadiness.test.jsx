import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
vi.mock('react-router-dom', async () => {
  const { useState } = await import('react')
  return { useSearchParams: () => useState(() => new URLSearchParams()) }
})
vi.mock('../../src/components/admin/TableGrid', () => ({ default: () => null }))
vi.mock('../../src/components/admin/LayoutEditor', () => ({ default: () => null }))
vi.mock('../../src/components/admin/TelegramSettings', () => ({ default: () => null }))
vi.mock('../../src/components/admin/StaffAdminSection', () => ({ default: () => null }))
vi.mock('../../src/components/admin/ExportCenter', () => ({ default: () => null }))
let ctx, toast, permit
vi.mock('../../src/contexts/BookingContext', () => ({ useBooking: () => ctx }))
vi.mock('../../src/contexts/AuthContext', () => ({ useAuth: () => ({ can: () => permit, user: {}, signOut: vi.fn() }) }))
vi.mock('../../src/components/ui/Toast', () => ({ useToast: () => toast, useConfirm: () => vi.fn(async () => true) }))
const SettingsView = (await import('../../src/components/admin/SettingsView')).default
const { getSettings } = await import('../../src/services/settingsService')
const complete = {
  lineLoginChannelId: '1234567890',
  lineLoginStartEndpoint: 'https://lineloginstart-reaor76eyq-uc.a.run.app',
  lineLoginCallbackUrl: 'https://linelogincallback-reaor76eyq-uc.a.run.app',
  publicSiteUrl: 'https://chicken-booking.zeabur.app',
}

describe('LINE settings validation and read-only permissions', () => {
  let root, container
  const button = text => [...container.querySelectorAll('button')].find(b => b.textContent.includes(text))
  const mount = (patch = {}) => {
    ctx.settings = { ...getSettings(), ...patch }
    act(() => root.render(<SettingsView />))
  }
  beforeEach(() => {
    permit = true
    toast = { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }
    ctx = { settings: {}, bookings: [], updateSettings: vi.fn(), flushCloudNow: vi.fn(), cloudStatus: { state: 'synced' } }
    container = document.createElement('div'); document.body.appendChild(container)
    root = createRoot(container)
  })
  afterEach(() => { act(() => root.unmount()); container.remove() })
  it('official friend link alone cannot produce a passed Login configuration check', () => {
    mount({ lineUseLiff: false, lineLoginChannelId: '', lineLoginCallbackUrl: '', publicSiteUrl: '' })
    act(() => button('通知與 LINE').click())
    act(() => button('驗證設定').click())
    expect(toast.success).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('LINE Login Channel ID'))
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('訂位網站網址'))
  })
  it('valid fields report format readiness while retaining the real-account delivery requirement', () => {
    mount(complete)
    act(() => button('通知與 LINE').click())
    act(() => button('驗證設定').click())
    expect(toast.error).not.toHaveBeenCalled()
    expect(toast.success).toHaveBeenCalledWith(expect.stringContaining('仍需確認 LINE Console'))
    expect(toast.success).toHaveBeenCalledWith(expect.stringContaining('本人帳號'))
  })
  it('kitchen cannot save changed settings; the effective arrival cutoff stays 60 minutes', () => {
    permit = false; mount({ onlineSessionCutoffMin: 120 })
    ctx.settings = { ...ctx.settings, storeName: 'changed remotely' }
    act(() => root.render(<SettingsView />))
    expect(button('儲存全部變更')).toBeUndefined()
    expect(ctx.updateSettings).not.toHaveBeenCalled()
    act(() => button('線上訂位').click())
    expect(container.textContent).toContain('至少提前 60 分鐘')
    expect(container.textContent).not.toContain('場次前 120 分停訂')
  })
})
