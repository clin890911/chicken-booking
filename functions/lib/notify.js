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

// 現場帶位開的檯（source='walkin'：現場快速帶位 / 併桌 / 候位入座）。
// 這類紀錄是店內內務、一天可能數十筆，推進 Telegram 只會洗版，蓋掉真正要看的線上/電話訂位異動；
// 建立、改人數、誤開檯取消都算在內（同一筆客人的整個現場生命週期都不通知）。
// 資料仍有備援：每日 04:30 的 dailyBackup 全量快照含所有 bookings；硬刪除也另走 admin_deleted 通知。
export function isOnsiteWalkIn(booking) {
  return String(booking?.source ?? '').trim() === 'walkin'
}

// 店員端改動分類：只有「客人在意的變更」才通知，店內內務一律靜默。
// - 取消（任何狀態 → cancelled）→ 'cancelled'
// - 維持 confirmed 且改期/改時段/改人數 → 'updated'
// - 其他（指派桌位、備註、入座 arrived、結帳 completed、noshow、新建文件）→ null 不通知
export function classifyAdminBookingChange(before, after) {
  if (!before || !after) return null
  // 現場帶位開的檯不對客人發 LINE：候位入座會把候位者的 lineUserId 寫進這筆 walk-in，
  // 外場一按「復原」誤帶位 → 客人會收到「您的訂位已取消」，但他根本沒訂過位。
  if (isOnsiteWalkIn(after)) return null
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

// 每日全量備份檔的收件 chat 解析：備份檔含所有客人姓名電話（PII），不能跟一般文字通知
// 共用同一個 chat（店員群組）——backup 專用 chat 有值就用它，否則 fallback 回主 chat
// （相容尚未設定 TELEGRAM_BACKUP_CHAT_ID 的環境，行為與改版前一致）。
export function resolveBackupChatId(backupRaw, mainRaw) {
  const backup = String(backupRaw ?? '').trim()
  if (backup) return backup
  return String(mainRaw ?? '').trim()
}

export function classifyAdminBookingBackupEvent(before, after) {
  if (!after) return null
  if (isOnsiteWalkIn(after)) return null
  if (!before) return 'created'
  if (before.status !== 'cancelled' && after.status === 'cancelled') return 'cancelled'
  if (after.status !== 'cancelled') {
    const structuralChanged = ['date', 'timeSlot', 'guests']
      .some(key => String(after[key] ?? '') !== String(before[key] ?? ''))
    if (structuralChanged) return 'updated'
  }
  return null
}

// ============== Telegram 訊息格式（內場通知，客人端與店員端共用）==============
// 一則通知＝「人看的摘要」＋「機器讀的 JSON 備份」。摘要要能在手機通知列一眼掃完，
// JSON 只留還原得到東西的欄位（空值/衍生欄位是雜訊，會把摘要擠出畫面）。
export const TG_SOURCE_LABEL = {
  online: '🌐 線上',
  phone: '📞 電話',
  walkin: '🚶 現場',
  group: '👥 團體',
  line: '💚 LINE',
}

// 狀態一律顯示：以前訊息看不出這筆是「待到」還是「已入座」，得翻 JSON 才知道。
export const TG_STATUS_LABEL = {
  pending: '待確認',
  confirmed: '待到',
  arrived: '用餐中',
  completed: '已離席',
  cancelled: '已取消',
  noshow: 'No-show',
}

export function escapeTg(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

// 這筆訂位佔到的所有桌（主桌 + 大組併桌的額外桌），去重去空。
export function bookingTableNumbers(booking) {
  const extra = Array.isArray(booking?.extraTableIds) ? booking.extraTableIds : []
  return [...new Set(
    [booking?.assignedTableId, ...extra]
      .filter(v => v !== null && v !== undefined && v !== '')
      .map(String),
  )]
}

// 日期加星期：「2026-08-02 (日)」。年份保留（未來日訂位不能只看 8/2）。
export function dateWithWeekday(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`)
  if (Number.isNaN(d.getTime())) return String(dateStr ?? '')
  return `${dateStr} (${['日', '一', '二', '三', '四', '五', '六'][d.getDay()]})`
}

// 備份 JSON 瘦身：空值（null / '' / [] / {}）、全 false 的備註旗標、伺服器可重算的欄位一律不寫。
// 目的是讓 <pre> 區塊不要淹掉摘要——留下的欄位仍足以還原一筆訂位。
const TG_BACKUP_DERIVED_KEYS = ['phoneDigits'] // 由 phone 推導（見 adminPushData 正規化），還原時自動重建

function compactNotes(notes) {
  if (!notes || typeof notes !== 'object') return null
  const out = {}
  if (notes.text) out.text = notes.text
  for (const flag of ['pet', 'child', 'mobility']) if (notes[flag]) out[flag] = true
  return Object.keys(out).length ? out : null
}

export function compactBookingForBackup(booking) {
  if (!booking || typeof booking !== 'object' || Array.isArray(booking)) return booking
  const out = {}
  for (const [key, val] of Object.entries(booking)) {
    if (TG_BACKUP_DERIVED_KEYS.includes(key)) continue
    if (val === null || val === undefined || val === '') continue
    if (Array.isArray(val) && val.length === 0) continue
    if (key === 'guestEditCount' && Number(val) === 0) continue
    if (key === 'notes') {
      const notes = compactNotes(val)
      if (notes) out.notes = notes
      continue
    }
    if (typeof val === 'object' && !Array.isArray(val) && Object.keys(val).length === 0) continue
    out[key] = val
  }
  return out
}

// 組裝一則訂位通知：標題（含訂位編號）+ 摘要 +（可選）補充段落 + JSON 備份。
// 摘要五行以內：日期時段來源 / 姓名人數狀態 / 桌 / 電話 / 備註旗標——空的欄位不佔行
//（舊版即使沒電話也印一行孤零零的 📱）。
export function tgBookingMessage(title, booking, payload, extraLine = '') {
  const b = booking || {}
  const source = TG_SOURCE_LABEL[b.source] || ''
  const status = TG_STATUS_LABEL[b.status] || ''
  const tables = bookingTableNumbers(b)

  const lines = [`${title}${b.id ? ` · <code>${escapeTg(b.id)}</code>` : ''}`]
  const when = [b.date ? dateWithWeekday(b.date) : '', b.timeSlot || ''].filter(Boolean).join(' ')
  if (when || source) lines.push(`📅 ${escapeTg(when)}${source ? `${when ? ' · ' : ''}${source}` : ''}`)
  lines.push(`👤 ${escapeTg(b.name) || '（未填姓名）'} · ${Number(b.guests) || 0} 位${status ? ` · ${status}` : ''}`)
  if (tables.length) lines.push(`🪑 桌 ${escapeTg(tables.join('＋'))}`)
  if (b.phone) lines.push(`📱 <code>${escapeTg(b.phone)}</code>`)
  if (b.notes?.text) lines.push(`📝 ${escapeTg(b.notes.text)}`)
  const flags = []
  if (b.notes?.pet) flags.push('🐾 寵物')
  if (b.notes?.child) flags.push('👶 兒童')
  if (b.notes?.mobility) flags.push('♿ 行動不便')
  if (flags.length) lines.push(flags.join(' · '))
  if (extraLine) lines.push('', extraLine)

  const slim = (payload && typeof payload === 'object' && payload.booking)
    ? { ...payload, booking: compactBookingForBackup(payload.booking) }
    : payload
  return `${lines.join('\n')}\n\n<pre>${escapeTg(JSON.stringify(slim, null, 0))}</pre>`
}
