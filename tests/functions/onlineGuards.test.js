import { describe, it, expect } from 'vitest'
import {
  normalizeOnlineGuardSettings,
  isOverAutoCloseThreshold,
} from '../../functions/lib/onlineGuards.js'

// 線上訂位防線純邏輯（functions/lib/onlineGuards.js）。
// 這層擋的是兩類營運事故：
// 1) 接近滿座仍收線上訂位 → 現場/電話客人無位可坐
// 2) 餐期開始前才湧入的線上訂位 → 廚房備餐量失準
//    （此項已改由 functions/lib/guestReliability.js「抵達前 2 小時」負責；onlineSessionCutoffMin 只剩相容資料 key）

describe('normalizeOnlineGuardSettings（設定正規化）', () => {
  it('預設：關閉、80%、0 分鐘（不啟用截止）', () => {
    expect(normalizeOnlineGuardSettings()).toEqual({
      onlineAutoCloseEnabled: false,
      onlineAutoClosePercent: 80,
      onlineSessionCutoffMin: 0,
    })
  })
  it('enabled 只認布林 true（truthy 字串/數字不算，與 lineNotifyOnAdminChange 同口徑）', () => {
    expect(normalizeOnlineGuardSettings({ onlineAutoCloseEnabled: 'true' }).onlineAutoCloseEnabled).toBe(false)
    expect(normalizeOnlineGuardSettings({ onlineAutoCloseEnabled: 1 }).onlineAutoCloseEnabled).toBe(false)
    expect(normalizeOnlineGuardSettings({ onlineAutoCloseEnabled: true }).onlineAutoCloseEnabled).toBe(true)
  })
  it('percent clamp 50–100，非法值回 80', () => {
    expect(normalizeOnlineGuardSettings({ onlineAutoClosePercent: 30 }).onlineAutoClosePercent).toBe(50)
    expect(normalizeOnlineGuardSettings({ onlineAutoClosePercent: 120 }).onlineAutoClosePercent).toBe(100)
    expect(normalizeOnlineGuardSettings({ onlineAutoClosePercent: 'abc' }).onlineAutoClosePercent).toBe(80)
    expect(normalizeOnlineGuardSettings({ onlineAutoClosePercent: '85' }).onlineAutoClosePercent).toBe(85)
  })
  it('cutoff clamp 0–720，非法值回 0（= 不啟用）', () => {
    expect(normalizeOnlineGuardSettings({ onlineSessionCutoffMin: -10 }).onlineSessionCutoffMin).toBe(0)
    expect(normalizeOnlineGuardSettings({ onlineSessionCutoffMin: 9999 }).onlineSessionCutoffMin).toBe(720)
    expect(normalizeOnlineGuardSettings({ onlineSessionCutoffMin: null }).onlineSessionCutoffMin).toBe(0)
    expect(normalizeOnlineGuardSettings({ onlineSessionCutoffMin: '120' }).onlineSessionCutoffMin).toBe(120)
  })
})

describe('isOverAutoCloseThreshold（滿座門檻自動關閉）', () => {
  const base = { totalSeats: 100, enabled: true, percent: 80 }
  it('未啟用一律 false（即使 100% 滿）', () => {
    expect(isOverAutoCloseThreshold({ ...base, enabled: false, remaining: 0 })).toBe(false)
  })
  it('剛好踩到門檻（80 滿 / 100 席）→ 關閉；79 滿 → 開放', () => {
    expect(isOverAutoCloseThreshold({ ...base, remaining: 20 })).toBe(true)
    expect(isOverAutoCloseThreshold({ ...base, remaining: 21 })).toBe(false)
  })
  it('超過門檻（remaining 0）→ 關閉', () => {
    expect(isOverAutoCloseThreshold({ ...base, remaining: 0 })).toBe(true)
  })
  it('totalSeats 0（全部桌位停用）不適用 → false，交給 remaining 檢查', () => {
    expect(isOverAutoCloseThreshold({ ...base, totalSeats: 0, remaining: 0 })).toBe(false)
  })
  it('remaining 為負或非數字時視為 0（已滿）', () => {
    expect(isOverAutoCloseThreshold({ ...base, remaining: -5 })).toBe(true)
    expect(isOverAutoCloseThreshold({ ...base, remaining: undefined })).toBe(true)
  })
  it('percent 非法時退回 80 計算', () => {
    expect(isOverAutoCloseThreshold({ ...base, percent: NaN, remaining: 20 })).toBe(true)
    expect(isOverAutoCloseThreshold({ ...base, percent: NaN, remaining: 21 })).toBe(false)
  })
})
