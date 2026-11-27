// 2026-11-27 C 包（verify P2-4）：現場頁入座提示同時最多 1 則，新的取代舊的（與復原欄只留最近一筆一致）。
// framer-motion 換成直接渲染：jsdom 跑不完退場動畫，被取代的舊提示會一直留在 DOM（實機 0.16 秒淡出）。
import { describe, it, expect, afterEach, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'

vi.mock('framer-motion', async () => {
  const React = await import('react')
  const strip = ({ initial, animate, exit, transition, ...rest }) => rest // eslint-disable-line no-unused-vars
  return {
    AnimatePresence: ({ children }) => React.createElement(React.Fragment, null, children),
    motion: new Proxy({}, { get: (_, tag) => React.forwardRef((p, ref) => React.createElement(tag, { ...strip(p), ref })) }),
  }
})

const { ToastProvider, useToast } = await import('../../src/components/ui/Toast')
const { useRegisterSeatUndoSlot } = await import('../../src/components/ui/seatUndoContext')
const { default: SeatUndoBar } = await import('../../src/components/admin/ops/SeatUndoBar')
const { toastSeatUndo, toastSeatDone } = await import('../../src/utils/seatFeedback')

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let api, container, root
function Probe() { api = useToast(); return null }
function OpsLike() { useRegisterSeatUndoSlot(); return <SeatUndoBar /> }
const mount = (withSlot = true) => {
  container = document.createElement('div'); document.body.appendChild(container)
  root = createRoot(container)
  act(() => root.render(<ToastProvider><Probe />{withSlot && <OpsLike />}</ToastProvider>))
}
afterEach(() => { act(() => root?.unmount()); container?.remove() })

// 2026-11-27 C 包（verify P2-4）：現場頁入座提示同時最多 1 則，新的取代舊的（與復原欄只留最近一筆一致）
describe('現場頁入座提示同時最多 1 則', () => {
  it('連續三次入座：畫面上只剩最新一則入座提示；其他提示不受影響', () => {
    mount()
    act(() => { api.info('新訂位：王先生', { duration: 0 }) })
    act(() => { toastSeatUndo(api, '✓ A 2 位 → 101 已入座', { ariaLabel: '復原帶位 101', onUndo: () => {} }) })
    act(() => { toastSeatDone(api, '✓ 團體 → 201 已入座') })
    act(() => { toastSeatUndo(api, '✓ C 3 位 → 103 已入座', { ariaLabel: '復原帶位 103', onUndo: () => {} }) })
    const seat = [...document.querySelectorAll('[data-placement="seat"]')]
    expect(seat.map(el => el.textContent)).toEqual([expect.stringContaining('C 3 位 → 103')])
    expect(seat[0].className).toContain('pointer-events-none')
    expect(seat[0].querySelector('button')).toBeNull()
    expect(document.body.textContent).toContain('新訂位：王先生')
  })
  it('沒有復原欄的頁面（非現場頁）入座提示照舊可疊', () => {
    mount(false)
    act(() => { toastSeatUndo(api, '✓ A 2 位 → 101 已入座', { ariaLabel: '復原帶位 101', onUndo: () => {} }) })
    act(() => { toastSeatUndo(api, '✓ B 2 位 → 102 已入座', { ariaLabel: '復原帶位 102', onUndo: () => {} }) })
    expect(document.querySelectorAll('[data-placement="seat"]').length).toBe(2)
  })
})
