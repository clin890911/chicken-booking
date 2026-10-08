// adminPushData 對「只有 settings.closures」角色（訂位專員 host）的 settings 寫入範圍（純函式，無 Firestore 相依）。
//
// 背景：店主用訂位專員帳號在設定頁關閉場次（把位子留給團體；關閉只擋線上客人），但 settings 整份寫入
// 只開放給 settings.update（店長）。決策：不給 host 整個 settings.update（那會連 LINE、營業時間、佈局都能
// 整份覆寫；LINE 設定已因整份覆寫被洗空三次），改給窄權限 settings.closures：只能寫 CLOSURE_SETTING_KEYS。
//
// 規則：
//   - 只把「客戶端表態改過、且屬於關閉相關」的 key（classifyDatasetByPermission 算好的 keys）從客戶端值套上；
//   - 其餘 key 一律沿用雲端值（next 以雲端為底）；
//   - 實際寫入只動 writeFields（Firestore set + mergeFields），其他欄位連碰都不碰——
//     比「讀雲端整份再寫回」更安全：讀與寫之間別台改的其他設定不會被這次寫入蓋回去。
//   - 🔴 mergeFields 會把 closures 整個物件替換掉；用 merge:true 的話 Firestore 會深層合併巢狀 map，
//     「某天某場次恢復開放」（該日期 key 被移除）永遠寫不進雲端。
//
// 與 PR #160（lib/settingsGuard.js，店長整份寫入前讀雲端、保護 LINE 欄位）的關係：
//   兩者都需要「寫前讀雲端 settings/main」。合併時 adminPushData 讀一次雲端，
//   scope='full' 走 guardSettingsPush、scope='closures' 走本函式即可；本函式不會動到 LINE 欄位，
//   故 closures 路徑不需要 guard（但仍可沿用其稽核紀錄）。
import { CLOSURE_SETTING_KEYS, settingsWriteScope } from './staffAccess.js'

const canonical = value => Array.isArray(value)
  ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]))
    : value
const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b))

// 輸入：
//   clientSettings  客戶端推上來的整份 settings（只會取 keys 指定的 key）
//   cloudSettings   雲端 settings/main 現值（原始文件；不存在給 {}）
//   role            員工角色
//   keys            要從客戶端套用的 key（由 classifyDatasetByPermission 的 settingsKeys 給；會再與白名單取交集）
//   normalize       後端 normalizeStoreSettings（由呼叫端注入，保持本檔可單測）
// 回傳：
//   mode         'closures'（可寫）| 'denied'（角色不是 closures 範圍或無可套用的 key）
//   next         以雲端為底、套上客戶端關閉 key 後的完整正規化 settings（給通知判斷／稽核用）
//   writeFields  要寫入的頂層欄位（僅 CLOSURE_SETTING_KEYS 的子集）
//   patch        實際寫入資料（只含 writeFields）
//   appliedKeys  客戶端值已在雲端的 key（含「本來就相同、免寫」的情形）——前端據此推進基準線
//   changed      雲端值是否真的會改變（false＝免寫入）
export function scopeClosureSettingsPush({ clientSettings = {}, cloudSettings = {}, role, keys = [], normalize = v => v }) {
  const empty = { mode: 'denied', next: normalize(cloudSettings || {}), writeFields: [], patch: {}, appliedKeys: [], changed: false }
  if (settingsWriteScope(role) !== 'closures') return empty
  const appliedKeys = [...new Set(keys)].filter(k => CLOSURE_SETTING_KEYS.includes(k) && clientSettings && k in clientSettings)
  if (!appliedKeys.length) return empty
  const before = normalize(cloudSettings || {})
  const merged = { ...(cloudSettings || {}) }
  for (const k of appliedKeys) merged[k] = clientSettings[k]
  const next = normalize(merged)
  const patch = Object.fromEntries(appliedKeys.map(k => [k, next[k]]))
  const changed = appliedKeys.some(k => !same(before[k], next[k]))
  return { mode: 'closures', next, writeFields: appliedKeys, patch, appliedKeys, changed }
}
