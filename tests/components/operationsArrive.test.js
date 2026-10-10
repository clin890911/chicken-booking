import { describe, it, expect, vi } from 'vitest'
import { handleArriveNow, preassignArriveConflictLines } from '../../src/components/admin/OperationsView.jsx'

// 「✓ 到了」一鍵入座的復原邏輯：抽成純函式（注入 seatBooking/setStatus/setTableStatus/toast）
// 方便單測，不必掛載整個 OperationsView（需要 BookingProvider/AuthProvider/ToastProvider
// 才能跑，不划算）。重點驗證：不二次確認直接呼叫 seatBooking；復原要「booking 與 table
// 兩邊都倒回去」——repo 內其他復原路徑曾經只復原 booking、沒復原 table（不完整實作），
// 這裡是刻意都做，用測試釘住不能回退。

const table = { number: 'A2' }
const booking = { id: 'bk1', name: '王小明' }

// 2026-10 起四個「客人到了」入口的復原統一走 undoSeatBooking(r.undo)（service 拍的入座前快照），
// 不再由呼叫端各自 setStatus＋setTableStatus。
const UNDO = { bookingId: 'bk1', tableNumbers: ['A2'], restore: { A2: 'reserved' } }
function makeDeps(overrides = {}) {
  return {
    seatBooking: vi.fn(() => ({ ok: true, undo: UNDO })),
    undoSeatBooking: vi.fn(() => ({ ok: true })),
    toast: { success: vi.fn(), error: vi.fn(), action: vi.fn(), info: vi.fn() },
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

  it('入座成功：toast.action 帶訊息、「復原」標籤（純文字，不用 emoji）、5 秒 duration', () => {
    const deps = makeDeps()
    handleArriveNow(table, booking, deps)
    expect(deps.toast.action).toHaveBeenCalledTimes(1)
    const [message, action, opts] = deps.toast.action.mock.calls[0]
    expect(message).toBe('王小明 已入座 A2')
    expect(action.label).toBe('復原')
    expect(opts).toEqual({ duration: 5000 })
  })

  it('復原：把 seatBooking 回傳的入座前快照原封交給 undoSeatBooking（booking 與 table 由 service 一起倒）', () => {
    const deps = makeDeps()
    handleArriveNow(table, booking, deps)
    const [, action] = deps.toast.action.mock.calls[0]
    action.onClick()
    expect(deps.undoSeatBooking).toHaveBeenCalledWith(UNDO)
    expect(deps.toast.info).toHaveBeenCalledWith('已復原：王小明 回到待到')
  })

  it('復原被擋（桌已被別組佔走）→ toast.error 說明，不硬搶', () => {
    const deps = makeDeps({ undoSeatBooking: vi.fn(() => ({ ok: false, error: 'A2 已被別組使用，無法復原' })) })
    handleArriveNow(table, booking, deps)
    deps.toast.action.mock.calls[0][1].onClick()
    expect(deps.toast.error).toHaveBeenCalledWith('復原失敗：A2 已被別組使用，無法復原')
  })

  it('入座失敗（例如桌被搶走）：不彈 toast.action，改用 toast.error，不呼叫復原', () => {
    const deps = makeDeps({ seatBooking: vi.fn(() => ({ ok: false, error: '桌位已被佔用' })) })
    handleArriveNow(table, booking, deps)
    expect(deps.toast.error).toHaveBeenCalledWith('入座失敗：桌位已被佔用')
    expect(deps.toast.action).not.toHaveBeenCalled()
    expect(deps.undoSeatBooking).not.toHaveBeenCalled()
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
    expect(deps.undoSeatBooking).not.toHaveBeenCalled()
  })

  it('併桌訂位不給改桌（單桌 move 會留孤兒額外桌）→ 退回 toast.error', () => {
    const deps = makeDeps({ seatBooking: vi.fn(() => ({ ok: false, error: '被佔用' })), onMove: vi.fn() })
    handleArriveNow(table, { ...booking, extraTableIds: ['A3'] }, deps)
    expect(deps.toast.error).toHaveBeenCalledWith('入座失敗：被佔用')
    expect(deps.toast.action).not.toHaveBeenCalled()
  })
})

