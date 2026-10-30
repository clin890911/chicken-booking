// @vitest-environment jsdom
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { installPopoverDismiss } from '../../src/utils/popoverDismiss'

// 「⋯ 更多」浮出選單：點外面／開另一個／按動作／Escape 都要自動收（2026-10-17 iPad 回饋）
const html = `
  <details data-popover id="a"><summary>更多</summary><div><button id="a-act">改桌</button></div></details>
  <details data-popover id="b"><summary>更多</summary><div><button id="b-act">取消</button></div></details>
  <details data-popover id="f"><summary id="f-sum">篩選</summary><div><label><input type="checkbox" id="f-cb">線上</label><button id="f-done">完成</button></div></details>
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

  // #198 收尾：鍵盤 Tab 把焦點移出選單 → 收；焦點仍在選單內（勾選框、按鈕）或去向不明（null）→ 不收
  const focusOut = (from, to) => from.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: to }))

  it('焦點從選單移到外面（Tab 到下方卡片）→ 只收那個選單', () => {
    $('f').open = true; $('acc').open = true
    focusOut($('f-done'), $('outside'))
    expect($('f').open).toBe(false)
    expect($('acc').open).toBe(true) // 一般手風琴不受影響
  })

  it('焦點在選單內移動（summary → 勾選框 → 按鈕）不收：多選勾來勾去不會被誤收', () => {
    $('f').open = true
    focusOut($('f-sum'), $('f-cb'))
    focusOut($('f-cb'), $('f-done'))
    expect($('f').open).toBe(true)
  })

  it('relatedTarget 為 null（Safari 點勾選框不給焦點、視窗失焦）→ 不收', () => {
    $('f').open = true
    focusOut($('f-cb'), null)
    expect($('f').open).toBe(true)
  })

  it('真的 focus 切換（jsdom 會帶 relatedTarget）：勾選框 → 選單內按鈕不收；→ 外面按鈕收', () => {
    $('f').open = true
    $('f-cb').focus()
    $('f-done').focus()
    expect($('f').open).toBe(true)
    $('outside').focus()
    expect($('f').open).toBe(false)
  })

  it('已收合的選單、一般 details 失焦 → 不動', () => {
    $('acc').open = true
    focusOut($('acc').querySelector('summary'), $('outside'))
    expect($('acc').open).toBe(true)
  })
})
