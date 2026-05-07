const DEFAULT_DINING_DURATION_MIN = 90
const DEFAULT_CLEANUP_BUFFER_MIN = 10

function toMinutes(time = '00:00') {
  const [h, m] = String(time).split(':').map(Number)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 0
  return h * 60 + m
}

function occupancyMinutes(settings = {}) {
  const dining = Number(settings.diningDurationMin) || DEFAULT_DINING_DURATION_MIN
  const buffer = Number(settings.cleanupBufferMin) || DEFAULT_CLEANUP_BUFFER_MIN
  return Math.max(0, dining + buffer)
}

function overlapsSlot(booking, targetMinutes, durationMin) {
  const start = toMinutes(booking.timeSlot)
  const end = start + durationMin
  return start < targetMinutes + durationMin && targetMinutes < end
}

// 計算特定抵達時段的可訂位剩餘人數。每筆訂位佔用「用餐時間 + 清桌緩衝」。
export function calcSlotCapacity(tables, bookings, date, timeSlot, settings = {}) {
  const durationMin = occupancyMinutes(settings)
  const targetMinutes = toMinutes(timeSlot)
  const totalSeats = tables
    .filter(t => t.isActive)
    .reduce((sum, t) => sum + t.capacity, 0)
  const reserved = bookings
    .filter(b =>
      b.date === date &&
      b.timeSlot &&
      !['cancelled', 'noshow', 'completed'].includes(b.status) &&
      overlapsSlot(b, targetMinutes, durationMin)
    )
    .reduce((sum, b) => sum + (Number(b.guests) || 0), 0)
  return Math.max(0, totalSeats - reserved)
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
