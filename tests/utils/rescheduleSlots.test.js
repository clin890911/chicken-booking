import { describe, it, expect } from 'vitest'
import { rescheduleSlotOptions } from '../../src/utils/rescheduleSlots'

const booking = { date: '2026-10-05', timeSlot: '18:00', guests: 2 }
const server = [
  { time: '17:00', remaining: 20, closed: true }, // 例如抵達前不足 2 小時
  { time: '18:00', remaining: 0, closed: true },  // 原時段
  { time: '18:30', remaining: 20, closed: false },
  { time: 'bad', remaining: 9 },
]

describe('rescheduleSlotOptions（我的訂位改期可選時段）', () => {
  it('後端 closed 的時段不可改過去（即使座位很多）；原時段保留並加回自己佔的座位', () => {
    const out = rescheduleSlotOptions(server, booking, { date: '2026-10-05', guests: 2 })
    expect(out.map(s => [s.time, s.full, s.closed, s.remaining])).toEqual([
      ['17:00', true, true, 20],
      ['18:00', false, false, 2],
      ['18:30', false, false, 20],
    ])
  })
  it('換到別天：同名時段不算原時段，closed 一律不可選', () => {
    const out = rescheduleSlotOptions(server, booking, { date: '2026-10-06', guests: 2 })
    expect(out.filter(s => s.full).map(s => s.time)).toEqual(['17:00', '18:00'])
  })
  it('未 closed 時維持原本以人數判斷', () => {
    const out = rescheduleSlotOptions([{ time: '12:00', remaining: 3 }], booking, { date: '2026-10-06', guests: 4 })
    expect(out[0]).toMatchObject({ full: true, closed: false, period: '午餐' })
  })
  it('非陣列輸入回空陣列', () => {
    expect(rescheduleSlotOptions(null, booking, {})).toEqual([])
  })
})
