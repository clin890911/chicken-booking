import { describe, it, expect } from 'vitest'
import { dayPhase } from '../../src/utils/dayPhase'

const SETTINGS = {
  openTime: '11:00',
  closeTime: '19:00',
  seatings: [
    { id: 'lunch1', name: '午餐第一批', start: '11:00', end: '12:30' },
    { id: 'lunch2', name: '午餐第二批', start: '12:30', end: '14:30' },
    { id: 'dinner1', name: '晚餐第一批', start: '17:00', end: '19:00' },
  ],
}
const at = (h, m = 0) => new Date(2026, 5, 10, h, m, 0, 0).getTime()

describe('dayPhase（一天營運節奏）', () => {
  it('開店前 / 場次中 / 空檔 / 打烊後', () => {
    expect(dayPhase(SETTINGS, at(10, 30)).phase).toBe('before-open')
    expect(dayPhase(SETTINGS, at(12, 0))).toMatchObject({ phase: 'service', seating: { id: 'lunch1' } })
    expect(dayPhase(SETTINGS, at(15, 0))).toMatchObject({ phase: 'between', next: { id: 'dinner1' } })
    expect(dayPhase(SETTINGS, at(18, 0))).toMatchObject({ phase: 'service', seating: { id: 'dinner1' } })
    expect(dayPhase(SETTINGS, at(19, 30)).phase).toBe('after-close')
  })
  it('seatings 空陣列 → fallback openTime/closeTime', () => {
    const s = { ...SETTINGS, seatings: [] }
    expect(dayPhase(s, at(10, 0)).phase).toBe('before-open')
    expect(dayPhase(s, at(12, 0)).phase).toBe('between') // 無場次定義時營業中視為 between
    expect(dayPhase(s, at(20, 0)).phase).toBe('after-close')
  })
})
