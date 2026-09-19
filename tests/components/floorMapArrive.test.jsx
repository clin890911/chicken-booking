import { describe, it, expect } from 'vitest'
import { isArriveEligible, isPreassignArriveEligible, ARRIVE_WINDOW_BEFORE_MIN, ARRIVE_WINDOW_AFTER_MIN } from '../../src/components/admin/floormap/FloorMap'

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

// 2026-09：預配（桌沒鎖給這筆）的待到訂位也進報到列，時間窗同鎖桌（前 30／後 60 分）
describe('isPreassignArriveEligible（預配訂位的報到窗口）', () => {
  const at = (h, m = 0) => new Date(2026, 8, 19, h, m).getTime()
  const t = (over = {}) => ({ number: '105', status: 'vacant', currentBookingId: null, ...over })
  const pre = (over = {}) => ({ id: 'P', name: '余先生', date: '2026-09-19', timeSlot: '12:00', status: 'confirmed', assignedTableId: '105', ...over })

  it('預配 12:00：11:30（前 30）～13:00（後 60）在窗內；11:29／13:01 不在', () => {
    expect(isPreassignArriveEligible(t(), pre(), at(11, 40))).toBe(true)
    expect(isPreassignArriveEligible(t(), pre(), at(11, 30))).toBe(true)
    expect(isPreassignArriveEligible(t(), pre(), at(13, 0))).toBe(true)
    expect(isPreassignArriveEligible(t(), pre(), at(11, 29))).toBe(false)
    expect(isPreassignArriveEligible(t(), pre(), at(13, 1))).toBe(false)
  })
  it('桌此刻被別組佔著仍列（按到了由入座守門擋下並給改桌）', () => {
    expect(isPreassignArriveEligible(t({ status: 'dining', currentBookingId: 'OTHER' }), pre(), at(11, 40))).toBe(true)
  })
  it('鎖桌給這筆（held）不走這條；非今天、非待到、桌號不符都不列', () => {
    expect(isPreassignArriveEligible(t({ status: 'reserved', currentBookingId: 'P' }), pre(), at(11, 40))).toBe(false)
    expect(isPreassignArriveEligible(t(), pre({ date: '2026-09-20' }), at(11, 40))).toBe(false)
    expect(isPreassignArriveEligible(t(), pre({ status: 'arrived' }), at(11, 40))).toBe(false)
    expect(isPreassignArriveEligible(t({ number: '106' }), pre(), at(11, 40))).toBe(false)
  })
})
