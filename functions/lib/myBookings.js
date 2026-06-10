// 「LINE 我的訂位」清單純邏輯（不碰 Firestore / fetch / secrets），供根目錄 Vitest 直接測試。
import { dayLabelServer, buildManageUrl } from './notify.js'

// 台灣固定 +08:00：把「店家時區的某日某時段」轉成絕對時間戳（ms），與 Date.now() 比較是否已過。
// （自 index.js 搬入，避免兩份實作分岔；index.js 改 import 本檔。）
export const STORE_UTC_OFFSET = '+08:00'
export function slotEpochMs(dateStr, timeSlot) {
  return Date.parse(`${dateStr}T${timeSlot}:00${STORE_UTC_OFFSET}`)
}

export const MY_BOOKINGS_LIMIT = 10
// 用餐中寬限：時段開始後 3 小時內仍視為「進行中」（confirmed/arrived 還會出現在清單上方）。
const DINING_GRACE_MS = 3 * 60 * 60 * 1000
// 近期歷史窗口：已取消/已完成/已過期的訂位保留 14 天供客人對照，更舊的不顯示。
const RECENT_PAST_WINDOW_MS = 14 * 24 * 60 * 60 * 1000

// 單筆訂位分類：upcoming（即將/進行中）｜recent（近期歷史）｜drop（太舊或日期壞掉）
export function classifyMyBooking(booking, nowMs) {
  const at = slotEpochMs(booking?.date, booking?.timeSlot)
  if (!Number.isFinite(at)) return { phase: 'drop', at: NaN }
  const active = ['confirmed', 'arrived'].includes(booking.status)
  if (active && at + DINING_GRACE_MS > nowMs) return { phase: 'upcoming', at }
  if (nowMs - at < RECENT_PAST_WINDOW_MS) return { phase: 'recent', at }
  return { phase: 'drop', at }
}

// entries = [{ booking, manageToken }] → 清單項目（即將升冪在前、近期降冪接後、截斷 limit）。
// 項目刻意不含姓名/電話——查詢者已是綁定本人，不需要，也讓回應比 /lookup 的 masked 更少個資。
export function buildMyBookingsList(entries, { nowMs, publicSiteUrl = '', limit = MY_BOOKINGS_LIMIT } = {}) {
  const upcoming = []
  const recent = []
  for (const entry of entries || []) {
    const booking = entry?.booking
    if (!booking?.id) continue
    const { phase, at } = classifyMyBooking(booking, nowMs)
    if (phase === 'drop') continue
    const manageToken = entry.manageToken || ''
    const item = {
      id: booking.id,
      date: booking.date,
      dateLabel: dayLabelServer(booking.date),
      timeSlot: booking.timeSlot,
      guests: Number(booking.guests) || 1,
      status: booking.status,
      past: phase === 'recent',
      manageToken,
      manageUrl: buildManageUrl(publicSiteUrl, booking.id, manageToken),
      _at: at,
    }
    if (phase === 'upcoming') upcoming.push(item)
    else recent.push(item)
  }
  upcoming.sort((a, b) => a._at - b._at)
  recent.sort((a, b) => b._at - a._at)
  return [...upcoming, ...recent].slice(0, limit).map(({ _at, ...item }) => item)
}
