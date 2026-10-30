// GA4 送出前的資料清洗（純函式，好測試）。
// 鐵律：送進 GA 的網址、標題、參數一律不帶個資或 manageToken。
//   - /confirm/:id、/manage/:id、/line/bind 的 query 都帶 token；bookingId 也不送。
//   - 只保留廣告歸因要用的 utm_* / gclid，其他 query 一律丟掉。
//   - 不在白名單的路徑一律記成 /(other)，避免未知網址把參數帶出去。

const ROUTES = [
  { re: /^\/$/, path: '/', title: '首頁' },
  { re: /^\/book\/?$/, path: '/book', title: '線上訂位' },
  { re: /^\/confirm\/[^/]+\/?$/, path: '/confirm/:id', title: '訂位完成' },
  { re: /^\/lookup\/?$/, path: '/lookup', title: '查詢訂位' },
  { re: /^\/manage\/[^/]+\/?$/, path: '/manage/:id', title: '修改訂位' },
  { re: /^\/line\/bind\/?$/, path: '/line/bind', title: 'LINE 綁定' },
  { re: /^\/line\/my-bookings\/?$/, path: '/line/my-bookings', title: 'LINE 我的訂位' },
]

const KEPT_QUERY_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id', 'gclid']

// 後台與內部頁：完全不追蹤（也不載入 gtag）。
export function isTrackedPath(pathname = '') {
  return !/^\/(admin|login|demo)(\/|\.html|$)/.test(pathname)
}

function matchRoute(pathname = '') {
  return ROUTES.find(r => r.re.test(pathname)) || null
}

export function sanitizePath(pathname = '') {
  return matchRoute(pathname)?.path || '/(other)'
}

export function pageTitleFor(pathname = '') {
  return matchRoute(pathname)?.title || '其他'
}

export function sanitizeSearch(search = '') {
  const params = new URLSearchParams(search)
  const kept = new URLSearchParams()
  for (const key of KEPT_QUERY_KEYS) {
    const value = params.get(key)
    if (value) kept.set(key, value.slice(0, 100))
  }
  const qs = kept.toString()
  return qs ? `?${qs}` : ''
}

export function sanitizeLocation(origin, pathname, search = '') {
  return `${origin}${sanitizePath(pathname)}${sanitizeSearch(search)}`
}

// 站內來源：換成清洗過的路徑；站外來源：只留網域（足夠判斷 google / facebook / line 等來源）。
export function sanitizeReferrer(referrer, origin) {
  if (!referrer) return ''
  try {
    const url = new URL(referrer)
    if (url.origin === origin) return `${origin}${sanitizePath(url.pathname)}`
    return `${url.origin}/`
  } catch {
    return ''
  }
}

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']

export function daysAhead(date, today) {
  const a = new Date(`${date}T00:00:00`)
  const b = new Date(`${today}T00:00:00`)
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return undefined
  return Math.round((a - b) / 86400000)
}

// 訂位事件的共同參數：人數、提前幾天、星期、時段、午晚餐。沒有任何可識別個人的欄位。
export function bookingParams({ guests, date, timeSlot } = {}, today) {
  const params = {}
  if (guests) params.party_size = Number(guests)
  if (date) {
    const ahead = daysAhead(date, today)
    if (ahead !== undefined) params.days_ahead = ahead
    const day = new Date(`${date}T00:00:00`).getDay()
    if (!Number.isNaN(day)) params.weekday = `週${WEEKDAYS[day]}`
  }
  if (timeSlot && /^\d{2}:\d{2}/.test(timeSlot)) {
    params.time_slot = timeSlot.slice(0, 5)
    params.meal_period = Number(timeSlot.slice(0, 2)) < 15 ? 'lunch' : 'dinner'
  }
  return params
}

// 把送出失敗分類成固定代碼；不送錯誤訊息原文（中文自由文字，日後改字就斷報表）。
export function classifyBookingError(err) {
  if (!err) return 'other'
  if (err.code === 'timeout') return 'timeout'
  const status = Number(err.status) || 0
  const msg = String(err.message || '')
  if (status === 429) return 'rate_limited'
  if (['booking-deadline-passed', 'booking-slot-past'].includes(err.reasonCode)) return 'slot_deadline'
  if (err.reasonCode === 'booking-date-past') return 'date_past'
  if (status === 409) {
    if (msg.includes('相同時段')) return 'duplicate'
    if (msg.includes('接近滿座')) return 'auto_closed'
    return 'full'
  }
  if (msg.includes('已關閉')) return 'slot_closed'
  if (status === 410) return 'recovery_unavailable'
  if (status >= 500) return 'server'
  if (status === 400) return 'invalid'
  if (!status) return 'network'
  return 'other'
}
