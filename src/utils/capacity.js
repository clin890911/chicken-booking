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

// 兩個時間窗是否重疊：[start, end) 與 [targetMinutes, targetMinutes+durationMin)
export function rangesOverlap(start, end, targetMinutes, durationMin) {
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
// 大組併桌預配時，桌可能落在 extraTableIds（額外桌），亦視為「此桌已被預配」。
// 參數：
//   - excludeBookingId：正在指派的這筆自己。現場指派的就是被預配的那位客人時，傳入其 id 以免自我示警。
//   - date：限定同日比對，避免跨日的預配誤報（不傳則不限日）。
export function findPreassignedBooking(bookings = [], tableNumber, { date, excludeBookingId } = {}) {
  if (tableNumber == null) return null
  const target = String(tableNumber)
  return (bookings || []).find(b => {
    if (b.id === excludeBookingId) return false
    if (date != null && b.date !== date) return false
    if (CAPACITY_EXCLUDED_STATUSES.includes(b.status)) return false
    const nums = [b.assignedTableId, ...(b.extraTableIds || [])].filter(n => n != null).map(String)
    return nums.includes(target)
  }) || null
}

// === 指派／入座的「佔用區間」（建議桌、候選、覆蓋預配判定共用的唯一口徑）===
// 同一張桌會被佔多久，取決於動作的語意，而不是只看訂位時段：
//   'hold'      會鎖桌（現場指派、新增表單今日存檔、held 訂位改桌）：存檔當下就 reserveTable，
//               桌從「現在」起就被佔住 → [min(現在, 時段), max(現在, 時段) + 佔位時長)。
//               只比 [時段, 時段+佔位) 會反向撞桌：09:00 幫 13:30 的陳小姐鎖 105，
//               11:00 預配 105 的余先生到店時桌已被鎖（2026-09 驗收重現）。
//               終點取 max(現在, 時段)：時段已過才鎖（遲到客）時，客人最早現在才坐下。
//   'preassign' 只記在訂位上、不鎖桌（規劃預配、預配訂位改桌）→ [時段, 時段+佔位)
//   'now'       立即入座（現場帶位、候位入座、散客直接入座）→ [現在, 現在+佔位)
// 佔位時長＝occupancyMinutes（用餐＋清桌緩衝），與容量引擎同一份。
// 非今天的 'hold' 退回 'preassign'（今天以外不會有「現在就鎖桌」）。缺時段（非 'now'）→ null＝無從比時間。
// now 可注入（測試固定時間）；分鐘數一律用本地時間。
export function assignmentWindow({ mode = 'hold', timeSlot, date, now = new Date() } = {}, settings = {}) {
  const occ = occupancyMinutes(settings)
  const nowMin = now.getHours() * 60 + now.getMinutes()
  if (mode === 'now') return { start: nowMin, end: nowMin + occ }
  if (!timeSlot) return null
  const slot = toMinutes(timeSlot)
  const isToday = !date || date === localDateStr(now)
  if (mode === 'hold' && isToday) return { start: Math.min(nowMin, slot), end: Math.max(nowMin, slot) + occ }
  return { start: slot, end: slot + occ }
}

function localDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// === 鎖桌時機（2026-09 店主拍板「接近時段才鎖」）===
// 過去今日訂位一存檔／一指派就 reserveTable：09:00 接到 18:00 的電話訂位，那張桌一整天都被鎖著，
// 現場帶位看得到空桌卻不能坐。改成依「離用餐時段還有多久」決定寫入語意：
//   'hold'      今天、且（時段開始 − 現在）≤ HOLD_LEAD_MIN（含已開始／已過的遲到客）→ 存檔當下就鎖桌（reserved）
//   'preassign' 更早 → 只記在訂位上（booking.assignedTableId），桌況維持空桌，地圖藍色虛線「預配」
//               （客人到了照樣可直接入座：seatBooking 的佔用守門允許 vacant）
// 非今天一律 'preassign'（未來日由規劃頁預配，不會「現在就鎖桌」）。缺時段無從判斷 → 'hold'（沿用舊行為）。
// ⚠️ 不做「到 T-30 自動轉鎖桌」：這裡只決定「存檔當下」寫什麼。
// 呼叫端：新增表單今日存檔、現場內嵌新增面板、現場「指派桌位」（單桌）。
// 刻意不套用：桌況抽屜「預訂」（店員明確要鎖）、帶位／候位（立即入座）、改桌（維持原 kind）。
export const HOLD_LEAD_MIN = 30

export function lockKindFor({ date, timeSlot, now = new Date(), leadMin = HOLD_LEAD_MIN } = {}) {
  if (date && date !== localDateStr(now)) return 'preassign'
  if (!timeSlot) return 'hold'
  const nowMin = now.getHours() * 60 + now.getMinutes()
  return toMinutes(timeSlot) - nowMin <= leadMin ? 'hold' : 'preassign'
}

// 這筆訂位自己的用餐區間（預配語意 [時段, 時段+佔位)）是否與 window 重疊。
// window 為 null（無從比時間）或訂位缺時段 → 保守視為重疊。
export function bookingOverlapsWindow(booking, window, settings = {}) {
  if (!window || !booking?.timeSlot) return true
  const start = toMinutes(booking.timeSlot)
  return rangesOverlap(start, start + occupancyMinutes(settings), window.start, window.end - window.start)
}

function bookingTableList(b) {
  return [b?.assignedTableId, ...(b?.extraTableIds || [])].filter(n => n != null && n !== '').map(String)
}

// === 依佔用區間的桌位衝突（建議桌／候選用）===
// 回傳「同日其他有效訂位已預配或持有、且其用餐區間與 window 重疊」的桌號集合（含併桌額外桌）。
// 過去建議桌只看「此刻桌況是不是空桌」，預配不動桌況（桌仍 vacant）→ 11:00 已預配 105 時仍建議 105。
// window 由 assignmentWindow 依動作語意算好（見上）；排除 CAPACITY_EXCLUDED_STATUSES。
//   - excludeBookingId：正在找桌的這筆自己（改桌時自己的舊桌不算衝突）。
// ⚠️ 只給「建議／候選」用；現場指派／帶位的可點選集合不可拿它縮小（預配/團保走警示＋勾選解鎖）。
export function overlappingBookedTables(bookings = [], { date, window, excludeBookingId } = {}, settings = {}) {
  const set = new Set()
  ;(bookings || []).forEach(b => {
    if (!b || (excludeBookingId != null && b.id === excludeBookingId)) return
    if (date != null && b.date !== date) return
    if (CAPACITY_EXCLUDED_STATUSES.includes(b.status)) return
    const nums = bookingTableList(b)
    if (!nums.length) return
    if (!bookingOverlapsWindow(b, window, settings)) return
    nums.forEach(n => set.add(n))
  })
  return set
}

// === 覆蓋預配判定（警示文字與實際解除共用）===
// 某桌上同日他筆訂位的預配，逐筆標記：
//   overlaps     其用餐區間是否與「新佔用區間」window 重疊
//   willRelease  重疊且仍是待到（confirmed/pending）→ 覆蓋後會被解除（seatingService.releaseOverriddenAssignment）
// 不重疊的預配保留（例：12:20 帶位不影響 20:30 的預配）。依時段排序。
// 觸發警示的集合與 findPreassignedBooking 相同（非取消/未到/完成），不因時段縮小（M1：警示＋勾選解鎖不變）。
export function preassignConflicts(bookings = [], tableNumber, { date, excludeBookingId, window } = {}, settings = {}) {
  if (tableNumber == null) return []
  const target = String(tableNumber)
  return (bookings || [])
    .filter(b => b && (excludeBookingId == null || b.id !== excludeBookingId)
      && (date == null || b.date === date)
      && !CAPACITY_EXCLUDED_STATUSES.includes(b.status)
      && bookingTableList(b).includes(target))
    .map(b => {
      const overlaps = bookingOverlapsWindow(b, window, settings)
      return { booking: b, overlaps, willRelease: overlaps && ['confirmed', 'pending'].includes(b.status) }
    })
    .sort((a, b) => String(a.booking.timeSlot || '').localeCompare(String(b.booking.timeSlot || '')))
}
