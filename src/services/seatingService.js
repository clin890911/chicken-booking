// seatingService：桌位 × 訂位 × 候位的協作流程
// 是業務邏輯整合層 — UI 元件呼叫這裡的高階動作，不直接戳底層 service
import * as tableService from './tableService'
import * as bookingService from './bookingService'
import * as waitlistService from './waitlistService'
import * as customerService from './customerService'
import * as groupService from './groupReservationService'
import { statusZh } from '../utils/tableStatus'
import { isTableUsableOnDate, normalizeOutage } from '../utils/tableAvailability'
import { groupTableNumbers } from '../utils/capacity'
import { todayStr } from '../utils/timeSlots'

// === 停用/維修守門（service 層底線；UI 防線會被新介面或程式呼叫繞過）===
// 所有「把客人放上桌」的入口共用：今日停用或維修中的桌一律拒絕。
function outOfServiceError(tableNumber) {
  return `${tableNumber} 停用/維修中，請改用其他桌`
}
function tableUsableToday(table) {
  return isTableUsableOnDate(table, todayStr())
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
  if (booking.assignedTableId) {
    tableService.checkoutTable(booking.assignedTableId)
  }
  bookingService.setStatus(bookingId, 'completed')
  return { ok: true }
}

// === 已離席 + 清桌完成（一鍵釋出，跳過待清桌）===
// 適用：外場本人正在桌邊、桌面已清乾淨、立即可給下一組
export function finalizeBooking(bookingId) {
  const booking = bookingService.getById(bookingId)
  if (!booking) return { ok: false, error: '訂位不存在' }
  const tableNumber = booking.assignedTableId
  bookingService.setStatus(bookingId, 'completed')
  if (tableNumber) {
    tableService.clearTable(tableNumber)  // 直接 vacant，跳過 cleaning
  }
  return { ok: true, tableNumber }
}

// === 清桌完成 → 桌位釋出 ===
export function clearTable(tableNumber) {
  return tableService.clearTable(tableNumber)
}

// === 取消訂位 ===
export function cancelBooking(bookingId) {
  const booking = bookingService.getById(bookingId)
  if (!booking) return { ok: false, error: '訂位不存在' }
  if (booking.assignedTableId) {
    tableService.clearTable(booking.assignedTableId)
  }
  bookingService.setStatus(bookingId, 'cancelled')
  bookingService.unassignTable(bookingId)
  return { ok: true }
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

  const today = new Date().toISOString().slice(0, 10)
  const now = new Date()
  const timeSlot = `${String(now.getHours()).padStart(2, '0')}:${String(Math.floor(now.getMinutes() / 30) * 30).padStart(2, '0')}`
  const booking = bookingService.create({
    name: guestData.name || '散客',
    phone: guestData.phone || '',
    guests: Number(guestData.guests) || 2,
    date: today,
    timeSlot,
    source: 'walkin',
    status: 'arrived',
    assignedTableId: tableNumber,
    createdBy: 'staff',
    notes: { text: guestData.notes || '' }
  })
  tableService.seatTable(tableNumber, booking.id)
  return { ok: true, booking }
}

// === 換桌（已入座的客人換到另一張空桌）===
export function moveTable(bookingId, newTableNumber) {
  const booking = bookingService.getById(bookingId)
  if (!booking || !booking.assignedTableId) return { ok: false, error: '訂位無桌位資料' }
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

// 批次寫入（佈局編輯器）前的整合守門：active→inactive 的桌若被今天起的有效團圈到 → 擋。
// （tableService.bulkWrite 已有佔用守門；這層補上它看不到的團體資料。）
export function bulkSaveTablesGuarded(list) {
  const byNum = new Map(tableService.listAll().map(t => [t.number, t]))
  for (const t of (list || [])) {
    const prev = byNum.get(t.number)
    if (prev && prev.isActive && t.isActive === false) {
      const g = groupHoldConflict(t.number, todayStr(), '')
      if (g) return { ok: false, error: `${t.number} 已被 ${g.date}「${g.agencyName || '團體'}」圈桌，請先調整該團再停用` }
    }
  }
  return tableService.bulkWrite(list)
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
