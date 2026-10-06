// 團體圈桌（groupReserveTables）的「停用 / 維修桌」把關純邏輯（後端版）。
//
// 前端 validateGroupForSave（src/services/groupReservationService.js）早就擋「圈到當日停用/維修中的桌」，
// 但後端從沒擋 → 繞過前端（舊版前端、離線後補送、多裝置競態：A 圈桌的同時 B 把桌設成維修）
// 就能把團圈進一張當天不能用的桌。此函式讓交易內也把關。
//
// 口徑與前端完全一致：
//   - 可用性一律走 isTableUsableOnDate（lib/tableUsable.js，與前端 tableAvailability.js parity 測試釘住）。
//   - 所有梯次都檢查（含司領桌 isEscort），與 validateGroupForSave 的 for (const b of batches) 一致。
//   - 桌號在 tables 集合查不到（已刪除）→ 不在此擋（前端是 `t && !isTableUsableOnDate(...)`，查無即略過）。
//     前端另有「圈到的桌一席都不算數 → 擋」的容量檢查，那是另一條規則，不在本函式範圍。

import { isTableUsableOnDate } from './tableUsable.js'

// 團單圈到的所有桌號（去重、保留首次出現順序、字串化、去空白）。
export function groupCircledTableNumbers(group = {}) {
  const seen = new Set()
  const out = []
  for (const b of (Array.isArray(group?.batches) ? group.batches : [])) {
    for (const raw of (Array.isArray(b?.tableNumbers) ? b.tableNumbers : [])) {
      const n = String(raw ?? '').trim()
      if (!n || seen.has(n)) continue
      seen.add(n)
      out.push(n)
    }
  }
  return out
}

// 回傳「存在於 tables、但在 group.date 停用或維修中」的桌號陣列（依圈桌順序、去重）；空陣列＝不擋。
// tables：桌位文件陣列（每筆至少有 number；isActive / outage 依現行結構）。
export function findUnusableGroupTables({ group, tables } = {}) {
  const date = String(group?.date || '')
  if (!date) return []
  const byNum = new Map((Array.isArray(tables) ? tables : [])
    .filter(t => t && t.number != null)
    .map(t => [String(t.number), t]))
  return groupCircledTableNumbers(group).filter(n => {
    const t = byNum.get(n)
    return !!t && !isTableUsableOnDate(t, date)
  })
}

// 409 錯誤訊息：「桌位 223、225 於 11/21 停用或維修中，無法圈桌」
export function unusableTablesMessage(numbers = [], date = '') {
  const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(String(date || ''))
  const day = m ? `${Number(m[1])}/${Number(m[2])}` : String(date || '')
  return `桌位 ${numbers.join('、')} 於 ${day} 停用或維修中，無法圈桌`
}
