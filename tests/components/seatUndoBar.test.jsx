// 2026-11-27 驗收 P1 第三輪：現場頁入座提示不可互動＋復原欄（固定保留、只留最近一筆）
import { describe, it, expect, afterEach, vi } from 'vitest'
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { ToastProvider, useToast } from '../../src/components/ui/Toast'
import { useRegisterSeatUndoSlot } from '../../src/components/ui/seatUndoContext'
import SeatUndoBar from '../../src/components/admin/ops/SeatUndoBar'
import { toastSeatUndo, toastSeatDone, seatUndoTextOf } from '../../src/utils/seatFeedback'
import { toastWaitlistSeat } from '../../src/utils/waitlistSeatToast'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let api, container, root
function Probe() { api = useToast(); return null }
function OpsLike() { useRegisterSeatUndoSlot(); return <SeatUndoBar /> }
const mount = (withSlot = true) => {
  container = document.createElement('div'); document.body.appendChild(container)
  root = createRoot(container)
  act(() => root.render(<ToastProvider><Probe />{withSlot && <OpsLike />}</ToastProvider>))
}
const bar = () => document.querySelector('[data-testid="seat-undo-bar"]')
const undoBtn = () => document.querySelector('[data-testid="seat-undo-action"]')
afterEach(() => { act(() => root?.unmount()); container?.remove(); vi.useRealTimers() })

describe('seatUndoTextOf', () => {
  it('去掉 ✓ 與「已入座」；換桌句原樣', () => {
    expect(seatUndoTextOf('✓ 王先生 3 位 → 101 已入座')).toBe('王先生 3 位 → 101')
    expect(seatUndoTextOf('✓ 林先生 3 位 改到 103')).toBe('林先生 3 位 改到 103')
  })
})

describe('現場頁（有復原欄）', () => {
  it('入座提示：pointer-events:none、沒有任何按鈕；復原進復原欄（讀屏名帶對象）', () => {
    vi.useFakeTimers()
    mount()
    expect(bar().dataset.state).toBe('empty')
    expect(bar().textContent).toBe('最近動作')
    const onUndo = vi.fn()
    act(() => { toastSeatUndo(api, '✓ 王先生 3 位 → 101 已入座', { ariaLabel: '復原帶位 101', onUndo }) })
    const t = document.querySelector('[data-placement="seat"]')
    expect(t.className).toContain('pointer-events-none')
    expect(t.hasAttribute('data-passive')).toBe(true)
    expect(t.querySelector('button')).toBeNull()
    expect(document.querySelector('[data-testid="toast-action"]')).toBeNull()
    expect(bar().dataset.state).toBe('live')
    expect(undoBtn().getAttribute('aria-label')).toBe('復原帶位 101')
    expect(undoBtn().textContent).toContain('復原：王先生 3 位 → 101')
    // 提示約 4 秒消失（退場動畫在假時鐘下不跑，這裡只驗復原欄照 8 秒、不跟著提示消失）
    act(() => { vi.advanceTimersByTime(4100) })
    expect(bar().dataset.state).toBe('live')
    act(() => undoBtn().click())
    expect(onUndo).toHaveBeenCalledTimes(1)
    expect(bar().dataset.state).toBe('empty')
  })

  it('只保留最近一筆：新的取代舊的，舊的不能再復原；時效到變淡色「最近」不可按', () => {
    vi.useFakeTimers()
    mount()
    const a = vi.fn(), b = vi.fn()
    act(() => { toastSeatUndo(api, '✓ A 2 位 → 101 已入座', { ariaLabel: '復原帶位 101', onUndo: a }) })
    act(() => { vi.advanceTimersByTime(3000) })
    act(() => { toastSeatUndo(api, '✓ B 2 位 → 102 已入座', { ariaLabel: '復原帶位 102', onUndo: b }) })
    expect(undoBtn().getAttribute('aria-label')).toBe('復原帶位 102')
    // A 的 8 秒到期不影響 B
    act(() => { vi.advanceTimersByTime(5500) })
    expect(bar().dataset.state).toBe('live')
    act(() => { vi.advanceTimersByTime(3000) })
    expect(bar().dataset.state).toBe('recent')
    expect(undoBtn()).toBeNull()
    expect(bar().textContent).toBe('最近：B 2 位 → 102')
    expect(a).not.toHaveBeenCalled(); expect(b).not.toHaveBeenCalled()
  })

  it('沒有復原的入座提示也不可互動', () => {
    mount()
    act(() => { toastSeatDone(api, '✓ 團體 → 201 已入座') })
    const t = document.querySelector('[data-placement="seat"]')
    expect(t.className).toContain('pointer-events-none')
    expect(t.querySelector('button')).toBeNull()
  })

  it('候位入座：復原時效照後端（例 4 秒），不另疊「可復原」提示；「查看」不出現在浮動提示', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-27T04:00:00Z'))
    mount()
    const undo = vi.fn(async () => ({ ok: true }))
    const result = { item: { id: 'W1', assignedTableNumber: '102', bookingId: 'B1' }, commandId: 'c1', tables: [], undoUntil: new Date(Date.now() + 4000).toISOString() }
    act(() => { toastWaitlistSeat(result, { message: '✓ 陳先生 2 位 → 102 已入座', toast: api, undoWaitlistSeat: undo, onView: () => {} }) })
    const toasts = document.querySelectorAll('[data-placement="seat"]')
    expect(toasts).toHaveLength(1)
    expect(toasts[0].querySelector('button')).toBeNull()
    expect(undoBtn().textContent).toContain('陳先生 2 位 → 102')
    act(() => { vi.advanceTimersByTime(4100) })
    expect(bar().dataset.state).toBe('recent')
  })

  it('取消、離席等非入座（placement 不是 seat）維持原狀：toast 照樣帶按鈕', () => {
    mount()
    act(() => { api.action('已取消 王小姐 的訂位', { label: '復原', onClick: () => {} }, { duration: 0 }) })
    expect(document.querySelector('[data-testid="toast-action"]')).not.toBeNull()
    expect(bar().dataset.state).toBe('empty')
  })
})

