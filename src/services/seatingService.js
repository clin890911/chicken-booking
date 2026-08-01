// seatingService：桌位 × 訂位 × 候位的協作流程
// 是業務邏輯整合層 — UI 元件呼叫這裡的高階動作，不直接戳底層 service
import * as tableService from './tableService'
import * as bookingService from './bookingService'
import * as waitlistService from './waitlistService'
import * as customerService from './customerService'
import * as groupService from './groupReservationService'
import { statusZh } from '../utils/tableStatus'
import { isTableUsableOnDate, normalizeOutage } from '../utils/tableAvailability'
import { groupTableNumbers, CAPACITY_EXCLUDED_STATUSES } from '../utils/capacity'
import { todayStr } from '../utils/timeSlots'

// === 停用/維修守門（service 層底線；UI 防線會被新介面或程式呼叫繞過）===
// 所有「把客人放上桌」的入口共用：今日停用或維修中的桌一律拒絕。
function outOfServiceError(tableNumber) {
  return `${tableNumber} 停用/維修中，請改用其他桌`
}
function tableUsableToday(table) {
  return isTableUsableOnDate(table, todayStr())
}

// 這筆 booking 佔用的所有桌（主桌 assignedTableId + 大組併桌的 extraTableIds），去重去空。
export function bookingTableNumbers(booking) {
  return [...new Set(
    [booking?.assignedTableId, ...(booking?.extraTableIds || [])].filter(Boolean).map(String),
  )]
}

// 現在時間的 30 分鐘抵達時段（walk-in 用）
function nowTimeSlot() {
  const now = new Date()
  return `${String(now.getHours()).padStart(2, '0')}:${String(Math.floor(now.getMinutes() / 30) * 30).padStart(2, '0')}`
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
  if (booking.guests > table.capacity) return { ok: false, error: `${tableNumber} 容量不足（${table.capacity} < ${booking.guests}）` }

  bookingService.assignTable(bookingId, tableNumber)
  tableService.reserveTable(tableNumber, bookingId)
  return { ok: true, booking, table }
}

// === 訂位 → 指派多桌（大組併桌）===
// 散客訂位人數超過任何單桌容量 → 一筆 booking 佔多張桌：tableNumbers[0]=主桌，其餘=額外桌。
// 全部桌 reserved + currentBookingId 指向同一 booking。單桌時退回 assignBookingToTable（維持單一路徑）。
// 與 walkInSeatMulti 同口徑：每張桌須存在/今日可用/空桌、合計容量≥人數、且同一樓層（一組不分坐兩層）。
export function assignBookingTablesMulti(bookingId, tableNumbers) {
  const nums = [...new Set((tableNumbers || []).map(String).filter(Boolean))]
  if (nums.length === 0) return { ok: false, error: '請至少選一張桌' }
  if (nums.length === 1) return assignBookingToTable(bookingId, nums[0])

  const booking = bookingService.getById(bookingId)
  if (!booking) return { ok: false, error: '訂位不存在' }

  let totalCap = 0
  const floors = new Set()
  for (const n of nums) {
    const t = tableService.getByNumber(n)
    if (!t) return { ok: false, error: `桌位 ${n} 不存在` }
    if (!tableUsableToday(t)) return { ok: false, error: outOfServiceError(n) }
    if (t.status !== 'vacant') return { ok: false, error: `${n} 目前不是空桌（${statusZh(t.status)}）` }
    totalCap += Number(t.capacity) || 0
    floors.add(t.floor)
  }
  // ★ 併桌必須同一樓層——service 層硬擋，繞過 UI 也擋得住
  if (floors.size > 1) return { ok: false, error: '併桌必須在同一樓層，請改選同層的桌' }
  const guests = Number(booking.guests) || 0
  if (guests > totalCap) return { ok: false, error: `所選桌合計 ${totalCap} 席，不足 ${guests} 位` }

  const [mainTable, ...extra] = nums
  bookingService.update(bookingId, { assignedTableId: mainTable, extraTableIds: extra })
  nums.forEach(n => tableService.reserveTable(n, bookingId))
  return { ok: true, booking, tableNumbers: nums }
}

// === 客人到了 → 入座 ===
// reserved + 客人到了 → dining
// 自動記錄 actualArrivalTime + 同步桌位狀態
export function seatBooking(bookingId) {
  const booking = bookingService.getById(bookingId)
  if (!booking) return { ok: false, error: '訂位不存在' }
  if (!booking.assignedTableId) return { ok: false, error: '尚未指派桌位（請先指派）' }
  // 預配後桌子才被設停用/維修：到店入座時擋下並提示改派（而非默默坐上維修桌）。
  const table = tableService.getByNumber(booking.assignedTableId)
  if (table && !tableUsableToday(table)) {
    return { ok: false, error: `${booking.assignedTableId} 停用/維修中，請先改派其他桌再入座` }
  }

  bookingService.setStatus(bookingId, 'arrived')   // setStatus 內會自動記 actualArrivalTime
  tableService.seatTable(booking.assignedTableId, bookingId)
  return { ok: true, tableNumber: booking.assignedTableId }
}

