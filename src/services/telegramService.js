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
const TOKEN = import.meta.env.VITE_TELEGRAM_BOT_TOKEN || ''
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

function fmtBookingHeader(b) {
  const lines = [
    `📅 ${b.date} ${b.timeSlot}`,
    `👤 ${escapeHTML(b.name)}  ${b.guests} 位`,
    `📱 <code>${escapeHTML(b.phone)}</code>`,
  ]
  if (b.assignedTableId) lines.push(`🪑 ${b.assignedTableId}`)
  if (SOURCE_LABEL[b.source]) lines.push(SOURCE_LABEL[b.source])
  if (b.notes?.text) lines.push(`📝 ${escapeHTML(b.notes.text)}`)
  const flags = []
  if (b.notes?.pet) flags.push('🐾 寵物')
  if (b.notes?.child) flags.push('👶 兒童')
  if (b.notes?.mobility) flags.push('♿ 行動不便')
  if (flags.length) lines.push(flags.join(' · '))
  return lines.join('\n')
}

// 訊息底部附完整 JSON（給備份還原使用）
function withBackupPayload(headerText, payload) {
  const json = JSON.stringify(payload, null, 0)
  return `${headerText}\n\n<pre>${escapeHTML(json)}</pre>`
}

// ============== Event Templates ==============
export function notifyBookingCreated(booking) {
  const head = `🆕 <b>新訂位</b>\n${fmtBookingHeader(booking)}`
  return sendMessage(withBackupPayload(head, { event: 'booking_created', booking }))
}

export function notifyBookingUpdated(booking, changes = {}) {
  const changeKeys = Object.keys(changes).filter(k => k !== 'updatedAt')
  const head = `✏️ <b>訂位修改</b> · ${booking.id}\n${fmtBookingHeader(booking)}` +
    (changeKeys.length ? `\n\n變動欄位：<code>${changeKeys.join(', ')}</code>` : '')
  return sendMessage(withBackupPayload(head, { event: 'booking_updated', booking, changes }))
}

export function notifyBookingCancelled(booking) {
  const head = `❌ <b>訂位取消</b>\n${fmtBookingHeader(booking)}`
  return sendMessage(withBackupPayload(head, { event: 'booking_cancelled', booking }))
}

export function notifyBookingAssigned(booking, tableNumber) {
  const head = `🪑 <b>桌位已指派</b> → ${tableNumber}\n${fmtBookingHeader(booking)}`
  return sendMessage(withBackupPayload(head, { event: 'booking_assigned', booking, tableNumber }))
}

export function notifyBookingArrived(booking) {
  const head = `✅ <b>客人到了</b>\n${fmtBookingHeader(booking)}`
  return sendMessage(withBackupPayload(head, { event: 'booking_arrived', booking }))
}

export function notifyBookingCompleted(booking, minutes) {
  const head = `🚪 <b>已離席</b>（用餐 ${minutes} 分）\n${fmtBookingHeader(booking)}`
  return sendMessage(withBackupPayload(head, { event: 'booking_completed', booking, minutes }))
}

export function notifyBookingNoShow(booking) {
  const head = `⚠️ <b>No-show</b>\n${fmtBookingHeader(booking)}`
  return sendMessage(withBackupPayload(head, { event: 'booking_noshow', booking }))
}

export function notifyWaitlistCreated(wait) {
  const head = `🚦 <b>候位取號</b> #${wait.queueNumber}\n` +
    `👤 ${escapeHTML(wait.name)}  ${wait.partySize} 位\n` +
    `📱 <code>${escapeHTML(wait.phone || '—')}</code>` +
    (wait.notes ? `\n📝 ${escapeHTML(wait.notes)}` : '')
  return sendMessage(withBackupPayload(head, { event: 'waitlist_created', wait }))
}

export function notifyWaitlistSeated(wait, tableNumber) {
  const head = `✅ <b>候位入座</b> #${wait.queueNumber} → ${tableNumber}\n` +
    `👤 ${escapeHTML(wait.name)}  ${wait.partySize} 位`
  return sendMessage(withBackupPayload(head, { event: 'waitlist_seated', wait, tableNumber }))
}

export function notifyWalkInSeated(booking) {
  const head = `🚶 <b>散客直接入座</b> → ${booking.assignedTableId}\n${fmtBookingHeader(booking)}`
  return sendMessage(withBackupPayload(head, { event: 'walkin_seated', booking }))
}

export function notifyTableMoved(booking, fromTable, toTable) {
  const head = `↔ <b>換桌</b> ${fromTable} → ${toTable}\n${fmtBookingHeader(booking)}`
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
