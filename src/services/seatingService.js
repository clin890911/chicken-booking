// seatingService：桌位 × 訂位 × 候位的協作流程
// 是業務邏輯整合層 — UI 元件呼叫這裡的高階動作，不直接戳底層 service
import * as tableService from './tableService'
import * as bookingService from './bookingService'
import * as waitlistService from './waitlistService'
import * as customerService from './customerService'

// === 訂位 → 指派桌 ===
// 客人線上訂位（assignedTableId: null）→ 到店時店長指派一張空桌
export function assignBookingToTable(bookingId, tableNumber) {
  const booking = bookingService.getById(bookingId)
  const table = tableService.getByNumber(tableNumber)
  if (!booking) return { ok: false, error: '訂位不存在' }
  if (!table) return { ok: false, error: '桌位不存在' }
  if (table.status !== 'vacant') return { ok: false, error: `${tableNumber} 目前不是空桌（${table.status}）` }
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
  return tableService.listAll()
    .filter(t => t.isActive && t.status === 'vacant' && t.capacity >= partySize)
    .sort((a, b) => {
      const wasteA = a.capacity - partySize
      const wasteB = b.capacity - partySize
      if (wasteA !== wasteB) return wasteA - wasteB
      if (a.floor !== b.floor) return a.floor === '1F' ? -1 : 1
      // tank 排在 natural-gas 後面
      if (a.fuel !== b.fuel) {
        if (a.fuel === 'tank') return 1
        if (b.fuel === 'tank') return -1
      }
      return a.number.localeCompare(b.number)
    })
}

// 取得「最佳建議桌」— 上面排序的第一張
export function suggestTable(partySize) {
  const list = findSuitableTables(partySize)
  return list[0] || null
}
