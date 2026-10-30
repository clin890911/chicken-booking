// 訂位「今日」清單的篩選（2026-10-31，Barry：來源篩選與「隱藏已離」併成一顆「篩選」鈕，可以勾選）。
// 純函式，TodayView 與單元測試共用。
//
// 篩選狀態 { sources: Set, hideCompleted: bool, arrivedOnly: bool }
//   sources       來源多選。全勾＝原本的「全部」＝不過濾（連 guest 等不在清單裡的來源也照列）；
//                 部分勾＝只列這些來源。至少要勾一個：取消最後一個是 no-op（UI 上那一格不可取消）。
//   hideCompleted 隱藏已離（completed），預設 true。不持久化——原本就只是元件 state，重新整理回預設。
//   arrivedOnly   只看已到／已離（arrived＋completed），統計卡「已到/離」點下去用。散客口徑，團體梯次卡不列。
// 與舊版單選等價：單選 X ＝ sources={X}；單選「全部」＝ sources 全勾。團體梯次卡在舊版只在「全部／團體」顯示，
// 多選時有勾「團體」就顯示（全勾自然含團體）。
import { bookingTableNumbers } from './bookingTables'

export const SOURCE_OPTIONS = [
  { key: 'online', label: '線上' },
  { key: 'phone',  label: '電話' },
  { key: 'walkin', label: '現場' },
  { key: 'group',  label: '團體' },
  { key: 'line',   label: 'LINE' },
]
export const ALL_SOURCE_KEYS = SOURCE_OPTIONS.map(o => o.key)

export const defaultTodayFilter = () => ({ sources: new Set(ALL_SOURCE_KEYS), hideCompleted: true, arrivedOnly: false })

export const isAllSources = (sources) => ALL_SOURCE_KEYS.every(k => sources.has(k))

export const isDefaultTodayFilter = (f) => isAllSources(f.sources) && f.hideCompleted === true && !f.arrivedOnly

// 勾／取消一個來源；取消最後一個 → 原樣回傳（至少留一個）
export function toggleSource(sources, key) {
  const next = new Set(sources)
  if (next.has(key)) {
    if (next.size <= 1) return sources
    next.delete(key)
  } else {
    next.add(key)
  }
  return next
}

// 「全部來源」勾選框：部分勾 → 全勾；已全勾 → 不動（全部取消會變成空集合）
export const selectAllSources = () => new Set(ALL_SOURCE_KEYS)

// 只看某一個來源（選單每列右邊的「只看」）＝舊版單選
export const onlySource = (key) => new Set([key])

// 統計卡「已到/離」：只看已到＋已離（隱藏已離取消）、來源回全部；已經是這個狀態再點一次 → 回預設
export const ARRIVED_FILTER = () => ({ sources: new Set(ALL_SOURCE_KEYS), hideCompleted: false, arrivedOnly: true })
export const isArrivedFilter = (f) => f.arrivedOnly && !f.hideCompleted && isAllSources(f.sources)
export const toggleArrivedFilter = (f) => (isArrivedFilter(f) ? defaultTodayFilter() : ARRIVED_FILTER())

export function filterTodayBookings(bookings, today, filter, query = '') {
  let list = (bookings || []).filter(b => b.date === today && b.status !== 'cancelled')
  if (filter.hideCompleted) list = list.filter(b => b.status !== 'completed')
  if (filter.arrivedOnly) list = list.filter(b => b.status === 'arrived' || b.status === 'completed')
  if (!isAllSources(filter.sources)) list = list.filter(b => filter.sources.has(b.source))
  const q = (query || '').trim().toLowerCase()
  if (q) {
    list = list.filter(b =>
      (b.name || '').toLowerCase().includes(q) ||
      (b.phone || '').includes(q) ||
      bookingTableNumbers(b).some(n => n.toLowerCase().includes(q)) ||
      (b.id || '').toLowerCase().includes(q)
    )
  }
  return list
}

// 團體梯次卡：有勾「團體」才列；「隱藏已離」同步隱藏已完成的團；「只看已到/離」是散客口徑 → 不列團體
export function filterTodayGroups(groups, filter) {
  if (!filter.sources.has('group') || filter.arrivedOnly) return []
  let list = groups || []
  if (filter.hideCompleted) list = list.filter(g => g.status !== 'completed')
  return list
}

// 篩選鈕的字：預設「篩選」；有變更只列「跟預設不一樣的部分」，例如「電話」「線上、LINE」「已到/離」「電話・含已離」。
// count＝偏離預設的項目數（來源、已離顯示方式、只看已到），按鈕上的數字徽章用。
// aria＝完整描述（讀屏念得出目前套了什麼）。
export function summarizeTodayFilter(f) {
  const parts = []
  const allSrc = isAllSources(f.sources)
  if (!allSrc) {
    const labels = SOURCE_OPTIONS.filter(o => f.sources.has(o.key)).map(o => o.label)
    parts.push(labels.length <= 2 ? labels.join('、') : `${labels.length} 種來源`)
  }
  if (f.arrivedOnly) parts.push('已到/離')
  if (!f.hideCompleted && !f.arrivedOnly) parts.push('含已離')
  if (f.hideCompleted && f.arrivedOnly) parts.push('隱藏已離')
  const srcText = allSrc ? '全部來源' : SOURCE_OPTIONS.filter(o => f.sources.has(o.key)).map(o => o.label).join('、')
  const statusText = [f.arrivedOnly ? '只看已到/離' : null, f.hideCompleted ? '隱藏已離' : '顯示已離'].filter(Boolean).join('、')
  return {
    isDefault: parts.length === 0,
    label: parts.length ? parts.join('・') : '篩選',
    count: parts.length,
    aria: `篩選：${srcText}；${statusText}`,
  }
}