describe('沒有復原欄的畫面（非現場頁）行為不變', () => {
  it('入座提示照舊帶「復原」按鈕', () => {
    mount(false)
    act(() => { toastSeatUndo(api, '✓ 王先生 3 位 → 101 已入座', { ariaLabel: '復原入座 王先生', onUndo: () => {} }) })
    const btn = document.querySelector('[data-testid="toast-action"]')
    expect(btn.getAttribute('aria-label')).toBe('復原入座 王先生')
    expect(document.querySelector('[data-placement="seat"]').className).toContain('pointer-events-auto')
  })
})

describe('離開現場頁', () => {
  it('復原欄卸載 → 那一筆作廢，回來不能再按', () => {
    let show = true, setShow
    function Host() { const [v, sv] = useState(true); setShow = sv; show = v; return v ? <OpsLike /> : null }
    container = document.createElement('div'); document.body.appendChild(container)
    root = createRoot(container)
    act(() => root.render(<ToastProvider><Probe /><Host /></ToastProvider>))
    act(() => { toastSeatUndo(api, '✓ A 2 位 → 101 已入座', { ariaLabel: '復原帶位 101', onUndo: () => {} }) })
    expect(bar().dataset.state).toBe('live')
    act(() => setShow(false))
    act(() => setShow(true))
    expect(show).toBe(true)
    expect(bar().dataset.state).toBe('empty')
  })
})

describe('復原欄在工具列裡（toolbar）', () => {
  it('同一行 → 左側分隔線＋內距；不改高度（h-11）', () => {
    mount(false)
    act(() => root.render(<ToastProvider><Probe /><div><button>放大視圖</button><SeatUndoBar toolbar /></div></ToastProvider>))
    expect(bar().dataset.wrapped).toBe('false')
    expect(bar().className).toMatch(/\bborder-l\b/)
    expect(bar().className).toMatch(/\bpl-2\b/)
    expect(bar().className).toMatch(/\bh-11\b/)
  })
  it('不在工具列（排程／摘要）→ 不加分組樣式', () => {
    mount(false)
    act(() => root.render(<ToastProvider><Probe /><div><button>x</button><SeatUndoBar /></div></ToastProvider>))
    expect(bar().dataset.wrapped).toBeUndefined()
    expect(bar().className).not.toMatch(/\bborder-l\b|\btop-2\b/)
  })
})
