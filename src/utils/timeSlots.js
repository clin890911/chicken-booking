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

// 訂位日期相對今天的分類：past=補登（離席/No-show/取消）、today=完整操作、
// future=只能預配/取消（現場報到類操作當天才開放）。無 date 視為今天（舊資料防呆）。
export function bookingDayKind(dateStr, today = todayStr()) {
  if (!dateStr) return 'today'
  if (dateStr < today) return 'past'
  if (dateStr > today) return 'future'
  return 'today'
}

export function dayLabel(dateStr) {
  const d = new Date(dateStr + 'T00:00:00')
  const w = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()]
  return `${d.getMonth() + 1}/${d.getDate()} (${w})`
}

// === 場次（seating）：把抵達時段歸類到店家自訂的固定場次（如「午餐第一批」）===
// settings.seatings = [{ id, name, start:'HH:MM', end:'HH:MM' }]；採半開區間 [start, end)。
// 散客以其 timeSlot、團客以各梯 timeSlot 對應到所屬場次，地圖時間軸即以場次切換。
function slotToMinutes(t) {
  const [h, m] = String(t || '').split(':').map(Number)
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0)
}

// 回傳包含此抵達時段的場次（找不到回 null；多場次重疊時取第一個命中）。
export function seatingForSlot(settings, timeSlot) {
  const list = Array.isArray(settings?.seatings) ? settings.seatings : []
  const x = slotToMinutes(timeSlot)
  return list.find(s => x >= slotToMinutes(s.start) && x < slotToMinutes(s.end)) || null
}

// 回傳某場次涵蓋的所有抵達時段（依營業設定的開始/結束/間隔產生）。
// 用於「關閉整場次 → 展開為各時段」與 SettingsView 的時段勾選清單。
export function slotsInSeating(settings, seating) {
  if (!seating) return []
  const all = generateTimeSlots(settings?.openTime, settings?.closeTime, settings?.slotInterval)
  const s = slotToMinutes(seating.start)
  const e = slotToMinutes(seating.end)
  return all.filter(t => { const x = slotToMinutes(t); return x >= s && x < e })
}

// 場次內可選的「預計抵達時間」清單（固定 stepMin 間隔、預設 15 分；半開區間 [start, end)）。
// 與 slotsInSeating 不同：不綁營業 slotInterval，讓店員能挑 11:45 這種較細的抵達時間，
// 且保證所有選項都落在場次窗內 → 用下拉挑選即可，無須事後驗證/拒絕。
export function arrivalSlotsForSeating(seating, stepMin = 15) {
  if (!seating) return []
  const step = Number(stepMin) > 0 ? Number(stepMin) : 15
  const e = slotToMinutes(seating.end)
  const out = []
  for (let m = slotToMinutes(seating.start); m < e; m += step) {
    out.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`)
  }
  return out
}
