// seatingService：桌位 × 訂位 × 候位的協作流程
// 是業務邏輯整合層 — UI 元件呼叫這裡的高階動作，不直接戳底層 service
import * as tableService from './tableService'
import * as bookingService from './bookingService'
import * as waitlistService from './waitlistService'
import * as customerService from './customerService'
import * as groupService from './groupReservationService'
import { getSettings } from './settingsService'
import { statusZh, assignmentKind } from '../utils/tableStatus'
import { bookingTableNumbers } from '../utils/bookingTables'
import { isTableUsableOnDate, normalizeOutage } from '../utils/tableAvailability'
import { groupTableNumbers, CAPACITY_EXCLUDED_STATUSES, overlappingBookedTables, assignmentWindow, bookingOverlapsWindow, occupancyMinutes, rangesOverlap, lockKindFor, preassignConflicts, squeezeSeats } from '../utils/capacity'
import { seatedMoveWarningSignature } from '../utils/seatedMoveWarnings'
import { buildGroupHolds } from '../utils/groupLive'
import { todayStr, nowSlot, formatDate } from '../utils/timeSlots'

// === 停用/維修守門（service 層底線；UI 防線會被新介面或程式呼叫繞過）===
// 所有「把客人放上桌」的入口共用：今日停用或維修中的桌一律拒絕。
function outOfServiceError(tableNumber) {
  return `${tableNumber} 停用/維修中，請改用其他桌`
}
function tableUsableToday(table) {
  return isTableUsableOnDate(table, todayStr())
}

// 這筆 booking 佔用的所有桌（主桌 assignedTableId + 大組併桌的 extraTableIds），去重去空。
export { bookingTableNumbers }

// 現在時間的 30 分鐘抵達時段（walk-in 用）
function nowTimeSlot() {
  return nowSlot()
}

// 這張桌「此刻由本訂位持有」：currentBookingId 指向本訂位（字串比對，避免數字/字串 id 混用）。
function heldBy(table, bookingId) {
  return !!table && bookingId != null && table.currentBookingId != null
    && String(table.currentBookingId) === String(bookingId)
}

// 桌上現在是誰（給錯誤訊息用）：散客訂位 → 姓名；團體梯次 → 團名；查不到 → null。
function occupantName(table) {
  if (!table) return null
  if (table.currentBookingId) {
    const other = bookingService.getById(table.currentBookingId)
    if (other) return other.name || '另一組客人'
  }
  if (table.currentRef?.groupId) {
    const g = groupService.getById(table.currentRef.groupId)
    return `團體${g?.agencyName ? ` ${g.agencyName}` : ''}`
  }
  return null
}

// 入座被擋時的訊息依桌況分：待清桌講清楚「上一組已用畢、先清桌」，而不是「目前由 X 使用」
// （待清桌的 currentBookingId 仍指向上一組，照舊寫法會誤導成那組客人還在）。
function occupiedError(tableNumber, table) {
  if (table.status === 'cleaning') return `${tableNumber} 待清桌（上一組已用畢），請先清桌或改桌`
  const who = ['dining', 'reserved'].includes(table.status) ? occupantName(table) : null
  return who
    ? `${tableNumber} 目前由 ${who} 使用，請先改桌`
    : `${tableNumber} 目前${statusZh(table.status)}，請先改桌`
}

// 併桌席數不足（已含每桌擠一擠的額度，見 capacity.squeezeSeats）
function squeezeShortError(tables, guests) {
  const seats = tables.reduce((s, t) => s + (Number(t.capacity) || 0), 0)
  return `所選桌合計 ${seats} 席（最多擠 ${squeezeSeats(tables)} 位），不足 ${guests} 位`
}

// === 訂位 → 指派桌 ===
// 客人線上訂位（assignedTableId: null）→ 到店時店長指派一張空桌
export function assignBookingToTable(bookingId, tableNumber) {
  const booking = bookingService.getById(bookingId)
  const table = tableService.getByNumber(tableNumber)
  if (!booking) return { ok: false, error: '訂位不存在' }
  if (!table) return { ok: false, error: '桌位不存在' }
  if (!tableUsableToday(table)) return { ok: false, error: outOfServiceError(tableNumber) }
  if (table.status !== 'vacant') return { ok: false, error: `${tableNumber} 目前不是空桌（${statusZh(table.status)}）` }
  if (Number(booking.guests) > squeezeSeats([table])) return { ok: false, error: `${tableNumber} 容量不足（${table.capacity} 人桌最多擠 ${squeezeSeats([table])} 位，此組 ${booking.guests} 位）` }

  bookingService.assignTable(bookingId, tableNumber)
  tableService.reserveTable(tableNumber, bookingId)
  return { ok: true, booking, table }
}

// === 訂位 → 指派多桌（大組併桌）===
// 散客訂位人數超過任何單桌容量 → 一筆 booking 佔多張桌：tableNumbers[0]=主桌，其餘=額外桌。
// 全部桌 reserved + currentBookingId 指向同一 booking。單桌時退回 assignBookingToTable（維持單一路徑）。
// 與 walkInSeatMulti 同口徑：每張桌須存在/今日可用/空桌、合計容量（含每桌擠一擠）≥人數、且同一樓層（一組不分坐兩層）。
export function assignBookingTablesMulti(bookingId, tableNumbers) {
  const nums = [...new Set((tableNumbers || []).map(String).filter(Boolean))]
  if (nums.length === 0) return { ok: false, error: '請至少選一張桌' }
  if (nums.length === 1) return assignBookingToTable(bookingId, nums[0])

  const booking = bookingService.getById(bookingId)
  if (!booking) return { ok: false, error: '訂位不存在' }

  const picked = []
  const floors = new Set()
  for (const n of nums) {
    const t = tableService.getByNumber(n)
    if (!t) return { ok: false, error: `桌位 ${n} 不存在` }
    if (!tableUsableToday(t)) return { ok: false, error: outOfServiceError(n) }
    if (t.status !== 'vacant') return { ok: false, error: `${n} 目前不是空桌（${statusZh(t.status)}）` }
    picked.push(t)
    floors.add(t.floor)
  }
  // ★ 併桌必須同一樓層——service 層硬擋，繞過 UI 也擋得住
  if (floors.size > 1) return { ok: false, error: '併桌必須在同一樓層，請改選同層的桌' }
  const guests = Number(booking.guests) || 0
  if (guests > squeezeSeats(picked)) return { ok: false, error: squeezeShortError(picked, guests) }

  const [mainTable, ...extra] = nums
  bookingService.update(bookingId, { assignedTableId: mainTable, extraTableIds: extra })
  nums.forEach(n => tableService.reserveTable(n, bookingId))
  return { ok: true, booking, tableNumbers: nums }
}

// === 客人到了 → 入座 ===
// reserved + 客人到了 → dining
// 自動記錄 actualArrivalTime + 同步桌位狀態
// ★ 佔用守門：桌必須是「空桌（預配）」或「由本訂位持有（現場指派鎖桌）」才放行。
//   過去不看桌上是誰就直接 seatTable 覆寫——同一張桌被兩筆訂位掛著時（預配被覆蓋、建議桌撞時段），
//   後按「客人到了」的那組會把正在用餐的那組從桌況圖上無聲抹掉（他們的訂位仍 arrived、卻沒有桌）。
//   擋下時回 code:'table-occupied'，UI 以 toast 顯示並給「改桌」出口。
export function seatBooking(bookingId) {
  const booking = bookingService.getById(bookingId)
  if (!booking) return { ok: false, error: '訂位不存在' }
  if (booking.status === 'arrived') return { ok: false, error: '此組已入座，請使用換桌' }
  if (bookingTableNumbers(booking).length > 1) return seatBookingAllTables(bookingId)
  if (!booking.assignedTableId) return { ok: false, error: '尚未指派桌位（請先指派）' }
  // 預配後桌子才被設停用/維修：到店入座時擋下並提示改派（而非默默坐上維修桌）。
  const table = tableService.getByNumber(booking.assignedTableId)
  if (!table) return { ok: false, error: '桌位不存在' }
  if (table && !tableUsableToday(table)) {
    return { ok: false, error: `${booking.assignedTableId} 停用/維修中，請先改派其他桌再入座` }
  }
  if (table && (table.currentRef || (table.status !== 'vacant' && !heldBy(table, bookingId)))) {
    return { ok: false, code: 'table-occupied', error: occupiedError(booking.assignedTableId, table) }
  }

  const undo = seatUndoSnapshot(bookingId, [table])
  bookingService.setStatus(bookingId, 'arrived')   // setStatus 內會自動記 actualArrivalTime
  tableService.seatTable(booking.assignedTableId, bookingId)
  return { ok: true, tableNumber: booking.assignedTableId, undo }
}

// 入座前的復原快照（四個「客人到了」入口共用，見 undoSeatBooking）：
// 每張桌入座前是「本筆鎖住（reserved）」還是「空桌（預配）」——復原時據此倒回 reserved 或 vacant。
// assignment：入座前的配桌（只有「到了 · 選桌入座」那條會連桌號一起改，復原要寫回原本的未配桌）。
function seatUndoSnapshot(bookingId, tables, assignment) {
  const restore = {}
  tables.forEach(t => { restore[String(t.number)] = heldBy(t, bookingId) ? 'reserved' : 'vacant' })
  const snap = { bookingId, tableNumbers: tables.map(t => String(t.number)), restore }
  if (assignment) snap.assignment = assignment
  return snap
}

// === 預配的大組（主桌＋額外桌）到店：整組一起入座 ===
// seatBooking 只把主桌設成用餐中（鎖桌型的大組額外桌早已 reserved）；預配型的額外桌此刻是空桌，
// 只坐主桌會讓額外桌在桌況圖上仍是空桌、被別組帶走。這裡要求每張桌「今日可用、且空桌或由本訂位持有」，
// 全部符合才一起入座（booking → arrived、每張桌 dining）；任一張被佔／停用就整組不動，回 code:'table-occupied'。
// 單桌訂位直接走 seatBooking（同一套守門）。
export function seatBookingAllTables(bookingId) {
  const booking = bookingService.getById(bookingId)
  if (!booking) return { ok: false, error: '訂位不存在' }
  if (booking.status === 'arrived') return { ok: false, error: '此組已入座，請使用換桌' }
  const nums = bookingTableNumbers(booking)
  if (nums.length <= 1) return seatBooking(bookingId)
  for (const n of nums) {
    const t = tableService.getByNumber(n)
    if (!t) return { ok: false, error: `桌位 ${n} 不存在` }
    if (!tableUsableToday(t)) return { ok: false, error: `${n} 停用/維修中，請先改派其他桌再入座` }
    if (t.currentRef || (t.status !== 'vacant' && !heldBy(t, bookingId))) {
      return { ok: false, code: 'table-occupied', error: occupiedError(n, t) }
    }
  }
  const undo = seatUndoSnapshot(bookingId, nums.map(n => tableService.getByNumber(n)))
  bookingService.setStatus(bookingId, 'arrived')
  nums.forEach(n => tableService.seatTable(n, bookingId))
  return { ok: true, tableNumber: nums[0], tableNumbers: nums, undo }
}

