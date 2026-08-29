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

// 每日全量備份檔的收件 chat 解析：備份檔含所有客人姓名電話（PII），不能跟一般文字通知
// 共用同一個 chat（店員群組）——backup 專用 chat 有值就用它，否則 fallback 回主 chat
// （相容尚未設定 TELEGRAM_BACKUP_CHAT_ID 的環境，行為與改版前一致）。
export function resolveBackupChatId(backupRaw, mainRaw) {
  const backup = String(backupRaw ?? '').trim()
  if (backup) return backup
  return String(mainRaw ?? '').trim()
}

export function escapeTelegramHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

const TELEGRAM_SOURCE_LABEL = {
  online: '🌐 線上',
  phone: '📞 電話',
  walkin: '🚶 現場',
  group: '👥 團體',
  line: '💚 LINE',
}

const TELEGRAM_BOOKING_JSON_MARKER = '<!--CHICKEN_BOOKING_JSON_V1-->'
const TELEGRAM_MESSAGE_LIMIT = 4096
const TELEGRAM_TRUNCATED_SUFFIX = '\n…（內容過長已截斷，完整事件留存於系統）'

// Telegram outbox 仍保留完整 JSON 作為稽核與重試來源；實際送出前由
// buildTelegramSendMessageBody 移除訊息尾端的 JSON block，避免 manageToken 等敏感欄位進入店員群組。
export function buildTelegramBookingMessage(title, booking = {}, payload = {}, extraLine = '') {
  const lines = [
    title,
    `📅 ${booking.date ?? ''} ${booking.timeSlot ?? ''}`.trimEnd(),
  ]
  const bookingId = String(booking.id ?? '').trim()
  if (bookingId) lines.push(`🆔 訂位編號：<code>${escapeTelegramHtml(bookingId)}</code>`)
  lines.push(
    `👤 ${escapeTelegramHtml(booking.name)}  ${booking.guests ?? ''} 位`,
    `📱 <code>${escapeTelegramHtml(booking.phone)}</code>`,
  )
  if (booking.assignedTableId) lines.push(`🪑 ${escapeTelegramHtml(booking.assignedTableId)}`)
  if (TELEGRAM_SOURCE_LABEL[booking.source]) lines.push(TELEGRAM_SOURCE_LABEL[booking.source])
  if (booking.notes?.text) lines.push(`📝 ${escapeTelegramHtml(booking.notes.text)}`)
  const flags = []
  if (booking.notes?.pet) flags.push('🐾 寵物')
  if (booking.notes?.child) flags.push('👶 兒童')
  if (booking.notes?.mobility) flags.push('♿ 行動不便')
  if (flags.length) lines.push(flags.join(' · '))
  if (extraLine) lines.push(extraLine)
  return `${lines.join('\n')}\n\n${TELEGRAM_BOOKING_JSON_MARKER}<pre>${escapeTelegramHtml(JSON.stringify(payload, null, 0))}</pre>`
}

function decodeTelegramHtml(value) {
  // escapeTelegramHtml 的反向順序：先還原尖括號，最後才還原 &amp;，
  // 避免把原始字串內的 &lt; 過度解碼成 <。
  return value
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&')
}

const LEGACY_TELEGRAM_EVENT_TITLE = {
  admin_created: '🆕 <b>店員新增訂位</b>',
  admin_updated: '✏️ <b>店員修改訂位</b> ·',
  admin_cancelled: '❌ <b>店員取消訂位</b>',
  admin_deleted: '🗑️ <b>店員刪除訂位</b>',
  booking_created: '🆕 <b>新線上訂位</b>',
  guest_updated: '✏️ <b>客人自助修改訂位</b> ·',
  guest_cancelled: '❌ <b>客人自助取消訂位</b>',
}

function sanitizeLegacyTelegramBookingPrefix(prefix, encodedJson) {
  try {
    const parsed = JSON.parse(decodeTelegramHtml(encodedJson))
    const expectedTitle = LEGACY_TELEGRAM_EVENT_TITLE[parsed?.event]
    const bookingId = String(parsed?.booking?.id ?? '').trim()
    const isLegacyBookingMessage = Boolean(
      expectedTitle
      && bookingId
      && prefix.startsWith(expectedTitle)
      && prefix.includes('\n📅 ')
      && prefix.includes('\n👤 ')
      && prefix.includes('\n📱 <code>')
      && prefix.includes('</code>'),
    )
    if (!isLegacyBookingMessage) return null
    // 舊 updated formatter 會把 booking.id 原樣插入標題；legacy 路徑在送出前一併修正。
    return prefix.split(bookingId).join(escapeTelegramHtml(bookingId))
  } catch {
    return null
  }
}

// 新 formatter 以內部 marker 精準辨識。無 marker 只為相容部署前已入列的 pending，
// 且必須同時符合正式 event、非空 booking.id 與舊 formatter 摘要特徵才會移除。
export function stripTelegramBookingJson(text) {
  const input = String(text ?? '')
  const closingTag = '</pre>'
  if (!input.endsWith(closingTag)) return input

  const markedOpening = `\n\n${TELEGRAM_BOOKING_JSON_MARKER}<pre>`
  const markedAt = input.lastIndexOf(markedOpening)
  if (markedAt >= 0) return input.slice(0, markedAt)

  const legacyOpening = '\n\n<pre>'
  const legacyAt = input.lastIndexOf(legacyOpening)
  if (legacyAt < 0) return input
  const prefix = input.slice(0, legacyAt)
  const encodedJson = input.slice(legacyAt + legacyOpening.length, -closingTag.length)
  return sanitizeLegacyTelegramBookingPrefix(prefix, encodedJson) ?? input
}

function telegramHtmlToPlainText(html) {
  const withoutFormatterTags = html.replace(/<\/?(?:b|code)>/g, '')
  return decodeTelegramHtml(withoutFormatterTags)
}

function truncateTelegramPlainText(plainText) {
  let escaped = ''
  for (const character of plainText) {
    const next = escapeTelegramHtml(character)
    if (escaped.length + next.length + TELEGRAM_TRUNCATED_SUFFIX.length > TELEGRAM_MESSAGE_LIMIT) break
    escaped += next
  }
  return `${escaped}${TELEGRAM_TRUNCATED_SUFFIX}`
}

// tgSend 的單一 request-body seam：在真正 JSON.stringify/fetch 前完成脫敏與 4096 字守門。
// 超長時改成重新 escape 的純文字，不會留下未閉合 HTML tag/entity，也不拆多則。
export function buildTelegramSendMessageBody(chatId, rawText) {
  const sanitized = stripTelegramBookingJson(rawText)
  const codePointLength = [...sanitized].length
  const text = sanitized.length <= TELEGRAM_MESSAGE_LIMIT && codePointLength <= TELEGRAM_MESSAGE_LIMIT
    ? sanitized
    : truncateTelegramPlainText(telegramHtmlToPlainText(sanitized))
  return {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  }
}

// 可注入 fetch 的最小 transport seam：生產環境傳 global fetch，測試傳 mock；
// request body 必定先經過同一個脫敏/長度守門。
export function postTelegramMessage(fetchFn, url, chatId, text, signal) {
  return fetchFn(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildTelegramSendMessageBody(chatId, text)),
    signal,
  })
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
