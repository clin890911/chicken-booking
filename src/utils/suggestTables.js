import { isTableUsableOnDate } from './tableAvailability'

// suggestTablesForBatch：團體預排「一鍵推薦桌位」。
// 純函式、吃日期維度的 blockedTables（非今日即時 status），故與 seatingService.findSuitableTables 區隔
// （後者讀今日 tableService 即時狀態，不適用預排）。
//
// 策略：貪婪取最少桌——候選＝啟用且未被佔（不在 blockedTables、不在 alreadySelected）；
// 依容量「由大到小」累加到 Σcap ≥ headcount，盡量用最少張桌。同容量偏好 1F、再依桌號。
// 回傳 { tableNumbers, seats, enough }；可用桌湊不滿 headcount 時回 enough:false 並給出能湊到的最大集合。
// date（YYYY-MM-DD，選填）：給定時排除該日維修中的桌（isTableUsableOnDate）。
export function suggestTablesForBatch({ tables = [], headcount = 0, blockedTables = [], alreadySelected = [], capByNum = {}, date = '' }) {
  const need = Math.max(0, Number(headcount) || 0)
  const blocked = new Set((blockedTables || []).map(String))
  const taken = new Set((alreadySelected || []).map(String))

  const pool = (tables || [])
    .filter(t => t && (date ? isTableUsableOnDate(t, date) : t.isActive !== false))
    .map(t => ({
      number: String(t.number),
      capacity: Number(t.capacity ?? capByNum[String(t.number)]) || 0,
      floor: t.floor || '',
    }))
    .filter(t => t.number && !blocked.has(t.number) && !taken.has(t.number) && t.capacity > 0)
    .sort((a, b) =>
      b.capacity - a.capacity ||                         // 容量大優先（最少桌）
      (a.floor === b.floor ? 0 : a.floor === '1F' ? -1 : 1) || // 同容量偏好 1F
      a.number.localeCompare(b.number),
    )

  const picked = []
  let seats = 0
  for (const t of pool) {
    if (seats >= need) break
    picked.push(t.number)
    seats += t.capacity
  }
  return { tableNumbers: picked, seats, enough: seats >= need }
}
