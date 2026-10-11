import { describe, it, expect } from 'vitest'
import { slotForDateChange, nextBookableSlot } from '../../src/utils/staffSlots'

// 後台新增／編輯訂位換日期：原時段在新日期仍可訂就保留（不清空）；
// 不行 → 新日期是今天就預選下一個可訂時段、其他日清空重選。（vitest 固定 TZ=Asia/Taipei）
const NOW = new Date(2026, 9, 10, 14, 10)        // 2026-10-10 14:10
const TODAY = '2026-10-10'
const TOMORROW = '2026-10-11'
const settings = { openTime: '11:00', closeTime: '20:00', slotInterval: 30, diningDurationMin: 90, cleanupBufferMin: 10 }
const tables = [{ number: '101', capacity: 4, isActive: true }]
const ctx = (over = {}) => ({ settings, tables, bookings: [], groupReservations: [], guests: 2, now: NOW, ...over })

describe('slotForDateChange', () => {
  it('明天同一時段仍可訂 → 保留', () => {
    expect(slotForDateChange('18:00', ctx({ date: TOMORROW }))).toBe('18:00')
  })
  it('改到今天、原時段已過 → 預選下一個可訂時段（14:30）', () => {
    expect(slotForDateChange('12:00', ctx({ date: TODAY }))).toBe('14:30')
  })
  it('改到今天、原時段還沒過 → 保留', () => {
    expect(slotForDateChange('18:00', ctx({ date: TODAY }))).toBe('18:00')
  })
  it('新日期該時段已滿 → 其他日清空', () => {
    const bookings = [{ id: 'x', date: TOMORROW, timeSlot: '18:00', guests: 4, status: 'confirmed' }]
    expect(slotForDateChange('18:00', ctx({ date: TOMORROW, bookings }))).toBe('')
  })
  it('新日期公休 → 清空', () => {
    const s = { ...settings, closures: { closedDates: [TOMORROW], closedSlots: {}, closedSeatings: {} } }
    expect(slotForDateChange('18:00', ctx({ date: TOMORROW, settings: s }))).toBe('')
  })
  it('只線上關閉（closedSlots）不算不可訂 → 保留（員工可訂）', () => {
    const s = { ...settings, closures: { closedDates: [], closedSlots: { [TOMORROW]: ['18:00'] }, closedSeatings: {} } }
    expect(slotForDateChange('18:00', ctx({ date: TOMORROW, settings: s }))).toBe('18:00')
  })
  it('原本沒選時段 → 今天預選下一個、其他日留空', () => {
    expect(slotForDateChange('', ctx({ date: TODAY }))).toBe('14:30')
    expect(slotForDateChange('', ctx({ date: TOMORROW }))).toBe('')
  })
  it('新日期的時段表沒有這個時段（營業時間不同）→ 清空', () => {
    expect(slotForDateChange('21:30', ctx({ date: TOMORROW }))).toBe('')
  })
})

describe('nextBookableSlot', () => {
  it('下一個「還沒開始」且席數夠的時段', () => {
    expect(nextBookableSlot(ctx({ date: TODAY }))).toBe('14:30')
  })
})
