import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import NumberStepper from '../../src/components/admin/planning/NumberStepper'

globalThis.IS_REACT_ACT_ENVIRONMENT = true // 讓 react-dom 在測試中支援 act()

let container, root
beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

const render = (el) => act(() => root.render(el))
const click = (el) => act(() => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true })))
const type = (el, value) => {
  const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  act(() => {
    setValue.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
const input = () => container.querySelector('input')
const minusBtn = () => container.querySelectorAll('button')[0]
const plusBtn = () => container.querySelectorAll('button')[1]

describe('NumberStepper 步進器', () => {
  it('🔴 輸入框是 type="text" + inputMode="numeric"，不是 type="number"（教訓 L23）', () => {
    render(<NumberStepper value={20} onChange={() => {}} ariaLabel="總人數" />)
    expect(input().getAttribute('type')).toBe('text')
    expect(input().getAttribute('inputmode')).toBe('numeric')
    expect(container.querySelector('input[type="number"]')).toBeNull()
    expect(input().value).toBe('20')
  })

  it('＋ / − 以 step 增減並回報給父層', () => {
    const onChange = vi.fn()
    render(<NumberStepper value={20} onChange={onChange} />)
    click(plusBtn())
    expect(onChange).toHaveBeenLastCalledWith(21)
    click(minusBtn())
    expect(onChange).toHaveBeenLastCalledWith(19)
  })

  it('自訂 step（消費金額每次 100）', () => {
    const onChange = vi.fn()
    render(<NumberStepper value={300} step={100} onChange={onChange} />)
    click(plusBtn())
    expect(onChange).toHaveBeenLastCalledWith(400)
  })

  it('到達 min / max 時對應按鈕 disabled（不會按出負數或爆表）', () => {
    render(<NumberStepper value={0} min={0} max={3} onChange={() => {}} />)
    expect(minusBtn().disabled).toBe(true)
    expect(plusBtn().disabled).toBe(false)
    render(<NumberStepper value={3} min={0} max={3} onChange={() => {}} />)
    expect(minusBtn().disabled).toBe(false)
    expect(plusBtn().disabled).toBe(true)
  })

  it('打字只吃數字，非數字字元被忽略', () => {
    const onChange = vi.fn()
    render(<NumberStepper value={0} onChange={onChange} />)
    type(input(), '4a3')
    expect(onChange).toHaveBeenLastCalledWith(43)
    expect(input().value).toBe('43')
  })

  it('清空輸入框時本地保持空白（可以刪光重打），但父層立刻拿到 min', () => {
    const onChange = vi.fn()
    render(<NumberStepper value={20} min={0} onChange={onChange} />)
    type(input(), '')
    expect(input().value).toBe('')            // 不會被受控值彈回 0
    expect(onChange).toHaveBeenLastCalledWith(0)
  })

  it('打字超過 max 會夾住', () => {
    const onChange = vi.fn()
    render(<NumberStepper value={0} max={500} onChange={onChange} />)
    type(input(), '9999')
    expect(onChange).toHaveBeenLastCalledWith(500)
  })

  it('外部值改變（快速鍵 chip 一鍵設定）時輸入框跟著更新', () => {
    function Host() {
      const [v, setV] = useState(0)
      return (
        <>
          <button type="button" data-testid="preset" onClick={() => setV(43)}>大巴</button>
          <NumberStepper value={v} onChange={setV} />
        </>
      )
    }
    render(<Host />)
    expect(input().value).toBe('0')
    click(container.querySelector('[data-testid="preset"]'))
    expect(input().value).toBe('43')
  })

  it('每顆按鈕都有 aria-label（螢幕閱讀器 / 測試定位得到）', () => {
    render(<NumberStepper value={2} ariaLabel="素食人數" onChange={() => {}} />)
    expect(minusBtn().getAttribute('aria-label')).toBe('素食人數 減 1')
    expect(plusBtn().getAttribute('aria-label')).toBe('素食人數 加 1')
    expect(input().getAttribute('aria-label')).toBe('素食人數')
  })
})
