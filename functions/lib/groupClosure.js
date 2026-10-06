// 團體圈桌（groupReserveTables）的「關閉」把關純邏輯。
//
// 店主語意（2026-10）：「關閉場次 / 時段」（closures.closedSeatings / closedSlots）是為了
// 停止線上客人訂位、把位子留給後台手動排的旅行社團 → 後台建團 / 圈桌**不受它擋**。
// 真正的限制是實際佔用（同交易內的撞桌檢查）。
// 公休日（closures.closedDates）維持原狀：整天不圈桌。
//
// ⚠️ 線上客人路徑（guestCreateBooking / guestGetAvailability / guestUpdateBooking /
//    calcSlotCapacityServer）仍用 isSlotClosedServer（三種關閉都擋），與此函式無關。

// 回傳第一個「有圈桌、且落在公休日」的梯次；null＝不擋。
export function findGroupClosedDateBatch(settings = {}, group = {}) {
  const closedDates = settings?.closures?.closedDates
  if (!Array.isArray(closedDates) || !closedDates.includes(group?.date)) return null
  return (group?.batches || []).find(b => (b?.tableNumbers || []).length) || null
}
