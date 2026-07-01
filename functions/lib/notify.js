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

// 店員端變更分類（Telegram 備份用）：目的是「萬一系統壞掉能從 Telegram 撈回資料」，
// 故比 classifyAdminBookingChange 多認「新增」，且改期/時段/人數不分狀態都留底——
// 內務操作（指派桌位、入座 arrived、結帳 completed、no-show、改備註）仍一律 null 不發。
// - 無 before（後端查無此訂位）但有 after → 'created'（店員新建；客人線上建單走 guestCreateBooking 不經這裡）
// - 任何狀態 → cancelled → 'cancelled'
// - 改期/改時段/改人數，只要訂位「不是已取消」（confirmed / arrived / completed 皆可）→ 'updated'
//   （比 classifyAdminBookingChange 放寬：已入座/已結帳客人臨時改人數也是重要異動，要備份）
// 硬刪除（dataset.deletedIds）不在此函式判斷，由呼叫端以刪除前快照另發 'deleted'。
// 店員修改訂位時，產生「什麼欄位 從X 變成 Y」的對照清單（純資料，escaping 由送出端處理）。
// 回傳 [{ key, label, from, to }, ...]；只比對客人/營運在意的欄位，volatile 欄位（updatedAt 等）不列。
const ADMIN_BOOKING_FIELD_LABELS = {
  date: '日期', timeSlot: '時段', guests: '人數', name: '姓名',
  phone: '電話', notes: '備註', assignedTableId: '桌位', status: '狀態',
}
const ADMIN_BOOKING_STATUS_LABELS = {
  confirmed: '已確認', arrived: '已入座', completed: '已結帳', cancelled: '已取消', noshow: '未到',
}
function adminBookingFieldDisplay(key, val) {
  if (key === 'notes') return (val && typeof val === 'object') ? String(val.text || '') : String(val ?? '')
  if (key === 'status') return ADMIN_BOOKING_STATUS_LABELS[val] || String(val ?? '')
  if (key === 'assignedTableId') return (val == null || val === '') ? '（無）' : String(val)
  return String(val ?? '')
}
export function diffAdminBooking(before, after) {
  const changes = []
  for (const key of Object.keys(ADMIN_BOOKING_FIELD_LABELS)) {
    // 以「顯示值」為準比對：guests 4 vs '4'、備註只改了非文字旗標等，顯示相同就不列為變更。
    const from = adminBookingFieldDisplay(key, before?.[key])
    const to = adminBookingFieldDisplay(key, after?.[key])
    if (from === to) continue
    changes.push({ key, label: ADMIN_BOOKING_FIELD_LABELS[key], from, to })
  }
  return changes
}

export function classifyAdminBookingBackupEvent(before, after) {
  if (!after) return null
  if (!before) return 'created'
  if (before.status !== 'cancelled' && after.status === 'cancelled') return 'cancelled'
  if (after.status !== 'cancelled') {
    const structuralChanged = ['date', 'timeSlot', 'guests']
      .some(key => String(after[key] ?? '') !== String(before[key] ?? ''))
    if (structuralChanged) return 'updated'
  }
  return null
}
