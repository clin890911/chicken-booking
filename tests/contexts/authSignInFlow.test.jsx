import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'

// 2026-10 店主：iPhone／主畫面 App 按「使用 Google 登入」永遠卡在「登入中…」。
// 彈窗結果回不來（App 的彈窗跳去 Safari；跨網域的 firebaseapp.com 在 iOS 被隔離）。
// 修法：正式網域自架登入輔助頁（authOnSameOrigin），主畫面 App 改整頁導向；彈窗被擋也改導向；
// 登入頁 15 秒沒結果給「改用整頁方式登入」。
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const fb = vi.hoisted(() => ({
  sameOrigin: true,
  signInWithPopup: vi.fn(),
  signInWithRedirect: vi.fn(async () => {}),
  getRedirectResult: vi.fn(async () => null),
}))
vi.mock('../../src/services/firebase', () => ({
  auth: { currentUser: null },
  googleProvider: {},
  isFirebaseConfigured: true,
  get authOnSameOrigin() { return fb.sameOrigin },
  signInWithPopup: (...a) => fb.signInWithPopup(...a),
  signInWithRedirect: (...a) => fb.signInWithRedirect(...a),
  getRedirectResult: (...a) => fb.getRedirectResult(...a),
  signOut: vi.fn(async () => {}),
  onAuthStateChanged: () => () => {},
  getIdToken: vi.fn(async () => null),
}))
let standalone = false
vi.mock('../../src/hooks/useAppManifest', () => ({
  isStandaloneApp: () => standalone,
  useAdminAppManifest: () => {},
}))
vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  Link: ({ children }) => <a>{children}</a>,
}))

const { AuthProvider, useAuth } = await import('../../src/contexts/AuthContext')
const { default: LoginPage, SLOW_LOGIN_MS } = await import('../../src/pages/LoginPage')

let api
function Grab() { api = useAuth(); return null }

describe('Google 登入流程', () => {
  let container, root
  const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve() })
  const render = (ui) => act(() => root.render(<AuthProvider>{ui}</AuthProvider>))
  const button = (text) => [...container.querySelectorAll('button')].find(b => b.textContent.includes(text))

  beforeEach(() => {
    fb.sameOrigin = true
    standalone = false
    fb.signInWithPopup.mockReset()
    fb.signInWithRedirect.mockClear()
    fb.getRedirectResult.mockReset().mockResolvedValue(null)
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })
  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.useRealTimers()
  })

  it('主畫面 App（同網域輔助頁）→ 整頁導向，不開彈窗', async () => {
    standalone = true
    render(<Grab />)
    act(() => { api.signIn() })
    await flush()
    expect(fb.signInWithRedirect).toHaveBeenCalledTimes(1)
    expect(fb.signInWithPopup).not.toHaveBeenCalled()
  })

  it('主畫面 App 但沒有同網域輔助頁 → 照舊彈窗（跨網域導向在 iOS 回來會拿不到結果）', async () => {
    standalone = true
    fb.sameOrigin = false
    fb.signInWithPopup.mockReturnValue(new Promise(() => {}))
    render(<Grab />)
    act(() => { api.signIn() })
    await flush()
    expect(fb.signInWithPopup).toHaveBeenCalledTimes(1)
    expect(fb.signInWithRedirect).not.toHaveBeenCalled()
  })

  it('一般瀏覽器彈窗被擋 → 改整頁導向', async () => {
    fb.signInWithPopup.mockRejectedValue(Object.assign(new Error('blocked'), { code: 'auth/popup-blocked' }))
    render(<Grab />)
    act(() => { api.signIn() })
    await flush()
    expect(fb.signInWithRedirect).toHaveBeenCalledTimes(1)
  })

  it('整頁導向回來失敗 → 登入頁顯示中文原因', async () => {
    fb.getRedirectResult.mockRejectedValue(Object.assign(new Error('x'), { code: 'auth/unauthorized-domain' }))
    render(<LoginPage />)
    await flush()
    expect(container.textContent).toContain('此網址尚未開放登入')
  })

  it('彈窗 15 秒沒回應 → 出現「改用整頁方式登入」，按了走整頁導向', async () => {
    vi.useFakeTimers()
    fb.signInWithPopup.mockReturnValue(new Promise(() => {})) // 卡住，永不回來
    render(<LoginPage />)
    await flush()
    act(() => { button('使用 Google 登入').click() })
    await flush()
    expect(container.textContent).toContain('登入中…')
    expect(button('改用整頁方式登入')).toBeFalsy()
    act(() => { vi.advanceTimersByTime(SLOW_LOGIN_MS) })
    expect(button('改用整頁方式登入')).toBeTruthy()
    act(() => { button('改用整頁方式登入').click() })
    await flush()
    expect(fb.signInWithRedirect).toHaveBeenCalledTimes(1)
  })
})
