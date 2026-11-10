import { describe, it, expect, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import ModeBanner from '../../src/components/admin/ops/ModeBanner'

// 驗收問題 3：現場指派模式的預配警示要據實——重疊寫「將解除」、不重疊寫「會保留」，
// 確認鈕也不能在預配會保留時還寫「覆蓋」。

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mode = { type: 'assign', booking: { id: 'C', name: '陳小姐', guests: 2, timeSlot: '13:30' }, suitable: ['105'], suggestion: '106' }
const yu = (slot) => ({ id: 'Y', name: '余先生', guests: 2, timeSlot: slot, status: 'confirmed' })

describe('ModeBanner：預配衝突據實', () => {
  let container, root
  const render = (pendingConflicts, m = mode) => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => { root.render(<ModeBanner mode={m} pendingConfirm="105" pendingConflicts={pendingConflicts} onCancel={() => {}} onConfirm={() => {}} onClearPending={() => {}} />) })
  }
  const buttons = () => [...container.querySelectorAll('button')].map(b => b.textContent)
  afterEach(() => { act(() => root?.unmount()); container?.remove() })

  it('重疊 → 「11:00 余先生 的預配將解除」＋「仍要覆蓋指派」', () => {
    render([{ booking: yu('11:00'), overlaps: true, willRelease: true }])
    expect(container.textContent).toContain('11:00 余先生（2 位）· 時間衝突：確認後 余先生 要重排')
    expect(buttons()).toContain('仍要覆蓋指派')
  })

  it('不重疊 → 「20:30 余先生 的預配會保留」＋「仍要指派（預配保留）」', () => {
    render([{ booking: yu('20:30'), overlaps: false, willRelease: false }])
    expect(container.textContent).toContain('時間不衝突，余先生 的排位保留')
    expect(container.textContent).not.toContain('將解除')
    expect(buttons()).toContain('仍要指派（預配保留）')
  })

  // 鎖桌時機（capacity.lockKindFor）：確認句據實講「指派並鎖桌」還是「預配（桌子現在仍可帶位）」
  // 按鈕上的 ✓ 已改成線條圖示（GlyphText，aria-hidden），按鈕文字＝純文字
  it('lockKind hold（或舊呼叫點沒帶）→「確認指派 陳小姐 至桌 105 並鎖桌？」＋「確認指派」鈕', () => {
    render(null, { ...mode, lockKind: 'hold' })
    expect(container.textContent).toContain('確認指派 陳小姐 至桌 105 並鎖桌？')
    expect(container.textContent).toContain('指派即鎖桌')
    expect(buttons()).toContain('確認指派')
  })

  it('lockKind preassign →「確認預配 陳小姐 到 105？（桌子現在仍可帶位）」＋「確認預配」鈕，banner 標出時段預配', () => {
    render(null, { ...mode, lockKind: 'preassign' })
    expect(container.textContent).toContain('確認預配 陳小姐 到 105？（桌子現在仍可帶位）')
    expect(container.textContent).toContain('13:30 預配 · 桌子先不鎖')
    expect(container.textContent).not.toContain('並鎖桌')
    expect(container.textContent).not.toContain('確認指派')
    expect(buttons()).toContain('確認預配')
  })

  it('lockKind preassign ＋他筆預配衝突 → 按鈕也講「預配」（覆蓋／保留）', () => {
    render([{ booking: yu('11:00'), overlaps: true, willRelease: true }], { ...mode, lockKind: 'preassign' })
    expect(buttons()).toContain('仍要覆蓋預配')
    act(() => root.unmount()); container.remove()
    render([{ booking: yu('20:30'), overlaps: false, willRelease: false }], { ...mode, lockKind: 'preassign' })
    expect(buttons()).toContain('仍要預配（他筆預配保留）')
  })
})

// 2026-10-17：多桌選位的警示依嚴重度配色——會解除別組或佔團體桌＝紅；只是提醒（對方保留）＝黃。勾選門檻不變。
describe('ModeBanner：多桌警示嚴重度配色', () => {
  let container, root
  const multi = { type: 'assign-multi', kind: 'booking', booking: { id: 'Y', name: '楊先生', guests: 10, timeSlot: '18:30' }, need: 10, selected: ['107'], suitable: ['107'], suggestionTables: [] }
  const render = (severe) => {
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
    act(() => { root.render(<ModeBanner mode={multi} multiSeats={4} multiMaxSeats={5} multiWarnings={['107 已排給 16:30 王先生（4 位）· 時間不衝突，王先生 的排位保留']} multiWarningSevere={severe} multiWarningConfirmed={false} onConfirmWarning={() => {}} onCancel={() => {}} onConfirmMulti={() => {}} onClearSelection={() => {}} />) })
  }
  afterEach(() => { act(() => root?.unmount()); container?.remove() })
  const box = () => [...container.querySelectorAll('label')].find(l => l.textContent.includes('知道了，仍用這桌')).parentElement

  it('只是提醒 → 黃底；仍要勾「知道了，仍用這桌」', () => {
    render(false)
    expect(box().className).toContain('bg-amber-100')
    expect(box().querySelector('input[type="checkbox"]').checked).toBe(false)
  })
  it('會解除別組／佔團體桌 → 紅底', () => {
    render(true)
    expect(box().className).toContain('bg-rose-600')
  })
})

// night-50 B3：選桌入座橫幅可直接改到店人數（−／＋ ≥44px），改了只回報給 onChangeNeed；B5：原預配被佔要講出來
describe('ModeBanner：選桌入座改人數／換桌入座', () => {
  let container, root
  afterEach(() => { act(() => root?.unmount()); container?.remove() })
  const arrive = (over = {}) => ({ type: 'assign-multi', kind: 'arrive', booking: { id: 'Z', name: '張先生', guests: 4 }, need: 4, selected: [], suitable: ['104'], ...over })
  const render = (m, onChangeNeed) => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => { root.render(<ModeBanner mode={m} onChangeNeed={onChangeNeed} onCancel={() => {}} onConfirmMulti={() => {}} />) })
  }
  it('＋／− 回報新人數；按鈕 ≥44px；人數與訂位不同時提示「入座時一併改」', () => {
    const calls = []
    render(arrive({ need: 6 }), n => calls.push(n))
    const plus = container.querySelector('button[aria-label="人數加一"]')
    const minus = container.querySelector('button[aria-label="人數減一"]')
    expect(plus.className).toContain('min-h-[44px]')
    expect(plus.className).toContain('min-w-[44px]')
    act(() => plus.dispatchEvent(new window.MouseEvent('click', { bubbles: true })))
    act(() => minus.dispatchEvent(new window.MouseEvent('click', { bubbles: true })))
    expect(calls).toEqual([7, 5])
    expect(container.querySelector('[data-testid="arrive-need"]').textContent).toBe('6 位')
    expect(container.textContent).toContain('訂位 4 位 · 入座時一併改')
  })
  it('原預配被佔 → 標題「到了 · 換桌入座」＋「原預配 102 被佔」', () => {
    render(arrive({ reseatFrom: ['102'] }), () => {})
    expect(container.textContent).toContain('到了 · 換桌入座：張先生 4 位')
    expect(container.querySelector('[data-testid="arrive-reseat-from"]').textContent).toContain('原預配 102 被佔')
  })
  it('非選桌入座（指派）不出現人數列', () => {
    render(arrive({ kind: 'booking' }), () => {})
    expect(container.querySelector('button[aria-label="人數加一"]')).toBeNull()
  })
})