// === 未配桌的訂位到店：選桌即入座（指派＋入座一步完成）===
// 不另寫佔用邏輯：先走 assignBookingTablesMulti（單桌退回 assignBookingToTable）的全部守門——
// 今日可用、此刻空桌（鎖桌型只能選此刻空桌）、同樓層、擠一擠容量——再走 seatBooking／seatBookingAllTables
// 的佔用守門入座。入座若意外失敗（理論上不會：桌剛由本筆鎖住）就把剛才的指派倒回，不留半套。
// 只給「還沒配桌」的待到訂位用：已有桌（鎖桌／預配）的到店走 seatBooking，換桌走 replace*。
// 回傳 undo 快照（桌全部倒回空桌、訂位回到未配桌），由 undoSeatBooking 復原。
// 通知：service 層不發；BookingContext 包裝只發一次「客人到了」（不發「桌位已指派」，避免一次入座兩則）。
export function assignAndSeatBooking(bookingId, tableNumbers) {
  const booking = bookingService.getById(bookingId)
  if (!booking) return { ok: false, error: '訂位不存在' }
  if (!['confirmed', 'pending'].includes(booking.status)) return { ok: false, error: '這筆訂位不是待到狀態，無法入座' }
  if (bookingTableNumbers(booking).length) return { ok: false, error: '這筆訂位已有桌，請改用「客人到了」或改桌' }
  const assignment = { assignedTableId: null, extraTableIds: [] }
  const picked = [...new Set((tableNumbers || []).map(String).filter(Boolean))]
  const a = assignBookingTablesMulti(bookingId, picked)
  if (!a.ok) return a
  const r = seatBooking(bookingId)
  if (!r.ok) {
    // 倒回剛才的指派：只清仍由本筆鎖住的桌
    bookingService.update(bookingId, assignment)
    picked.forEach(n => { const t = tableService.getByNumber(n); if (t && t.status === 'reserved' && heldBy(t, bookingId)) tableService.clearTable(n) })
    return r
  }
  const nums = r.tableNumbers || [r.tableNumber]
  // 入座前這些桌都是空桌（剛才才鎖給本筆）→ 復原一律倒回空桌，訂位回未配桌
  return { ok: true, tableNumber: nums[0], tableNumbers: nums, undo: { ...r.undo, restore: Object.fromEntries(nums.map(n => [String(n), 'vacant'])), assignment } }
}

// === 「客人到了」的 5 秒復原（報到列／今日訂位卡／桌抽屜／訂位卡共用）===
// snap＝入座時回傳的 undo 快照（seatBooking／seatBookingAllTables／assignAndSeatBooking）。
// 復原鐵律（見 undo-paths 記錄）：
//   - 訂位必須仍是 arrived、桌組仍是當初那幾張（期間被改桌／離席就不動）
//   - 每張桌必須「仍由本筆用餐中」或「已是無人持有的空桌」才可倒；任一張被別組／團體接手 → 整組不動、回錯誤
//     （不搶別人的桌、不清別人的桌；只動本筆持有或空著的桌）
//   - 桌倒回入座前的樣子：本筆鎖住的 → reserved（重新鎖給本筆）、原本空桌（預配）→ vacant
//   - 訂位回待到（清 actualArrivalTime）；有 assignment（選桌入座）則桌號一併寫回入座前（未配桌）
export function undoSeatBooking(snap = {}) {
  const { bookingId, tableNumbers = [], restore = {}, assignment } = snap || {}
  const booking = bookingId != null ? bookingService.getById(bookingId) : null
  if (!booking) return { ok: false, error: '訂位不存在' }
  if (booking.status !== 'arrived') return { ok: false, error: '這筆訂位的狀態已被更動，無法復原' }
  const nums = bookingTableNumbers(booking)
  const want = [...new Set(tableNumbers.map(String))]
  if (!want.length || nums.length !== want.length || nums.some(n => !want.includes(n))) {
    return { ok: false, error: '這筆訂位的桌位已被更動，無法復原' }
  }
  const taken = nums.filter(n => {
    const t = tableService.getByNumber(n)
    if (!t || t.currentRef) return true
    if (t.status === 'dining' && heldBy(t, bookingId)) return false
    if (t.status === 'vacant' && t.currentBookingId == null) return false
    return true
  })
  if (taken.length) return { ok: false, code: 'table-occupied', error: `${taken.join('、')} 已被別組使用，無法復原` }
  bookingService.setStatus(bookingId, 'confirmed')   // 清掉 actualArrivalTime
  if (assignment) bookingService.update(bookingId, { assignedTableId: assignment.assignedTableId ?? null, extraTableIds: assignment.extraTableIds || [] })
  nums.forEach(n => (restore[n] === 'reserved' ? tableService.reserveTable(n, bookingId) : tableService.clearTable(n)))
  return { ok: true, tableNumbers: nums }
}

// === 報到列「到了」入座「預配」訂位後的 5 秒復原 ===
// 預配入座前桌是空桌（或別組剛離開後的空桌）→ 復原要把桌倒回空桌、訂位回待到，且保留預配
// （assignedTableId／extraTableIds 不動：客人其實還沒到，預配要留著）。不能沿用鎖桌那條把桌寫回
// reserved——那會把原本沒鎖的桌憑空鎖住。大組（主桌＋額外桌）整組一起倒。
// 復原鐵律：只在「這筆仍是用餐中、仍指向這張主桌、每張桌仍由這筆用餐中」時才倒；期間被改桌／清桌／
// 別組接手就整組不動（不清別人的桌、不搶桌）。
export function undoSeatPreassigned(bookingId, tableNumber) {
  const booking = bookingService.getById(bookingId)
  if (!booking) return { ok: false, error: '訂位不存在' }
  const nums = bookingTableNumbers(booking)
  const stillHeld = nums.length > 0 && nums.every(n => {
    const t = tableService.getByNumber(n)
    return t && t.status === 'dining' && heldBy(t, bookingId)
  })
  if (booking.status !== 'arrived' || String(booking.assignedTableId) !== String(tableNumber) || !stillHeld) {
    return { ok: false, error: '這筆訂位或桌位已被更動，無法復原' }
  }
  bookingService.setStatus(bookingId, 'confirmed')   // 會清掉 actualArrivalTime；桌號（預配）保留
  nums.forEach(n => tableService.clearTable(n))
  return { ok: true, tableNumbers: nums }
}

// === 已離席 → 等待清桌 ===
// 訂位 status: arrived → completed
// 桌位 status: dining → cleaning（仍佔位、提醒外場去清）
export function checkoutBooking(bookingId) {
  const booking = bookingService.getById(bookingId)
  if (!booking) return { ok: false, error: '訂位不存在' }
  // 大組併桌：主桌 + 額外桌 checkout（dining → cleaning）。
  // ★ 只動「仍由本訂位持有」的桌：桌號可能只是預配、或已被改派／別組接手，
  //   checkoutTable 是無條件覆寫，會把正在用餐的別組或團體梯次桌打成待清桌。
  bookingTableNumbers(booking).forEach(n => {
    if (heldBy(tableService.getByNumber(n), bookingId)) tableService.checkoutTable(n)
  })
  bookingService.setStatus(bookingId, 'completed')
  return { ok: true }
}

// === 已離席 + 清桌完成（一鍵釋出，跳過待清桌）===
// 適用：外場本人正在桌邊、桌面已清乾淨、立即可給下一組
export function finalizeBooking(bookingId) {
  const booking = bookingService.getById(bookingId)
  if (!booking) return { ok: false, error: '訂位不存在' }
  const tableNumbers = bookingTableNumbers(booking)
  bookingService.setStatus(bookingId, 'completed')
  // 大組併桌：主桌 + 額外桌直接釋出（跳過待清桌）。只清仍由本訂位持有的桌（同 checkoutBooking）。
  tableNumbers.forEach(n => {
    if (heldBy(tableService.getByNumber(n), bookingId)) tableService.clearTable(n)
  })
  return { ok: true, tableNumber: booking.assignedTableId, tableNumbers }
}

// === 過時未到 → 直接標記完成（未透過系統走過入座）===
// 差異於 checkoutBooking／finalizeBooking：那兩者假設訂位已經真的 status==='arrived'
// （客人有點過「客人到了」，桌況也真的 dining 過）。這裡專門處理「過時未到」清單的補登場景——
// 店員事後確認「這組客人其實有來、也吃完了，只是當下沒點系統入座」，所以：
//   1) 不要求前置狀態（confirmed 直接可標，不必先 arrived）
//   2) 不記 actualArrivalTime（沒有真實入座時間可記，硬記反而誤導「用餐時長」等統計）
//   3) 若有指派桌位、且該桌目前仍由這筆訂位持有（防呆：桌可能已被改派/被別筆訂位接手），
//      直接釋出為空桌（vacant）——不像 checkoutBooking 進待清桌，因為客人根本沒真的坐上那張桌，
//      沒有「清潔」這回事；桌況不動的話會永遠卡在 reserved、白白佔掉容量。
// ⚠️ 不得放寬 checkoutBooking／finalizeBooking 既有的前置條件守門，本函式是獨立入口。
export function completeWithoutSeating(bookingId) {
  const booking = bookingService.getById(bookingId)
  if (!booking) return { ok: false, error: '訂位不存在' }
  const releasedTables = []
  for (const n of bookingTableNumbers(booking)) {
    const t = tableService.getByNumber(n)
    if (t && t.currentBookingId === bookingId) {
      tableService.clearTable(n)
      releasedTables.push(n)
    }
  }
  bookingService.setStatus(bookingId, 'completed')
  return { ok: true, releasedTables }
}

// completeWithoutSeating 的復原（誤觸「已完成」後按「↩ 復原」）：
// booking 改回 confirmed；剛才釋出的桌位若「仍是空桌」就搶回 reserved（不是 dining——
// 這些桌從未真的入座過）。若在復原前那幾秒內已被別組帶位/預配佔走，不搶桌（不搶別組的桌），
// 只復原 booking 狀態，並在 failed 回報哪些桌沒搶回，交由 UI 提示店員手動再指派。
export function undoCompleteWithoutSeating(bookingId) {
  const booking = bookingService.getById(bookingId)
  if (!booking) return { ok: false, error: '訂位不存在' }
  const restored = []
  const failed = []
  for (const n of bookingTableNumbers(booking)) {
    const t = tableService.getByNumber(n)
    if (t && t.status === 'vacant') {
      tableService.reserveTable(n, bookingId)
      restored.push(n)
    } else {
      failed.push(n)
    }
  }
  bookingService.setStatus(bookingId, 'confirmed')
  return { ok: true, restored, failed }
}

