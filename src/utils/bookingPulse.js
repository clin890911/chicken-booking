// 今日訂位「脈動」分類：現場頁右側欄與 StatusBar 共用同一口徑。
// 純函式、注入 now（epoch ms）可單測。
// 三段：overdue（已過預約時間 + 寬限仍未到）/ soon（寬限內 ~ soonMin 分內將到）/ later（更晚）。
// 只看今日、status === 'confirmed'（已到/完成/取消/未到都不再是「待到」）。

function slotEpoch(timeSlot, now) {
  const [hh, mm] = String(timeSlot || '00:00').split(':').map(Number)
  const d = new Date(now)
  d.setHours(hh || 0, mm || 0, 0, 0)
  return d.getTime()
}

// 正值 = 已過預約時間 N 分
export function overdueMinOf(timeSlot, now = Date.now()) {
  return Math.round((now - slotEpoch(timeSlot, now)) / 60000)
}

export function classifyTodayPulse(bookings, today, now = Date.now(), { soonMin = 90, graceMin = 15 } = {}) {
  const todays = (bookings || []).filter(b => b.date === today && b.status === 'confirmed' && b.timeSlot)
  const diffOf = (b) => Math.round((slotEpoch(b.timeSlot, now) - now) / 60000) // 正值 = N 分後
  const byTimeSlot = (a, b) => String(a.timeSlot).localeCompare(String(b.timeSlot))
  const overdue = todays.filter(b => diffOf(b) < -graceMin)
    .sort((a, b) => diffOf(a) - diffOf(b)) // 過越久越前
  const soon = todays.filter(b => diffOf(b) >= -graceMin && diffOf(b) <= soonMin).sort(byTimeSlot)
  const later = todays.filter(b => diffOf(b) > soonMin).sort(byTimeSlot)
  return { overdue, soon, later }
}

// 過時文案：395 分 → 「已過預約時間 6 時 35 分」（之前誤標為「已到場 X 分」）
export function fmtOverdueMin(min) {
  const m = Math.max(0, Math.round(min))
  if (m < 60) return `已過預約時間 ${m} 分`
  const h = Math.floor(m / 60)
  const rest = m % 60
  return `已過預約時間 ${h} 時${rest ? ` ${rest} 分` : ''}`
}
