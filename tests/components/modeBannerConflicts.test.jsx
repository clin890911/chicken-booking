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
    expect(container.textContent).toContain('確認後 11:00 余先生 的預配將解除')
    expect(buttons()).toContain('仍要覆蓋指派')
  })

  it('不重疊 → 「20:30 余先生 的預配會保留」＋「仍要指派（預配保留）」', () => {
    render([{ booking: yu('20:30'), overlaps: false, willRelease: false }])
    expect(container.textContent).toContain('20:30 余先生 的預配會保留')
    expect(container.textContent).not.toContain('將解除')
    expect(buttons()).toContain('仍要指派（預配保留）')
  })

  // 鎖桌時機（capacity.lockKindFor）：確認句據實講「指派並鎖桌」還是「預配（桌子現在仍可帶位）」
  it('lockKind hold（或舊呼叫點沒帶）→「確認指派 陳小姐 至桌 105 並鎖桌？」＋「✓ 確認指派」', () => {
    render(null, { ...mode, lockKind: 'hold' })
    expect(container.textContent).toContain('確認指派 陳小姐 至桌 105 並鎖桌？')
    expect(container.textContent).toContain('指派即鎖桌')
    expect(buttons()).toContain('✓ 確認指派')
  })

  it('lockKind preassign →「預配（桌子現在仍可帶位）」＋「✓ 確認指派（預配）」，banner 標出時段預配', () => {
    render(null, { ...mode, lockKind: 'preassign' })
    expect(container.textContent).toContain('確認指派 陳小姐 至桌 105 · 預配（桌子現在仍可帶位）？')
    expect(container.textContent).toContain('13:30 預配 · 桌子先不鎖')
    expect(container.textContent).not.toContain('並鎖桌')
    expect(buttons()).toContain('✓ 確認指派（預配）')
  })
})