// === 手動標 No-show（店員確認客人不會來）===
// booking → noshow（bookingService.setStatus 內會 recordNoshow，罰則行為不變）。
// ★ 現場指派鎖桌（reserved 且由本訂位持有）一併釋成空桌：過去只改 booking 狀態，桌一直卡在
//   reserved、白白佔掉容量，要等換日掃除才放出來。只預配（桌況沒鎖）或已被別組／團體佔用的桌不動。
// 回傳復原快照 { releasedTables, previousStatus }：桌被清掉後 currentBookingId 已查不回，
// 復原只能靠呼叫端把這份回傳值原封帶回 undoMarkNoshow。
const NOSHOW_RESTORABLE_STATUSES = ['confirmed', 'pending']
export function markNoshow(bookingId) {
  const booking = bookingService.getById(bookingId)
  if (!booking) return { ok: false, error: '訂位不存在' }
  const previousStatus = booking.status
  const releasedTables = []
  for (const n of bookingTableNumbers(booking)) {
    const t = tableService.getByNumber(n)
    if (t && t.status === 'reserved' && heldBy(t, bookingId)) {
      tableService.clearTable(n)
      releasedTables.push(n)
    }
  }
  const b = bookingService.setStatus(bookingId, 'noshow')
  return { ok: true, booking: b, releasedTables, previousStatus }
}

// markNoshow 的復原：booking 改回原狀態（confirmed/pending；其他一律 confirmed）＋扣回爽約次數；
// 剛釋出的桌只在「仍是空桌」時 reserve 回來（復原鐵律：不搶別組的桌）。搶不回的放 failed，
// 並從 booking 的桌號中拿掉（不留指向別組桌位的孤兒鎖桌）；原本只預配的桌照舊保留。
export function undoMarkNoshow(bookingId, { tableNumbers = [], status } = {}) {
  const booking = bookingService.getById(bookingId)
  if (!booking) return { ok: false, error: '訂位不存在' }
  if (booking.status !== 'noshow') return { ok: false, error: '這筆訂位已不是 No-show 狀態，無法復原' }
  const restoreStatus = NOSHOW_RESTORABLE_STATUSES.includes(status) ? status : 'confirmed'
  bookingService.setStatus(bookingId, restoreStatus)
  bookingService.revokeNoshow(booking.phone, bookingId)
  const restored = []
  const failed = []
  for (const n of [...new Set((tableNumbers || []).map(String).filter(Boolean))]) {
    const t = tableService.getByNumber(n)
    if (t && t.status === 'vacant') {
      tableService.reserveTable(n, bookingId)
      restored.push(n)
    } else {
      failed.push(n)
    }
  }
  if (failed.length) {
    const drop = new Set(failed)
    bookingService.assignTables(bookingId, bookingTableNumbers(booking).filter(n => !drop.has(String(n))))
  }
  return { ok: true, restored, failed, status: restoreStatus }
}

// === 清桌完成 → 桌位釋出 ===
export function clearTable(tableNumber) {
  return tableService.clearTable(tableNumber)
}

// === 離席後 toast「一鍵釋出」：把這筆的主桌＋併桌副桌從待清桌直接釋成空桌 ===
// 只清「仍是待清桌、且仍由這筆持有」的桌：toast 按鈕可能幾秒後才按，期間桌可能已被清好、
// 甚至已帶下一組（clearTable 是無條件覆寫，直接清會把剛入座那組從桌況圖抹掉）。
// 回傳 { ok, released: [...桌號], skipped: [...桌號] }。
export function releaseCheckedOutTables(bookingId) {
  const booking = bookingService.getById(bookingId)
  if (!booking) return { ok: false, error: '訂位不存在', released: [], skipped: [] }
  const released = []
  const skipped = []
  bookingTableNumbers(booking).forEach(n => {
    const t = tableService.getByNumber(n)
    if (t && t.status === 'cleaning' && heldBy(t, bookingId)) {
      tableService.clearTable(n)
      released.push(n)
    } else {
      skipped.push(n)
    }
  })
  return { ok: true, released, skipped }
}

// clearTable 的反向操作（誤按「✨ 清桌完成」後按「↩ 復原」）：桌況還原成待清桌。
// ★ 與其他復原同一套口徑：只在桌「仍是空桌」時還原。清桌完成後的那幾秒正是下一組被帶上桌的
//   高峰（把桌清空本來就是為了讓下一組坐），若已經有人坐下卻硬寫回 cleaning，會把剛入座那組
//   從桌況圖上抹掉——他們的 booking 還是 arrived 卻沒有桌，而且畫面完全看不出來。
//   ⚠️ 不可改回 tableService.setStatus 直接 patch（那是無條件覆寫，正是本函式要根治的）。
// snapshot 帶 clearTable 前的 currentBookingId / currentRef：兩個都被 clearTable 清掉了，
// 事後從桌上查不回來（散客走 currentBookingId、團體梯次走 currentRef）。
export function undoClearTable(tableNumber, { bookingId = null, ref = null } = {}) {
  const t = tableService.getByNumber(tableNumber)
  if (!t) return { ok: false, error: '桌位不存在' }
  if (t.status !== 'vacant') {
    return { ok: false, error: `${tableNumber} 已被下一組使用（${statusZh(t.status)}），未復原` }
  }
  tableService.setStatus(tableNumber, 'cleaning', {
    currentBookingId: bookingId,
    currentRef: ref,
    seatedAt: null,   // 待清桌本來就沒有入座時間（checkoutTable 同口徑）
  })
  return { ok: true, tableNumber }
}

// === 取消訂位 ===
// 回傳值帶著「復原所需的快照」：releasedTables（這次真的釋出的桌）、preassignedTables（只是預配、
// 桌況沒動的桌）、originalTables（取消前的完整桌號，主桌在前）與 previousStatus。
// ★ 快照不可省：取消會把 assignedTableId/extraTableIds 清空，事後從 booking 上已經完全看不出
//   原本佔了哪幾張桌 —— 復原只能靠呼叫端把這份回傳值原封帶回 undoCancelBooking。
// ★ 只清「此刻由本訂位持有」的桌（currentBookingId＝本訂位）：預配只記在 booking 上、桌況沒鎖，
//   那張桌此刻可能正由別組用餐中或被團體梯次佔用——無條件 clearTable 會把那組從桌況圖上抹掉。
export function cancelBooking(bookingId) {
  const booking = bookingService.getById(bookingId)
  if (!booking) return { ok: false, error: '訂位不存在' }
  const previousStatus = booking.status
  // 大組併桌：主桌 + 額外桌逐張看；持有的釋出、只預配的不動桌。
  const originalTables = bookingTableNumbers(booking)
  const releasedTables = []
  const preassignedTables = []
  for (const n of originalTables) {
    if (heldBy(tableService.getByNumber(n), bookingId)) {
      tableService.clearTable(n)
      releasedTables.push(n)
    } else {
      preassignedTables.push(n)
    }
  }
  bookingService.setStatus(bookingId, 'cancelled')
  // 解除主桌與額外桌的指派（避免取消後仍掛著桌號）
  bookingService.update(bookingId, { assignedTableId: null, extraTableIds: [] })
  return { ok: true, releasedTables, preassignedTables, originalTables, previousStatus }
}

// 取消訂位的入口只開在客人到店前：BookingCard 只在 confirmed/pending 顯示「取消訂位」，
// TableDrawer 只在桌況 reserved 顯示 —— 所以復原後的正確狀態就是「已預訂、等客人來」。
// 快照若帶進其他狀態（理論上到不了）一律當 confirmed，免得做出「booking 說用餐中、
// 桌況卻只是 reserved」的矛盾狀態。
const CANCEL_RESTORABLE_STATUSES = ['confirmed', 'pending']

// cancelBooking 的反向操作（店員誤按「取消訂位」後按「↩ 復原」）。
// 與 undoCompleteWithoutSeating 同一套桌位口徑：只搶「仍是空桌」的桌，被別組帶位/預配佔走的
// 不硬寫（不搶別組的桌），放進 failed 交由 UI 明講，避免店員以為復原了、其實那組客人的桌沒了。
// ⚠️ booking 的 assignedTableId/extraTableIds 只依「真的搶回來的桌＋原本只預配的桌」依取消前的
//    原順序重建：鎖桌搶不回的不留（絕不留下指向別組桌位的孤兒鎖桌），全都沒有 → 回到未指派
//    （卡片會重新長出「指派桌位」鈕）。原本只預配的桌回到「只預配、不鎖桌」（不 reserve）。
export function undoCancelBooking(bookingId, { tableNumbers = [], preassignedTables = [], originalTables, status } = {}) {
  const booking = bookingService.getById(bookingId)
  if (!booking) return { ok: false, error: '訂位不存在' }
  // 復原期間若這筆訂位已被別的操作改動（例如又被重新建立/改狀態），不覆寫別人的結果。
  if (booking.status !== 'cancelled') return { ok: false, error: '這筆訂位已不是「已取消」狀態，無法復原' }

  const restored = []
  const failed = []
  for (const n of [...new Set((tableNumbers || []).map(String).filter(Boolean))]) {
    const t = tableService.getByNumber(n)
    if (t && t.status === 'vacant') {
      tableService.reserveTable(n, bookingId)
      restored.push(n)
    } else {
      failed.push(n)
    }
  }
  const restoreStatus = CANCEL_RESTORABLE_STATUSES.includes(status) ? status : 'confirmed'
  bookingService.setStatus(bookingId, restoreStatus)
  // 依取消前的原順序：第一張當主桌、其餘為額外桌；空陣列 → assignedTableId 回 null、extraTableIds 回 []
  const keep = new Set([...restored, ...(preassignedTables || []).map(String)])
  const order = Array.isArray(originalTables) ? originalTables.map(String) : [...keep]
  bookingService.assignTables(bookingId, order.filter(n => keep.has(n)))
  return { ok: true, restored, failed, status: restoreStatus }
}

// === 候位 → 入座（拖到空桌）===
// 流程：候位 #15 → 拖到 A2 空桌 → 自動建一筆 walk-in booking + 桌位 dining
export function seatWaitlist(waitId, tableNumber) {
  const wait = waitlistService.getById(waitId)
  const table = tableService.getByNumber(tableNumber)
  if (!wait) return { ok: false, error: '候位記錄不存在' }
  if (!waitlistService.isSeatEligible(wait)) return { ok: false, error: '此候位已過號、結束或不是今天，請先確認候位狀態' }
  if (!table) return { ok: false, error: '桌位不存在' }
  if (!tableUsableToday(table)) return { ok: false, error: outOfServiceError(tableNumber) }
  if (table.status !== 'vacant') return { ok: false, error: `${tableNumber} 目前不是空桌` }
  if (Number(wait.partySize) > squeezeSeats([table])) return { ok: false, error: `${tableNumber} 容量不足（最多擠 ${squeezeSeats([table])} 位）` }

  // 1. 建立一筆 walk-in 訂位（已到店狀態）
  const today = todayStr()
  const now = new Date()
  const timeSlot = `${String(now.getHours()).padStart(2, '0')}:${String(Math.floor(now.getMinutes() / 30) * 30).padStart(2, '0')}`
  const booking = bookingService.create({
    name: wait.name,
    phone: wait.phone,
    guests: wait.partySize,
    children: wait.children,
    date: today,
    timeSlot,
    source: 'walkin',
    status: 'arrived',
    assignedTableId: tableNumber,
    lineUserId: wait.lineUserId,
    createdBy: 'waitlist',
    notes: { text: wait.notes || '' }
  })

  // 2. 桌位設為 dining
  tableService.seatTable(tableNumber, booking.id)

  // 3. 候位記錄改為 seated
  waitlistService.seat(waitId, tableNumber)

  return { ok: true, booking, tableNumber }
}

