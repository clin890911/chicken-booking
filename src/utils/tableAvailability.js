// 桌位「按日期可用性」純邏輯（前端版）。
// ★ 與後端 functions/lib/tableUsable.js 成對：兩邊規則必須位元級一致，
//   由 tests/utils/tableAvailability.test.js 的 parity 測試釘住。
//
// 兩個軸：
//   - isActive：永久停用（桌子不存在/長期不用），不分日期。
//   - outage { from, to, reason }：維修停用（按日期），from/to 皆 'YYYY-MM-DD'；
//     to 空字串 = 無限期（直到手動結束）。窗口含頭含尾。

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

// 正規化 outage：格式不合法回 null（視為沒有維修）。
export function normalizeOutage(outage) {
  if (!outage || typeof outage !== 'object') return null
  const from = String(outage.from || '')
  if (!DATE_RE.test(from)) return null
  const toRaw = String(outage.to || '')
  const to = DATE_RE.test(toRaw) ? toRaw : ''
  if (to && to < from) return null
  return { from, to, reason: String(outage.reason || '').trim().slice(0, 60) }
}

// 某日是否在維修窗內（含頭含尾；to 空 = 無限期）。
export function isTableOutOnDate(table, date) {
  const o = normalizeOutage(table?.outage)
  if (!o || !DATE_RE.test(String(date || ''))) return false
  return date >= o.from && (!o.to || date <= o.to)
}

// 某日此桌是否可用 = 未永久停用 且 不在維修窗內。容量/配桌/入座一律用這個口徑。
export function isTableUsableOnDate(table, date) {
  return table?.isActive !== false && !isTableOutOnDate(table, date)
}

// 顯示用：維修標籤文字，例如「維修 6/12 起」「維修至 6/15」「維修中」。
// 已過期的窗（to < today）回空字串——過期紀錄不該再以任何形式標示為維修。
export function outageLabel(table, today) {
  const o = normalizeOutage(table?.outage)
  if (!o) return ''
  const short = (d) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`
  if (today && DATE_RE.test(today)) {
    if (o.to && o.to < today) return ''
    if (o.from > today) return o.to ? `維修 ${short(o.from)}–${short(o.to)}` : `維修 ${short(o.from)} 起`
  }
  return o.to ? `維修至 ${short(o.to)}` : '維修中'
}
