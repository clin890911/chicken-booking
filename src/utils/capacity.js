import { seatingForSlot } from './timeSlots'
import { isTableUsableOnDate } from './tableAvailability'

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

// === 司領桌（司機+領隊桌）===
// 司領桌以「特殊梯次」存在 group.batches 內，旗標 isEscort=true。
// 實體佔桌一律照算（含司領桌→擋他人/維修守門），但旅客人數/保留席/「第N梯」標號只看旅客梯次。
export function isEscortBatch(b) {
  return !!b?.isEscort
}
// 旅客梯次（排除司領桌）— 旅客計數/保留席/梯次編號的單一來源
export function guestBatches(group) {
  return (group?.batches || []).filter(b => !isEscortBatch(b))
}

// === 團體佔位（整桌保留語意）===
// 一個團在某日佔用的「相異桌號」集合（兩梯重用同桌只算一次）。含司領桌（實體佔桌）。
export function groupTableNumbers(group) {
  const seen = new Set()
  ;(group?.batches || []).forEach(b => (b.tableNumbers || []).forEach(n => { if (n) seen.add(String(n)) }))
  return [...seen]
}

// 旅客梯次佔用的相異桌號（排除司領桌）— 算「旅客保留席」用，不含司領桌
export function guestTableNumbers(group) {
  const seen = new Set()
  guestBatches(group).forEach(b => (b.tableNumbers || []).forEach(n => { if (n) seen.add(String(n)) }))
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

// === 關閉時段判定（client 與 server functions/index.js 必須同邏輯）===
// 某日某抵達時段是否已被店家關閉訂位：整天公休 / 該時段被關 / 其所屬場次被關，任一成立即關閉。
export function isSlotClosed(settings = {}, date, timeSlot) {
  const c = settings?.closures || {}
  if (Array.isArray(c.closedDates) && c.closedDates.includes(date)) return true
  if (Array.isArray(c.closedSlots?.[date]) && c.closedSlots[date].includes(timeSlot)) return true
  const seating = seatingForSlot(settings, timeSlot)
  if (seating && Array.isArray(c.closedSeatings?.[date]) && c.closedSeatings[date].includes(seating.id)) return true
  return false
}

// 某日某「場次」是否關閉（整天公休或該場次被關）。給統一地圖場次層判定用。
export function isSeatingClosed(settings = {}, date, seating) {
  const c = settings?.closures || {}
  if (Array.isArray(c.closedDates) && c.closedDates.includes(date)) return true
  if (seating && Array.isArray(c.closedSeatings?.[date]) && c.closedSeatings[date].includes(seating.id)) return true
  return false
}

// 計算特定抵達時段的可訂位剩餘人數。
// 散客訂位：每筆佔用「用餐時間 + 清桌緩衝」窗、扣 guests（各自佔各自座位 → 逐筆 sum）。
// 團體預排：整桌專屬保留，扣「該團相異桌號的座位合計」、佔用窗為合併梯次窗
//          （兩梯重用同桌只算一次，避免雙扣；圈大桌坐少人也照整桌扣，即「嚴格」口徑）。
// 已關閉的時段直接回 0（與後端 calcSlotCapacityServer 一致），讓 availability 顯示為不可訂。
export function calcSlotCapacity(tables, bookings, date, timeSlot, settings = {}, groupReservations = []) {
  if (isSlotClosed(settings, date, timeSlot)) return 0
  const durationMin = occupancyMinutes(settings)
  const targetMinutes = toMinutes(timeSlot)
  // 可用桌 = 啟用中且該日不在維修窗（與後端 calcSlotCapacityServer 同口徑）。
  const totalSeats = tables
    .filter(t => isTableUsableOnDate(t, date))
    .reduce((sum, t) => sum + (Number(t.capacity) || 0), 0)

  const reserved = bookings
    .filter(b =>
      b.date === date &&
      b.timeSlot &&
      !CAPACITY_EXCLUDED_STATUSES.includes(b.status) &&
      overlapsSlot(b, targetMinutes, durationMin)
    )
    .reduce((sum, b) => sum + (Number(b.guests) || 0), 0)

  // 團體保留席只計「該日可用」的桌：停用/維修桌不在 totalSeats 池中，
  // 若仍按容量扣會雙重扣除（線上可訂量憑空變少）。與後端 calcSlotCapacityServer 同口徑。
  const tableCapByNumber = {}
  tables.forEach(t => { tableCapByNumber[t.number] = isTableUsableOnDate(t, date) ? (Number(t.capacity) || 0) : 0 })

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

// === 統一佔用解析器（散客 × 團客同框）===
// 給「日期 + 場次」維度的統一座位地圖：把同日、且 timeSlot 歸屬於該場次的散客訂位與團客梯次
// 攤平成「每桌佔用者」+ 摘要。複用 CAPACITY_EXCLUDED_STATUSES 與 seatingForSlot，口徑與容量引擎一致。
//   - 散客：有 assignedTableId → 落該桌（kind:'walkin'）；未指派 → 只進 summary.unassignedWalkinGuests。
//   - 團客：該梯各圈定桌號 → 落該桌（kind:'group'），整桌保留；同場次跨梯重用同桌只算一次。
// 回傳 byTable={ 桌號: { kind, booking?|group?+batch? } } 與 summary。
export function resolveSlotOccupancy(tables = [], bookings = [], groupReservations = [], date, seating, settings = {}) {
  const byTable = {}
  // 與 calcSlotCapacity 同口徑：團體保留席只計該日可用的桌（防雙重扣除）。
  const capByNum = {}
  tables.forEach(t => { capByNum[t.number] = isTableUsableOnDate(t, date) ? (Number(t.capacity) || 0) : 0 })
  const belongs = (timeSlot) => !!seating && seatingForSlot(settings, timeSlot)?.id === seating.id

  let walkinGuests = 0
  let unassignedWalkinGuests = 0
  let walkinAssignedTables = 0
  ;(bookings || []).forEach(b => {
    if (b.date !== date || !b.timeSlot || CAPACITY_EXCLUDED_STATUSES.includes(b.status)) return
    if (!belongs(b.timeSlot)) return
    walkinGuests += Number(b.guests) || 0
    const tn = b.assignedTableId ? String(b.assignedTableId) : null
    if (tn) {
      if (!byTable[tn]) { byTable[tn] = { kind: 'walkin', booking: b }; walkinAssignedTables++ }
      // 大組併桌的額外桌也算這組佔用——否則副桌會被當空桌、被別組預配/帶位。
      ;(b.extraTableIds || []).forEach(n => {
        const key = String(n)
        if (key && !byTable[key]) { byTable[key] = { kind: 'walkin', booking: b, isExtra: true }; walkinAssignedTables++ }
      })
    } else {
      unassignedWalkinGuests += Number(b.guests) || 0
    }
  })

  let groupHeldSeats = 0
  let groupTableCount = 0
  ;(groupReservations || []).forEach(g => {
    if (g.date !== date || CAPACITY_EXCLUDED_STATUSES.includes(g.status)) return
    ;(g.batches || []).forEach(bt => {
      if (!belongs(bt.timeSlot)) return
      ;(bt.tableNumbers || []).forEach(n => {
        const key = String(n)
        if (!byTable[key]) { byTable[key] = { kind: 'group', group: g, batch: bt }; groupHeldSeats += capByNum[key] || 0; groupTableCount++ }
      })
    })
  })

  const activeTables = (tables || []).filter(t => isTableUsableOnDate(t, date))
  const totalSeats = activeTables.reduce((s, t) => s + (Number(t.capacity) || 0), 0)
  const totalTables = activeTables.length
  const occupiedTables = Object.keys(byTable).length // = walkinAssignedTables + groupTableCount（byTable 已去重）
  const closed = isSeatingClosed(settings, date, seating)
  const remaining = closed ? 0 : Math.max(0, totalSeats - walkinGuests - groupHeldSeats)
  const remainingTables = closed ? 0 : Math.max(0, totalTables - occupiedTables)
  return {
    byTable,
    summary: { totalSeats, totalTables, occupiedTables, walkinGuests, unassignedWalkinGuests, walkinAssignedTables, groupHeldSeats, groupTableCount, remaining, remainingTables, closed },
  }
}

// 某「日期 + 場次」還剩幾桌 / 幾席 —— 給團體預排「預選場次」的剩餘提示。
// 只呼叫一次 resolveSlotOccupancy（與容量引擎同口徑），由其 summary 取焦點欄位。
// 註：occupiedTables 以「相異被佔桌號」計，一張大桌被 2 人散客佔仍算 1 桌占用，
//     故 remainingTables 為保守值、remainingSeats 為嚴格席數。
export function remainingTablesForSeating(tables = [], bookings = [], groupReservations = [], date, seating, settings = {}) {
  const { summary } = resolveSlotOccupancy(tables, bookings, groupReservations, date, seating, settings)
  return {
    totalTables: summary.totalTables,
    occupiedTables: summary.occupiedTables,
    remainingTables: summary.remainingTables,
    totalSeats: summary.totalSeats,
    remainingSeats: summary.remaining,
    closed: summary.closed,
  }
}

// === 預先配桌衝突偵測 ===
// 找出「已把某桌預先配走」的散客訂位（assignedTableId 指向此桌、未取消/未完成）。
// 用途：現場「指派桌」防呆 — 指派到一張已被別筆預配的桌前，先示警「此桌已預留給 ○○」。
//   預配只記 booking.assignedTableId、不動 table.status，故被預配的桌仍是 vacant，
//   會照常出現在現場可指派清單，若不示警就會默默覆蓋前者預配。
// 參數：
//   - excludeBookingId：正在指派的這筆自己。現場指派的就是被預配的那位客人時，傳入其 id 以免自我示警。
//   - date：限定同日比對，避免跨日的預配誤報（不傳則不限日）。
export function findPreassignedBooking(bookings = [], tableNumber, { date, excludeBookingId } = {}) {
  if (tableNumber == null) return null
  return (bookings || []).find(b =>
    b.assignedTableId != null &&
    String(b.assignedTableId) === String(tableNumber) &&
    b.id !== excludeBookingId &&
    (date == null || b.date === date) &&
    !CAPACITY_EXCLUDED_STATUSES.includes(b.status),
  ) || null
}
