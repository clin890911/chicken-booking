import { describe, it, expect, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { Ban } from 'lucide-react'
import GlyphText from '../../src/components/ui/GlyphText'

// 2026-10 全站去 emoji：GlyphText 加 icon prop，原本寫死在字串裡的彩色 emoji（⛔ 📅 🚌…）
// 改傳 lucide 元件。圖示 aria-hidden，按鈕的可及名稱只剩純文字。
describe('GlyphText icon prop', () => {
  let container, root
  const mount = (el) => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => root.render(el))
  }
  afterEach(() => { act(() => root?.unmount()); container?.remove() })

  it('icon＋文字：線條圖示 aria-hidden，按鈕文字＝純文字', () => {
    mount(<button type="button"><GlyphText icon={Ban} size={16}>整天公休中</GlyphText></button>)
    const btn = container.querySelector('button')
    expect(btn.textContent).toBe('整天公休中')
    const svg = btn.querySelector('svg')
    expect(svg.getAttribute('aria-hidden')).toBe('true')
    expect(svg.getAttribute('width')).toBe('16')
  })

  it('icon 模式接受 JSX 子節點（含插值）', () => {
    mount(<span><GlyphText icon={Ban}>已關閉 {3} 個</GlyphText></span>)
    expect(container.textContent).toBe('已關閉 3 個')
    expect(container.querySelectorAll('svg').length).toBe(1)
  })
})
