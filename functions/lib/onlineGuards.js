// 線上訂位自動防線（純邏輯，不碰 Firestore / 時鐘），抽出供根目錄 Vitest 直接測試。
// 兩道防線都只擋「線上客人端」：店員後台、現場散客、團體預排完全不受影響。
//
// 1) 滿座門檻自動關閉：某時段已訂佔比達總容量的 N%（預設 80），該時段線上訂位關閉，
//    保留剩餘座位給現場與電話客人。
// 2) 場次截止：場次（餐期）開始前 X 分鐘起，該場次所有抵達時段停止線上訂位
//    （0 = 不啟用，維持原本「時段時間到才關」的行為）。

function clampInt(value, min, max, fallback) {
  const n = Math.round(Number(value))
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

// 設定欄位正規化：前端 settingsService.withDefaults 與後端 normalizeStoreSettings 共用此口徑。
// ★ 白名單成對鐵律：這三個欄位必須同時存在於 functions normalizeStoreSettings 與前端 DEFAULT。
export function normalizeOnlineGuardSettings(settings = {}) {
  return {
    onlineAutoCloseEnabled: settings.onlineAutoCloseEnabled === true,
    onlineAutoClosePercent: clampInt(settings.onlineAutoClosePercent, 50, 100, 80),
    // 已停用：線上訂位改由 guestReliability 的 MIN_GUEST_LEAD_MINUTES（抵達前 2 小時）控制；
    // 此 key 只為相容雲端舊資料保留，不再擋任何訂位。
    onlineSessionCutoffMin: clampInt(settings.onlineSessionCutoffMin, 0, 720, 0),
  }
}

// 滿座門檻：已訂 (totalSeats - remaining) / totalSeats >= percent% → 線上關閉。
// totalSeats <= 0（全部桌位停用）視為不適用，交給既有的 remaining 檢查處理。
export function isOverAutoCloseThreshold({ totalSeats, remaining, enabled, percent }) {
  if (enabled !== true) return false
  const total = Number(totalSeats)
  if (!Number.isFinite(total) || total <= 0) return false
  const used = total - Math.max(0, Number(remaining) || 0)
  return used / total >= clampInt(percent, 50, 100, 80) / 100
}
