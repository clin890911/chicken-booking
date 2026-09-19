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

// S1 擋下入座（桌被別組佔用／停用）時，報到列的 toast 直接帶「改桌」出口（2026-09）
describe('handleArriveNow：入座被擋時給改桌出口', () => {
  it('有 onMove → toast.action（label 改桌），點了把這筆訂位交給 onMove；不動 booking/table', () => {
    const onMove = vi.fn()
    const deps = makeDeps({ seatBooking: vi.fn(() => ({ ok: false, error: 'A2 目前由 陳小姐 使用，請先改桌' })), onMove })
    handleArriveNow(table, booking, deps)
    const [msg, action, opts] = deps.toast.action.mock.calls[0]
    expect(msg).toBe('入座失敗：A2 目前由 陳小姐 使用，請先改桌')
    expect(action.label).toBe('改桌')
    expect(opts.type).toBe('error')
    action.onClick()
    expect(onMove).toHaveBeenCalledWith(booking)
    expect(deps.setStatus).not.toHaveBeenCalled()
    expect(deps.setTableStatus).not.toHaveBeenCalled()
  })

  it('併桌訂位不給改桌（單桌 move 會留孤兒額外桌）→ 退回 toast.error', () => {
    const deps = makeDeps({ seatBooking: vi.fn(() => ({ ok: false, error: '被佔用' })), onMove: vi.fn() })
    handleArriveNow(table, { ...booking, extraTableIds: ['A3'] }, deps)
    expect(deps.toast.error).toHaveBeenCalledWith('入座失敗：被佔用')
    expect(deps.toast.action).not.toHaveBeenCalled()
  })
})

// 2026-09：報到列也列「預配」訂位（桌沒鎖給這筆）。入座的 5 秒復原要把桌倒回空桌、訂位回待到且保留預配，
// 走 undoSeatPreassigned（只在桌仍由這筆用餐中時才倒）；不可沿用鎖桌那條把桌寫回 reserved。
describe('handleArriveNow：預配訂位的入座與復原', () => {
  const vacant = { number: '105', status: 'vacant', currentBookingId: null }
  const pre = { id: 'bkP', name: '余先生', assignedTableId: '105' }

  it('預配桌空著 → 照常 seatBooking；復原走 undoSeatPreassigned，不碰 setStatus/setTableStatus', () => {
    const undoSeatPreassigned = vi.fn(() => ({ ok: true }))
    const deps = makeDeps({ undoSeatPreassigned })
    handleArriveNow(vacant, pre, deps)
    expect(deps.seatBooking).toHaveBeenCalledWith('bkP')
    const [msg, action] = deps.toast.action.mock.calls[0]
    expect(msg).toBe('余先生 已入座 105')
    action.onClick()
    expect(undoSeatPreassigned).toHaveBeenCalledWith('bkP', '105')
    expect(deps.setStatus).not.toHaveBeenCalled()
    expect(deps.setTableStatus).not.toHaveBeenCalled()
  })

  it('復原被擋（桌已被更動）→ toast.error 說明，不硬倒', () => {
    const deps = makeDeps({ undoSeatPreassigned: vi.fn(() => ({ ok: false, error: '這筆訂位或桌位已被更動，無法復原' })) })
    handleArriveNow(vacant, pre, deps)
    deps.toast.action.mock.calls[0][1].onClick()
    expect(deps.toast.error).toHaveBeenCalledWith('復原失敗：這筆訂位或桌位已被更動，無法復原')
  })

  it('鎖桌（held：桌 reserved 且 currentBookingId＝這筆）→ 復原維持原本那條（setStatus＋setTableStatus reserved）', () => {
    const undoSeatPreassigned = vi.fn()
    const deps = makeDeps({ undoSeatPreassigned })
    handleArriveNow({ number: '105', status: 'reserved', currentBookingId: 'bkP' }, pre, deps)
    deps.toast.action.mock.calls[0][1].onClick()
    expect(undoSeatPreassigned).not.toHaveBeenCalled()
    expect(deps.setStatus).toHaveBeenCalledWith('bkP', 'confirmed')
    expect(deps.setTableStatus).toHaveBeenCalledWith('105', 'reserved', { seatedAt: null })
  })
})
