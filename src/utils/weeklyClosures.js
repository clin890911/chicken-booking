// === 每週預設關閉場次（closures.weeklySeatings）＋單日覆寫開放（closures.openSeatings）===
// 店主需求（2026-10）：「每週六、日預設關閉午餐第二批」不必每天點；單一日期仍可手動「本日開放」。
//   weeklySeatings = { '0'..'6': [seatingId] }（key＝星期幾，0＝週日，與 JS getDay 相同）
//   openSeatings   = { 'YYYY-MM-DD': [seatingId] }（只抵銷每週預設，不抵銷 closedSeatings 明細）
// 有效關閉場次(date) = (closedSeatings[date] ∪ weeklySeatings[dow(date)]) − openSeatings[date]
// 語意與 closedSeatings 相同：只停線上客人新訂位；公休 closedDates 不受影響。
// ★ 後端 functions/index.js closureDayOfWeekServer / effectiveClosedSeatingsServer 必須同邏輯。

export const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六']
// UI 顯示順序：週一 … 週日（店家習慣）
export const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0]

// 由 'YYYY-MM-DD' 字串算星期幾（0＝週日）。一律用 UTC 計算，不受裝置/伺服器時區影響。
export function closureDayOfWeek(date) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date || ''))
  if (!m) return null
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay()
}

const idList = (v) => (Array.isArray(v) ? v.map(String) : [])

// 該日因「每週預設」而關閉的場次 id（未扣除單日覆寫）。
export function weeklyClosedSeatingIds(closures, date) {
  const dow = closureDayOfWeek(date)
  if (dow === null) return []
  return idList(closures?.weeklySeatings?.[String(dow)])
}

// 該日被覆寫為「本日開放」的場次 id。
export function openSeatingIdsOn(closures, date) {
  return idList(closures?.openSeatings?.[date])
}

// 該日實際關閉的場次 id（明細 ∪ 每週預設 − 單日開放；明細不受單日開放影響）。
export function effectiveClosedSeatings(closures, date) {
  const explicit = idList(closures?.closedSeatings?.[date])
  const open = new Set(openSeatingIdsOn(closures, date))
  const weekly = weeklyClosedSeatingIds(closures, date).filter(id => !open.has(id))
  return [...new Set([...explicit, ...weekly])]
}

// 每週規則的人話摘要：同一組星期的場次合併成一行，例：['每週六、日：午餐第二批']。
export function describeWeeklyClosures(closures, seatings = []) {
  const ws = closures?.weeklySeatings || {}
  const daysBySeating = new Map()
  for (const dow of WEEKDAY_ORDER) {
    for (const id of idList(ws[String(dow)])) {
      if (!daysBySeating.has(id)) daysBySeating.set(id, [])
      daysBySeating.get(id).push(dow)
    }
  }
  const nameOf = (id) => seatings.find(s => s.id === id)?.name || '已刪除的場次'
  const groups = new Map() // 星期組合 → 場次名
  for (const [id, days] of daysBySeating) {
    const key = days.join(',')
    if (!groups.has(key)) groups.set(key, { days, names: [] })
    groups.get(key).names.push(nameOf(id))
  }
  return [...groups.values()].map(g => `每週${g.days.map(d => WEEKDAY_LABELS[d]).join('、')}：${g.names.join('、')}`)
}
