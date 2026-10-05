import { assignmentWindow, bookingOverlapsWindow, CAPACITY_EXCLUDED_STATUSES, occupancyMinutes, toMinutes } from './capacity'
import { isTableUsableOnDate, isTableOutOnDate } from './tableAvailability'
import { statusZh, diningTablePresentation } from './tableStatus'

const localDay = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
export const opsTimeLabel = minutes => minutes == null ? '' : `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`

// 唯讀呈現：沿用容量引擎的 [開始, 結束) 與用餐＋清桌時長，不取代入座 service 守門。
export function getOpsTableState(table, { bookings = [], tables = [], groupHoldTables = {}, settings = {}, date, now = Date.now() } = {}) {
  table = diningTablePresentation(table, bookings.find(b => String(b.id) === String(table.currentBookingId)), tables)
  const at = now instanceof Date ? now : new Date(now)
  const day = date || localDay(at)
  const currentWindow = assignmentWindow({ mode: 'now', now: at }, settings)
  const number = String(table.number)
  const reservations = bookings.filter(b => b.date === day && !CAPACITY_EXCLUDED_STATUSES.includes(b.status)
    && ['confirmed', 'pending'].includes(b.status)
    && [b.assignedTableId, ...(b.extraTableIds || [])].filter(Boolean).map(String).includes(number))
    .map(b => ({ timeSlot: b.timeSlot || '', guests: Number(b.guests) || 0, kind: 'booking', label: b.name || '訂位' }))
  ;(groupHoldTables[number]?.holds || []).forEach(({ group, batch }) => {
    if (!group || !batch || (group.date && group.date !== day) || CAPACITY_EXCLUDED_STATUSES.includes(group.status) || batch.releasedAt) return
    reservations.push({ timeSlot: batch.timeSlot || '', guests: Number(batch.guests) || 0, kind: 'group', label: group.agencyName || '團體' })
  })
  const pending = reservations.filter(r => !r.timeSlot || toMinutes(r.timeSlot) + occupancyMinutes(settings) > currentWindow.start)
    .sort((a, b) => String(a.timeSlot || '00:00').localeCompare(String(b.timeSlot || '00:00')))
  const nextReservation = pending[0] || null
  const hasTimeConflict = pending.some(r => bookingOverlapsWindow(r, currentWindow, settings))
  const availableUntil = nextReservation?.timeSlot ? toMinutes(nextReservation.timeSlot) : null
  let unavailableReason = ''
  if (!isTableUsableOnDate(table, day)) unavailableReason = table.isActive === false ? '長期停用' : (table.outage?.reason || '維修中')
  else if (table.status === 'blocked') unavailableReason = table.blockReason || '臨時不可用'
  const statusLabel = unavailableReason ? (table.isActive === false ? '停用' : isTableOutOnDate(table, day) ? '維修中' : '不可用') : statusZh(table.status || 'vacant')
  const canSeatNow = !unavailableReason && table.status === 'vacant' && !hasTimeConflict
  let estimatedEnd = currentWindow.end
  if (table.status === 'dining' && table.seatedAt) {
    const seated = new Date(table.seatedAt)
    if (Number.isFinite(seated.getTime())) estimatedEnd = seated.getHours() * 60 + seated.getMinutes() + occupancyMinutes(settings)
  }
  const reservationLabel = nextReservation ? `${nextReservation.kind === 'group' ? '團保' : '下組'} ${nextReservation.timeSlot || '未定時段'}` : ''
  let availabilityLabel
  if (unavailableReason) availabilityLabel = `現在不可用 · ${unavailableReason}`
  else if (table.status === 'dining') availabilityLabel = `用餐中 · 預估清桌至 ${opsTimeLabel(estimatedEnd)}`
  else if (table.status !== 'vacant') availabilityLabel = statusLabel
  else if (hasTimeConflict) availabilityLabel = `本組預估占到 ${opsTimeLabel(estimatedEnd)}：時段衝突`
  else availabilityLabel = `現在可入座 · ${availableUntil == null ? `本組預估占到 ${opsTimeLabel(estimatedEnd)}` : `可用至 ${opsTimeLabel(availableUntil)}`}`
  return { statusLabel, unavailableReason, canSeatNow, nextReservation, availableUntil, estimatedEnd, hasTimeConflict, availabilityLabel, reservationLabel }
}

export function buildOpsTablePresentation({ tables = [], ...options } = {}) {
  return Object.fromEntries(tables.map(t => [t.number, getOpsTableState(t, { ...options, tables })]))
}
