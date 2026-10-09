// 設定（settings）的寫入範圍：訂位專員（host，只有 settings.closures）只能儲存「休店／關閉」相關 key。
// ★ 與後端 functions/lib/staffAccess.js 的 CLOSURE_SETTING_KEYS 成對（tests 比對）。
// ★ PR #156 的每週預設關閉（weeklySeatings）／本日開放（openSeatings）都在 closures 物件內，自然涵蓋。
export const CLOSURE_SETTING_KEYS = Object.freeze(['closures'])

export const isClosureSettingKey = (key) => CLOSURE_SETTING_KEYS.includes(key)

// 角色對 settings 的寫入範圍：'full'（店長）／'closures'（訂位專員）／null（外場、廚房）。與後端 settingsWriteScope 同口徑。
export function settingsWriteScope(can) {
  if (can?.('settings.update')) return 'full'
  if (can?.('settings.closures')) return 'closures'
  return null
}

const json = (v) => JSON.stringify(v ?? null)

// 兩份 settings 之間值不同的頂層 key（排序後回傳）。任一側缺 key 視為 undefined。
// 用途：同步引擎告訴後端「本機相對上次同步基準線改了哪些 key」（settingsChangedKeys）。
export function changedSettingsKeys(base, next) {
  const a = base && typeof base === 'object' ? base : {}
  const b = next && typeof next === 'object' ? next : {}
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])]
  return keys.filter(k => json(a[k]) !== json(b[k])).sort()
}
