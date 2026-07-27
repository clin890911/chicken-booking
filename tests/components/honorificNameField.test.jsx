import { describe, it, expect, vi, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import HonorificNameField, { composeName, nextTitle, honorificApplies, DEFAULT_TITLE } from '../../src/components/admin/ops/HonorificNameField'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

describe('composeName 合成稱呼字串', () => {
  it('稱謂+姓氏', () => {
    expect(composeName('先生', '陳')).toBe('陳先生')
  })
  it('custom 優先於 surname', () => {
    expect(composeName('先生', null, '鄭')).toBe('鄭先生')
    expect(composeName('先生', '陳', '鄭')).toBe('鄭先生')
  })

  // 🔴 店主拍板：稱謂只接在「單姓」後面。電話帶出的顧客全名（王小明）原樣使用，
  // 不可變成「王小明先生」——會把女客叫成先生。判準只看字數，不看來源。
  it('單姓（chips 或手打一個字）接稱謂', () => {
    expect(composeName('先生', '陳')).toBe('陳先生')
    expect(composeName('小姐', null, '鄭')).toBe('鄭小姐')
  })
  it('全名（≥2 字）原樣使用，不接稱謂', () => {
    expect(composeName('先生', null, '王小明')).toBe('王小明')
    expect(composeName('先生', '陳', '王小明')).toBe('王小明')
  })
  it('切換稱謂不影響全名（三個稱謂結果一致）', () => {
    const out = ['先生', '小姐', '太太'].map(t => composeName(t, null, '王小明'))
    expect(out).toEqual(['王小明', '王小明', '王小明'])
  })
  // 代價：兩字複姓（歐陽、諸葛）也被當成全名 → 不接稱謂。此為長度判準的已知取捨。
  it('兩字複姓被當成全名，不接稱謂', () => {
    expect(composeName('先生', null, '歐陽')).toBe('歐陽')
  })
  // 視覺判定：只有 ≥2 字才算「不生效」。空字串（還沒選姓氏）＝初始狀態，稱謂鈕要亮著
  it('honorificApplies：≥2 字才不生效，空字串與單字都算生效', () => {
    expect(honorificApplies('陳')).toBe(true)
    expect(honorificApplies('')).toBe(true)
    expect(honorificApplies(null)).toBe(true)
    expect(honorificApplies('歐陽')).toBe(false)
    expect(honorificApplies('王小明')).toBe(false)
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
  // 稱謂鈕的 aria-label 帶著當前值（「稱謂：先生（點一下換小姐）」），用前綴找
  const titleBtn = () => [...container.querySelectorAll('button')].find(b => (b.getAttribute('aria-label') || '').startsWith('稱謂'))
  const click = (btn) => act(() => btn.dispatchEvent(new MouseEvent('click', { bubbles: true })))

  // v2 版面：稱謂併進姓氏格，變成一顆「點一下換下一個」的循環鈕（先生→小姐→太太→先生）
  it('稱謂鈕點一下換下一個稱謂，保留原 surname', () => {
    const onChange = vi.fn()
    setup()
    mount(<HonorificNameField title="先生" surname="陳" onChange={onChange} />)

    click(titleBtn())
    expect(onChange).toHaveBeenCalledWith({ title: '小姐', surname: '陳' })
  })

  it('稱謂循環三段回到先生', () => {
    expect(nextTitle('先生')).toBe('小姐')
    expect(nextTitle('小姐')).toBe('太太')
    expect(nextTitle('太太')).toBe('先生')
  })

  // 🔴 稱謂不是 toggle-off：連點幾次都不能點成「沒有稱謂」，否則客人會被叫成光禿禿的「陳」
  it('稱謂鈕永遠不會回傳 null（點不出「沒有稱謂」）', () => {
    const onChange = vi.fn()
    setup()
    for (const t of ['先生', '小姐', '太太']) {
      mount(<HonorificNameField title={t} surname="陳" onChange={onChange} />)
      click(titleBtn())
    }
    onChange.mock.calls.forEach(([arg]) => expect(arg.title).toBeTruthy())
  })

  // 稱謂此刻不生效（姓名是全名）→ 降透明度告知，但仍可點（店員可能先切稱謂再改名字）
  it('姓名是全名時稱謂鈕降透明度，但仍可點且會循環', () => {
    const onChange = vi.fn()
    setup()
    mount(<HonorificNameField title="先生" surname={null} onChange={onChange} custom="王小明" onCustomChange={() => {}} />)

    const btn = titleBtn()
    expect(btn.getAttribute('data-honorific-applies')).toBe('false')
    expect(btn.className).toContain('opacity-40')
    expect(btn.hasAttribute('disabled')).toBe(false)
    click(btn)
    expect(onChange).toHaveBeenCalledWith({ title: '小姐', surname: null })
  })

  it('姓名是單姓時稱謂鈕正常不透明', () => {
    setup()
    mount(<HonorificNameField title="先生" surname="陳" onChange={() => {}} />)
    expect(titleBtn().getAttribute('data-honorific-applies')).toBe('true')
    expect(titleBtn().className).not.toContain('opacity-40')
  })

  // 初始狀態（什麼都還沒選）稱謂鈕必須是亮的——灰掉會讓店員以為壞了
  it('還沒選姓氏（base 為空）時稱謂鈕不透明', () => {
    setup()
    mount(<HonorificNameField title="先生" surname={null} onChange={() => {}} custom="" onCustomChange={() => {}} />)
    expect(titleBtn().getAttribute('data-honorific-applies')).toBe('true')
    expect(titleBtn().className).not.toContain('opacity-40')
  })

  // 舊呼叫點若沒給 title，畫面顯示預設「先生」，點一下就把它寫回父層（不會停在「畫面有字、資料是空」）
  it('title 為 null 時顯示預設稱謂，點一下把預設值寫回父層', () => {
    const onChange = vi.fn()
    setup()
    mount(<HonorificNameField title={null} surname="陳" onChange={onChange} />)

    expect(titleBtn().textContent).toContain(DEFAULT_TITLE)
    click(titleBtn())
    expect(onChange).toHaveBeenCalledWith({ title: DEFAULT_TITLE, surname: '陳' })
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