// === 候位 → 多桌入座（併桌）===
// 候位大組（人數超過任何單桌容量，例如 9 位但只剩幾張 4 人桌）→ 一筆 walk-in booking 佔多張桌：
// tableNumbers[0]=主桌，其餘=額外桌，全部桌 dining + currentBookingId 指向同一 booking。
// 補的缺口：過去候位入座只有單桌路徑，湊不到單桌就只回「目前無符合容量的空桌」，
// 明明併兩三張小桌就坐得下（訂位指派早就有併桌路徑，候位沒有）。
// 與 walkInSeatMulti / assignBookingTablesMulti 同口徑：每張桌須存在/今日可用/空桌、
// 合計容量≥人數、且同一樓層。單桌時退回 seatWaitlist（維持單一路徑）。
export function seatWaitlistMulti(waitId, tableNumbers) {
  const nums = [...new Set((tableNumbers || []).map(String).filter(Boolean))]
  if (nums.length === 0) return { ok: false, error: '請至少選一張桌' }
  if (nums.length === 1) return seatWaitlist(waitId, nums[0])

  const wait = waitlistService.getById(waitId)
  if (!wait) return { ok: false, error: '候位記錄不存在' }
  if (!waitlistService.isSeatEligible(wait)) return { ok: false, error: '此候位已過號、結束或不是今天，請先確認候位狀態' }

  const picked = []
  const floors = new Set()
  for (const n of nums) {
    const t = tableService.getByNumber(n)
    if (!t) return { ok: false, error: `桌位 ${n} 不存在` }
    if (!tableUsableToday(t)) return { ok: false, error: outOfServiceError(n) }
    if (t.status !== 'vacant') return { ok: false, error: `${n} 目前不是空桌（${statusZh(t.status)}）` }
    picked.push(t)
    floors.add(t.floor)
  }
  // ★ 併桌必須同一樓層（一組客人不可能分坐兩層）——service 層硬擋，繞過 UI 也擋得住
  if (floors.size > 1) return { ok: false, error: '併桌必須在同一樓層，請改選同層的桌' }
  const guests = Number(wait.partySize) || 0
  if (guests > squeezeSeats(picked)) return { ok: false, error: squeezeShortError(picked, guests) }

  const [mainTable, ...extra] = nums
  const booking = bookingService.create({
    name: wait.name,
    phone: wait.phone,
    guests,
    children: wait.children,
    date: todayStr(),
    timeSlot: nowTimeSlot(),
    source: 'walkin',
    status: 'arrived',
    assignedTableId: mainTable,
    extraTableIds: extra,
    lineUserId: wait.lineUserId,
    createdBy: 'waitlist',
    notes: { text: wait.notes || '' },
  })
  nums.forEach(n => tableService.seatTable(n, booking.id))
  // 候位記錄只記主桌（欄位是單數 assignedTableNumber）；完整桌組在 booking 上，
  // 釋出/復原都以 booking 為準（見 reseatBookingTables / bookingTableNumbers）。
  waitlistService.seat(waitId, mainTable)
  return { ok: true, booking, tableNumbers: nums }
}

// === 直接入座（外場手動現場開檯）===
// 用於：沒訂位、沒取候位的散客直接入座
export function walkInSeat(tableNumber, guestData) {
  const table = tableService.getByNumber(tableNumber)
  if (!table) return { ok: false, error: '桌位不存在' }
  if (!tableUsableToday(table)) return { ok: false, error: outOfServiceError(tableNumber) }
  if (table.status !== 'vacant') return { ok: false, error: `${tableNumber} 目前不是空桌` }

  const booking = bookingService.create({
    name: guestData.name || '散客',
    phone: guestData.phone || '',
    guests: Number(guestData.guests) || 2,
    children: guestData.children,
    date: todayStr(),
    timeSlot: nowTimeSlot(),
    source: 'walkin',
    status: 'arrived',
    assignedTableId: tableNumber,
    createdBy: 'staff',
    notes: { text: guestData.notes || '' }
  })
  tableService.seatTable(tableNumber, booking.id)
  return { ok: true, booking }
}

// === 大組多桌入座（併桌）===
// 散客大組（超過任何單桌容量）→ 一筆 walk-in booking 佔多張桌：tableNumbers[0]=主桌，其餘=額外桌。
// 所有桌 dining + currentBookingId 指向同一 booking。單桌時退回 walkInSeat（維持單一路徑）。
export function walkInSeatMulti(tableNumbers, guestData) {
  const nums = [...new Set((tableNumbers || []).map(String).filter(Boolean))]
  if (nums.length === 0) return { ok: false, error: '請至少選一張桌' }
  if (nums.length === 1) return walkInSeat(nums[0], guestData)

  // 驗證每張桌：存在、可用、空桌；累計容量 + 同樓層
  const picked = []
  const floors = new Set()
  for (const n of nums) {
    const t = tableService.getByNumber(n)
    if (!t) return { ok: false, error: `桌位 ${n} 不存在` }
    if (!tableUsableToday(t)) return { ok: false, error: outOfServiceError(n) }
    if (t.status !== 'vacant') return { ok: false, error: `${n} 目前不是空桌（${statusZh(t.status)}）` }
    picked.push(t)
    floors.add(t.floor)
  }
  // ★ 併桌必須同一樓層（一組客人不可能分坐兩層）——service 層硬擋，繞過 UI 也擋得住
  if (floors.size > 1) return { ok: false, error: '併桌必須在同一樓層，請改選同層的桌' }
  const guests = Number(guestData.guests) || 2
  if (guests > squeezeSeats(picked)) return { ok: false, error: squeezeShortError(picked, guests) }

  const [mainTable, ...extra] = nums
  const booking = bookingService.create({
    name: guestData.name || '散客',
    phone: guestData.phone || '',
    guests,
    children: guestData.children,
    date: todayStr(),
    timeSlot: nowTimeSlot(),
    source: 'walkin',
    status: 'arrived',
    assignedTableId: mainTable,
    extraTableIds: extra,
    createdBy: 'staff',
    notes: { text: guestData.notes || '' }
  })
  nums.forEach(n => tableService.seatTable(n, booking.id))
  return { ok: true, booking, tableNumbers: nums }
}

// 「一鍵釋出」的復原：把這筆 booking 的整組桌（主桌 + 額外桌）重新入座。
// 全部桌須仍空可用，否則拒絕（避免復原時搶走 8 秒空窗內被別組帶位的桌）。
// 單桌訂位也適用（nums = [主桌]），取代復原路徑原本只還主桌的 seatBooking。
export function reseatBookingTables(bookingId) {
  const booking = bookingService.getById(bookingId)
  if (!booking) return { ok: false, error: '訂位不存在' }
  const nums = bookingTableNumbers(booking)
  if (!nums.length) return { ok: false, error: '此訂位無桌位資料' }
  for (const n of nums) {
    const t = tableService.getByNumber(n)
    if (!t) return { ok: false, error: `桌位 ${n} 不存在` }
    if (!tableUsableToday(t)) return { ok: false, error: outOfServiceError(n) }
    if (t.status !== 'vacant') return { ok: false, error: `${n} 已被佔用，無法復原` }
  }
  bookingService.setStatus(bookingId, 'arrived')
  nums.forEach(n => tableService.seatTable(n, bookingId))
  return { ok: true, tableNumbers: nums }
}

// === 換桌／改桌（把訂位換到另一張空桌）===
// 三種來源語意各自保留（不因改桌而升級或降級）：
//   用餐中（arrived）→ 新桌 dining
//   現場指派鎖桌（held：舊桌 reserved 且 currentBookingId＝本訂位）→ 新桌 reserved
//   預配（preassign：只記在 booking 上、桌況沒鎖）→ 只改 booking.assignedTableId，不鎖新桌
// ★ 舊桌只有「仍由本訂位持有」才清（與 bookingService.releaseTableIfHeldBy 同口徑）：
//   預配的舊桌此刻可能已被別組帶位，無條件 clearTable 會把那組清掉。
// 未到訂位整組重選：驗證全部目標後才替換；取消選桌不會提前解除原桌。
export function replacePendingBookingTables(bookingId, tableNumbers, { now = new Date() } = {}) {
  const booking = bookingService.getById(bookingId)
  if (!booking || !['confirmed', 'pending'].includes(booking.status)) return { ok: false, error: '僅未到店訂位可重新選桌；已入座請保留原桌' }
  const nums = [...new Set((tableNumbers || []).map(String).filter(Boolean))]
  if (!nums.length) return { ok: false, error: '請至少選一張桌' }
  const tables = tableService.listAll()
  const original = bookingTableNumbers(booking)
  if (tables.some(t => heldBy(t, bookingId) && ['dining', 'cleaning'].includes(t.status))) return { ok: false, error: '此組已入座或離席，無法重新選桌' }
  const wasHeld = original.some(n => {
    const t = tables.find(t => String(t.number) === n)
    return t?.status === 'reserved' && heldBy(t, bookingId)
  })
  const kind = wasHeld ? 'hold' : lockKindFor({ date: booking.date, timeSlot: booking.timeSlot, now })
  const available = kind === 'preassign' ? new Set(preassignableTables(1, { bookingId, date: booking.date, timeSlot: booking.timeSlot, now }).map(t => String(t.number))) : null
  const picked = []
  const floors = new Set()
  for (const n of nums) {
    const t = tables.find(t => String(t.number) === n)
    if (!t) return { ok: false, error: `桌位 ${n} 不存在` }
    if (!isTableUsableOnDate(t, booking.date)) return { ok: false, error: `${n} 停用／維修中` }
    const ownReserved = t.status === 'reserved' && heldBy(t, bookingId)
    if (!ownReserved && (kind === 'hold' ? t.status !== 'vacant' : !available.has(n))) return { ok: false, error: occupiedError(n, t) }
    picked.push(t)
    floors.add(t.floor)
  }
  if (floors.size > 1) return { ok: false, error: '併桌必須在同一樓層，請改選同層的桌' }
  if (Number(booking.guests) > squeezeSeats(picked)) return { ok: false, error: squeezeShortError(picked, booking.guests) }
  const updatedAt = now.toISOString()
  const nextTables = tables.map(t => {
    const n = String(t.number)
    if (nums.includes(n) && kind === 'hold') return { ...t, status: 'reserved', currentBookingId: bookingId, currentRef: null, seatedAt: null, mergedWith: null, blockReason: null, updatedAt }
    if (original.includes(n) && !nums.includes(n) && t.status === 'reserved' && heldBy(t, bookingId)) return { ...t, status: 'vacant', currentBookingId: null, currentRef: null, seatedAt: null, mergedWith: null, blockReason: null, updatedAt }
    return t
  })
  // localStorage 兩份資料寫入失敗時還原快照；不留下半組改桌。
  const keys = ['chicken_tables_v3', 'chicken_bookings_v1']
  const snapshots = keys.map(key => localStorage.getItem(key))
  try {
    const written = tableService.bulkWrite(nextTables)
    if (!written.ok) return written
    const changed = bookingService.assignTables(bookingId, nums)
    if (!changed) throw new Error('訂位不存在')
    return { ok: true, booking: changed, tableNumbers: nums, kind }
  } catch {
    try { keys.forEach((key, i) => snapshots[i] == null ? localStorage.removeItem(key) : localStorage.setItem(key, snapshots[i])) }
    catch { return { ok: false, error: '裝置儲存異常，請重新整理確認桌況後再操作' } }
    return { ok: false, error: '改桌儲存失敗，原配桌已保留，請重試' }
  }
}

