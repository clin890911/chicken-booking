// 計算特定時段的可訂位剩餘人數
export function calcSlotCapacity(tables, bookings, date, timeSlot) {
  const totalSeats = tables
    .filter(t => t.isActive)
    .reduce((sum, t) => sum + t.capacity, 0)
  const reserved = bookings
    .filter(b => b.date === date && b.timeSlot === timeSlot && b.status !== 'cancelled' && b.status !== 'noshow')
    .reduce((sum, b) => sum + (Number(b.guests) || 0), 0)
  return Math.max(0, totalSeats - reserved)
}

export function calcDayBookings(bookings, date) {
  return bookings.filter(b => b.date === date && b.status !== 'cancelled')
}

export function totalActiveSeats(tables) {
  return tables.filter(t => t.isActive).reduce((s, t) => s + t.capacity, 0)
}
