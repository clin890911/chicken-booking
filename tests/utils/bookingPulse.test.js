import { describe, it, expect } from 'vitest'
import { classifyTodayPulse, fmtOverdueMin, overdueMinOf } from '../../src/utils/bookingPulse'

const TODAY = '2026-06-10'
// 固定 now = 今天 12:00
const NOW = new Date(2026, 5, 10, 12, 0, 0, 0).getTime()
const mkB = (id, timeSlot, overrides = {}) =>
  ({ id, date: TODAY, timeSlot, status: 'confirmed', ...overrides })

describe('classifyTodayPulse（今日訂位三段分類）', () => {
  it('過時未到（> 15 分寬限）/ 90 分內將到 / 之後 三段', () => {
    const bookings = [
      mkB('over2h', '09:30'),   // 過 150 分 → overdue
      mkB('over20', '11:40'),   // 過 20 分 → overdue
      mkB('grace', '11:50'),    // 過 10 分（寬限內）→ soon
      mkB('now', '12:00'),      // 現在 → soon
      mkB('in90', '13:30'),     // 90 分後（含）→ soon
      mkB('in91', '13:35'),     // 95 分後 → later
      mkB('night', '18:00'),    // 晚市 → later
    ]
    const r = classifyTodayPulse(bookings, TODAY, NOW)
    expect(r.overdue.map(b => b.id)).toEqual(['over2h', 'over20']) // 過越久越前
    expect(r.soon.map(b => b.id)).toEqual(['grace', 'now', 'in90'])
    expect(r.later.map(b => b.id)).toEqual(['in91', 'night'])
  })

  it('非今日 / 非 confirmed / 無時段 都排除', () => {
    const bookings = [
      mkB('other-day', '12:00', { date: '2026-06-11' }),
      mkB('arrived', '11:00', { status: 'arrived' }),
      mkB('noshow', '11:00', { status: 'noshow' }),
      mkB('cancelled', '11:00', { status: 'cancelled' }),
      mkB('no-slot', '', {}),
    ]
    const r = classifyTodayPulse(bookings, TODAY, NOW)
    expect(r.overdue.length + r.soon.length + r.later.length).toBe(0)
  })

  it('邊界：剛好過 15 分在寬限內、過 16 分算 overdue', () => {
    const r = classifyTodayPulse([mkB('a', '11:45'), mkB('b', '11:44')], TODAY, NOW)
    expect(r.soon.map(b => b.id)).toEqual(['a'])
    expect(r.overdue.map(b => b.id)).toEqual(['b'])
  })
})

describe('fmtOverdueMin / overdueMinOf', () => {
  it('59 分內顯示分鐘、60 分起顯示時與分（395 分 → 6 時 35 分）', () => {
    expect(fmtOverdueMin(59)).toBe('已過預約時間 59 分')
    expect(fmtOverdueMin(60)).toBe('已過預約時間 1 時')
    expect(fmtOverdueMin(395)).toBe('已過預約時間 6 時 35 分')
  })
  it('overdueMinOf：正值＝已過 N 分', () => {
    expect(overdueMinOf('11:30', NOW)).toBe(30)
    expect(overdueMinOf('12:30', NOW)).toBe(-30)
  })
})
