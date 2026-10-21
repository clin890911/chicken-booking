import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'

// 店裡 iPad 常駐現場頁好幾天不重整 → 跑舊版。useNewVersion：伺服器版本不同就提示；
// 螢幕關掉 10 分鐘以上再打開、且沒有未存資料 → 自動重新整理。
globalThis.IS_REACT_ACT_ENVIRONMENT = true

let latest = 'build-2'
let blocked = false
vi.mock('../../src/utils/appVersion', () => ({
  BUILD_ID: 'build-1',
  fetchLatestBuildId: vi.fn(async () => latest),
  isNewBuild: (l, c = 'build-1') => !!l && l !== c,
  canAutoReload: () => !blocked,
}))
const { useNewVersion } = await import('../../src/hooks/useNewVersion')

function Probe() {
  const { updateAvailable } = useNewVersion()
  return <span>{updateAvailable ? 'NEW' : 'SAME'}</span>
}

describe('useNewVersion', () => {
  let container, root, reload, visibility
  const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve() })
  const setVisibility = async (v) => {
    visibility = v
    document.dispatchEvent(new Event('visibilitychange'))
    await flush()
  }

  beforeEach(() => {
    latest = 'build-2'
    blocked = false
    visibility = 'visible'
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility)
    reload = vi.fn()
    vi.stubGlobal('location', { ...window.location, reload })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })
  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('伺服器是新版本 → 顯示有更新；同版本 → 不顯示', async () => {
    act(() => root.render(<Probe />))
    await flush()
    expect(container.textContent).toBe('NEW')

    latest = 'build-1'
    const c2 = document.createElement('div')
    const r2 = createRoot(c2)
    act(() => r2.render(<Probe />))
    await flush()
    expect(c2.textContent).toBe('SAME')
    act(() => r2.unmount())
  })

  it('螢幕關掉 10 分鐘以上再打開＋有新版本 → 自動重新整理；有未存資料則不重整', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
    act(() => root.render(<Probe />))
    await flush()

    await setVisibility('hidden')
    vi.setSystemTime(Date.now() + 11 * 60 * 1000)
    blocked = true
    await setVisibility('visible')
    expect(reload).not.toHaveBeenCalled()

    await setVisibility('hidden')
    vi.setSystemTime(Date.now() + 11 * 60 * 1000)
    blocked = false
    await setVisibility('visible')
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('只切走一下（不到 10 分鐘）不自動重整', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
    act(() => root.render(<Probe />))
    await flush()
    await setVisibility('hidden')
    vi.setSystemTime(Date.now() + 60 * 1000)
    await setVisibility('visible')
    expect(reload).not.toHaveBeenCalled()
  })
})
