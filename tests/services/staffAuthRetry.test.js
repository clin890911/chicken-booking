import { it, expect, vi, afterEach } from 'vitest'
import { pullCloudData, setAuthTokenProvider } from '../../src/services/cloudDataService'
import { isRetryablePushError } from '../../src/utils/syncStatus'

// iPad 休眠喚醒：ID Token 過期、Wi‑Fi 還沒接上 → 取不到 token。
// 舊行為：照樣送出沒帶 Authorization 的請求 → 401 → 被當成不會好的 4xx、不自動補推，前台一直顯示同步失敗。
afterEach(() => { vi.unstubAllGlobals(); setAuthTokenProvider(null) })

const ok = (body) => ({ ok: true, status: 200, json: async () => body })
const unauthorized = (code) => ({ ok: false, status: 401, json: async () => ({ ok: false, error: code }) })

it('取不到 token：不送請求，丟出可自動補推的錯誤（沒有 HTTP status）', async () => {
  const fetch = vi.fn()
  vi.stubGlobal('fetch', fetch)
  setAuthTokenProvider(async () => null)
  const err = await pullCloudData().catch(e => e)
  expect(fetch).not.toHaveBeenCalled()
  expect(err.code).toBe('auth-token-unavailable')
  expect(isRetryablePushError(err)).toBe(true)
})

it('token 換發拋錯也一樣視為暫時性錯誤', async () => {
  vi.stubGlobal('fetch', vi.fn())
  setAuthTokenProvider(async () => { throw new Error('auth/network-request-failed') })
  await expect(pullCloudData()).rejects.toMatchObject({ code: 'auth-token-unavailable' })
})

it('後端回 401 invalid-auth-token：強制換新 token 重送一次就成功', async () => {
  const provider = vi.fn(async (force) => (force ? 'fresh' : 'stale'))
  setAuthTokenProvider(provider)
  const fetch = vi.fn(async (url, opts) => (opts.headers.Authorization === 'Bearer fresh' ? ok({ ok: true, bookings: [] }) : unauthorized('invalid-auth-token')))
  vi.stubGlobal('fetch', fetch)
  await expect(pullCloudData()).resolves.toMatchObject({ ok: true })
  expect(fetch).toHaveBeenCalledTimes(2)
  expect(provider).toHaveBeenLastCalledWith(true)
})

it('非 token 類的 401／403 不重送', async () => {
  setAuthTokenProvider(async () => 't')
  const fetch = vi.fn(async () => ({ ok: false, status: 403, json: async () => ({ ok: false, error: 'not-authorized' }) }))
  vi.stubGlobal('fetch', fetch)
  await expect(pullCloudData()).rejects.toMatchObject({ status: 403 })
  expect(fetch).toHaveBeenCalledTimes(1)
})
