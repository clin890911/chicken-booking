// 產生時段陣列：例如 11:00-19:00, 30 分鐘間隔
export function generateTimeSlots(openTime = '11:00', closeTime = '19:00', intervalMin = 30) {
  const [oh, om] = openTime.split(':').map(Number)
  const [ch, cm] = closeTime.split(':').map(Number)
  const slots = []
  let cur = oh * 60 + om
  const end = ch * 60 + cm
  while (cur <= end) {
    const h = Math.floor(cur / 60)
    const m = cur % 60
    slots.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`)
    cur += intervalMin
  }
  return slots
}

export function formatDate(d) {
  if (typeof d === 'string') return d
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function todayStr() {
  return formatDate(new Date())
}

export function addDays(d, days) {
  const r = new Date(d)
  r.setDate(r.getDate() + days)
  return r
}

export function isPast(dateStr) {
  return dateStr < todayStr()
}

export function dayLabel(dateStr) {
  const d = new Date(dateStr + 'T00:00:00')
  const w = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()]
  return `${d.getMonth() + 1}/${d.getDate()} (${w})`
}
