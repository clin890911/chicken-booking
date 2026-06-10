// 一天營運節奏判定：開店前 / 場次中（午市、晚市…）/ 場次間空檔 / 打烊後。
// 以 settings.seatings（場次定義）為主、openTime/closeTime 為備援；純函式注入 now 可測。

function toMin(hhmm, fallback) {
  const m = String(hhmm || '').match(/^(\d{1,2}):(\d{2})$/)
  if (!m) return fallback
  return Number(m[1]) * 60 + Number(m[2])
}

// 回傳 { phase: 'before-open'|'service'|'between'|'after-close', seating?: {…}, next?: {…} }
export function dayPhase(settings = {}, now = Date.now()) {
  const d = new Date(now)
  const cur = d.getHours() * 60 + d.getMinutes()
  const open = toMin(settings.openTime, 11 * 60)
  const close = toMin(settings.closeTime, 19 * 60)
  const seatings = (Array.isArray(settings.seatings) ? settings.seatings : [])
    .map(s => ({ ...s, startMin: toMin(s.start, null), endMin: toMin(s.end, null) }))
    .filter(s => s.startMin != null && s.endMin != null)
    .sort((a, b) => a.startMin - b.startMin)

  const inSeating = seatings.find(s => cur >= s.startMin && cur < s.endMin)
  if (inSeating) return { phase: 'service', seating: inSeating }
  const next = seatings.find(s => cur < s.startMin) || null
  if (cur < open) return { phase: 'before-open', next: next || seatings[0] || null }
  if (cur >= close && !next) return { phase: 'after-close' }
  return { phase: 'between', next }
}
