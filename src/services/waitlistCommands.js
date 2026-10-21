import { todayStr } from '../utils/timeSlots'

// A saved envelope is a request to confirm with the server, never a local queue ticket or table hold.
const KEY = 'chicken_waitlist_commands_v1'
export const pendingEvent = 'chicken-waitlist-pending'
const read = () => {
  try { const value = JSON.parse(localStorage.getItem(KEY) || '[]'); if (!Array.isArray(value)) throw new Error(); return value }
  catch { throw new Error('候位待確認資料無法讀取，請先確認儲存狀態') }
}
const write = entries => {
  try { localStorage.setItem(KEY, JSON.stringify(entries)) }
  catch { throw new Error('無法儲存候位待確認資料，未送出；請保留表單並檢查裝置儲存空間') }
  window.dispatchEvent(new Event(pendingEvent))
}
export const listPending = (owner, store) => read().filter(entry => entry.owner === owner && entry.store === store)
export function prepareCommand({ owner, store, action, id, expectedVersion = 0, payload, commandId }) {
  if (!owner) throw new Error('請重新登入後操作候位')
  const entries = read()
  const existing = entries.find(entry => entry.owner === owner && entry.store === store && (commandId ? entry.command.commandId === commandId : entry.command.action === action && (action === 'create' || entry.command.id === id)))
  if (!existing && id && entries.some(entry => entry.owner === owner && entry.store === store && entry.command.id === id)) throw new Error('此候位仍有待確認操作，請先確認原操作結果')
  // Unknown outcomes must resolve the original request before a changed draft can be submitted.
  if (existing) return existing
  const command = { id: id || 'W' + crypto.randomUUID(), commandId: commandId || crypto.randomUUID(), expectedVersion, action, date: todayStr(), ...(payload ? { payload } : {}) }
  const envelope = { owner, store, command, createdAt: new Date().toISOString() }
  write([...entries, envelope])
  return envelope
}
export function completeCommand(envelope) {
  write(read().filter(entry => !(entry.owner === envelope.owner && entry.store === envelope.store && entry.command.commandId === envelope.command.commandId)))
}
export const commandError = error => error?.status === 409 ? '另一台已更新或操作已過期，未套用此操作；請確認最新候位與桌況'
  : error?.status === 403 ? '此帳號沒有操作權限，未套用此操作'
  : error?.status >= 400 && error?.status < 500 ? '候位操作未成立，請確認資料後再試'
  : '結果待確認，請恢復連線後確認原操作；請勿另建同一組候位'
export const isDefiniteRejection = error => error?.status >= 400 && error?.status < 500 && ![408, 429].includes(error.status)
