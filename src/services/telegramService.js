// telegramService：Telegram Bot 通知 + 資料備份
//
// 用途雙重：
//   1. 即時通知：訂位建立/修改/取消/到場/離席等事件 → 立刻推送
//   2. 資料備份：每則訊息含完整 JSON payload，萬一資料丟失可從 chat 還原
//
// 設定：
//   - VITE_TELEGRAM_BOT_TOKEN：bot token（.env.local，絕不 commit）
//   - chat_id 存在 LocalStorage，由使用者透過 Settings 頁面設定或自動偵測
//
// API: https://core.telegram.org/bots/api
//
// 安全：正式環境（prod build）一律不在前端持有 bot token——內場通知改由後端 Cloud Functions
// （Secret Manager 的 TELEGRAM_BOT_TOKEN）權威送出。此處僅在 dev 讀取 token，供本機測試
// chat 偵測 / 測試訊息；prod build 中 TOKEN 恆為空字串，hasToken() 即 false，下方所有
// 直打 Telegram API 的路徑自動 no-op（即使有人誤把 VITE_TELEGRAM_BOT_TOKEN 設進正式環境也不外洩）。
const TOKEN = import.meta.env.DEV ? (import.meta.env.VITE_TELEGRAM_BOT_TOKEN || '') : ''
const CHAT_ID_KEY = 'chicken_telegram_chatid'
const ENABLED_KEY = 'chicken_telegram_enabled'

const TG_BASE = 'https://api.telegram.org'

// ============== Configuration ==============
export function hasToken() {
  return !!TOKEN
}

export function getChatId() {
  return localStorage.getItem(CHAT_ID_KEY) || ''
}

export function setChatId(id) {
  if (id) localStorage.setItem(CHAT_ID_KEY, String(id))
  else localStorage.removeItem(CHAT_ID_KEY)
}

export function isEnabled() {
  // 預設開啟（如果有 token 跟 chat_id），可由使用者關閉
  if (!hasToken() || !getChatId()) return false
  const flag = localStorage.getItem(ENABLED_KEY)
  return flag !== '0'  // 沒設或 '1' = on
}

export function setEnabled(on) {
  localStorage.setItem(ENABLED_KEY, on ? '1' : '0')
}

export function isConfigured() {
  return hasToken() && !!getChatId()
}

