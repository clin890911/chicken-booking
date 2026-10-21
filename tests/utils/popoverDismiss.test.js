// @vitest-environment jsdom
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { installPopoverDismiss } from '../../src/utils/popoverDismiss'

// 「⋯ 更多」浮出選單：點外面／開另一個／按動作／Escape 都要自動收（2026-10-17 iPad 回饋）
const html = `
  <details data-popover id="a"><summary>更多</summary><div><button id="a-act">改桌</button></div></details>
  <details data-popover id="b"><summary>更多</summary><div><button id="b-act">取消</button></div></details>
  <details id="acc"><summary>設定區塊</summary><p>內容</p></details>
  <button id="outside">外面</button>`
const $ = id => document.getElementById(id)
const down = el => el.dispatchEvent(new Event('pointerdown', { bubbles: true }))

describe('popoverDismiss', () => {
  beforeAll(() => installPopoverDismiss())
  beforeEach(() => { document.body.innerHTML = html })

  it('點選單以外 → 收起；一般手風琴 details 不受影響', () => {
    $('a').open = true; $('acc').open = true
    down($('outside'))
    expect($('a').open).toBe(false)
    expect($('acc').open).toBe(true)
  })

  it('點選單內部不收', () => {
    $('a').open = true
    down($('a-act'))
    expect($('a').open).toBe(true)
  })

  it('打開另一個 → 先開的收起（同時只開一個）', () => {
    $('a').open = true
    $('b').open = true
    $('b').dispatchEvent(new Event('toggle'))
    expect($('a').open).toBe(false)
    expect($('b').open).toBe(true)
  })

  it('按下選單裡的動作 → 動作跑完後收起', async () => {
    $('a').open = true
    $('a-act').click()
    await new Promise(r => setTimeout(r, 0))
    expect($('a').open).toBe(false)
  })

  it('Escape 全收', () => {
    $('a').open = true
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect($('a').open).toBe(false)
  })
})
