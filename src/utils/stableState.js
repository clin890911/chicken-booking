// stableState：讓「重新讀取但內容沒變」的資料保持同一個參考。
//
// 背景（後台「卡卡的」根因之一）：BookingContext 每 5 秒拉一次雲端，拉完呼叫 refresh()
// 把八個集合從 localStorage 重新 JSON.parse 一遍再 setState。就算資料一個字都沒變，
// 每次 parse 出來的都是全新的陣列與物件 → 所有吃 bookings/tables/groupReservations 的
// useMemo（容量引擎、當日總覽、月曆彙總、排位地圖佔位）全部重算，整棵後台元件樹也
// 跟著重繪。在手機上這就是「每 5 秒掉一次幀」、捲動到一半頓一下的來源。
//
// 這裡提供純函式：把「新讀到的資料」對照「目前 state」，內容相同就回傳舊參考
// （整個陣列相同 → 回舊陣列；只有部分項目變 → 新陣列，但沒變的項目沿用舊物件），
// 讓 React 的 setState bail-out 與下游 memo / React.memo 都能真的生效。
//
// 比對用 JSON 字串（與 cloudDataService 的 stable() 同一口徑），並以 WeakMap 快取每個
// 物件的字串：舊 state 的項目只算一次，之後每輪只需要序列化新讀進來的資料。

const cache = new WeakMap()

export function stableKey(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null)
  let s = cache.get(value)
  if (s === undefined) {
    s = JSON.stringify(value)
    cache.set(value, s)
  }
  return s
}

// 陣列版：idOf(item) 取主鍵（例如 b => b.id / t => t.number）。
// - 長度相同、每個位置的主鍵與內容都相同 → 回傳 prev（同一參考）
// - 否則回傳新陣列；主鍵相同且內容相同的項目沿用 prev 裡的物件
export function reconcileList(prev, next, idOf) {
  if (!Array.isArray(next)) return next
  if (!Array.isArray(prev) || prev.length === 0) return next
  const byId = new Map()
  prev.forEach(p => { if (p && typeof p === 'object') byId.set(idOf(p), p) })
  let same = prev.length === next.length
  const out = next.map((n, i) => {
    if (!n || typeof n !== 'object') { if (prev[i] !== n) same = false; return n }
    const old = byId.get(idOf(n))
    if (old && stableKey(old) === stableKey(n)) {
      if (prev[i] !== old) same = false
      return old
    }
    same = false
    return n
  })
  return same ? prev : out
}

// 單一物件版（settings 等）：內容相同回 prev，否則回 next。
export function reconcileValue(prev, next) {
  if (prev === next) return prev
  if (!prev || !next || typeof prev !== 'object' || typeof next !== 'object') return next
  return stableKey(prev) === stableKey(next) ? prev : next
}
