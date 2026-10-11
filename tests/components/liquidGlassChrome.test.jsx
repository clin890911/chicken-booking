// Liquid Glass A 版（只有控制層用玻璃）：降級開關、字元圖示換線條圖示、Modal 面板結構。
// 材質本身在 src/styles/glass.css（jsdom 不算 CSS），這裡守的是 JS 端的行為與 DOM 結構不變量。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import GlyphText from '../../src/components/ui/GlyphText'
import { Modal } from '../../src/components/ui'
import NumericKeypad from '../../src/components/admin/ops/NumericKeypad'
import { OPAQUE_PREF_KEY, readOpaquePref, setOpaquePref, initOpaqueMode, supportsBackdropFilter } from '../../src/utils/opaqueMode'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const html = document.documentElement

describe('不透明模式（每台裝置自己記）', () => {
  beforeEach(() => { localStorage.clear(); delete html.dataset.material; delete html.dataset.noBackdrop })
  afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); delete html.dataset.material; delete html.dataset.noBackdrop })

  it('預設關閉＝玻璃；打開後寫入 localStorage 並在 <html> 標 data-material="opaque"，關掉移除', () => {
    expect(readOpaquePref()).toBe(false)
    initOpaqueMode()
    expect(html.dataset.material).toBeUndefined()
    expect(setOpaquePref(true)).toBe(true)
    expect(localStorage.getItem(OPAQUE_PREF_KEY)).toBe('1')
    expect(html.dataset.material).toBe('opaque')
    setOpaquePref(false)
    expect(localStorage.getItem(OPAQUE_PREF_KEY)).toBeNull()
    expect(html.dataset.material).toBeUndefined()
  })

  it('重新載入（init）沿用上次的選擇', () => {
    localStorage.setItem(OPAQUE_PREF_KEY, '1')
    initOpaqueMode()
    expect(html.dataset.material).toBe('opaque')
  })

  it('讀取失敗（私密瀏覽／封鎖網站資料）＝當作沒開，不丟例外', () => {
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => { throw new Error('SecurityError') })
    expect(readOpaquePref()).toBe(false)
    expect(() => initOpaqueMode()).not.toThrow()
    expect(html.dataset.material).toBeUndefined()
  })

  it('寫入失敗：這次仍套用，回傳 false 讓設定頁提示「重新整理後會回到預設」', () => {
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('QuotaExceeded') })
    expect(setOpaquePref(true)).toBe(false)
    expect(html.dataset.material).toBe('opaque')
  })

  it('瀏覽器不支援 backdrop-filter → <html data-no-backdrop>（CSS 退回不透明底）', () => {
    const orig = globalThis.CSS
    globalThis.CSS = { supports: () => false }
    try {
      expect(supportsBackdropFilter()).toBe(false)
      initOpaqueMode()
      expect('noBackdrop' in html.dataset).toBe(true)
    } finally { globalThis.CSS = orig }
  })

  it('支援 -webkit-backdrop-filter（舊 Safari）也算支援', () => {
    const orig = globalThis.CSS
    globalThis.CSS = { supports: (p) => p === '-webkit-backdrop-filter' }
    try {
      expect(supportsBackdropFilter()).toBe(true)
      initOpaqueMode()
      expect('noBackdrop' in html.dataset).toBe(false)
    } finally { globalThis.CSS = orig }
  })
})

describe('控制層元件', () => {
  let container, root
  const mount = (el) => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => root.render(el))
  }
  afterEach(() => { act(() => root?.unmount()); container?.remove() })

  it('GlyphText：開頭 ✓／✕／↩／↔ 與結尾 → 換成 aria-hidden 線條圖示，文字只剩純文字', () => {
    for (const [src, text] of [['✓ 確認入座', '確認入座'], ['✕ 取消訂位', '取消訂位'], ['↩ 復原', '復原'], ['↔ 換桌', '換桌'], ['下一步 →', '下一步']]) {
      mount(<button type="button"><GlyphText>{src}</GlyphText></button>)
      const btn = container.querySelector('button')
      expect(btn.textContent).toBe(text)
      expect(btn.querySelectorAll('svg[aria-hidden="true"]').length).toBeGreaterThan(0)
      act(() => root.unmount()); container.remove(); root = null
    }
  })

  it('GlyphText：沒有字元圖示的字串原樣輸出（不多包一層）', () => {
    mount(<button type="button"><GlyphText>復原</GlyphText></button>)
    expect(container.querySelector('button').innerHTML).toBe('復原')
  })

  it('Modal：面板是浮動玻璃、本身不捲動（捲動在裡層），玻璃底才不會跟著內容捲走', () => {
    mount(<Modal open onClose={() => {}} title="標題"><p>內容</p></Modal>)
    const panel = document.querySelector('.lg-float.lg-sheet')
    expect(panel).not.toBeNull()
    expect(panel.className).toContain('overflow-hidden')
    expect(panel.className).not.toContain('overflow-y-auto')
    expect(panel.firstElementChild.className).toContain('overflow-y-auto')
    expect(panel.textContent).toContain('內容')
  })

  it('數字鍵盤：退格鍵畫線條圖示，無障礙名稱仍是「退格」、功能不變', () => {
    const onChange = vi.fn()
    mount(<NumericKeypad value="0912" onChange={onChange} tone="dark" />)
    const back = container.querySelector('button[aria-label="退格"]')
    expect(back.textContent).toBe('')
    expect(back.querySelector('svg')).not.toBeNull()
    act(() => back.click())
    expect(onChange).toHaveBeenCalledWith('091')
  })
})
