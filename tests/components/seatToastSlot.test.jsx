// B1 入座回饋的位置：placement:'seat' 的 toast 出現在現場頁的 <SeatToastSlot />（桌況圖底部、報到列上方），
// 其他 toast 照舊在頂部；沒有落點（手機、其他頁）時入座回饋也退回頂部，不會消失。
import { describe, it, expect, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { ToastProvider, useToast } from '../../src/components/ui/Toast'
import { SeatToastSlot } from '../../src/components/ui/SeatToastSlot'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let container, root, api
function Grab() { api = useToast(); return null }
const mount = (withSlot) => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => { root.render(<ToastProvider><Grab />{withSlot && <div data-testid="map"><SeatToastSlot /></div>}</ToastProvider>) })
}
afterEach(() => { act(() => root?.unmount()); container?.remove() })

const top = () => document.querySelector('[data-testid="toast-container"]')
const slot = () => document.querySelector('[data-testid="seat-toast-slot"]')

describe('SeatToastSlot', () => {
  it('有落點：入座回饋進落點、一般 toast 留頂部', () => {
    mount(true)
    act(() => { api.action('✓ 林先生 3 位 → 105 已入座', { label: '復原', onClick: () => {} }, { duration: 8000, placement: 'seat' }) })
    act(() => { api.info('新訂位：王先生 2 位') })
    expect(slot().textContent).toContain('✓ 林先生 3 位 → 105 已入座')
    expect(slot().querySelector('[data-testid="toast-action"]').textContent).toContain('復原')
    expect(top().textContent).toContain('新訂位：王先生 2 位')
    expect(top().textContent).not.toContain('105 已入座')
  })

  it('沒有落點：入座回饋退回頂部（不會不見）', () => {
    mount(false)
    act(() => { api.success('✓ 林先生 3 位 → 105 已入座', { duration: 8000, placement: 'seat' }) })
    expect(slot()).toBeNull()
    expect(top().textContent).toContain('105 已入座')
  })

  it('落點本身不佔高度、外框不吃點擊（一面式版面不變）', () => {
    mount(true)
    expect(slot().className).toContain('pointer-events-none')
    expect(slot().className).toContain('absolute')
    expect(slot().parentElement.className.trim()).toBe('relative')
  })
})
