// groupReserveTables 交易內的撞桌把關（純函式，方便單元測試；交易內讀取仍在 index.js）。
// 前端對應：src/services/groupReservationService.js 的 tableConflictsForBatch（即時提示），
// 這裡才是原子真相——兩邊的「佔用桌」口徑必須一致。

const toMinutes = (time = '00:00') => {
  const [h, m] = String(time).split(':').map(Number)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 0
  return h * 60 + m
}

// 一筆訂位佔用的所有桌：主桌 assignedTableId＋大組併桌的副桌 extraTableIds（去重去空）。
// 只看主桌會讓團體圈走散客的副桌 → 同桌超賣。
export function bookingOccupiedTables(booking) {
  const extras = Array.isArray(booking?.extraTableIds) ? booking.extraTableIds : []
  return [...new Set([booking?.assignedTableId, ...extras].filter(Boolean).map(String))]
}

// 回傳衝突清單 [{ table, batch, withGroupId?, withAgency?, withBookingId? }]；空陣列＝可圈。
//   group         正在圈桌的團單（batches[].timeSlot / tableNumbers）
//   otherGroups   同日其他「有效」團單（呼叫端已排除本團與取消/完成等狀態）
//   bookings      同日一般訂位（呼叫端已排除取消/未到/完成；無時段或無桌者這裡會跳過）
//   durationMin   佔位時長（用餐＋清桌緩衝）
export function findGroupTableConflicts({ group, otherGroups = [], bookings = [], durationMin }) {
  const occupied = (bookings || [])
    .filter(bk => bk.timeSlot)
    .map(bk => ({ bk, tables: bookingOccupiedTables(bk) }))
    .filter(x => x.tables.length)

  const conflicts = []
  for (const b of group?.batches || []) {
    const s = toMinutes(b.timeSlot)
    const e = s + durationMin
    const wanted = new Set((b.tableNumbers || []).map(String))
    if (!wanted.size) continue
    // 與其他團衝突
    for (const og of otherGroups) {
      for (const ob of og.batches || []) {
        const os = toMinutes(ob.timeSlot)
        const oe = os + durationMin
        if (!(s < oe && os < e)) continue // 時間窗不重疊 → 同桌可重用
        for (const n of ob.tableNumbers || []) {
          if (wanted.has(String(n))) {
            conflicts.push({ table: String(n), withGroupId: og.id, withAgency: og.agencyName || '', batch: b.label })
          }
        }
      }
    }
    // 與一般訂位已指派桌（含併桌副桌）衝突
    for (const { bk, tables } of occupied) {
      const bs = toMinutes(bk.timeSlot)
      const be = bs + durationMin
      if (!(s < be && bs < e)) continue
      for (const n of tables) {
        if (wanted.has(n)) conflicts.push({ table: n, withBookingId: bk.id, batch: b.label })
      }
    }
  }
  return conflicts
}
