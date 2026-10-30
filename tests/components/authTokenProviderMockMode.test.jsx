import { it, expect, vi, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'

// #168 之後 cloudDataService.staffRequest 的規則：「有 token 提供者但取不到 token」＝暫時性錯誤，
// 不送請求、等自動補推；「沒有提供者」＝不需驗證的模式，照舊不帶 Authorization 送出。
//
// 本機模擬登入（沒有 Firebase 設定，E2E 全套都跑在這個模式）時 getIdToken 永遠回 null。
// AuthContext 若照樣把它當 getToken 注入，staffRequest 會把「永遠取不到」誤判成「暫時取不到」
// → adminPullData／adminPushData 一律不送、無限補推。實際後果：persist-degraded-alert
// 這支 E2E 的觸發前提（首拉成功 → applyCloudSnapshot → persistSyncState）永遠走不到，
// 「同步基準線寫不進本機」的警示在測試裡完全無從驗證。

const fb = vi.hoisted(() => ({ configured: false, getIdToken: async () => null }))
vi.mock('../../src/services/firebase', () => ({
  auth: null,
  googleProvider: null,
  get isFirebaseConfigured() { return fb.configured },
  authOnSameOrigin: false,
  signInWithPopup: vi.fn(),
  signInWithRedirect: vi.fn(),
  getRedirectResult: vi.fn(async () => null),
  signOut: vi.fn(),
  onAuthStateChanged: vi.fn(() => () => {}),
  getIdToken: (...args) => fb.getIdToken(...args),
}))

globalThis.IS_REACT_ACT_ENVIRONMENT = true
afterEach(() => { vi.resetModules(); vi.unstubAllGlobals() })

async function renderGetToken() {
  const { AuthProvider, useAuth } = await import('../../src/contexts/AuthContext')
  let captured
  function Probe() { captured = useAuth().getToken; return null }
  const el = document.createElement('div')
  const root = createRoot(el)
  await act(async () => { root.render(<AuthProvider><Probe /></AuthProvider>) })
  act(() => root.unmount())
  return captured
}

it('本機模擬登入（無 Firebase）：不提供 token 提供者', async () => {
  fb.configured = false
  expect(await renderGetToken()).toBeNull()
})

it('正式模式（有 Firebase）：照常提供 getIdToken', async () => {
  fb.configured = true
  const getToken = await renderGetToken()
  expect(typeof getToken).toBe('function')
  fb.getIdToken = async () => 'tok'
  expect(await getToken()).toBe('tok')
})

it('沒有提供者時，員工端點照舊送出（不帶 Authorization）', async () => {
  const { pullCloudData, setAuthTokenProvider } = await import('../../src/services/cloudDataService')
  setAuthTokenProvider(null)
  const fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) }))
  vi.stubGlobal('fetch', fetch)
  await expect(pullCloudData()).resolves.toMatchObject({ ok: true })
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(fetch.mock.calls[0][1].headers?.Authorization).toBeUndefined()
})