// 已入座整組换桌：保留訂位與原用餐起點，撤出的桌待清潔；不重走 arrival。
// confirmedConflictTables 僅涵蓋店員已看過並勾選確認的預配／團保桌。
export function replaceSeatedBookingTables(bookingId, tableNumbers, { now = new Date(), confirmedConflictTables = [], confirmedWarningSignature, originalTableNumbers } = {}) {
  const booking = bookingService.getById(bookingId)
  if (!booking || booking.status !== 'arrived') return { ok: false, error: '僅已入座訂位可調整位子' }
  const original = bookingTableNumbers(booking)
  if (!original.length) return { ok: false, error: '訂位無桌位資料' }
  if (originalTableNumbers && JSON.stringify(original) !== JSON.stringify(originalTableNumbers.map(String))) return { ok: false, error: '原配桌已被更動，請重新開啟換桌' }
  const nums = [...new Set((tableNumbers || []).map(String).filter(Boolean))]
  if (!nums.length) return { ok: false, error: '請至少選一張桌' }
  const tables = tableService.listAll()
  // legacy 同組 reserved 可一起修正，但來源必須仍全部由本訂位持有。
  const own = t => heldBy(t, bookingId) && !t.currentRef && ['dining', 'reserved'].includes(t.status)
  if (original.some(n => !own(tables.find(t => String(t.number) === n)))) return { ok: false, error: '原桌已被更動或由其他組使用，請重新確認桌況' }
  const conflicts = timeConflictTableNumbers({ bookingId, date: formatDate(now), mode: 'now', now })
  const settings = getSettings()
  const allBookings = bookingService.listAll()
  const window = assignmentWindow({ mode: 'now', date: formatDate(now), now }, settings)
  const overridden = nums.flatMap(n => preassignConflicts(allBookings, n, { date: formatDate(now), excludeBookingId: bookingId, window }, settings)).filter(c => c.willRelease)
  const hasConflicts = nums.some(n => conflicts.has(n))
  if (hasConflicts && confirmedWarningSignature !== seatedMoveWarningSignature(bookingId, nums, { bookings: allBookings, groups: groupService.listAll(), tables, settings, now })) return { ok: false, error: '桌位保留已改變，請重新確認警示' }
  if (allBookings.some(b => String(b.id) !== String(bookingId) && b.status === 'arrived' && b.date === formatDate(now) && bookingTableNumbers(b).some(n => nums.includes(n)))) return { ok: false, error: '目標桌仍屬於另一組已入座客人，請重新確認桌況' }
  const picked = []
  const floors = new Set()
  for (const n of nums) {
    const t = tables.find(t => String(t.number) === n)
    if (!t) return { ok: false, error: `桌位 ${n} 不存在` }
    if (!isTableUsableOnDate(t, formatDate(now))) return { ok: false, error: outOfServiceError(n) }
    if (!(original.includes(n) && own(t)) && (t.status !== 'vacant' || t.currentBookingId || t.currentRef)) return { ok: false, error: occupiedError(n, t) }
    if (conflicts.has(n) && !confirmedConflictTables.map(String).includes(n)) return { ok: false, error: `${n} 有其他訂位／團體保留，請重新確認警示` }
    picked.push(t)
    floors.add(t.floor)
  }
  if (floors.size > 1) return { ok: false, error: '併桌必須在同一樓層，請改選同層的桌' }
  if (Number(booking.guests) > squeezeSeats(picked)) return { ok: false, error: squeezeShortError(picked, booking.guests) }
  const start = tables.find(t => String(t.number) === original[0])?.seatedAt
    || original.map(n => tables.find(t => String(t.number) === n)?.seatedAt).find(Boolean)
    || booking.actualArrivalTime || null
  const updatedAt = now.toISOString()
  const next = tables.map(t => {
    const n = String(t.number)
    if (nums.includes(n)) return { ...t, status: 'dining', currentBookingId: bookingId, currentRef: null, seatedAt: original.includes(n) ? (t.seatedAt || start) : start, mergedWith: null, blockReason: null, updatedAt }
    if (original.includes(n)) return { ...t, status: 'cleaning', currentBookingId: null, currentRef: null, seatedAt: null, mergedWith: null, blockReason: null, updatedAt }
    return t
  })
  const keys = ['chicken_tables_v3', 'chicken_bookings_v1']
  const snapshots = keys.map(key => localStorage.getItem(key))
  try {
    const written = tableService.bulkWrite(next)
    if (!written.ok) return written
    const changed = bookingService.assignTables(bookingId, nums)
    if (!changed) throw new Error('訂位不存在')
    for (const id of new Set(overridden.map(c => c.booking.id))) {
      const released = releaseOverriddenAssignment(id)
      if (!released.ok) throw new Error('預配解除失敗')
    }
    return { ok: true, booking: changed, tableNumbers: nums }
  } catch {
    try { keys.forEach((key, i) => snapshots[i] == null ? localStorage.removeItem(key) : localStorage.setItem(key, snapshots[i])) }
    catch { return { ok: false, error: '裝置儲存異常，請重新整理確認桌況後再操作' } }
    return { ok: false, error: '換桌儲存失敗，原配桌已保留，請重試' }
  }
}

export function moveTable(bookingId, newTableNumber) {
  const booking = bookingService.getById(bookingId)
  if (!booking || !booking.assignedTableId) return { ok: false, error: '訂位無桌位資料' }
  if (booking.status === 'arrived') return replaceSeatedBookingTables(bookingId, [newTableNumber])
  // 併桌（大組多桌）暫不支援單桌換位（會留下孤兒額外桌）；請先清桌再重新帶位。
  if ((booking.extraTableIds || []).length) {
    return { ok: false, error: '併桌的大組請先整組清桌，再重新帶位' }
  }
  const oldNumber = booking.assignedTableId
  if (oldNumber === newTableNumber) return { ok: false, error: '同桌無需換桌' }
  const newTable = tableService.getByNumber(newTableNumber)
  if (!newTable) return { ok: false, error: '目標桌位不存在' }
  if (!tableUsableToday(newTable)) return { ok: false, error: outOfServiceError(newTableNumber) }
  if (newTable.status !== 'vacant') return { ok: false, error: '目標桌位非空桌' }
  if (Number(booking.guests) > squeezeSeats([newTable])) return { ok: false, error: '目標桌容量不足' }

  // 釋放舊桌（僅限仍由本訂位持有）、佔用新桌（依原本的語意）
  const oldTable = tableService.getByNumber(oldNumber)
  const wasDining = booking.status === 'arrived'
  const wasHeld = !wasDining && assignmentKind(booking, oldTable) === 'held'
  if (heldBy(oldTable, bookingId)) tableService.clearTable(oldNumber)
  if (wasDining) tableService.seatTable(newTableNumber, bookingId)
  else if (wasHeld) tableService.reserveTable(newTableNumber, bookingId)
  bookingService.assignTable(bookingId, newTableNumber)
  return { ok: true }
}

// === 依佔用區間會撞桌的桌號（建議桌／候選排除用）===
// 佔用區間依動作語意算（capacity.assignmentWindow）：
//   mode 'hold'（預設，會鎖桌）/ 'preassign'（只記在訂位上）/ 'now'（立即入座）；now 可注入。
// 排除：當日其他有效訂位已預配/持有、且其用餐區間與佔用區間重疊的桌（capacity.overlappingBookedTables），
// 加上當日團體保留（有效團、未釋出、未入座的梯次圈桌，與桌況圖 🚌 標記同口徑）。
export function timeConflictTableNumbers({ bookingId, date, timeSlot, mode = 'hold', now = new Date() } = {}) {
  const day = date || formatDate(now)
  const settings = getSettings()
  const window = assignmentWindow({ mode, timeSlot, date: day, now }, settings)
  const set = overlappingBookedTables(
    bookingService.listAll(), { date: day, window, excludeBookingId: bookingId }, settings)
  const groups = groupService.listAll()
    .filter(g => g.date === day && !['cancelled', 'completed'].includes(g.status))
  Object.entries(buildGroupHolds(groups, tableService.listAll())).forEach(([n, v]) => {
    if (v?.holds?.length) set.add(String(n))
  })
  return set
}

// === 找適合容量的空桌（給「指派桌」UI 用）===
// 排序邏輯：
// 1) 坐得下的桌優先（要擠一擠才坐得下的排後面，見 capacity.squeezeSeats）；再看最小容量浪費（capacity - partySize 越小越好）
// 2) 1F 優先（行動方便、走道近）
// 3) 桌號字典序
// opts（可選）＝{ bookingId, date, timeSlot, mode, now }：帶了就再排除「依佔用區間會撞桌」的桌
//   （timeConflictTableNumbers）。建議桌、新增表單候選、訂位卡「建議桌 N」全部走這一條，不各算各的。
//   只有「建議／候選」才帶 opts；現場指派/帶位的可點選集合一律不帶（不可縮小，預配/團保靠警示＋勾選解鎖）。
export function findSuitableTables(partySize, opts = null) {
  const today = opts?.now ? formatDate(opts.now) : todayStr()
  const conflicts = opts ? timeConflictTableNumbers(opts) : null
  return tableService.listAll()
    .filter(t => isTableUsableOnDate(t, today) && t.status === 'vacant' && squeezeSeats([t]) >= partySize)
    .filter(t => !conflicts || !conflicts.has(String(t.number)))
    .sort(bySuitability(partySize))
}

// 候選排序（findSuitableTables 與預配型候選共用）：浪費小 → 1F 優先 → 桌號
function bySuitability(partySize) {
  return (a, b) => {
    // 要擠一擠才坐得下的桌排在坐得下的桌之後（只有沒有剛好坐得下的桌才會建議超坐）
    const overA = Math.max(0, partySize - (Number(a.capacity) || 0))
    const overB = Math.max(0, partySize - (Number(b.capacity) || 0))
    if (overA !== overB) return overA - overB
    const wasteA = a.capacity - partySize
    const wasteB = b.capacity - partySize
    if (wasteA !== wasteB) return wasteA - wasteB
    if (a.floor !== b.floor) return a.floor === '1F' ? -1 : 1
    return String(a.number).localeCompare(String(b.number))
  }
}

