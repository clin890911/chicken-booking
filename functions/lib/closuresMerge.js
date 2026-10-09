// 休店／關閉設定（settings.closures）的三方合併（純函式，零相依；前端 src/utils/closuresMerge.js 直接轉出口）。
//
// 事故：closures 是「整個物件最後存檔者勝」。訂位專員打開設定頁關 10/12（未存）、店長關 10/15 並存，
// 訂位專員再存 → 10/15 消失；或店長已恢復開放的日期被訂位專員的舊副本改回關閉。
//
// 合併單位（每個單位各自判斷「這次存檔的人有沒有改它」）：
//   closedDates                     → 陣列元素（日期）集合：新增／移除各自套用
//   closedSlots / closedSeatings / openSeatings → 每個日期 key（整天的時段／場次清單為一個單位）
//   weeklySeatings                  → 每個星期 key（'0'..'6'）
// 規則：local（存檔者本機）相對 base（該裝置上次同步的雲端值）有變 → 用 local；沒變 → 用 remote（雲端現值）。
// 同一單位兩邊都改、且改成不同值 → local 勝，記進 conflicts（讓前端提示「X 日被他人同時修改，已以你的為準」）。
//
// 等值口徑：清單一律當集合比（去重＋排序；[B,A] 與 [A,B] 同義），空清單＝不存在（正規化本就會丟掉空清單）。
// 形狀：整個欄位若一側沒變，直接沿用另一側的原值（含 key 順序），讓「沒人同時改」時結果與存檔者本機逐字相同、
// 不製造假的未儲存變更。輸出交給呼叫端再走一次 normalizeClosures／normalizeStoreSettings。
export const CLOSURE_MAP_FIELDS = Object.freeze(['closedSlots', 'closedSeatings', 'weeklySeatings', 'openSeatings'])

const isMap = v => !!v && typeof v === 'object' && !Array.isArray(v)
const asMap = v => (isMap(v) ? v : {})
const asList = v => (Array.isArray(v) ? v.map(String) : [])
const listKey = v => {
  const list = [...new Set(asList(v))].sort()
  return list.length ? JSON.stringify(list) : 'null'
}
const sameEntry = (a, b) => listKey(a) === listKey(b)
const present = v => asList(v).length > 0

function sameMap(a, b) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const k of keys) if (!sameEntry(a[k], b[k])) return false
  return true
}

const copyMap = m => Object.fromEntries(Object.entries(m).filter(([, v]) => present(v)).map(([k, v]) => [k, asList(v)]))

function mergeMap(field, baseM, localM, remoteM, conflicts) {
  if (sameMap(localM, baseM)) return copyMap(remoteM)
  if (sameMap(remoteM, baseM)) return copyMap(localM)
  const out = {}
  const keys = [...Object.keys(localM), ...Object.keys(remoteM).filter(k => !(k in localM))]
  for (const k of keys) {
    const localChanged = !sameEntry(localM[k], baseM[k])
    if (localChanged) {
      if (present(localM[k])) out[k] = asList(localM[k])
      if (!sameEntry(remoteM[k], baseM[k]) && !sameEntry(remoteM[k], localM[k])) conflicts.push({ field, key: k })
    } else if (present(remoteM[k])) {
      out[k] = asList(remoteM[k])
    }
  }
  return out
}

function mergeSet(baseL, localL, remoteL) {
  const b = new Set(asList(baseL))
  const l = new Set(asList(localL))
  const r = new Set(asList(remoteL))
  const same = (x, y) => x.size === y.size && [...x].every(v => y.has(v))
  if (same(l, b)) return [...new Set(asList(remoteL))]
  if (same(r, b)) return [...new Set(asList(localL))]
  const out = new Set(r)
  for (const v of b) if (!l.has(v)) out.delete(v) // 存檔者移除（恢復開放）
  for (const v of l) if (!b.has(v)) out.add(v)    // 存檔者新增
  return [...out].sort()
}

// closures 兩份是否等值（同上等值口徑）。
export function sameClosures(a, b) {
  const x = isMap(a) ? a : {}
  const y = isMap(b) ? b : {}
  if (listKey(x.closedDates) !== listKey(y.closedDates)) return false
  return CLOSURE_MAP_FIELDS.every(f => sameMap(asMap(x[f]), asMap(y[f])))
}

// 輸入：base／local／remote 三份 closures（null／缺欄位皆視為空）。
// 回傳：
//   merged     合併後的 closures（closedDates/closedSlots/closedSeatings 必有；weeklySeatings/openSeatings 非空才有）
//   conflicts  [{ field, key }]：同一單位兩邊都改且不同值，已以 local 為準
//   localChanged／remoteChanged：local／remote 相對 base 是否有任何變更
export function mergeClosures(base, local, remote) {
  const b = isMap(base) ? base : {}
  const l = isMap(local) ? local : {}
  const r = isMap(remote) ? remote : {}
  const conflicts = []
  const merged = { closedDates: mergeSet(b.closedDates, l.closedDates, r.closedDates) }
  for (const field of CLOSURE_MAP_FIELDS) {
    const m = mergeMap(field, asMap(b[field]), asMap(l[field]), asMap(r[field]), conflicts)
    if (Object.keys(m).length || field === 'closedSlots' || field === 'closedSeatings') merged[field] = m
  }
  return { merged, conflicts, localChanged: !sameClosures(l, b), remoteChanged: !sameClosures(r, b) }
}
