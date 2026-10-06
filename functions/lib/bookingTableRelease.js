// 客人自助改期／取消解除配桌時，交易內要釋放哪些桌（純邏輯，供 index.js 與測試共用）。
// 一筆訂位佔用主桌 assignedTableId＋大組併桌副桌 extraTableIds；只釋放主桌會讓副桌永遠
// reserved 指向這筆（幽靈佔用）。且只能釋放「桌文件仍由這筆持有」的桌（currentBookingId 指向本筆）：
// 預配（只記在訂位上、桌仍 vacant）不必寫；已被別組接手的桌絕不可覆寫成空桌。
import { bookingOccupiedTables } from './groupTableConflicts.js'

// tableDocs：交易內先讀好的桌文件 [{ id, exists, currentBookingId, ... }]。回傳要釋放的桌 id（字串）。
export function heldTableIdsToRelease(booking, tableDocs = []) {
  const bookingId = booking?.id
  if (bookingId == null) return []
  const wanted = new Set(bookingOccupiedTables(booking))
  return (tableDocs || [])
    .filter(t => t && t.exists !== false && wanted.has(String(t.id))
      && t.currentBookingId != null && String(t.currentBookingId) === String(bookingId))
    .map(t => String(t.id))
}
