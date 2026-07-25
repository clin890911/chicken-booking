import { describe, it, expect, vi, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import HonorificNameField, { composeName } from '../../src/components/admin/ops/HonorificNameField'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

describe('composeName 合成稱呼字串', () => {
  it('稱謂+姓氏', () => {
    expect(composeName('先生', '陳')).toBe('陳先生')
  })
  it('custom 優先於 surname', () => {
    expect(composeName('先生', null, '歐陽')).toBe('歐陽先生')
    expect(composeName('先生', '陳', '歐陽')).toBe('歐陽先生')
  })
  it('三者皆空回傳空字串', () => {
    expect(composeName(null, null, null)).toBe('')
  })
  it('只有 surname 沒有 title：不補稱謂', () => {
    expect(composeName(null, '陳', null)).toBe('陳')
  })
  it('只有 title 沒有 surname/custom：仍回傳空字串（沒有姓就不成稱呼）', () => {
    expect(composeName('先生', null, null)).toBe('')
  })
})

describe('HonorificNameField 互動', () => {
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

  const byLabel = (label) => [...container.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === label)
  const click = (btn) => act(() => btn.dispatchEvent(new MouseEvent('click', { bubbles: true })))

  it('點稱謂「先生」呼叫 onChange 帶正確值，保留原 surname', () => {
    const onChange = vi.fn()
    setup()
    mount(<HonorificNameField title={null} surname="陳" onChange={onChange} />)

    click(byLabel('先生'))
    expect(onChange).toHaveBeenCalledWith({ title: '先生', surname: '陳' })
  })

  it('再點一次同一個稱謂會取消選取（回傳 null）', () => {
    const onChange = vi.fn()
    setup()
    mount(<HonorificNameField title="先生" surname="陳" onChange={onChange} />)

    click(byLabel('先生'))
    expect(onChange).toHaveBeenCalledWith({ title: null, surname: '陳' })
  })

  it('點姓氏「陳」呼叫 onChange 帶正確值，保留原 title', () => {
    const onChange = vi.fn()
    setup()
    mount(<HonorificNameField title="先生" surname={null} onChange={onChange} />)

    click(byLabel('陳'))
    expect(onChange).toHaveBeenCalledWith({ title: '先生', surname: '陳' })
  })

  it('再點一次同一個姓氏會取消選取（回傳 null）', () => {
    const onChange = vi.fn()
    setup()
    mount(<HonorificNameField title="先生" surname="陳" onChange={onChange} />)

    click(byLabel('陳'))
    expect(onChange).toHaveBeenCalledWith({ title: '先生', surname: null })
  })

  it('12 大姓依序渲染、每顆有 aria-pressed 反映選取狀態', () => {
    setup()
    mount(<HonorificNameField title={null} surname="林" onChange={() => {}} />)
    const order = ['陳', '林', '黃', '張', '李', '王', '吳', '劉', '蔡', '楊', '許', '鄭']
    order.forEach(s => expect(byLabel(s)).toBeTruthy())
    expect(byLabel('林').getAttribute('aria-pressed')).toBe('true')
    expect(byLabel('陳').getAttribute('aria-pressed')).toBe('false')
  })

  it('點「其他」切換出自訂姓氏 input，輸入會呼叫 onCustomChange', () => {
    const onCustomChange = vi.fn()
    setup()
    mount(<HonorificNameField title={null} surname={null} onChange={() => {}} custom="" onCustomChange={onCustomChange} />)

    expect(container.querySelector('input')).toBeNull()
    click(byLabel('其他'))
    const input = container.querySelector('input[aria-label="自訂姓氏"]')
    expect(input).toBeTruthy()

    act(() => {
      const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setValue.call(input, '歐陽')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(onCustomChange).toHaveBeenCalledWith('歐陽')
  })

  // 迴歸：電話帶顧客檔是在掛載「之後」才把姓名填進 custom。若展開狀態只在 mount 時
  // 由 useState(!!custom) 決定，輸入框不會打開 → 名字被送出卻看不見，店員無從發現或修改。
  it('custom 在掛載後才有值（電話帶出顧客檔）：自訂 input 要自動顯示', () => {
    setup()
    mount(<HonorificNameField title={null} surname={null} onChange={() => {}} custom="" onCustomChange={() => {}} />)
    expect(container.querySelector('input[aria-label="自訂姓氏"]')).toBeNull()

    // 電話比對到顧客 → 父層把姓名塞進 custom
    mount(<HonorificNameField title={null} surname={null} onChange={() => {}} custom="王小明" onCustomChange={() => {}} />)
    const input = container.querySelector('input[aria-label="自訂姓氏"]')
    expect(input).toBeTruthy()
    expect(input.value).toBe('王小明')
  })

  it('收起「其他」時清掉自訂姓氏，避免看不見的值還被送出', () => {
    const onCustomChange = vi.fn()
    setup()
    mount(<HonorificNameField title={null} surname={null} onChange={() => {}} custom="歐陽" onCustomChange={onCustomChange} />)
    expect(container.querySelector('input[aria-label="自訂姓氏"]')).toBeTruthy()

    click(byLabel('其他'))
    expect(onCustomChange).toHaveBeenCalledWith('')
  })
})
