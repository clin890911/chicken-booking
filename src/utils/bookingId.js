// 訂位編號（booking.id）相關純函式。
//
// 編號由後端 functions/index.js 產生為「'B' + 時間戳(base36) + 隨機碼」並一律 toUpperCase()，
// 例如 BMQ60M3900491。但前端離線 fallback（bookingService.js 的 uid()）產生的時間戳段是小寫，
// 兩者大小寫不一致；客人從 LINE / 簡訊複製編號時也常夾入前後或中間空白（含全形空白 U+3000）。
// 因此後台用編號查詢前必須先正規化（去空白 + 轉大寫）再比對。

// 去除所有空白（含全形空白 U+3000）並轉大寫。null/undefined/數字皆安全。
export function normalizeBookingId(raw) {
  return String(raw ?? '').replace(/[\s　]/g, '').toUpperCase()
}

// 兩個編號正規化後是否精確相等；任一為空 → false。
export function bookingIdEquals(a, b) {
  const na = normalizeBookingId(a)
  const nb = normalizeBookingId(b)
  if (!na || !nb) return false
  return na === nb
}

// 只取數字（電話比對用）。
function digitsOnly(raw) {
  return String(raw ?? '').replace(/\D/g, '')
}

// 後台全域查詢：對全量 bookings 以「編號 / 姓名 / 電話」比對。
// - 空白 query → []
// - 編號：去空白 + 大小寫不敏感 includes（輸入 ≥ 2 字才比，避免單一 'b' 命中全部）
// - 姓名：去前後空白 + 小寫 includes
// - 電話：只比數字，且查詢不含英文字母（避免編號內嵌的數字誤命中電話），輸入 ≥ 3 碼才比
// - includeCancelled=false 時排除 status==='cancelled'（預設 true：用編號查常是要確認是否被取消）
// - 排序：date 由新到舊（未來日在前），同日依 timeSlot 由早到晚
export function searchBookings(bookings, rawQuery, { includeCancelled = true } = {}) {
  const list = Array.isArray(bookings) ? bookings : []
  const raw = String(rawQuery ?? '')
  const q = raw.trim().toLowerCase()
  if (!q) return []
  const qDigits = digitsOnly(raw)
  const qId = normalizeBookingId(raw) // 去空白 + 大寫，用於編號比對
  const qHasLetters = /[a-z]/i.test(raw) // 含英文字母 → 視為編號而非電話

  const matched = list.filter(b => {
    if (!b) return false
    if (!includeCancelled && b.status === 'cancelled') return false
    // 編號（去空白 + 大小寫不敏感）
    if (qId.length >= 2 && normalizeBookingId(b.id).includes(qId)) return true
    // 姓名
    const name = String(b.name ?? '').toLowerCase()
    if (name && name.includes(q)) return true
    // 電話（只比數字；查詢含字母時視為編號，不做電話比對）
    if (!qHasLetters && qDigits.length >= 3 && digitsOnly(b.phone).includes(qDigits)) return true
    return false
  })

  return matched.sort((a, b) => {
    const byDate = String(b.date ?? '').localeCompare(String(a.date ?? '')) // 新到舊
    if (byDate) return byDate
    return String(a.timeSlot ?? '').localeCompare(String(b.timeSlot ?? '')) // 同日早到晚
  })
}