// 2026-09：報到列也列「預配」訂位（桌沒鎖給這筆）。復原一律走 undoSeatBooking(r.undo)——
// 快照裡預配的桌記成 vacant（倒回空桌、預配保留）、鎖桌的記成 reserved，由 service 決定，呼叫端不分岔。
describe('handleArriveNow：預配訂位的入座與復原', () => {
  const vacant = { number: '105', status: 'vacant', currentBookingId: null }
  const pre = { id: 'bkP', name: '余先生', assignedTableId: '105' }
  const PRE_UNDO = { bookingId: 'bkP', tableNumbers: ['105'], restore: { 105: 'vacant' } }

  it('預配桌空著 → 照常 seatBooking；復原把快照交給 undoSeatBooking', () => {
    const deps = makeDeps({ seatBooking: vi.fn(() => ({ ok: true, undo: PRE_UNDO })) })
    handleArriveNow(vacant, pre, deps)
    expect(deps.seatBooking).toHaveBeenCalledWith('bkP')
    const [msg, action] = deps.toast.action.mock.calls[0]
    expect(msg).toBe('余先生 已入座 105')
    action.onClick()
    expect(deps.undoSeatBooking).toHaveBeenCalledWith(PRE_UNDO)
  })

  it('復原被擋（桌已被更動）→ toast.error 說明，不硬倒', () => {
    const deps = makeDeps({ undoSeatBooking: vi.fn(() => ({ ok: false, error: '這筆訂位的桌位已被更動，無法復原' })) })
    handleArriveNow(vacant, pre, deps)
    deps.toast.action.mock.calls[0][1].onClick()
    expect(deps.toast.error).toHaveBeenCalledWith('復原失敗：這筆訂位的桌位已被更動，無法復原')
  })

  it('鎖桌（held：桌 reserved 且 currentBookingId＝這筆）→ 同一套復原', () => {
    const deps = makeDeps()
    handleArriveNow({ number: '105', status: 'reserved', currentBookingId: 'bkP' }, pre, deps)
    deps.toast.action.mock.calls[0][1].onClick()
    expect(deps.undoSeatBooking).toHaveBeenCalledWith(UNDO)
  })
})

// 驗收 v4-1：預配那條「到了」遇團保桌或他筆預配（用餐區間重疊）→ 先確認（與今日訂位卡同一道防呆）
describe('handleArriveNow：預配訂位遇團保／重疊預配先確認', () => {
  const vacant = { number: '105', status: 'vacant', currentBookingId: null }
  const pre = { id: 'bkP', name: '余先生', date: '2026-09-19', timeSlot: '12:00', assignedTableId: '105' }
  const lines = () => ['105 為今日團體「甲旅行社」預留（第一梯 12:30）']

  it('有衝突 → 先 confirm；取消 → 不入座、不 toast', async () => {
    const confirm = vi.fn(async () => false)
    const deps = makeDeps({ confirm, preassignConflictLines: lines })
    const r = await handleArriveNow(vacant, pre, deps)
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('105 為今日團體「甲旅行社」預留（第一梯 12:30）'),
      expect.objectContaining({ title: '桌位有預留', confirmLabel: '仍要入座' }))
    expect(r).toEqual({ ok: false, cancelled: true })
    expect(deps.seatBooking).not.toHaveBeenCalled()
    expect(deps.toast.action).not.toHaveBeenCalled()
  })

  it('有衝突 → 確認後才入座，成功 toast 帶復原', async () => {
    const deps = makeDeps({ confirm: vi.fn(async () => true), preassignConflictLines: lines })
    await handleArriveNow(vacant, pre, deps)
    expect(deps.seatBooking).toHaveBeenCalledWith('bkP')
    deps.toast.action.mock.calls[0][1].onClick()
    expect(deps.undoSeatBooking).toHaveBeenCalledWith(UNDO)
  })

  it('桌已被別組佔 → 不問（讓入座守門擋下並給改桌）', () => {
    const confirm = vi.fn()
    const onMove = vi.fn()
    const deps = makeDeps({ confirm, preassignConflictLines: lines, onMove,
      seatBooking: vi.fn(() => ({ ok: false, error: '105 目前由 別組 使用，請先改桌' })) })
    handleArriveNow({ number: '105', status: 'dining', currentBookingId: 'OTHER' }, pre, deps)
    expect(confirm).not.toHaveBeenCalled()
    expect(deps.toast.action.mock.calls[0][1].label).toBe('改桌')
  })

  it('鎖桌（held）那條不走確認（維持原樣）', () => {
    const confirm = vi.fn()
    const deps = makeDeps({ confirm, preassignConflictLines: lines })
    handleArriveNow({ number: '105', status: 'reserved', currentBookingId: 'bkP' }, pre, deps)
    expect(confirm).not.toHaveBeenCalled()
    expect(deps.seatBooking).toHaveBeenCalledWith('bkP')
  })
})

