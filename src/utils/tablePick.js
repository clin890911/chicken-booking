// 現場選桌的「點桌語意」（2026-11 A2，Barry 拍板：點第二張桌＝改選）。
// 選桌入座模式（OperationsView assign-multi）與現場帶位（FastWalkInPanel）共用同一套，不各寫一份：
//   單選（預設）：點另一張可選桌＝換成那張；點已選的桌＝取消選取。
//   多選（按「＋再加一桌（併桌）」，或沒有任何單桌坐得下這組 → 自動）：點桌加／減。
// 純函式、不碰 React，方便單測。
import { squeezeSeats } from './capacity'

// 沒有任何一張單桌（擠一擠後）坐得下 need 位 → 這組只能併桌，自動進多選（沿用 PR #67 大組併桌的口徑）。
// tables：此刻可選的桌物件（已依模式過濾過的候選池）
export function needsComboTables(need, tables = []) {
  const n = Number(need) || 0
  if (!(n > 0)) return false
  return !(tables || []).some(t => t && squeezeSeats([t]) >= n)
}

// 點一張桌之後的已選集合。action 由「當下畫面的已選」決定，next 是冪等的結果：
// iPad 觸控同一個 tick 可能送兩次 click，兩次都依同一個畫面判斷 → 結果相同、不會「加了又自己取消」。
//   remove  ：點的是已選的桌
//   add     ：多選時加入（已在就不重複加）
//   replace ：單選時換成這張
export function pickAction(selected = [], number, { multi = false } = {}) {
  const list = (selected || []).map(String)
  const n = String(number)
  if (list.includes(n)) return 'remove'
  return multi ? 'add' : 'replace'
}

export function applyPick(prev = [], number, action) {
  const n = String(number)
  const has = (prev || []).some(x => String(x) === n)
  if (action === 'remove') return (prev || []).filter(x => String(x) !== n)
  if (action === 'add') return has ? prev : [...(prev || []), number]
  return [number]
}

// 「一張就夠卻選了多張」：多選了 ≥2 張，且拿掉其中任一張仍坐得下（擠一擠口徑）→ 黃字提醒，不硬擋。
// 例：3 位選了 103＋101（12 席）。回傳 { seats, count } 或 null。
export function excessTablesHint(selectedTables = [], need) {
  const list = (selectedTables || []).filter(Boolean)
  const n = Number(need) || 0
  if (list.length < 2 || !(n > 0)) return null
  const removable = list.some((_, i) => squeezeSeats(list.filter((__, j) => j !== i)) >= n)
  if (!removable) return null
  const seats = list.reduce((s, t) => s + (Number(t.capacity) || 0), 0)
  return { seats, count: list.length, text: `${n} 位用了 ${list.length} 桌 ${seats} 席 · 少一張也坐得下，點桌可取消多的` }
}
