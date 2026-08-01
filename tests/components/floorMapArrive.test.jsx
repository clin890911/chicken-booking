import { describe, it, expect } from 'vitest'
import { isArriveEligible, ARRIVE_WINDOW_BEFORE_MIN, ARRIVE_WINDOW_AFTER_MIN } from '../../src/components/admin/floormap/FloorMap'

// 「到了」出現窗口判定：純函式。二版設計（報到列，見 arrivalStrip.test.jsx）把消費端從
// 疊在桌況圖上的浮動鈕改成地圖下方的 in-flow 列，但窗口判定邏輯不變、仍沿用同一份純函式。
// （一版的浮動鈕掛載測試已移除：獨立驗收發現相鄰桌的鈕會互相完全遮擋，可能誤觸入座錯的
// 訂位，店主已拍板改設計，見 tests/components/arrivalStrip.test.jsx。）

const baseTable = (over = {}) => ({
  number: '101', capacity: 4, floor: '1F', x: 100, y: 100, w: 80, h: 75,
  rotation: 0, zoneId: null, isActive: true, outage: null, status: 'reserved',
  currentBookingId: 'b1', currentRef: null, seatedAt: null, mergedWith: null,
  blockReason: null, updatedAt: null, ...over,
})

const NOW = new Date(2026, 6, 1, 18, 0, 0).getTime() // 2026-07-01 18:00

describe('isArriveEligible（純函式：出現窗口判定）', () => {
  const booking = { id: 'b1', name: '王小明', timeSlot: '18:00' }

  it('訂位時間前 30 分內：符合', () => {
    const now = NOW - ARRIVE_WINDOW_BEFORE_MIN * 60000
    expect(isArriveEligible(baseTable(), booking, now)).toBe(true)
  })

  it('訂位時間後 60 分內：符合', () => {
    const now = NOW + ARRIVE_WINDOW_AFTER_MIN * 60000
    expect(isArriveEligible(baseTable(), booking, now)).toBe(true)
  })

  it('超前窗口（前 31 分）：不符合', () => {
    const now = NOW - (ARRIVE_WINDOW_BEFORE_MIN + 1) * 60000
    expect(isArriveEligible(baseTable(), booking, now)).toBe(false)
  })

  it('超過窗口（後 61 分）：不符合', () => {
    const now = NOW + (ARRIVE_WINDOW_AFTER_MIN + 1) * 60000
    expect(isArriveEligible(baseTable(), booking, now)).toBe(false)
  })

  it('桌況非 reserved：不符合（即使時間在窗內）', () => {
    expect(isArriveEligible(baseTable({ status: 'dining' }), booking, NOW)).toBe(false)
  })

  it('沒有對應 booking：不符合', () => {
    expect(isArriveEligible(baseTable(), null, NOW)).toBe(false)
  })

  it('booking 沒有 timeSlot：不符合', () => {
    expect(isArriveEligible(baseTable(), { id: 'b1', name: '王小明' }, NOW)).toBe(false)
  })

  it('table 為 null：不符合（防呆）', () => {
    expect(isArriveEligible(null, booking, NOW)).toBe(false)
  })
})