// === 預配型（不鎖桌）的可選桌 ===
// 預配只記在訂位上、不動桌況 → 桌子不必「此刻」空著，只要此刻的佔用不會延續進預配區間
// [時段, 時段+佔位)（capacity.assignmentWindow 'preassign'）：
//   用餐中 → 依 seatedAt 推估到何時（occupiedWindow）；鎖桌 → 那筆的鎖桌區間；待清 → 清桌緩衝；
//   手動不可用（blocked）→ 當日都不行；依日期的維修停用 → isTableUsableOnDate。
// 例：09:00 時 105 正在用餐、推估 10:40 結束 → 18:00 的預配可以選 105。
// 這是「可點選集合」：不排除他筆預配／團保（那些走警示＋「將解除／會保留」，與指派模式同口徑）。
// 非今天不看此刻桌況（未來日的桌況與今天無關）。now 可注入（測試固定時間）。
export function preassignableTables(partySize, { bookingId, date, timeSlot, now = new Date() } = {}) {
  const day = date || formatDate(now)
  const settings = getSettings()
  const window = assignmentWindow({ mode: 'preassign', timeSlot, date: day, now }, settings)
  const isToday = day === formatDate(now)
  return tableService.listAll()
    .filter(t => isTableUsableOnDate(t, day) && squeezeSeats([t]) >= partySize)
    .filter(t => {
      if (!isToday || t.status === 'vacant' || heldBy(t, bookingId)) return true
      if (!window) return false
      const occ = occupiedWindow(t, now, settings)
      return !rangesOverlap(occ.start, occ.end, window.start, window.end - window.start)
    })
    .sort(bySuitability(partySize))
}

// 預配型的「建議／候選」：可選桌再排除與預配區間重疊的他筆預配／鎖桌，以及今日團保
// （timeConflictTableNumbers，與鎖桌型候選同一支 helper，只差 mode）。第一張＝建議桌。
export function findPreassignCandidates(partySize, opts = {}) {
  const conflicts = timeConflictTableNumbers({ ...opts, mode: 'preassign' })
  return preassignableTables(partySize, opts).filter(t => !conflicts.has(String(t.number)))
}

// 幫一筆今日訂位挑桌（新增表單、現場新增面板、訂位卡「建議桌」、現場指派模式的建議）：
// 依鎖桌時機（capacity.lockKindFor）分流 → { kind:'hold'|'preassign', tables }（已排序、第一張＝建議）。
//   hold      ＝現在就鎖桌：此刻空桌、依鎖桌區間不撞他筆（findSuitableTables mode 'hold'）
//   preassign ＝只預配：findPreassignCandidates
export function findReserveCandidates(partySize, { bookingId, date, timeSlot, now = new Date() } = {}) {
  const kind = lockKindFor({ date, timeSlot, now })
  const tables = kind === 'hold'
    ? findSuitableTables(partySize, { bookingId, date, timeSlot, mode: 'hold', now })
    : findPreassignCandidates(partySize, { bookingId, date, timeSlot, now })
  return { kind, tables }
}

// 取得「最佳建議桌」— 上面排序的第一張（opts 同 findSuitableTables：帶時段就不建議會撞桌的桌）
export function suggestTable(partySize, opts = null) {
  const list = findSuitableTables(partySize, opts)
  return list[0] || null
}

// === 覆蓋預配後，解除被覆蓋那筆的桌號 ===
// 現場指派／帶位／候位入座／換桌時店員確認「仍要覆蓋」某筆訂位的預配：警示寫的是「○○ 將變回未配桌」，
// 過去程式卻沒這樣做 → 兩筆訂位同時聲稱擁有同一張桌，之後按「客人到了」就撞桌。
// 這裡把被覆蓋那筆的主桌＋額外桌一起解除（booking 回到未配桌，卡片重新長出「指派桌位」）；
// 它仍持有（reserved）的其他桌一併釋出，不留孤兒 reserved 桌。只處理尚未到店（confirmed/pending）的訂位。
export function releaseOverriddenAssignment(bookingId) {
  const booking = bookingService.getById(bookingId)
  if (!booking) return { ok: false, error: '訂位不存在' }
  if (!['confirmed', 'pending'].includes(booking.status)) {
    return { ok: false, error: '這筆訂位已不是待到狀態，未解除桌號' }
  }
  const tableNumbers = bookingTableNumbers(booking)
  const released = []
  for (const n of tableNumbers) {
    const t = tableService.getByNumber(n)
    if (t && t.status === 'reserved' && heldBy(t, bookingId)) {
      tableService.clearTable(n)
      released.push(n)
    }
  }
  bookingService.unassignTable(bookingId)
  return { ok: true, tableNumbers, released }
}

// 某張桌「此刻被別組佔著」會佔到什麼時候（還原預配前的撞桌判定用；分鐘，本地時間）。
//   reserved（別筆鎖桌）→ 那筆的鎖桌區間（assignmentWindow 'hold'）
//   dining → [現在, max(入座＋佔位, 現在＋清桌緩衝))：超時未走的也還佔著
//   cleaning → [現在, 現在＋清桌緩衝)
//   其他（團體用餐、停用等查不到時間）→ 保守視為 [現在, 現在＋佔位)；blocked 無結束時間 → 到當日結束
function occupiedWindow(table, now, settings) {
  const nowMin = now.getHours() * 60 + now.getMinutes()
  const occ = occupancyMinutes(settings)
  const buffer = Number(settings.cleanupBufferMin) || 10   // 與 occupancyMinutes 同一個預設
  if (table.status === 'reserved' && table.currentBookingId) {
    const holder = bookingService.getById(table.currentBookingId)
    const w = holder?.timeSlot ? assignmentWindow({ mode: 'hold', timeSlot: holder.timeSlot, date: holder.date, now }, settings) : null
    if (w) return w
  }
  if (table.status === 'dining' && table.seatedAt) {
    const s = new Date(table.seatedAt)
    const seatedMin = formatDate(s) === formatDate(now) ? s.getHours() * 60 + s.getMinutes() : nowMin
    return { start: nowMin, end: Math.max(seatedMin + occ, nowMin + buffer) }
  }
  if (table.status === 'cleaning') return { start: nowMin, end: nowMin + buffer }
  if (table.status === 'blocked') return { start: nowMin, end: 48 * 60 }
  return { start: nowMin, end: nowMin + occ }
}

// releaseOverriddenAssignment 的反向（帶位／指派按「復原」時把被解除的預配還回去）。
// snapshot＝release 的回傳值加上 bookingId：{ bookingId, tableNumbers, released }。
// 與其他復原同口徑：
//   - 只在那筆「仍是待到、且仍未配桌」時才寫回桌號（期間若已被重新指派別桌，不覆寫別人的結果）
//   - 寫回前逐桌檢查：此刻被別組鎖住／入座／待清、且佔用區間與這筆的用餐區間重疊 → 不寫回，
//     回 code:'table-taken' 與原因（寫回只會讓他到店時被 S1 擋下，toast 卻說已還原）
//   - 原本鎖著（released）的桌只在「仍是空桌」時才重新鎖回；被別組佔走的不搶，維持預配（notRelocked 回報）
// now 可注入（測試固定時間）。
export function restoreOverriddenAssignment({ bookingId, tableNumbers = [], released = [] } = {}, { now = new Date() } = {}) {
  const booking = bookingService.getById(bookingId)
  if (!booking) return { ok: false, error: '訂位不存在' }
  if (!['confirmed', 'pending'].includes(booking.status)) {
    return { ok: false, error: '這筆訂位已不是待到狀態，未還原預配' }
  }
  if (bookingTableNumbers(booking).length) return { ok: false, error: '這筆訂位已重新配桌，未覆寫' }
  const nums = [...new Set((tableNumbers || []).map(String).filter(Boolean))]
  if (!nums.length) return { ok: false, error: '沒有可還原的桌號' }
  const settings = getSettings()
  for (const n of nums) {
    const t = tableService.getByNumber(n)
    if (!t || t.status === 'vacant' || heldBy(t, bookingId)) continue
    if (bookingOverlapsWindow(booking, occupiedWindow(t, now, settings), settings)) {
      const who = ['dining', 'reserved'].includes(t.status) ? occupantName(t) : null
      return {
        ok: false,
        code: 'table-taken',
        error: who ? `${n} 目前由 ${who} 使用` : `${n} 目前${statusZh(t.status)}`,
      }
    }
  }
  bookingService.assignTables(bookingId, nums)
  const relocked = []
  for (const n of (released || []).map(String)) {
    const t = tableService.getByNumber(n)
    if (t && t.status === 'vacant') {
      tableService.reserveTable(n, bookingId)
      relocked.push(n)
    }
  }
  const notRelocked = (released || []).map(String).filter(n => !relocked.includes(n))
  return { ok: true, tableNumbers: nums, relocked, notRelocked }
}

// 現場指派（assignBookingToTable）的復原：只在「這筆仍是待到、仍指向這張桌、沒有額外桌」時解除，
// 桌只在「仍由這筆持有且是 reserved」時才釋出（已入座／被別組接走的桌不動）。
// 只清不搶——不會把桌寫成任何人的佔用。
export function undoAssignBooking(bookingId, tableNumber) {
  const booking = bookingService.getById(bookingId)
  if (!booking) return { ok: false, error: '訂位不存在' }
  if (booking.status !== 'confirmed' || String(booking.assignedTableId) !== String(tableNumber)
    || (booking.extraTableIds || []).length) {
    return { ok: false, error: '這筆訂位已被更動，無法復原指派' }
  }
  const t = tableService.getByNumber(tableNumber)
  if (t && t.status === 'reserved' && heldBy(t, bookingId)) tableService.clearTable(tableNumber)
  bookingService.unassignTable(bookingId)
  return { ok: true }
}

// === 大組多桌組合建議（單桌裝不下時的併桌建議）===
// 候選 = 今日可用 + vacant 桌，再排除「依佔用區間會撞桌」的桌（timeConflictTableNumbers：時段重疊的他筆
// 預配／鎖桌、今日團保）——與單桌建議 suggestTable 同一支 helper。過去只看 vacant，會推薦有預配的桌和
// 團體保留桌，店員照著選才被警示擋下（尖峰時白走一趟）。只影響「建議」；可點選集合不縮小（預配/團保靠警示＋勾選解鎖）。
// opts 同 findSuitableTables（預設 mode 'now'＝現在入座的佔用區間 [現在, 現在＋佔位)）。
// ★ 併桌一律「同一樓層」（一組客人不可能分坐兩層）。
// 每個樓層內：
//   1) 桌數最少 → 2) 空位（浪費）最少 → 3) 桌與桌在平面圖上最靠近（真的併得起來）。
//   過去用「容量大優先」貪婪湊，9 位會給 6+6（12 席、浪費 3），明明 4+6（10 席）就夠、
//   且隔壁兩桌直接併（店主 2026-10 回報：該推 107/110 卻推 101+102）。
// 跨樓層：桌數少 → 浪費少 → 1F 優先。
// 沒有任何單一樓層能湊夠 → 回座位最多的單層（該層全部可用桌，enough:false），由 UI 提示改候位/分桌。
// 回傳 { tableNumbers, seats, enough, floor }。
export function suggestTableCombo(partySize, opts = {}) {
  const need = Math.max(0, Number(partySize) || 0)
  const today = opts?.now ? formatDate(opts.now) : todayStr()
  const conflicts = timeConflictTableNumbers({ date: today, mode: 'now', ...opts })
  const pool = tableService.listAll()
    .filter(t => isTableUsableOnDate(t, today) && t.status === 'vacant' && (Number(t.capacity) || 0) > 0)
    .filter(t => !conflicts.has(String(t.number)))

  const floors = [...new Set(pool.map(t => t.floor))]
  const perFloor = floors.map(f => bestComboOnFloor(pool.filter(t => t.floor === f), need, f))
  const enoughFloors = perFloor.filter(r => r.enough)
    .sort((a, b) =>
      a.tableNumbers.length - b.tableNumbers.length ||
      a.seats - b.seats ||
      (a.floor === b.floor ? 0 : a.floor === '1F' ? -1 : 1))
  if (enoughFloors.length) return enoughFloors[0]
  return perFloor.sort((a, b) => b.seats - a.seats)[0] || { tableNumbers: [], seats: 0, enough: false, floor: null }
}

