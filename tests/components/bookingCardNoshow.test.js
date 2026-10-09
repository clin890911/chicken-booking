import { describe, it, expect, vi, beforeEach } from 'vitest'
import { markNoshow, restoreFromNoshow } from '../../src/components/booking/BookingCard.jsx'
import { recordNoshow, getNoshowCount, revokeNoshow } from '../../src/services/bookingService'
import * as bookingService from '../../src/services/bookingService'
import * as tableService from '../../src/services/tableService'
import * as seating from '../../src/services/seatingService'

// BookingCard 的 No-show 標記/復原：抽成純函式方便單測（不必掛載整個 BookingCard，
// 需要 BookingProvider/AuthProvider/ToastProvider/ConfirmProvider 才能跑，不划算，
// 見 tests/components/operationsArrive.test.js 的 handleArriveNow 同一套手法）。
// 這裡刻意注入「真的」seatingService.markNoshow / undoMarkNoshow（不 mock）：
// 只驗證 mock 被呼叫過什麼參數，蓋不住「函式邏輯本身寫錯」——要鎖住的是
// 2026-08 抓到的既有 bug：No-show 復原沒有把 recordNoshow 加上去的次數扣回，
// 客人身上會冤枉留著一次爽約紀錄；以及 R5：手動標 No-show 不釋放鎖住的桌。

const booking = { id: 'BK1', name: '王小明', phone: '0911222333' }

function makeToast() {
  return { success: vi.fn(), action: vi.fn(), error: vi.fn() }
}

const deps = (toast) => ({
  markBookingNoshow: seating.markNoshow,
  undoMarkBookingNoshow: seating.undoMarkNoshow,
  getNoshowCount,
  toast,
})

function seed({ tableStatus = 'vacant', heldByMe = false } = {}) {
  tableService.bulkWrite([{ number: '101', capacity: 4, floor: '1F', isActive: true, status: tableStatus,
    currentBookingId: null, currentRef: null, seatedAt: null }])
  const b = bookingService.create({ name: '王小明', phone: booking.phone, guests: 2, date: '2026-08-01',
    timeSlot: '18:00', source: 'online', status: 'confirmed' })
  if (heldByMe) seating.assignBookingToTable(b.id, '101')
  return { ...booking, id: b.id }
}

describe('markNoshow（過時未到/訂位列表共用的 No-show 標記邏輯）', () => {
  beforeEach(() => { localStorage.clear() })

  it('booking → noshow，toast 講出目前累計次數', () => {
    const b = seed()
    const toast = makeToast()
    markNoshow(b, deps(toast))
    expect(bookingService.getById(b.id).status).toBe('noshow')
    expect(toast.action).toHaveBeenCalledTimes(1)
    const [message, action, opts] = toast.action.mock.calls[0]
    expect(message).toBe('已標記 王小明 No-show — 這支電話累計第 1 次，之後訂位會提醒')
    expect(action.label).toBe('↩ 復原')
    expect(opts).toEqual({ duration: 8000 })
  })

  it('標記→次數 +1→復原→次數回到原值（不會冤枉客人留著爽約紀錄）', () => {
    const b = seed()
    const toast = makeToast()
    markNoshow(b, deps(toast))
    expect(getNoshowCount(b.phone)).toBe(1)

    const [, action] = toast.action.mock.calls[0]
    action.onClick() // 點「↩ 復原」

    expect(bookingService.getById(b.id).status).toBe('confirmed')
    expect(getNoshowCount(b.phone)).toBe(0)
    expect(toast.success).toHaveBeenCalledWith('已復原 王小明 為待到，爽約次數已扣回')
  })

  it('R5 鎖桌（reserved 且由本訂位持有）一併釋出；復原時桌仍空 → reserve 回來', () => {
    const b = seed({ heldByMe: true })
    expect(tableService.getByNumber('101').status).toBe('reserved')
    const toast = makeToast()
    markNoshow(b, deps(toast))
    expect(tableService.getByNumber('101').status).toBe('vacant')        // ★ 不再卡 reserved
    expect(toast.action.mock.calls[0][0]).toContain('101 已釋出空桌')
    toast.action.mock.calls[0][1].onClick()
    const t = tableService.getByNumber('101')
    expect(t.status).toBe('reserved')
    expect(t.currentBookingId).toBe(b.id)
  })

  it('沒有既有紀錄時的文案退化（count 查詢回 0 的邊界）', () => {
    const b = seed()
    const toast = makeToast()
    markNoshow(b, { ...deps(toast), getNoshowCount: () => 0 })
    const [message] = toast.action.mock.calls[0]
    expect(message).toBe('已標記 王小明 No-show — 已記錄這支電話的爽約次數')
  })
})

describe('restoreFromNoshow（卡片常駐「↩ 恢復為待到」鈕——No-show 復原的第二入口）', () => {
  it('復原：setStatus 改回 confirmed、爽約次數扣回、toast 說明後果', () => {
    recordNoshow({ phone: booking.phone, date: '2026-08-01', id: booking.id })
    expect(getNoshowCount(booking.phone)).toBe(1)

    const setStatus = vi.fn()
    const toast = makeToast()
    restoreFromNoshow(booking, { setStatus, revokeNoshow, toast })

    expect(setStatus).toHaveBeenCalledWith('BK1', 'confirmed')
    expect(getNoshowCount(booking.phone)).toBe(0)
    expect(toast.success).toHaveBeenCalledWith('王小明 已恢復為待到，爽約次數已扣回')
  })

  it('依 bookingId 精準扣回：同電話另一筆訂位的爽約紀錄不受影響', () => {
    recordNoshow({ phone: booking.phone, date: '2026-07-01', id: 'BK1' })
    recordNoshow({ phone: booking.phone, date: '2026-07-15', id: 'BK2' })
    expect(getNoshowCount(booking.phone)).toBe(2)

    restoreFromNoshow(booking, { setStatus: vi.fn(), revokeNoshow, toast: makeToast() })

    expect(getNoshowCount(booking.phone)).toBe(1) // 只扣掉 BK1 那一筆，BK2 仍在
  })

  it('與 UpcomingPanel.jsx 過時未到清單的 No-show toast 文案一致（同一套訊息格式）', () => {
    localStorage.clear()
    const b = seed()
    const toast = makeToast()
    markNoshow(b, deps(toast))
    const [message] = toast.action.mock.calls[0]
    // UpcomingPanel.handleNoshow 的訊息格式：`已標記 ${b.name} No-show — ${countMsg}`
    expect(message).toMatch(/^已標記 王小明 No-show — 這支電話累計第 \d+ 次，之後訂位會提醒$/)
  })
})
