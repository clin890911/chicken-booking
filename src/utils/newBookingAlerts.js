// 新訂位通報（現場頁右上角 toast）的口徑：純函式、可單測。
//
// 🔴 這支存在的理由是一個「畫面被自己的通知洗版」的缺陷：
// 登入當下 bookings 由 [] → 首次雲端拉取的全量資料，若把「多出來的 id」一律當成新訂位，
// 開機瞬間會一次噴出數十則 toast 蓋住整個桌況圖（實際上一筆都不是剛進來的訂位）。
// 兩條規則各治一半：
//   (1) 資料備妥前只記基準、不通報       → isAlertBaselineReady
//   (2) 同一批多筆合併成一則摘要         → buildNewBookingAlerts
// 合起來保證：開機 0 則、之後每次輪詢最多 2 則（今日一則、未來日一則）。

// 每桶（今日／未來日）超過這個數量就不逐筆報，改推一則摘要。
const DETAIL_LIMIT = 1

// 「基準是否可信」：不可信時看到的新增只是資料補齊，不是真的有人來訂位。
// - 本機模式（未接 Firebase）：localStorage 就是全部資料，首次 refresh 後即備妥。
// - 雲端模式：必須等第一次拉取成功（lastSyncAt 有值）。刻意不把 offline 當備妥——
//   連不上時本機快照可能是空的／過期的，拿它當基準，等網路回來就會再洗版一次；
//   而且離線期間唯一的資料來源是本機自己的操作，那不需要「新訂位」通知。
export function isAlertBaselineReady({ usingFirebase, cloudStatus, hydrated } = {}) {
  if (!usingFirebase) return !!hydrated
  return !!cloudStatus?.lastSyncAt
}

// 相對前一份基準，這次多出來的已確認訂位（維持傳入順序）。
export function diffNewConfirmed(prevIds, bookings) {
  if (!prevIds) return []
  return (bookings || []).filter(b => b?.status === 'confirmed' && !prevIds.has(b.id))
}

// 已確認訂位的 id 集合——下一輪比對用的基準。
export function confirmedIdSet(bookings) {
  return new Set((bookings || []).filter(b => b?.status === 'confirmed').map(b => b.id))
}

const label = (b) => `${b.name || '訂位'} ${b.guests || 0} 位`

// added → 要推的 toast 清單（最多兩則）。空陣列代表沒事發生。
// 回傳 { key, message, duration }：key 供測試與消費端辨識，非畫面文字。
export function buildNewBookingAlerts(added, today, { detailLimit = DETAIL_LIMIT } = {}) {
  const list = (added || []).filter(Boolean)
  if (!list.length) return []
  const todays = list.filter(b => b.date === today)
    .sort((a, b) => String(a.timeSlot).localeCompare(String(b.timeSlot)))
  const future = list.filter(b => b.date !== today)
    .sort((a, b) => `${a.date} ${a.timeSlot}`.localeCompare(`${b.date} ${b.timeSlot}`))
  const alerts = []

  // 今日：顯眼且停留久（店員得馬上安排桌）
  if (todays.length) {
    alerts.push(todays.length <= detailLimit
      ? { key: 'today', message: `📋 新訂位：${label(todays[0])} · ${todays[0].timeSlot}`, duration: 6000 }
      : { key: 'today-many', message: `📋 ${todays.length} 筆新訂位 · ${todays[0].timeSlot} 起（見「今日訂位」）`, duration: 6000 })
  }
  // 未來日：不緊迫，標註日期、停留短
  if (future.length) {
    alerts.push(future.length <= detailLimit
      ? { key: 'future', message: `🗓 未來日新訂位：${label(future[0])} · ${future[0].date} ${future[0].timeSlot}`, duration: 3500 }
      : { key: 'future-many', message: `🗓 ${future.length} 筆未來日新訂位（見「訂位」頁）`, duration: 3500 })
  }
  return alerts
}