const byTableNumber = (a, b) => String(a.number).localeCompare(String(b.number))
const tableCenter = (t) => ({
  x: (Number(t.x) || 0) + (Number(t.w) || 0) / 2,
  y: (Number(t.y) || 0) + (Number(t.h) || 0) / 2,
})

// 單一樓層的最佳組合。先在「容量組成」層級列舉（桌型種類很少：4P/6P…，列舉量極小），
// 一旦座位 ≥ 需求就停止往下加桌（再加只會更浪費），取桌數最少、再浪費最少的組成；
// 同分的組成再比「挑出來的實際桌子」誰最緊湊。
function bestComboOnFloor(list, need, floor) {
  const total = list.reduce((s, t) => s + (Number(t.capacity) || 0), 0)
  if (total < need || need <= 0) {
    // 湊不夠：回該層全部可用桌（座位最多的 partial）
    const all = [...list].sort(byTableNumber)
    return { tableNumbers: all.map(t => String(t.number)), seats: total, enough: total >= need && all.length > 0, floor }
  }
  const groups = new Map()
  for (const t of list) {
    const c = Number(t.capacity) || 0
    if (!groups.has(c)) groups.set(c, [])
    groups.get(c).push(t)
  }
  const caps = [...groups.keys()].sort((a, b) => b - a)

  // 列舉容量組成：counts[i] = 取幾張 caps[i]
  let best = null // { count, seats, mixes: [counts[]] }
  const counts = new Array(caps.length).fill(0)
  const walk = (i, seats, count) => {
    if (best && count > best.count) return
    if (seats >= need) {
      if (!best || count < best.count || (count === best.count && seats < best.seats)) {
        best = { count, seats, mixes: [[...counts]] }
      } else if (count === best.count && seats === best.seats) {
        best.mixes.push([...counts])
      }
      return
    }
    if (i >= caps.length) return
    const max = groups.get(caps[i]).length
    for (let k = max; k >= 0; k--) {
      counts[i] = k
      walk(i + 1, seats + k * caps[i], count + k)
    }
    counts[i] = 0
  }
  walk(0, 0, 0)

  // 依組成挑實際桌：以每張候選桌為錨點，各容量取離錨點最近的 k 張；總距離最小者勝（同分依桌號）。
  let pick = null // { score, tables }
  for (const mix of best.mixes) {
    const anchors = [...list].filter(t => mix[caps.indexOf(Number(t.capacity) || 0)] > 0).sort(byTableNumber)
    for (const anchor of anchors) {
      const ac = tableCenter(anchor)
      const dist = (t) => { const c = tableCenter(t); return Math.hypot(c.x - ac.x, c.y - ac.y) }
      const chosen = []
      caps.forEach((cap, i) => {
        if (!mix[i]) return
        const near = [...groups.get(cap)].sort((a, b) => dist(a) - dist(b) || byTableNumber(a, b))
        chosen.push(...near.slice(0, mix[i]))
      })
      const score = chosen.reduce((s, t) => s + dist(t), 0)
      if (!pick || score < pick.score - 1e-9) pick = { score, tables: chosen }
    }
  }
  const tables = pick.tables.sort(byTableNumber)
  return { tableNumbers: tables.map(t => String(t.number)), seats: best.seats, enough: true, floor }
}

// === 停用/維修 × 團體圈桌的衝突檢查（integration 層：tableService 看不到團體資料）===
// 找出「日期落在 [from, to] 窗內、仍有效（非取消/完成）、圈到此桌」的第一張團單；to 空 = 無限期。
function groupHoldConflict(tableNumber, from, to) {
  const num = String(tableNumber)
  return groupService.listAll().find(g =>
    g.date && g.date >= from && (!to || g.date <= to)
    && !['cancelled', 'completed'].includes(g.status)
    && groupTableNumbers(g).map(String).includes(num)
  ) || null
}

// 佈局編輯器唯一擁有寫入權的欄位。其餘（status/currentBookingId/currentRef/seatedAt/mergedWith/
// blockReason/outage 等現場即時狀態）不屬於編輯器，存檔時一律沿用本機當下值。
const LAYOUT_FIELDS = ['capacity', 'floor', 'x', 'y', 'w', 'h', 'rotation', 'zoneId', 'isActive']

// 批次寫入（佈局編輯器）前的整合守門。⚠️ list 必須是「完整桌集」（唯一呼叫者 saveFloorPlan 傳
// 刪後的 localTables 全集）——刪桌偵測靠「本機現存但 list 缺席」，若傳部分清單會誤判成大量刪除。
// 三道守門：(1) 停用被團圈到的桌；(2) 佔用中的桌不可停用（tableService.bulkWrite 底線）；
// (3) 刪桌不可孤兒化未來預約/團圈（見下方 delete guard）。
export function bulkSaveTablesGuarded(list) {
  const byNum = new Map(tableService.listAll().map(t => [t.number, t]))
  for (const t of (list || [])) {
    const prev = byNum.get(t.number)
    if (prev && prev.isActive && t.isActive === false) {
      const g = groupHoldConflict(t.number, todayStr(), '')
      if (g) return { ok: false, error: `${t.number} 已被 ${g.date}「${g.agencyName || '團體'}」圈桌，請先調整該團再停用` }
    }
  }
  // 刪桌守門：本機現存但 list 缺席者＝被刪。刪掉仍有「未來預約 / 團體圈了還沒到店」的桌，會讓那筆
  // 訂位/團單的桌號參照變孤兒（桌況仍 vacant，前端 isOccupied 與 tableService 佔用守門都抓不到）。
  // 前後端目前都沒有這道參照檢查，這是唯一一道 → 命中即整批擋、指名該桌/該團/該日。
  const keep = new Set((list || []).map(t => t.number))
  const deleted = [...byNum.keys()].filter(num => !keep.has(num))
  if (deleted.length) {
    const today = todayStr()
    const activeBookings = bookingService.listAll().filter(b =>
      !CAPACITY_EXCLUDED_STATUSES.includes(b.status) && b.date >= today)
    for (const num of deleted) {
      const prev = byNum.get(num)
      // (a) 現場仍佔用（保險底線；前端 UI 已擋，但程式/舊快照可能繞過）
      if (['dining', 'reserved', 'cleaning'].includes(prev.status) || prev.currentBookingId || prev.currentRef) {
        return { ok: false, error: `${num} 目前有客人/訂位，無法刪除，請先清桌` }
      }
      // (b) 今天起有效團體圈到此桌（含未入座的圈桌、司領桌）
      const g = groupHoldConflict(num, today, '')
      if (g) return { ok: false, error: `${num} 已被 ${g.date}「${g.agencyName || '團體'}」圈桌，無法刪除，請先調整該團` }
      // (c) 今天起有效散客訂位參照此桌（含未到店的預配、併桌額外桌）
      const b = activeBookings.find(bk => bookingTableNumbers(bk).includes(num))
      if (b) return { ok: false, error: `${num} 已被 ${b.date} 訂位（${b.name || '散客'}）預配，無法刪除，請先改派或取消該訂位` }
    }
  }
  // 存檔只把「佈局欄位」套用到本機當下的桌上；現場即時欄位一律保留本機最新值，不採用編輯器打開時
  // 凍結的舊快照。否則店主開著編輯器慢慢排時，別台剛帶的位、剛設的維修，會被舊快照覆蓋回去
  // （存檔後差異同步 merge:true 會連帶覆蓋雲端，讓當天的桌看起來變空桌）。
  const merged = (list || []).map(t => {
    const prev = byNum.get(t.number)
    if (!prev) return t   // 全新桌：無本機現值可保留，整張寫入
    const patch = {}
    for (const f of LAYOUT_FIELDS) if (f in t) patch[f] = t[f]
    return { ...prev, ...patch }
  })
  return tableService.bulkWrite(merged)
}

// 永久停用前的整合守門：今天起任何未來有效團圈到此桌 → 擋下並指名該團
// （否則該團的保留席默默蒸發，入座當天才發現桌子不能用）。啟用方向不受限。
export function toggleTableGuarded(number) {
  const t = tableService.getByNumber(number)
  if (!t) return { ok: false, error: '桌位不存在' }
  if (t.isActive) {
    const g = groupHoldConflict(number, todayStr(), '')
    if (g) return { ok: false, error: `${number} 已被 ${g.date}「${g.agencyName || '團體'}」圈桌，請先調整該團再停用` }
  }
  return tableService.toggle(number)
}

// 維修停用前的整合守門：維修窗內任何有效團圈到此桌 → 擋下（先為該團改桌，再設維修）。
export function setTableOutageGuarded(number, outage) {
  const clean = normalizeOutage(outage)
  if (clean) {
    const g = groupHoldConflict(number, clean.from, clean.to)
    if (g) return { ok: false, error: `${number} 已被 ${g.date}「${g.agencyName || '團體'}」圈桌，請先為該團改桌再設維修` }
  }
  return tableService.setOutage(number, outage)
}

// =====================================================================
// 團體梯次入座流程（兩段用餐：第二梯可接續坐同一批桌）
// 重要：團體生命週期內永不建立 booking 文件；桌位以 currentRef 連到 group/batch。
// =====================================================================

