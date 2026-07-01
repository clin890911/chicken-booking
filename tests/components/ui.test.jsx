// 共用表單元件的可存取性契約回歸測試。
// 不引入 React Testing Library：用 react-dom/server 靜態渲染成 HTML，
// 直接斷言 label 的 htmlFor 對到 input 的 id（等同 getByLabel 依賴的綁定），
// 以及 Button 預設 type="button"（避免在 <form> 內被誤觸 submit）。
import { renderToStaticMarkup } from 'react-dom/server'
import { Input, Select, Textarea, Button } from '../../src/components/ui/index.jsx'

// 從一段 HTML 取出 <label for="X"> 與對應標籤的 id，確認兩者一致且非空。
function assertBound(html, tag) {
  const forMatch = html.match(/<label[^>]*\sfor="([^"]+)"/)
  expect(forMatch, `找不到 <label for>：${html}`).toBeTruthy()
  const forId = forMatch[1]
  expect(forId).toBeTruthy()
  const idMatch = html.match(new RegExp(`<${tag}[^>]*\\sid="([^"]+)"`))
  expect(idMatch, `找不到 <${tag} id>：${html}`).toBeTruthy()
  expect(idMatch[1]).toBe(forId)
  return forId
}

describe('ui 共用元件可存取性', () => {
  it('Input 的 label 以 htmlFor 綁到 input（自動產生 id）', () => {
    const html = renderToStaticMarkup(<Input label="電話" />)
    assertBound(html, 'input')
  })

  it('Select 的 label 以 htmlFor 綁到 select', () => {
    const html = renderToStaticMarkup(<Select label="狀態" options={[{ value: 'a', label: 'A' }]} />)
    assertBound(html, 'select')
  })

  it('Textarea 的 label 以 htmlFor 綁到 textarea', () => {
    const html = renderToStaticMarkup(<Textarea label="備註" />)
    assertBound(html, 'textarea')
  })

  it('呼叫端傳入的 id 優先於自動 id', () => {
    const html = renderToStaticMarkup(<Input label="Email" id="my-email" />)
    const id = assertBound(html, 'input')
    expect(id).toBe('my-email')
  })

  it('未給 label 時不渲染 label 元素', () => {
    const html = renderToStaticMarkup(<Input placeholder="無 label" />)
    expect(html).not.toContain('<label')
  })

  it('Button 預設 type="button"', () => {
    const html = renderToStaticMarkup(<Button>送出</Button>)
    expect(html).toContain('type="button"')
  })

  it('Button 可被呼叫端覆寫為 type="submit"', () => {
    const html = renderToStaticMarkup(<Button type="submit">查詢</Button>)
    expect(html).toContain('type="submit"')
    expect(html).not.toContain('type="button"')
  })
})
