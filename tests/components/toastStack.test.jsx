// Toast 同時顯示數量的上限：最後一道「不准洗版」的防線。
// 背景：現場頁 iPad 上曾出現十來則「新訂位」toast 疊起來，把整張桌況圖蓋掉。
// 源頭已在 utils/newBookingAlerts 收斂，這裡守的是「任何來源都不該疊爆畫面」。
import { describe, it, expect, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { ToastProvider, useToast } from '../../src/components/ui/Toast'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

// 把 toast api 撈出來，讓測試能在 provider 外直接推訊息
let api = null
function Probe() {
  api = useToast()
  return null
}

describe('Toast 疊加上限', () => {
  let container, root
  const setup = () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => root.render(<ToastProvider><Probe /></ToastProvider>))
  }
  const visible = () => container.querySelectorAll('[class*="pointer-events-auto"]')

  afterEach(() => {
    act(() => root?.unmount())
    container?.remove()
    api = null
  })

  it('連推 10 則只留最多 3 則，且留下的是最新的', () => {
    setup()
    act(() => { for (let i = 1; i <= 10; i++) api.info(`訊息 ${i}`, { duration: 0 }) })
    const shown = [...visible()].map(el => el.querySelector('span:nth-child(2)')?.textContent)
    expect(shown).toEqual(['訊息 8', '訊息 9', '訊息 10'])
  })

  // 帶「復原」的 toast 是使用者唯一的反悔入口，被後續通知擠掉等於動作做不回來。
  it('帶復原動作的那則不會被擠掉', () => {
    setup()
    act(() => api.action('已標記 No-show', { label: '復原', onClick: () => {} }, { duration: 0 }))
    act(() => { for (let i = 1; i <= 6; i++) api.info(`訊息 ${i}`, { duration: 0 }) })
    expect(container.textContent).toContain('已標記 No-show')
    expect(container.querySelector('button')?.textContent).toBe('復原')
  })
})