// 團體梯次到店入座：把該梯次圈的桌全部設 dining 並連到 group/batch；團 status→arrived。
export function seatGroupBatch(groupId, batchId) {
  const group = groupService.getById(groupId)
  if (!group) return { ok: false, error: '團單不存在' }
  if (group.status === 'completed') return { ok: false, error: '此團已整團完成，無法再入座' }
  if (group.status === 'cancelled') return { ok: false, error: '此團已取消，無法入座' }
  const batch = (group.batches || []).find(b => b.id === batchId)
  if (!batch) return { ok: false, error: '梯次不存在' }
  // 已清桌釋出的梯不得重跑：桌位痕跡已清空，releasedAt 是唯一防線
  //（缺了它，店員可對同一梯重複「入座→離席→清桌」整輪，2026-06-12 實測 bug）。
  if (batch.releasedAt) return { ok: false, error: '此梯已清桌釋出完成，無法重複入座' }
  const tables = batch.tableNumbers || []
  if (!tables.length) return { ok: false, error: '此梯次尚未圈桌' }
  // 桌況檢查：必須 vacant 或 cleaning（接續同團前梯剛離席的桌），且今日可用（非停用/維修）。
  // 收集「全部」被佔/不可用桌回傳 blocked，讓 UI 能進「改派桌位」流程逐桌處理
  // （reseatCandidateTables 已排除停用/維修桌，改派路徑天然安全）。
  const blocked = []
  for (const n of tables) {
    const t = tableService.getByNumber(n)
    if (!t) return { ok: false, error: `桌位 ${n} 不存在` }
    if (!tableUsableToday(t)) {
      blocked.push({ tableNumber: n, status: 'outage' })
      continue
    }
    const sameGroupSeated = t.currentRef?.groupId === groupId
    if (!['vacant', 'cleaning'].includes(t.status) && !sameGroupSeated) {
      blocked.push({ tableNumber: n, status: t.status })
    }
  }
  if (blocked.length) {
    const label = (b) => b.status === 'outage' ? '停用/維修中' : statusZh(b.status)
    const listTxt = blocked.map(b => `${b.tableNumber}（${label(b)}）`).join('、')
    // 純佔用沿用既有措辭「被佔用」（E2E 與店員習慣已釘住）；含維修桌時改用「無法使用」。
    const hasOutage = blocked.some(b => b.status === 'outage')
    return {
      ok: false,
      error: hasOutage ? `${listTxt}無法使用，無法整梯入座` : `${listTxt}被佔用，無法整梯入座`,
      blocked,
    }
  }
  tables.forEach(n => tableService.seatTableForGroup(n, groupId, batchId))
  if (group.status !== 'arrived') groupService.setStatus(groupId, 'arrived')
  return { ok: true, tableNumbers: tables }
}

// 改派桌位：團體梯次某張桌被佔時，把該梯圈桌中的 fromTable 換成 toTable，並立即重試整梯入座。
// swap 成功即落地（不回滾）：就算其他桌仍被佔，已改派的進度保留，UI 繼續逐桌處理。
export function reseatGroupBatchTable(groupId, batchId, fromTable, toTable) {
  const group = groupService.getById(groupId)
  if (!group) return { ok: false, error: '團單不存在' }
  if (['completed', 'cancelled'].includes(group.status)) {
    return { ok: false, error: '此團已結束，無法改派桌位' }
  }
  const batch = (group.batches || []).find(b => b.id === batchId)
  if (!batch) return { ok: false, error: '梯次不存在' }
  if (batch.releasedAt) return { ok: false, error: '此梯已清桌釋出完成，無法改派桌位' }
  const nums = (batch.tableNumbers || []).map(String)
  if (!nums.includes(String(fromTable))) return { ok: false, error: `${fromTable} 不在此梯圈桌內` }
  if (nums.includes(String(toTable))) return { ok: false, error: `${toTable} 已在此梯圈桌內` }
  const target = tableService.getByNumber(toTable)
  if (!target) return { ok: false, error: '桌位不存在' }
  if (!tableUsableToday(target)) return { ok: false, error: outOfServiceError(toTable) }
  if (target.status !== 'vacant') {
    return { ok: false, error: `${toTable} 目前為${statusZh(target.status)}，無法改派` }
  }
  // 不可搶其他今日團體已圈的桌
  const heldByOther = groupService.listActiveByDate(group.date).some(g =>
    g.id !== groupId && (g.batches || []).some(b => (b.tableNumbers || []).map(String).includes(String(toTable))))
  if (heldByOther) return { ok: false, error: `${toTable} 已被其他團體保留` }

  groupService.swapBatchTable(groupId, batchId, fromTable, toTable)
  const seat = seatGroupBatch(groupId, batchId)
  if (seat.ok) return { ok: true, seated: true, tableNumbers: seat.tableNumbers }
  return { ok: true, seated: false, blocked: seat.blocked || [], error: seat.error }
}

// 團體梯次離席：把該梯次的桌 dining→cleaning（仍佔位、保留 currentRef 供接第二梯）。
export function checkoutGroupBatch(groupId, batchId) {
  const group = groupService.getById(groupId)
  if (!group) return { ok: false, error: '團單不存在' }
  const batch = (group.batches || []).find(b => b.id === batchId)
  if (!batch) return { ok: false, error: '梯次不存在' }
  ;(batch.tableNumbers || []).forEach(n => {
    const t = tableService.getByNumber(n)
    if (t && t.status === 'dining' && t.currentRef?.groupId === groupId && t.currentRef?.batchId === batchId) {
      tableService.checkoutTable(n)
    }
  })
  return { ok: true }
}

// 整梯清桌釋出：把該梯次目前「待清（cleaning）」的桌一次清成空桌（vacant）、釋放座位。
// 與 finalizeGroup 不同：只釋放這一梯的桌、不結束整團；與 seatNextBatchOnTable 不同：不接下一梯。
// 只動「currentRef 仍指向本梯且為 cleaning」的桌——已被下一梯接走（currentRef 改指）或仍在用餐的桌都不碰。
// 釋出同時在 batch 落 releasedAt 持久標記（桌位痕跡清空後「此梯已消化」的唯一證據）；
// 全部「有圈桌」的梯都釋出後自動結團——單梯團跑完整輪即收斂，多梯團維持逐梯釋出不提早結束。
export function releaseGroupBatch(groupId, batchId) {
  const group = groupService.getById(groupId)
  if (!group) return { ok: false, error: '團單不存在' }
  const batch = (group.batches || []).find(b => b.id === batchId)
  if (!batch) return { ok: false, error: '梯次不存在' }
  const cleared = []
  ;(batch.tableNumbers || []).forEach(n => {
    const t = tableService.getByNumber(n)
    if (t && t.status === 'cleaning' && t.currentRef?.groupId === groupId && t.currentRef?.batchId === batchId) {
      tableService.clearTable(n)
      cleared.push(n)
    }
  })
  if (!cleared.length) return { ok: false, error: '此梯沒有待清桌可釋出' }
  groupService.markBatchReleased(groupId, batchId)

  // 自動結團：所有可執行（有圈桌）的梯都已釋出 → 團收斂為 completed。
  // 空圈桌的梯本來就不可入座，不擋結團；finalizeGroup 順帶防禦性清掉任何殘留 currentRef。
  const after = groupService.getById(groupId)
  const executable = (after?.batches || []).filter(b => (b.tableNumbers || []).length)
  if (executable.length && executable.every(b => b.releasedAt) && after.status !== 'completed') {
    finalizeGroup(groupId)
    return { ok: true, cleared, groupCompleted: true }
  }
  return { ok: true, cleared }
}

// 單桌「清桌完成 → 接第二梯入座」：先清空此桌，再把指定梯次坐進來（複合一鍵）。
export function seatNextBatchOnTable(tableNumber, groupId, batchId) {
  const t = tableService.getByNumber(tableNumber)
  if (!t) return { ok: false, error: '桌位不存在' }
  if (!tableUsableToday(t)) return { ok: false, error: outOfServiceError(tableNumber) }
  const group0 = groupService.getById(groupId)
  if (!group0) return { ok: false, error: '團單不存在' }
  if (['completed', 'cancelled'].includes(group0.status)) {
    return { ok: false, error: '此團已結束，無法再入座' }
  }
  const nextBatch = (group0.batches || []).find(b => b.id === batchId)
  if (nextBatch?.releasedAt) return { ok: false, error: '此梯已清桌釋出完成，無法再入座' }
  tableService.clearTable(tableNumber)
  tableService.seatTableForGroup(tableNumber, groupId, batchId)
  const group = groupService.getById(groupId)
  if (group && group.status !== 'arrived') groupService.setStatus(groupId, 'arrived')
  return { ok: true }
}

// 團體整團完成：清空所有 currentRef 指向此團的桌、團 status→completed。
export function finalizeGroup(groupId) {
  const group = groupService.getById(groupId)
  if (!group) return { ok: false, error: '團單不存在' }
  tableService.listAll().forEach(t => {
    if (t.currentRef?.groupId === groupId) tableService.clearTable(t.number)
  })
  groupService.setStatus(groupId, 'completed')
  return { ok: true }
}

// =====================================================================
// 現場自動清檯（sweep）執行層：吃 opsSweep 純計算層產出的 action 清單。
// 每個 action 執行前重驗前置條件 → 冪等：多分頁/多裝置同時 sweep 也只會收斂到同一終態。
// 注意：一律走 service 層（不發 TG 通知；context 層的 finalizeBooking 會發）。
// =====================================================================
export function executeSweepActions(actions = []) {
  const done = []
  for (const a of actions) {
    if (a.type === 'finalize-booking') {
      const t = tableService.getByNumber(a.tableNumber)
      if (t?.status === 'dining' && t.currentBookingId === a.bookingId) {
        finalizeBooking(a.bookingId)
        done.push(a)
      }
    } else if (a.type === 'checkout-group-table') {
      const t = tableService.getByNumber(a.tableNumber)
      if (t?.status === 'dining' && t.currentRef?.groupId === a.groupId) {
        tableService.checkoutTable(a.tableNumber)
        done.push(a)
      }
    } else if (a.type === 'clear-table') {
      const t = tableService.getByNumber(a.tableNumber)
      if (t && ['dining', 'cleaning', 'reserved'].includes(t.status)) {
        tableService.clearTable(a.tableNumber)
        done.push(a)
      }
    } else if (a.type === 'complete-booking') {
      const b = bookingService.getById(a.bookingId)
      if (b && b.status === 'arrived') {
        bookingService.update(a.bookingId, { status: 'completed' })
        done.push(a)
      }
    } else if (a.type === 'complete-group') {
      const g = groupService.getById(a.groupId)
      if (g && !['completed', 'cancelled'].includes(g.status)) {
        finalizeGroup(a.groupId)
        done.push(a)
      }
    } else if (a.type === 'mark-noshow-auto') {
      const b = bookingService.getById(a.bookingId)
      if (b && b.status === 'confirmed') {
        // 直寫 update 繞過 setStatus → 不觸發 recordNoshow 罰則累計（系統自動標記≠客人惡意未到）
        bookingService.update(a.bookingId, { status: 'noshow', autoFlag: 'rollover' })
        done.push(a)
      }
    } else if (a.type === 'leave-waitlist-auto') {
      const w = waitlistService.getById(a.waitlistId)
      // 重驗：可能已被別的裝置/店員叫號入座、或本來就已經棄號，此時就不重複結一次。
      // 走 waitlistService.leave（純寫入 status:'left' + leftAt），刻意不經任何會發通知的
      // Context wrapper——自動結號絕不能讓客人收到通知。
      if (w && ['waiting','called','skipped'].includes(w.status)) {
        waitlistService.leave(a.waitlistId)
        done.push(a)
      }
    }
  }
  return done
}

// 取消團體：清空所有相關桌、團 status→cancelled。
export function cancelGroup(groupId) {
  const group = groupService.getById(groupId)
  if (!group) return { ok: false, error: '團單不存在' }
  tableService.listAll().forEach(t => {
    if (t.currentRef?.groupId === groupId) tableService.clearTable(t.number)
  })
  groupService.setStatus(groupId, 'cancelled')
  return { ok: true }
}
