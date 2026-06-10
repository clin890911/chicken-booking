// LINE 通知相關純邏輯（不碰 Firestore / secrets / fetch），抽出供根目錄 Vitest 直接測試。

// 事件級防重窗口：同一事件、同一內容指紋，在窗口內只送一次。
// 設 90 秒是為了擋「functions 先部署、舊前端 bundle 仍打 linePushBooking」共存期的重複推播，
// 同時不誤殺「客人 90 秒內連改兩次（內容不同）」的合法連續通知。
export const LINE_PUSH_DEDUPE_WINDOW_MS = 90_000

// 訂位內容指紋：只取會出現在通知訊息裡、客人在意的欄位。
export function notificationStateHash(booking = {}) {
  return [booking.date, booking.timeSlot, booking.guests, booking.status]
    .map(v => String(v ?? ''))
    .join('|')
}

// 防重判斷：binding.lastPushByEvent[event] 與本次指紋相同、且仍在窗口內 → 跳過。
export function shouldSkipDuplicatePush(lastPushByEvent, event, stateHash, nowMs, windowMs = LINE_PUSH_DEDUPE_WINDOW_MS) {
  const last = lastPushByEvent?.[event]
  if (!last?.at || last.stateHash !== stateHash) return false
  const lastMs = new Date(last.at).getTime()
  return Number.isFinite(lastMs) && nowMs - lastMs < windowMs
}

// LINE push 失敗是否值得重試：4xx（429 除外）代表請求本身無效（使用者封鎖/非好友/壞 payload），
// 重試也不會好，應立即 dead-letter；429（限流）與 5xx/逾時/網路錯誤才重試。
export function isRetryableLineStatus(status) {
  const code = Number(status)
  if (!Number.isFinite(code)) return true
  if (code === 429) return true
  return code < 400 || code >= 500
}

// 伺服器端日期標籤（與 src/utils/timeSlots.dayLabel 同邏輯）：
// 後端權威組訊息時 Firestore booking 沒有 dateLabel 欄位，需自己補「6/10 (三)」格式。
export function dayLabelServer(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`)
  if (Number.isNaN(d.getTime())) return String(dateStr || '')
  const w = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()]
  return `${d.getMonth() + 1}/${d.getDate()} (${w})`
}

// 後端組客人管理連結（Flex 卡片「管理 / 修改訂位」按鈕）。
// publicSiteUrl 未設定時回空字串 → bookingBubble 會直接略過該按鈕，不會產生壞連結。
export function buildManageUrl(publicSiteUrl, bookingId, manageToken) {
  const base = String(publicSiteUrl || '').trim().replace(/\/+$/, '')
  if (!/^https?:\/\//.test(base) || !bookingId || !manageToken) return ''
  return `${base}/manage/${encodeURIComponent(bookingId)}?token=${encodeURIComponent(manageToken)}`
}

// 店員端改動分類：只有「客人在意的變更」才通知，店內內務一律靜默。
// - 取消（任何狀態 → cancelled）→ 'cancelled'
// - 維持 confirmed 且改期/改時段/改人數 → 'updated'
// - 其他（指派桌位、備註、入座 arrived、結帳 completed、noshow、新建文件）→ null 不通知
export function classifyAdminBookingChange(before, after) {
  if (!before || !after) return null
  if (before.status !== 'cancelled' && after.status === 'cancelled') return 'cancelled'
  if (before.status === 'confirmed' && after.status === 'confirmed') {
    const structuralChanged = ['date', 'timeSlot', 'guests']
      .some(key => String(after[key] ?? '') !== String(before[key] ?? ''))
    if (structuralChanged) return 'updated'
  }
  return null
}
