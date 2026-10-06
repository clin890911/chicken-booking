import { describe, it, expect } from 'vitest'
import { findGroupClosedDateBatch } from '../../functions/lib/groupClosure.js'

// groupReserveTables 的「關閉」把關（functions/lib/groupClosure.js）。
// 2026-10 店主語意：關閉場次 / 時段只停線上客人，後台建團不擋；公休日維持原狀照擋。
const DATE = '2026-10-10'
const SEATINGS = [{ id: 'lunch1', name: '午餐第一批', start: '11:00', end: '12:30' }]
const settings = (closures) => ({ seatings: SEATINGS, closures: { closedDates: [], closedSlots: {}, closedSeatings: {}, ...closures } })
const group = (over = {}) => ({
  id: 'G1', date: DATE,
  batches: [{ id: 'b1', label: '第一梯', timeSlot: '11:00', tableNumbers: ['101'], guests: 6 }],
  ...over,
})

describe('findGroupClosedDateBatch', () => {
  it('closedSeatings 關了該場次 → 不擋', () => {
    expect(findGroupClosedDateBatch(settings({ closedSeatings: { [DATE]: ['lunch1'] } }), group())).toBeNull()
  })
  it('closedSlots 關了該時段 → 不擋', () => {
    expect(findGroupClosedDateBatch(settings({ closedSlots: { [DATE]: ['11:00'] } }), group())).toBeNull()
  })
  it('closedDates 公休日 → 擋，回傳有圈桌的梯次', () => {
    expect(findGroupClosedDateBatch(settings({ closedDates: [DATE] }), group())).toMatchObject({ id: 'b1', label: '第一梯' })
  })
  it('公休日但沒有圈任何桌 → 不擋（與舊行為一致：只擋有圈桌的梯次）', () => {
    const g = group({ batches: [{ id: 'b1', label: '第一梯', timeSlot: '11:00', tableNumbers: [], guests: 6 }] })
    expect(findGroupClosedDateBatch(settings({ closedDates: [DATE] }), g)).toBeNull()
  })
  it('別天公休 / 沒有 closures → 不擋', () => {
    expect(findGroupClosedDateBatch(settings({ closedDates: ['2026-10-11'] }), group())).toBeNull()
    expect(findGroupClosedDateBatch({}, group())).toBeNull()
    expect(findGroupClosedDateBatch(undefined, undefined)).toBeNull()
  })
})
