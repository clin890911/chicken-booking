import { describe, it, expect, afterEach, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import AgencyPicker from '../../src/components/admin/group/AgencyPicker'

globalThis.IS_REACT_ACT_ENVIRONMENT = true // 讓 react-dom 在測試中支援 act()

// 旅行社欄位：打字沒有同名 → 下拉底部「＋ 新增旅行社「X」」一點即建檔；底部連結帶入已打的字。
const AGENCIES = [
  { id: 'a1', name: '華信旅行社', phone: '0911111111' },
  { id: 'a2', name: 'Alpha Tours', phone: '' },
  { id: 'a3', name: '舊旅行社', archived: true },
]

let root, host
function mount(props = {}) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  const onPick = vi.fn()
  const onQuickAdd = vi.fn()
  const onCreateNamed = vi.fn()
  act(() => {
    root.render(
      <AgencyPicker agencies={AGENCIES} groupReservations={[]} onPick={onPick}
        onQuickAdd={onQuickAdd} onCreateNamed={onCreateNamed} {...props} />,
    )
  })
  return { onPick, onQuickAdd, onCreateNamed }
}

// React 控制的 input 要走原生 setter 才會觸發 onChange
function type(text) {
  const input = host.querySelector('input')
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
  act(() => {
    setter.call(input, text)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
const buttons = () => [...host.querySelectorAll('button')]
const createBtn = () => buttons().find(b => b.textContent.includes('新增旅行社「'))
const linkBtn = () => buttons().find(b => b.textContent.includes('快速新增旅行社（含電話）'))

afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  root = host = null
})

describe('AgencyPicker 打字即建檔', () => {
  it('(a) 打「華盛頓」無符合 → 出現新增按鈕，點擊以該名稱呼叫 onCreateNamed 並收起下拉', () => {
    const { onCreateNamed, onPick } = mount()
    type('華盛頓')
    const btn = createBtn()
    expect(btn).toBeTruthy()
    expect(btn.textContent).toContain('新增旅行社「華盛頓」')
    act(() => { btn.click() })
    expect(onCreateNamed).toHaveBeenCalledTimes(1)
    expect(onCreateNamed).toHaveBeenCalledWith('華盛頓')
    expect(onPick).not.toHaveBeenCalled()
    expect(createBtn()).toBeUndefined() // 下拉已關
  })

  it('(b) 與既有旅行社同名（大小寫／前後空白不計）→ 不顯示新增列', () => {
    mount()
    type('  alpha tours ')
    expect(createBtn()).toBeUndefined()
    type('華信旅行社')
    expect(createBtn()).toBeUndefined()
  })

  it('(b2) 同名但已封存的旅行社不擋新增', () => {
    mount()
    type('舊旅行社')
    expect(createBtn()).toBeTruthy()
  })

  it('(c) 部分符合時仍顯示新增列（同時列出符合項）', () => {
    mount()
    type('華')
    expect(buttons().some(b => b.textContent.includes('華信旅行社'))).toBe(true)
    expect(createBtn()?.textContent).toContain('新增旅行社「華」')
  })

  it('(d) 沒打字（或只有空白）不顯示新增列', () => {
    mount()
    const input = host.querySelector('input')
    act(() => { input.focus(); input.dispatchEvent(new FocusEvent('focusin', { bubbles: true })) })
    expect(host.textContent).toContain('華信旅行社') // 下拉確實已開（列出前幾筆），只是沒有新增列
    expect(createBtn()).toBeUndefined()
    type('   ')
    expect(createBtn()).toBeUndefined()
  })

  it('沒傳 onCreateNamed（父層不給建檔）→ 不顯示新增列', () => {
    mount({ onCreateNamed: undefined })
    type('華盛頓')
    expect(createBtn()).toBeUndefined()
  })

  it('(e) 底部「快速新增（含電話）」連結把已打的字帶給 onQuickAdd', () => {
    const { onQuickAdd } = mount()
    type('  華盛頓 ')
    act(() => { linkBtn().click() })
    expect(onQuickAdd).toHaveBeenCalledWith('華盛頓')
  })

  it('(e2) 沒打字直接點連結 → onQuickAdd 收到空字串', () => {
    const { onQuickAdd } = mount()
    act(() => { linkBtn().click() })
    expect(onQuickAdd).toHaveBeenCalledWith('')
  })
})