describe('preassignArriveConflictLines（團保＋他筆預配，PR #131 區間重疊口徑）', () => {
  const now = new Date(2026, 8, 19, 11, 50)
  const me = { id: 'ME', name: '余先生', date: '2026-09-19', timeSlot: '12:00', status: 'confirmed', assignedTableId: '105' }
  const other = (slot) => ({ id: 'O' + slot, name: '陳小姐', guests: 2, date: '2026-09-19', timeSlot: slot, status: 'confirmed', assignedTableId: '105' })
  const hold = { '105': { agencyName: '甲旅行社', holds: [{ batch: { label: '第一梯', timeSlot: '12:30' } }] } }

  it('團保 → 一條；重疊的他筆預配（12:30）→ 一條；不重疊（18:00）不列；自己不算', () => {
    const lines = preassignArriveConflictLines(me, { bookings: [me, other('12:30'), other('18:00')], groupHoldTables: hold, now })
    expect(lines).toEqual([
      '105 為今日團體「甲旅行社」預留（第一梯 12:30）',
      '105 已預先配給 陳小姐（2 位 · 12:30），用餐時段重疊',
    ])
  })
  it('大組：額外桌的團保也列', () => {
    const combo = { ...me, assignedTableId: '106', extraTableIds: ['105'] }
    expect(preassignArriveConflictLines(combo, { bookings: [combo], groupHoldTables: hold, now })).toEqual([
      '105 為今日團體「甲旅行社」預留（第一梯 12:30）',
    ])
  })
})

// 驗收 v4-3：預配的大組（主桌＋額外桌）→ 整組入座（seatBookingAllTables）；被擋不給改桌（單桌 move 會留孤兒額外桌）
describe('handleArriveNow：預配大組', () => {
  const combo = { id: 'bkC', name: '大組', assignedTableId: '106', extraTableIds: ['105'] }
  const t106 = { number: '106', status: 'vacant', currentBookingId: null }

  it('整組都空 → seatBookingAllTables；toast 寫整組桌號；復原交給 undoSeatBooking（整組快照）', () => {
    const COMBO_UNDO = { bookingId: 'bkC', tableNumbers: ['106', '105'], restore: { 106: 'vacant', 105: 'vacant' } }
    const seatBookingAllTables = vi.fn(() => ({ ok: true, undo: COMBO_UNDO }))
    const deps = makeDeps({ seatBookingAllTables, getTable: () => ({ number: '105', status: 'vacant' }) })
    handleArriveNow(t106, combo, deps)
    expect(seatBookingAllTables).toHaveBeenCalledWith('bkC')
    expect(deps.seatBooking).not.toHaveBeenCalled()
    const [msg, action] = deps.toast.action.mock.calls[0]
    expect(msg).toBe('大組 已入座 106 + 105')
    action.onClick()
    expect(deps.undoSeatBooking).toHaveBeenCalledWith(COMBO_UNDO)
  })

  it('任一張被佔 → 不入座，toast.error 說明（不給改桌）', () => {
    const deps = makeDeps({ onMove: vi.fn(),
      seatBookingAllTables: vi.fn(() => ({ ok: false, code: 'table-occupied', error: '105 目前由 別組 使用，請先改桌' })),
      getTable: () => ({ number: '105', status: 'dining', currentBookingId: 'OTHER' }) })
    handleArriveNow(t106, combo, deps)
    expect(deps.toast.error).toHaveBeenCalledWith('入座失敗：106+105 有桌被佔（105 目前由 別組 使用），請到今日訂位卡處理')
    expect(deps.toast.action).not.toHaveBeenCalled()
  })
})
