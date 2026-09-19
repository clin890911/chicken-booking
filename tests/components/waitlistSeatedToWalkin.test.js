import { describe, it, expect, vi } from 'vitest'
import { seatedToWalkin } from '../../src/components/admin/OperationsView.jsx'

// 候位入座成功後的收尾：抽成純函式方便單測（同 handleArriveNow 同一套手法，注入
// setSelectedTable/setMode/setPendingConfirm/setRailTab/toast，不必掛載整個
// OperationsView——那需要 BookingProvider/AuthProvider/ToastProvider 才能跑，不划算，
// 見 tests/components/operationsArrive.test.js）。
//
// 店主原話：「候位的客人選定位子後，會直接回到帶位頁面，這樣 UX 比較順」。修正前，
// 候位入座三條成功路徑（二步確認單桌 executeAssign、併桌 confirmWalkinMulti、桌況抽屜
// 候選名單 TableCandidatePanel）都會 setSelectedTable(number) 打開桌況抽屜、且不切換
// 左欄籤——店員入座完還得自己關抽屜、切回「帶位」籤才能接著帶下一組。這裡鎖住新行為：
// 不開抽屜、直接切回帶位籤、清掉 mode，toast 帶「查看」動作按下才回頭開抽屜。

function makeDeps() {
  return {
    setSelectedTable: vi.fn(),
    setMode: vi.fn(),
    setPendingConfirm: vi.fn(),
    setRailTab: vi.fn(),
    toast: { action: vi.fn() },
  }
}

describe('seatedToWalkin（候位入座成功收尾）', () => {
  it('不開桌況抽屜（setSelectedTable(null)）、切回帶位籤（setRailTab("walkin")）、清掉 mode', () => {
    const deps = makeDeps()
    seatedToWalkin('111', '黃先生 已入座 111', deps)

    expect(deps.setSelectedTable).toHaveBeenCalledWith(null)
    expect(deps.setMode).toHaveBeenCalledWith(null)
    expect(deps.setPendingConfirm).toHaveBeenCalledWith(null)
    expect(deps.setRailTab).toHaveBeenCalledWith('walkin')
    // 沒有任何呼叫把 selectedTable 設成真正的桌號（也就是說抽屜不會自動打開）
    expect(deps.setSelectedTable).not.toHaveBeenCalledWith('111')
  })

  it('toast.action 帶原始訊息與「查看」標籤', () => {
    const deps = makeDeps()
    seatedToWalkin('111', '黃先生 已入座 111', deps)

    expect(deps.toast.action).toHaveBeenCalledTimes(1)
    const [message, action] = deps.toast.action.mock.calls[0]
    expect(message).toBe('黃先生 已入座 111')
    expect(action.label).toBe('查看')
  })

  it('按下 toast 的「查看」才會真正打開該桌抽屜（setSelectedTable(桌號)）', () => {
    const deps = makeDeps()
    seatedToWalkin('111', '黃先生 已入座 111', deps)

    const [, action] = deps.toast.action.mock.calls[0]
    deps.setSelectedTable.mockClear()
    action.onClick()
    expect(deps.setSelectedTable).toHaveBeenCalledWith('111')
  })

  it('併桌情境：桌號是多桌的第一張，訊息原樣帶入', () => {
    const deps = makeDeps()
    seatedToWalkin('105', '訪客（候位 #3・9 位）併桌入座 105 + 106 + 109 · 可指派下一組', deps)

    expect(deps.setRailTab).toHaveBeenCalledWith('walkin')
    const [message, action] = deps.toast.action.mock.calls[0]
    expect(message).toContain('併桌入座 105 + 106 + 109')
    action.onClick()
    expect(deps.setSelectedTable).toHaveBeenCalledWith('105')
  })
})
