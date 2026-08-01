import { describe, it, expect, vi } from 'vitest'
import { handleArriveNow } from '../../src/components/admin/OperationsView.jsx'

// 「✓ 到了」一鍵入座的復原邏輯：抽成純函式（注入 seatBooking/setStatus/setTableStatus/toast）
// 方便單測，不必掛載整個 OperationsView（需要 BookingProvider/AuthProvider/ToastProvider
// 才能跑，不划算）。重點驗證：不二次確認直接呼叫 seatBooking；復原要「booking 與 table
// 兩邊都倒回去」——repo 內其他復原路徑曾經只復原 booking、沒復原 table（不完整實作），
// 這裡是刻意都做，用測試釘住不能回退。

const table = { number: 'A2' }
const booking = { id: 'bk1', name: '王小明' }

function makeDeps(overrides = {}) {
  return {
    seatBooking: vi.fn(() => ({ ok: true })),
    setStatus: vi.fn(),
    setTableStatus: vi.fn(),
    toast: { success: vi.fn(), error: vi.fn(), action: vi.fn() },
    ...overrides,
  }
}

describe('handleArriveNow', () => {
  it('直接呼叫 seatBooking(booking.id)，不經過任何確認框', () => {
    const deps = makeDeps()
    handleArriveNow(table, booking, deps)
    expect(deps.seatBooking).toHaveBeenCalledTimes(1)
    expect(deps.seatBooking).toHaveBeenCalledWith('bk1')
  })

  it('入座成功：toast.action 帶訊息、「↩ 復原」標籤、5 秒 duration', () => {
    const deps = makeDeps()
    handleArriveNow(table, booking, deps)
    expect(deps.toast.action).toHaveBeenCalledTimes(1)
    const [message, action, opts] = deps.toast.action.mock.calls[0]
    expect(message).toBe('王小明 已入座 A2')
    expect(action.label).toBe('↩ 復原')
    expect(opts).toEqual({ duration: 5000 })
  })

  it('復原：同時把 booking 改回 confirmed、table 改回 reserved 且 seatedAt 清 null', () => {
    const deps = makeDeps()
    handleArriveNow(table, booking, deps)
    const [, action] = deps.toast.action.mock.calls[0]
    action.onClick()
    expect(deps.setStatus).toHaveBeenCalledWith('bk1', 'confirmed')
    expect(deps.setTableStatus).toHaveBeenCalledWith('A2', 'reserved', { seatedAt: null })
  })

  it('入座失敗（例如桌被搶走）：不彈 toast.action，改用 toast.error，不呼叫 setStatus/setTableStatus', () => {
    const deps = makeDeps({ seatBooking: vi.fn(() => ({ ok: false, error: '桌位已被佔用' })) })
    handleArriveNow(table, booking, deps)
    expect(deps.toast.error).toHaveBeenCalledWith('入座失敗：桌位已被佔用')
    expect(deps.toast.action).not.toHaveBeenCalled()
    expect(deps.setStatus).not.toHaveBeenCalled()
    expect(deps.setTableStatus).not.toHaveBeenCalled()
  })
})