// ============== Core API ==============
export async function sendMessage(text, opts = {}) {
  if (!hasToken()) return { ok: false, reason: 'no-token' }
  const chatId = getChatId()
  if (!chatId) return { ok: false, reason: 'no-chat-id' }
  if (!isEnabled() && !opts.force) return { ok: false, reason: 'disabled' }
  try {
    const res = await fetch(`${TG_BASE}/bot${TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        disable_notification: !!opts.silent,
      }),
    })
    const data = await res.json()
    return data
  } catch (err) {
    console.warn('Telegram send failed:', err)
    return { ok: false, error: err.message }
  }
}

// 自動偵測 chat_id（從 getUpdates 取最近一條訊息的 chat.id）
// 使用前提：使用者已經跟 bot 開始對話（按過 /start）
export async function detectChatId() {
  if (!hasToken()) return { ok: false, reason: 'no-token' }
  try {
    const res = await fetch(`${TG_BASE}/bot${TOKEN}/getUpdates`)
    const data = await res.json()
    if (!data.ok) return { ok: false, reason: 'api-error', error: data.description }
    if (!data.result || data.result.length === 0) {
      return { ok: false, reason: 'no-messages' }
    }
    // 找最後一則含 message 的更新
    const updates = [...data.result].reverse()
    for (const u of updates) {
      const msg = u.message || u.channel_post || u.edited_message
      if (msg?.chat?.id) {
        const chatId = msg.chat.id
        const name = msg.chat.title || msg.chat.first_name || msg.chat.username || `chat ${chatId}`
        setChatId(chatId)
        return { ok: true, chatId, name, type: msg.chat.type }
      }
    }
    return { ok: false, reason: 'no-chat-info' }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}

// 測試訊息
export async function sendTest() {
  return sendMessage(
    `🐔 <b>雞王訂位系統</b>\n` +
    `Telegram 通知已成功連接！\n\n` +
    `所有訂位事件會自動推到此 chat，並包含完整 JSON 作為備份。\n` +
    `<i>${new Date().toLocaleString('zh-TW')}</i>`,
    { force: true }
  )
}

// ============== Message Formatters ==============
const escapeHTML = (s) => String(s ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')

const SOURCE_LABEL = {
  online: '🌐 線上',
  phone:  '📞 電話',
  walkin: '🚶 現場',
  group:  '👥 團體',
  line:   '💚 LINE',
}

// 狀態一律顯示：以前看訊息分不出這筆是「待到」還是已經坐在店裡
const STATUS_LABEL = {
  pending: '待確認', confirmed: '待到', arrived: '用餐中',
  completed: '已離席', cancelled: '已取消', noshow: 'No-show',
}

// 現場帶位（source='walkin'：快速帶位 / 併桌 / 候位入座）＝店內內務，不推 Telegram。
// ★ 與後端 functions/lib/notify.js 的 isOnsiteWalkIn 同口徑，兩邊要一起改。
const isOnsiteWalkIn = (b) => String(b?.source ?? '').trim() === 'walkin'
const SKIPPED = { ok: false, reason: 'onsite-walkin' }

const tablesOf = (b) => [...new Set(
  [b?.assignedTableId, ...(Array.isArray(b?.extraTableIds) ? b.extraTableIds : [])]
    .filter(v => v !== null && v !== undefined && v !== '')
    .map(String),
)]

const dateWithWeekday = (dateStr) => {
  const d = new Date(`${dateStr}T00:00:00`)
  if (Number.isNaN(d.getTime())) return String(dateStr ?? '')
  return `${dateStr} (${['日', '一', '二', '三', '四', '五', '六'][d.getDay()]})`
}

// 摘要五行以內，空欄位不佔行（舊版沒電話也印一行孤零零的 📱）
function fmtBookingHeader(b) {
  const source = SOURCE_LABEL[b.source] || ''
  const status = STATUS_LABEL[b.status] || ''
  const tables = tablesOf(b)
  const when = [b.date ? dateWithWeekday(b.date) : '', b.timeSlot || ''].filter(Boolean).join(' ')
  const lines = []
  if (when || source) lines.push(`📅 ${escapeHTML(when)}${source ? `${when ? ' · ' : ''}${source}` : ''}`)
  lines.push(`👤 ${escapeHTML(b.name) || '（未填姓名）'} · ${Number(b.guests) || 0} 位${status ? ` · ${status}` : ''}`)
  if (tables.length) lines.push(`🪑 桌 ${escapeHTML(tables.join('＋'))}`)
  if (b.phone) lines.push(`📱 <code>${escapeHTML(b.phone)}</code>`)
  if (b.notes?.text) lines.push(`📝 ${escapeHTML(b.notes.text)}`)
  const flags = []
  if (b.notes?.pet) flags.push('🐾 寵物')
  if (b.notes?.child) flags.push('👶 兒童')
  if (b.notes?.mobility) flags.push('♿ 行動不便')
  if (flags.length) lines.push(flags.join(' · '))
  return lines.join('\n')
}

// 備份 JSON 瘦身：空值 / 全 false 的備註旗標不寫，免得 <pre> 淹掉上面的摘要
function compactBooking(b) {
  if (!b || typeof b !== 'object') return b
  const out = {}
  for (const [k, v] of Object.entries(b)) {
    if (v === null || v === undefined || v === '') continue
    if (Array.isArray(v) && v.length === 0) continue
    if (k === 'guestEditCount' && Number(v) === 0) continue
    if (k === 'notes') {
      const notes = {}
      if (v?.text) notes.text = v.text
      ;['pet', 'child', 'mobility'].forEach(f => { if (v?.[f]) notes[f] = true })
      if (Object.keys(notes).length) out.notes = notes
      continue
    }
    if (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0) continue
    out[k] = v
  }
  return out
}

// 訊息底部附 JSON（給備份還原使用）
function withBackupPayload(headerText, payload) {
  const slim = (payload && typeof payload === 'object' && payload.booking)
    ? { ...payload, booking: compactBooking(payload.booking) }
    : payload
  const json = JSON.stringify(slim, null, 0)
  return `${headerText}\n\n<pre>${escapeHTML(json)}</pre>`
}

// 標題統一接訂位編號（要回查 / 回報時直接複製）
const titleWithId = (title, b) => `${title}${b?.id ? ` · <code>${escapeHTML(b.id)}</code>` : ''}`

// ============== Event Templates ==============
// 所有訂位事件都先過現場帶位濾網：現場開檯的整段生命週期（開檯/改人數/誤開檯取消/入座/離席）
// 都不推播——一天數十筆會把真正要看的線上、電話訂位異動洗掉。
export function notifyBookingCreated(booking) {
  if (isOnsiteWalkIn(booking)) return SKIPPED
  const head = `${titleWithId('🆕 <b>新訂位</b>', booking)}\n${fmtBookingHeader(booking)}`
  return sendMessage(withBackupPayload(head, { event: 'booking_created', booking }))
}

export function notifyBookingUpdated(booking, changes = {}) {
  if (isOnsiteWalkIn(booking)) return SKIPPED
  const changeKeys = Object.keys(changes).filter(k => k !== 'updatedAt')
  const head = `${titleWithId('✏️ <b>訂位修改</b>', booking)}\n${fmtBookingHeader(booking)}` +
    (changeKeys.length ? `\n\n變動欄位：<code>${escapeHTML(changeKeys.join(', '))}</code>` : '')
  return sendMessage(withBackupPayload(head, { event: 'booking_updated', booking, changes }))
}

export function notifyBookingCancelled(booking) {
  if (isOnsiteWalkIn(booking)) return SKIPPED
  const head = `${titleWithId('❌ <b>訂位取消</b>', booking)}\n${fmtBookingHeader(booking)}`
  return sendMessage(withBackupPayload(head, { event: 'booking_cancelled', booking }))
}

export function notifyBookingAssigned(booking, tableNumber) {
  if (isOnsiteWalkIn(booking)) return SKIPPED
  const head = `${titleWithId(`🪑 <b>桌位已指派</b> → ${escapeHTML(tableNumber)}`, booking)}\n${fmtBookingHeader(booking)}`
  return sendMessage(withBackupPayload(head, { event: 'booking_assigned', booking, tableNumber }))
}

export function notifyBookingArrived(booking) {
  if (isOnsiteWalkIn(booking)) return SKIPPED
  const head = `${titleWithId('✅ <b>客人到了</b>', booking)}\n${fmtBookingHeader(booking)}`
  return sendMessage(withBackupPayload(head, { event: 'booking_arrived', booking }))
}

export function notifyBookingCompleted(booking, minutes) {
  if (isOnsiteWalkIn(booking)) return SKIPPED
  const head = `${titleWithId(`🚪 <b>已離席</b>（用餐 ${minutes} 分）`, booking)}\n${fmtBookingHeader(booking)}`
  return sendMessage(withBackupPayload(head, { event: 'booking_completed', booking, minutes }))
}

export function notifyBookingNoShow(booking) {
  if (isOnsiteWalkIn(booking)) return SKIPPED
  const head = `${titleWithId('⚠️ <b>No-show</b>', booking)}\n${fmtBookingHeader(booking)}`
  return sendMessage(withBackupPayload(head, { event: 'booking_noshow', booking }))
}

export function notifyWaitlistCreated(wait) {
  const head = `🚦 <b>候位取號</b> #${wait.queueNumber}\n` +
    `👤 ${escapeHTML(wait.name)}  ${wait.partySize} 位\n` +
    `📱 <code>${escapeHTML(wait.phone || '—')}</code>` +
    (wait.notes ? `\n📝 ${escapeHTML(wait.notes)}` : '')
  return sendMessage(withBackupPayload(head, { event: 'waitlist_created', wait }))
}

// 候位入座 / 散客直接入座 / 現場換桌都是「現場排位」，一律不推播（見上方 isOnsiteWalkIn 註解）。
// 候位「取號」保留通知：那是客人在門口排隊的即時訊號，不是排位動作。

export function notifyTableMoved(booking, fromTable, toTable) {
  if (isOnsiteWalkIn(booking)) return SKIPPED
  const head = `${titleWithId(`↔ <b>換桌</b> ${escapeHTML(fromTable)} → ${escapeHTML(toTable)}`, booking)}\n${fmtBookingHeader(booking)}`
  return sendMessage(withBackupPayload(head, { event: 'table_moved', booking, fromTable, toTable }))
}

// 每日彙總（手動觸發或 cron）
export function notifyDailySummary(stats) {
  const lines = [
    `📊 <b>每日彙總</b> · ${new Date().toLocaleDateString('zh-TW')}`,
    '',
    `總訂位：${stats.total} 組 · ${stats.totalGuests} 位`,
    `已到：${stats.arrived} 組`,
    `已離：${stats.completed} 組`,
    `No-show：${stats.noshow} 組`,
    `取消：${stats.cancelled} 組`,
    `候位：${stats.waitlist} 組`,
  ]
  return sendMessage(withBackupPayload(lines.join('\n'), { event: 'daily_summary', stats, date: new Date().toISOString() }))
}
