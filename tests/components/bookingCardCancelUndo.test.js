// BookingCard／TableDrawer 共用的「取消訂位 + ↩ 復原」邏輯。
// 抽成純函式方便單測（不必掛載整個 BookingCard，那需要 BookingProvider/AuthProvider/
// ToastProvider/ConfirmProvider 才能跑，不划算，見 tests/components/bookingCardNoshow.test.js
// 的 markNoshow 同一套手法）。確認對話框留在元件內，這裡只涵蓋確認後的邏輯。
//
// 這裡刻意注入「真的」seatingService.cancelBooking / undoCancelBooking（不 mock）：
// 只驗證 mock 被呼叫過什麼參數，蓋不住「復原沒把桌位倒回來」這種缺陷——而那正是 2026-08
// 抓到的既有 bug：復原只呼叫 setStatus(id,'confirmed')，訂位變回「待到」但桌已經被放掉、
// assignedTableId 是空的，店員以為復原了，實際上那組客人的桌沒了、畫面上還看不出來。
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { cancelWithUndo } from '../../src/components/booking/BookingCard.jsx'
import * as seating from '../../src/services/seatingService'
import * as tableService from '../../src/services/tableService'
import * as bookingService from '../../src/services/bookingService'

function mkTable(number, capacity, floor = '1F') {
  return {
    number, capacity, floor,
    x: 100, y: 100, w: 80, h: 75,
    isActive: true, outage: null,
    status: 'vacant', currentBookingId: null, currentRef: null,
    seatedAt: null, mergedWith: null, blockReason: null, updatedAt: null,
  }
}

function makeToast() {
  return { success: vi.fn(), error: vi.fn(), action: vi.fn() }
}

// 元件實際注入的就是 BookingContext 包一層的同名函式，這裡直接用 service 本尊。
const deps = (toast) => ({
  cancelBooking: seating.cancelBooking,
  undoCancelBooking: seating.undoCancelBooking,
  toast,
})

function mkBooking(overrides = {}) {
  return bookingService.create({
    name: '王小明', phone: '0912345678', guests: 2,
    date: '2026-06-15', timeSlot: '18:00', source: 'online', status: 'confirmed',
    ...overrides,
  })
}

// toast.action 的復原鈕
function clickUndo(toast) {
  const [, action] = toast.action.mock.calls[0]
  action.onClick()
}

describe('cancelWithUndo（取消訂位 + 可復原 toast）', () => {
  beforeEach(() => {
    tableService.bulkWrite([mkTable('101', 4, '1F'), mkTable('108', 6, '1F')])
  })

  it('取消：桌釋出、訂位 cancelled，並給出 8 秒的「↩ 復原」', () => {
    const b = mkBooking()
    seating.assignBookingToTable(b.id, '101')
    const toast = makeToast()

    cancelWithUndo(b, deps(toast))

    expect(bookingService.getById(b.id).status).toBe('cancelled')
    expect(tableService.getByNumber('101').status).toBe('vacant')
    expect(toast.action).toHaveBeenCalledTimes(1)
    const [message, action, opts] = toast.action.mock.calls[0]
    expect(message).toBe('已取消 王小明 的訂位')
    expect(action.label).toBe('↩ 復原')
    expect(opts).toEqual({ duration: 8000 })
  })

  it('★ 取消 → 復原：booking 與桌位都回到原狀（不是只把狀態改回待到、桌卻沒了）', () => {
    const b = mkBooking()
    seating.assignBookingToTable(b.id, '101')
    const toast = makeToast()

    cancelWithUndo(b, deps(toast))
    clickUndo(toast)

    const updated = bookingService.getById(b.id)
    expect(updated.status).toBe('confirmed')
    expect(updated.assignedTableId).toBe('101')     // ★ 桌位真的倒回來了
    const t = tableService.getByNumber('101')
    expect(t.status).toBe('reserved')
    expect(t.currentBookingId).toBe(b.id)
    expect(toast.success).toHaveBeenCalledWith('已復原 王小明 的訂位，101 已改回保留')
  })

  it('復原時桌已被別組佔走：安全失敗——訂位仍復原、桌不硬搶，toast 明講要重新指派', () => {
    const b = mkBooking()
    seating.assignBookingToTable(b.id, '101')
    const toast = makeToast()

    cancelWithUndo(b, deps(toast))
    seating.walkInSeat('101', { name: '別組', guests: 2 })   // 復原前那幾秒被別組坐走
    clickUndo(toast)

    const updated = bookingService.getById(b.id)
    expect(updated.status).toBe('confirmed')
    expect(updated.assignedTableId).toBeNull()      // 不留指向別組桌位的孤兒桌號
    expect(tableService.getByNumber('101').status).toBe('dining')  // 別組不受影響
    expect(toast.success).toHaveBeenCalledWith(
      '已復原 王小明 的訂位（101 已被占用，桌位未搶回，請重新指派）',
    )
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('沒指派桌的訂位：取消/復原都不碰桌', () => {
    const b = mkBooking()
    const toast = makeToast()

    cancelWithUndo(b, deps(toast))
    clickUndo(toast)

    expect(bookingService.getById(b.id).status).toBe('confirmed')
    expect(toast.success).toHaveBeenCalledWith('已復原 王小明 的訂位')
  })

  it('取消失敗 → 報錯、不給復原鈕', () => {
    const toast = makeToast()
    cancelWithUndo({ id: 'NOPE', name: '幽靈' }, deps(toast))
    expect(toast.error).toHaveBeenCalledWith('取消失敗：訂位不存在')
    expect(toast.action).not.toHaveBeenCalled()
  })

  it('復原失敗（訂位已被別的操作改動）→ 報錯給店員，不靜默吞掉', () => {
    const b = mkBooking()
    const toast = makeToast()
    cancelWithUndo(b, deps(toast))
    bookingService.setStatus(b.id, 'confirmed')     // 別的路徑先把它改回來了
    clickUndo(toast)
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('復原失敗：'))
    expect(toast.success).not.toHaveBeenCalled()
  })
})
