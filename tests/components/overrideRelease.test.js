import { describe, it, expect, vi } from 'vitest'
import { releaseOverriddenPreassigns } from '../../src/components/admin/OperationsView.jsx'

// S4（2026-09 撞桌止血）：現場指派/帶位時店員確認「仍要覆蓋」某筆預配 →
// 真的呼叫 Context 的 releaseOverriddenAssignment 解除被覆蓋那筆，並 toast 告知店員要重新指派。
// 過去警示寫「○○ 將變回未配桌」、程式卻沒做，兩筆訂位同時聲稱同一張桌。

const deps = (release = vi.fn(() => ({ ok: true, tableNumbers: ['105'] }))) => ({
  releaseOverriddenAssignment: release,
  toast: { info: vi.fn() },
})

describe('releaseOverriddenPreassigns', () => {
  it('解除被覆蓋那筆並 toast「余先生原本的預配 105 已解除，請重新指派」', () => {
    const d = deps()
    const done = releaseOverriddenPreassigns([{ id: 'Y', name: '余先生' }], '105', d)
    expect(d.releaseOverriddenAssignment).toHaveBeenCalledWith('Y')
    expect(d.toast.info).toHaveBeenCalledWith('余先生原本的預配 105 已解除，請重新指派', { duration: 8000 })
    expect(done).toEqual(['Y'])
  })

  it('同一筆只解除一次（併桌帶位兩張桌指向同一筆）；null 略過', () => {
    const d = deps(vi.fn(() => ({ ok: true, tableNumbers: ['105', '106'] })))
    releaseOverriddenPreassigns([{ id: 'Y', name: '余先生' }, null, { id: 'Y', name: '余先生' }], '105 + 106', d)
    expect(d.releaseOverriddenAssignment).toHaveBeenCalledTimes(1)
    expect(d.toast.info).toHaveBeenCalledWith('余先生原本的預配 105 + 106 已解除，請重新指派', { duration: 8000 })
  })

  it('沒有被覆蓋的預配 → 什麼都不做', () => {
    const d = deps()
    expect(releaseOverriddenPreassigns([], '105', d)).toEqual([])
    expect(d.releaseOverriddenAssignment).not.toHaveBeenCalled()
    expect(d.toast.info).not.toHaveBeenCalled()
  })

  it('解除失敗（例如那筆已到店）→ 不謊稱已解除', () => {
    const d = deps(vi.fn(() => ({ ok: false, error: '這筆訂位已不是待到狀態' })))
    releaseOverriddenPreassigns([{ id: 'Y', name: '余先生' }], '105', d)
    expect(d.toast.info).not.toHaveBeenCalled()
  })
})
