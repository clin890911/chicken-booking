// 「用建議桌」一鍵套用的共用判斷（OperationsView 的模式橫幅 applyModeSuggestion、
// 帶位面板 applyWalkinSuggestion——FastWalkInPanel 建立的建議整組丟進後者）。
//
// 建議是整組的（單桌＝1 張、併桌＝主桌＋副桌）。套用時只能「整組都還可選」才選；
// 只要有一張已不在可選集合（被別台裝置帶走、進維修、時段被別筆預配吃掉……），就一張都不選，
// 由店員自行選桌——只選一部分會讓店員以為選好了建議，實際席數不夠或少了一張桌。
export const SUGGESTION_CHANGED_MSG = '建議桌已變動，請自行選桌'

// suggested：建議桌號陣列；selectable：此刻可點的桌號集合（陣列或 Set）
// → { ok: true, tables } 或 { ok: false, error }
export function resolveSuggestedTables(suggested, selectable) {
  const nums = [...new Set((suggested || []).map(String).filter(Boolean))]
  const pool = selectable instanceof Set ? new Set([...selectable].map(String)) : new Set((selectable || []).map(String))
  if (!nums.length || nums.some(n => !pool.has(n))) return { ok: false, error: SUGGESTION_CHANGED_MSG }
  return { ok: true, tables: nums }
}
