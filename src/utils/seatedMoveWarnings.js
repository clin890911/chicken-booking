import { assignmentWindow, preassignConflicts } from './capacity'
import { buildGroupHolds } from './groupLive'
import { formatDate } from './timeSlots'

// UI 確認與 service 重驗用相同快照；同桌換了另一筆保留也必須重新勾選。
export function seatedMoveWarningSignature(bookingId, numbers, { bookings, groups, tables, settings, now = new Date() }) {
  const date = formatDate(now)
  const window = assignmentWindow({ mode: 'now', date, now }, settings)
  const holds = buildGroupHolds(groups.filter(g => g.date === date && !['cancelled', 'completed'].includes(g.status)), tables)
  return JSON.stringify(numbers.map(String).sort().map(n => ({
    number: n,
    bookings: preassignConflicts(bookings, n, { date, excludeBookingId: bookingId, window }, settings)
      .map(c => ({ booking: c.booking, overlaps: c.overlaps, willRelease: c.willRelease })),
    holds: holds[n]?.holds || [],
  })))
}
