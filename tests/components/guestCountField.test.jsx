import { describe, it, expect, afterEach } from 'vitest'
import { useState } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import GuestCountField, { clampGuests } from '../../src/components/admin/GuestCountField'

globalThis.IS_REACT_ACT_ENVIRONMENT = true // 讓 react-dom 在測試中支援 act()

describe('clampGuests 人數夾住（上限 200）', () => {
  it('超過上限夾到 200（防手誤多按 0）', () => {
    expect(clampGuests(201, 200)).toBe(200)
    expect(clampGuests(2000, 200)).toBe(200)
  })
  it('正常值原樣（含大團）', () => {
    expect(clampGuests(5)).toBe(5)
    expect(clampGuests(60)).toBe(60)
    expect(clampGuests(200)).toBe(200)
  })
  it('小數取整、字串可解析', () => {
    expect(clampGuests(3.9)).toBe(3)
    expect(clampGuests('12')).toBe(12)
  })
  it('非數字 / < 1 → null（不更新）', () => {
    expect(clampGuests(0)).toBeNull()
    expect(clampGuests('')).toBeNull()
    expect(clampGuests('abc')).toBeNull()
    expect(clampGuests(-3)).toBeNull()
  })
})

describe('GuestCountField 渲染', () => {
  it('value>8 顯示自訂數字輸入框且 max=200', () => {
    const html = renderToStaticMarkup(<GuestCountField value={60} onChange={() => {}} />)
    expect(html).toContain('type="number"')
    expect(html).toContain('max="200"')
    expect(html).toContain('value="60"')
  })
  it('value<=8 顯示 chips 與 9+ 展開鈕、無自訂輸入框', () => {
    const html = renderToStaticMarkup(<GuestCountField value={4} onChange={() => {}} />)
    expect(html).toContain('9+ ▾')
    expect(html).not.toContain('type="number"')
  })
})

// 互動回歸：輸入兩位數（如 12）時，鍵入第一位「1」的瞬間 value=1 ≤ 8，
// 輸入框不得被收合卸載（否則焦點消失、第二位數打不進去——回報的「一直跳掉」bug）。
describe('GuestCountField 自訂輸入互動', () => {
  let container, root
  const mount = (ui) => act(() => { root.render(ui) })
  const setup = () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  }
  afterEach(() => {
    act(() => root?.unmount())
    container?.remove()
  })

  function Harness() {
    const [guests, setGuests] = useState(2)
    return <GuestCountField value={guests} onChange={setGuests} />
  }

  const typeInto = (input, text) => act(() => {
    const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setValue.call(input, text)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })

  it('聚焦中鍵入 ≤8 的中間值，輸入框保持展開；補完兩位數後值正確', () => {
    setup()
    mount(<Harness />)

    // 點 9+ 展開輸入框並聚焦
    const moreBtn = [...container.querySelectorAll('button')].find(b => b.textContent.includes('9+'))
    act(() => { moreBtn.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    const input = container.querySelector('input[type="number"]')
    expect(input).toBeTruthy()
    act(() => { input.focus() })

    // 打「1」（全選後重打的第一位數）→ 輸入框不得消失
    typeInto(input, '1')
    expect(container.querySelector('input[type="number"]')).toBeTruthy()

    // 補上「2」成 12
    typeInto(input, '12')
    expect(container.querySelector('input[type="number"]').value).toBe('12')

    // 失焦：>8 維持展開、值不變
    act(() => { input.blur() })
    expect(container.querySelector('input[type="number"]')?.value).toBe('12')
  })

  it('失焦時 ≤8 收回 chips、清空則還原原值', () => {
    setup()
    mount(<Harness />)

    const moreBtn = [...container.querySelectorAll('button')].find(b => b.textContent.includes('9+'))
    act(() => { moreBtn.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    const input = container.querySelector('input[type="number"]')
    act(() => { input.focus() })

    // 打「4」後失焦 → 收回 chips，chip 4 為選中
    typeInto(input, '4')
    act(() => { input.blur() })
    expect(container.querySelector('input[type="number"]')).toBeNull()
    const chip4 = [...container.querySelectorAll('button')].find(b => b.textContent.trim() === '4')
    expect(chip4.className).toContain('bg-chicken-red')
  })
})