// === 已離席 → 等待清桌 ===
// 訂位 status: arrived → completed
// 桌位 status: dining → cleaning（仍佔位、提醒外場去清）
export function checkoutBooking(bookingId) {
  const booking = bookingService.getById(bookingId)
  if (!booking) return { ok: false, error: '訂位不存在' }
  // 大組併桌：主桌 + 額外桌全部 checkout（dining → cleaning）。
  bookingTableNumbers(booking).forEach(n => tableService.checkoutTable(n))
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
  // 大組併桌：主桌 + 額外桌全部直接釋出（跳過待清桌）。
  tableNumbers.forEach(n => tableService.clearTable(n))
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

// === 清桌完成 → 桌位釋出 ===
export function clearTable(tableNumber) {
  return tableService.clearTable(tableNumber)
}

// === 取消訂位 ===
// 回傳值帶著「復原所需的快照」：releasedTables（這次釋出的桌，主桌在前）與 previousStatus。
// ★ 快照不可省：取消會把 assignedTableId/extraTableIds 清空，事後從 booking 上已經完全看不出
//   原本佔了哪幾張桌 —— 復原只能靠呼叫端把這份回傳值原封帶回 undoCancelBooking。
export function cancelBooking(bookingId) {
  const booking = bookingService.getById(bookingId)
  if (!booking) return { ok: false, error: '訂位不存在' }
  const previousStatus = booking.status
  // 大組併桌：主桌 + 額外桌全部釋出。
  const releasedTables = bookingTableNumbers(booking)
  releasedTables.forEach(n => tableService.clearTable(n))
  bookingService.setStatus(bookingId, 'cancelled')
  // 解除主桌與額外桌的指派（避免取消後仍掛著桌號）
  bookingService.update(bookingId, { assignedTableId: null, extraTableIds: [] })
  return { ok: true, releasedTables, previousStatus }
}

// 取消訂位的入口只開在客人到店前：BookingCard 只在 confirmed/pending 顯示「取消訂位」，
// TableDrawer 只在桌況 reserved 顯示 —— 所以復原後的正確狀態就是「已預訂、等客人來」。
// 快照若帶進其他狀態（理論上到不了）一律當 confirmed，免得做出「booking 說用餐中、
// 桌況卻只是 reserved」的矛盾狀態。
const CANCEL_RESTORABLE_STATUSES = ['confirmed', 'pending']

// cancelBooking 的反向操作（店員誤按「取消訂位」後按「↩ 復原」）。
// 與 undoCompleteWithoutSeating 同一套桌位口徑：只搶「仍是空桌」的桌，被別組帶位/預配佔走的
// 不硬寫（不搶別組的桌），放進 failed 交由 UI 明講，避免店員以為復原了、其實那組客人的桌沒了。
// ⚠️ booking 的 assignedTableId/extraTableIds 只依「真的搶回來的桌」重建：全都搶不回 → 回到
//    未指派（卡片會重新長出「指派桌位」鈕），絕不留下指向別組桌位的孤兒桌號。
export function undoCancelBooking(bookingId, { tableNumbers = [], status } = {}) {
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
  // restored[0] 當主桌、其餘為額外桌；空陣列 → assignedTableId 回 null、extraTableIds 回 []
  bookingService.assignTables(bookingId, restored)
  return { ok: true, restored, failed, status: restoreStatus }
}

// === 候位 → 入座（拖到空桌）===
// 流程：候位 #15 → 拖到 A2 空桌 → 自動建一筆 walk-in booking + 桌位 dining
export function seatWaitlist(waitId, tableNumber) {
  const wait = waitlistService.getById(waitId)
  const table = tableService.getByNumber(tableNumber)
  if (!wait) return { ok: false, error: '候位記錄不存在' }
  if (!table) return { ok: false, error: '桌位不存在' }
  if (!tableUsableToday(table)) return { ok: false, error: outOfServiceError(tableNumber) }
  if (table.status !== 'vacant') return { ok: false, error: `${tableNumber} 目前不是空桌` }
  if (wait.partySize > table.capacity) return { ok: false, error: `${tableNumber} 容量不足` }

  // 1. 建立一筆 walk-in 訂位（已到店狀態）
  const today = new Date().toISOString().slice(0, 10)
  const now = new Date()
  const timeSlot = `${String(now.getHours()).padStart(2, '0')}:${String(Math.floor(now.getMinutes() / 30) * 30).padStart(2, '0')}`
  const booking = bookingService.create({
    name: wait.name,
    phone: wait.phone,
    guests: wait.partySize,
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
  let totalCap = 0
  const floors = new Set()
  for (const n of nums) {
    const t = tableService.getByNumber(n)
    if (!t) return { ok: false, error: `桌位 ${n} 不存在` }
    if (!tableUsableToday(t)) return { ok: false, error: outOfServiceError(n) }
    if (t.status !== 'vacant') return { ok: false, error: `${n} 目前不是空桌（${statusZh(t.status)}）` }
    totalCap += Number(t.capacity) || 0
    floors.add(t.floor)
  }
  // ★ 併桌必須同一樓層（一組客人不可能分坐兩層）——service 層硬擋，繞過 UI 也擋得住
  if (floors.size > 1) return { ok: false, error: '併桌必須在同一樓層，請改選同層的桌' }
  const guests = Number(guestData.guests) || 2
  if (guests > totalCap) return { ok: false, error: `所選桌合計 ${totalCap} 席，不足 ${guests} 位` }

  const [mainTable, ...extra] = nums
  const booking = bookingService.create({
    name: guestData.name || '散客',
    phone: guestData.phone || '',
    guests,
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

// === 換桌（已入座的客人換到另一張空桌）===
export function moveTable(bookingId, newTableNumber) {
  const booking = bookingService.getById(bookingId)
  if (!booking || !booking.assignedTableId) return { ok: false, error: '訂位無桌位資料' }
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
  if (booking.guests > newTable.capacity) return { ok: false, error: '目標桌容量不足' }

  // 釋放舊桌、佔用新桌
  const wasDining = booking.status === 'arrived'
  tableService.clearTable(oldNumber)
  if (wasDining) tableService.seatTable(newTableNumber, bookingId)
  else tableService.reserveTable(newTableNumber, bookingId)
  bookingService.assignTable(bookingId, newTableNumber)
  return { ok: true }
}

// === 找適合容量的空桌（給「指派桌」UI 用）===
// 排序邏輯：
// 1) 最小容量浪費（capacity - partySize 越小越好）
// 2) 1F 優先（行動方便、走道近）
// 3) 天然氣優先（火力穩定、體驗較好）
export function findSuitableTables(partySize) {
  const today = todayStr()
  return tableService.listAll()
    .filter(t => isTableUsableOnDate(t, today) && t.status === 'vacant' && t.capacity >= partySize)
    .sort((a, b) => {
      const wasteA = a.capacity - partySize
      const wasteB = b.capacity - partySize
      if (wasteA !== wasteB) return wasteA - wasteB
      if (a.floor !== b.floor) return a.floor === '1F' ? -1 : 1
      return a.number.localeCompare(b.number)
    })
}

// 取得「最佳建議桌」— 上面排序的第一張
export function suggestTable(partySize) {
  const list = findSuitableTables(partySize)
  return list[0] || null
}

// === 大組多桌組合建議（單桌裝不下時的併桌建議）===
// 候選 = 今日可用 + vacant 桌。★ 併桌一律「同一樓層」（一組客人不可能分坐兩層）：
//   在每個樓層內各自貪婪湊（容量大優先 → 最少桌），選浪費最少的樓層。
//   沒有任何單一樓層能湊夠 → 回該樓層能湊到的最大集合（enough:false），由 UI 提示改候位/分桌。
// 回傳 { tableNumbers, seats, enough, floor }。
export function suggestTableCombo(partySize) {
  const need = Math.max(0, Number(partySize) || 0)
  const today = todayStr()
  const pool = tableService.listAll()
    .filter(t => isTableUsableOnDate(t, today) && t.status === 'vacant' && (Number(t.capacity) || 0) > 0)

  const greedy = (list, floor) => {
    const sorted = [...list].sort((a, b) =>
      (Number(b.capacity) || 0) - (Number(a.capacity) || 0) ||   // 容量大優先（最少桌）
      String(a.number).localeCompare(String(b.number)))
    const picked = []
    let seats = 0
    for (const t of sorted) {
      if (seats >= need) break
      picked.push(String(t.number))
      seats += Number(t.capacity) || 0
    }
    return { tableNumbers: picked, seats, enough: seats >= need, floor }
  }

  const floors = [...new Set(pool.map(t => t.floor))]
  const perFloor = floors.map(f => greedy(pool.filter(t => t.floor === f), f))
  // 同層湊夠的，選浪費最少（座位最接近 need、桌數最少）；都湊不夠則回座位最多的單層 partial。
  const enoughFloors = perFloor.filter(r => r.enough)
    .sort((a, b) => a.seats - b.seats || a.tableNumbers.length - b.tableNumbers.length)
  if (enoughFloors.length) return enoughFloors[0]
  return perFloor.sort((a, b) => b.seats - a.seats)[0] || { tableNumbers: [], seats: 0, enough: false, floor: null }
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
