// 建議桌「目前樓層優先」（2026-11-27 C 包，walkthrough #18／verify P2-3）。
// 背景：站在 1F 領位台的店員看著 1F 地圖，散客 2 位卻被建議到 2F・207（只因 2F 有 4 人桌、浪費少 2 席），
// 大組選桌時地圖還自動跳到 2F——店員沒注意樓層切換，點了 2F 的桌號以為是 1F。
// 規則（排序偏好，不是硬限制）：
//   「容量合適」＝與最佳候選同樣不必擠（或擠的程度相同），且空位浪費最多只比最佳多 FLOOR_PREF_WASTE_TOLERANCE 席；
//   合適的桌裡，目前樓層的排前面（各自原本的順序不變）。目前樓層沒有合適的桌 → 原排序照舊（建議仍可能在別層）。
// 例：2 位、1F 只剩 6 人桌（浪費 4）、2F 有 4 人桌（浪費 2）→ 差 2 席，在容許內 → 建議 1F 的 6 人桌。
//     2 位、1F 只剩 10 人桌（浪費 8）→ 超過容許，照舊建議 2F 的 4 人桌。
export const FLOOR_PREF_WASTE_TOLERANCE = 2

const capOf = (t) => Number(t?.capacity) || 0

// sorted：已依 bySuitability 排好的單桌候選（第一張＝原本的建議）。回傳新陣列，不改原陣列。
export function preferFloorFirst(sorted = [], partySize = 0, preferFloor = null, tolerance = FLOOR_PREF_WASTE_TOLERANCE) {
  const list = Array.isArray(sorted) ? sorted : []
  if (!preferFloor || list.length < 2 || list[0]?.floor === preferFloor) return list.slice()
  const need = Math.max(0, Number(partySize) || 0)
  const over = (t) => Math.max(0, need - capOf(t))
  const waste = (t) => capOf(t) - need
  const best = list[0]
  const fits = (t) => over(t) === over(best) && waste(t) <= waste(best) + tolerance
  const promoted = list.filter(t => t.floor === preferFloor && fits(t))
  if (!promoted.length) return list.slice()
  const set = new Set(promoted)
  return [...promoted, ...list.filter(t => !set.has(t))]
}

// 併桌組合版：ranked＝各樓層「湊得夠」的最佳組合（已依 桌數→座位→1F 排好）。
// 目前樓層的組合若桌數相同、座位最多只多 tolerance 席 → 換它當建議。
export function preferFloorCombo(ranked = [], preferFloor = null, tolerance = FLOOR_PREF_WASTE_TOLERANCE) {
  const list = Array.isArray(ranked) ? ranked : []
  const best = list[0]
  if (!preferFloor || !best || best.floor === preferFloor) return best || null
  const alt = list.find(r => r.floor === preferFloor
    && r.tableNumbers.length === best.tableNumbers.length
    && r.effSeats <= best.effSeats + tolerance)
  return alt || best
}

// 地圖樓層籤的提示：建議桌（含併桌組合）都不在目前樓層時，回建議桌所在的樓層（給「建議桌在 2F」）；否則 null。
export function suggestionFloorHint(suggestionNumbers = [], tables = [], currentFloor = null) {
  const nums = new Set((suggestionNumbers || []).filter(n => n != null && n !== '').map(String))
  if (!nums.size) return null
  const floors = [...new Set((tables || []).filter(t => nums.has(String(t.number))).map(t => t.floor).filter(Boolean))]
  if (!floors.length || floors.includes(currentFloor)) return null
  return floors[0]
}
