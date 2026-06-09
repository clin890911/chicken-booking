const DEFAULT_DINING_DURATION_MIN = 90
const DEFAULT_CLEANUP_BUFFER_MIN = 10

// 容量排除的狀態：已取消/未到/已完成 的訂位與團體都不再佔位。
// client 與 server（functions/index.js）必須使用同一份排除集合。
export const CAPACITY_EXCLUDED_STATUSES = ['cancelled', 'noshow', 'completed']

export function toMinutes(time = '00:00') {
  const [h, m] = String(time).split(':').map(Number)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 0
  return h * 60 + m
}

export function occupancyMinutes(settings = {}) {
  const dining = Number(settings.diningDurationMin) || DEFAULT_DINING_DURATION_MIN
  const buffer = Number(settings.cleanupBufferMin) || DEFAULT_CLEANUP_BUFFER_MIN
  return Math.max(0, dining + buffer)
}

// 兩個時間窗是否重疊：[start, start+durationMin) 與 [targetMinutes, targetMinutes+durationMin)
function rangesOverlap(start, end, targetMinutes, durationMin) {
  return start < targetMinutes + durationMin && targetMinutes < end
}

function overlapsSlot(booking, targetMinutes, durationMin) {
  const start = toMinutes(booking.timeSlot)
  const end = start + durationMin
  return rangesOverlap(start, end, targetMinutes, durationMin)
}

// === 團體佔位（整桌保留語意）===
// 一個團在某日佔用的「相異桌號」集合（兩梯重用同桌只算一次）。
export function groupTableNumbers(group) {
  const seen = new Set()
  ;(group?.batches || []).forEach(b => (b.tableNumbers || []).forEach(n => { if (n) seen.add(String(n)) }))
  return [...seen]
}

// 團體佔用的合併時間窗：[最早梯次開始, 最晚梯次開始 + 佔位時長]。
// 回傳 null 代表沒有任何有效梯次。
export function groupOccupancyWindow(group, durationMin) {
  const starts = (group?.batches || [])
    .map(b => toMinutes(b.timeSlot))
    .filter(n => Number.isFinite(n) && n > 0)
  if (!starts.length) return null
  return { start: Math.min(...starts), end: Math.max(...starts) + durationMin }
}

// 一個團對「全店座位池」的佔用 = 其相異桌號的 capacity 合計（整桌保留）。
export function groupHeldSeats(group, tableCapByNumber) {
  return groupTableNumbers(group).reduce((sum, n) => sum + (Number(tableCapByNumber[n]) || 0), 0)
}

// 計算特定抵達時段的可訂位剩餘人數。
// 散客訂位：每筆佔用「用餐時間 + 清桌緩衝」窗、扣 guests（各自佔各自座位 → 逐筆 sum）。
// 團體預排：整桌專屬保留，扣「該團相異桌號的座位合計」、佔用窗為合併梯次窗
//          （兩梯重用同桌只算一次，避免雙扣；圈大桌坐少人也照整桌扣，即「嚴格」口徑）。
export function calcSlotCapacity(tables, bookings, date, timeSlot, settings = {}, groupReservations = []) {
  const durationMin = occupancyMinutes(settings)
  const targetMinutes = toMinutes(timeSlot)
  const totalSeats = tables
    .filter(t => t.isActive)
    .reduce((sum, t) => sum + t.capacity, 0)

  const reserved = bookings
    .filter(b =>
      b.date === date &&
      b.timeSlot &&
      !CAPACITY_EXCLUDED_STATUSES.includes(b.status) &&
      overlapsSlot(b, targetMinutes, durationMin)
    )
    .reduce((sum, b) => sum + (Number(b.guests) || 0), 0)

  const tableCapByNumber = {}
  tables.forEach(t => { tableCapByNumber[t.number] = Number(t.capacity) || 0 })

  const groupHeld = (groupReservations || [])
    .filter(g => g.date === date && !CAPACITY_EXCLUDED_STATUSES.includes(g.status))
    .reduce((sum, g) => {
      const win = groupOccupancyWindow(g, durationMin)
      if (!win || !rangesOverlap(win.start, win.end, targetMinutes, durationMin)) return sum
      return sum + groupHeldSeats(g, tableCapByNumber)
    }, 0)

  return Math.max(0, totalSeats - reserved - groupHeld)
}

export function bookingOccupancyLabel(settings = {}) {
  const dining = Number(settings.diningDurationMin) || DEFAULT_DINING_DURATION_MIN
  const buffer = Number(settings.cleanupBufferMin) || DEFAULT_CLEANUP_BUFFER_MIN
  return `用餐 ${dining} 分鐘，保留 ${buffer} 分鐘清桌緩衝`
}

export function calcDayBookings(bookings, date) {
  return bookings.filter(b => b.date === date && b.status !== 'cancelled')
}

export function totalActiveSeats(tables) {
  return tables.filter(t => t.isActive).reduce((s, t) => s + t.capacity, 0)
}
