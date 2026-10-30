// GA4（gtag.js）客人端追蹤。
// - 沒設 VITE_GA4_MEASUREMENT_ID 就整支 no-op（本機開發、測試、demo 預設不送）。
// - 只在客人頁第一次 page_view 時才載入 gtag，後台 /admin、/login 永遠不載入。
// - 自動 page_view 關閉，改由路由變化手動送清洗過的網址（見 utils/analyticsSanitize）。
//   ⚠️ GA4 後台的「加強型評估」也要照 docs/GA4分析指南.md 關掉瀏覽記錄事件與外連點擊，
//   否則 gtag 會自己再送一筆帶原始網址（含 token）的事件，程式這邊擋不住。
import { isTrackedPath, pageTitleFor, sanitizeLocation, sanitizePath, sanitizeReferrer } from '../utils/analyticsSanitize'

const MEASUREMENT_ID = import.meta.env.VITE_GA4_MEASUREMENT_ID || ''

let initialized = false
let lastPageKey = ''
let lastLocation = ''

function gtag() {
  window.dataLayer.push(arguments)
}

export function analyticsEnabled() {
  return !!MEASUREMENT_ID && typeof window !== 'undefined'
}

function init(firstLocation) {
  if (initialized) return true
  if (!analyticsEnabled()) return false
  initialized = true
  window.dataLayer = window.dataLayer || []
  window.gtag = window.gtag || gtag
  const debug = import.meta.env.DEV || new URLSearchParams(window.location.search).has('ga_debug')
  window.gtag('js', new Date())
  window.gtag('set', { in_line_app: /\bLine\//i.test(navigator.userAgent) ? 'yes' : 'no' })
  window.gtag('config', MEASUREMENT_ID, {
    send_page_view: false,
    page_location: firstLocation,
    page_referrer: sanitizeReferrer(document.referrer, window.location.origin),
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
    ...(debug ? { debug_mode: true } : {}),
  })
  const script = document.createElement('script')
  script.async = true
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(MEASUREMENT_ID)}`
  document.head.appendChild(script)
  return true
}

export function trackPageView({ pathname, search }) {
  if (!analyticsEnabled() || !isTrackedPath(pathname)) return
  const location = sanitizeLocation(window.location.origin, pathname, search)
  // StrictMode 雙跑 effect、或只改了被丟掉的 query → 同一頁不重送
  if (location === lastPageKey) return
  if (!init(location)) return
  const referrer = lastLocation || sanitizeReferrer(document.referrer, window.location.origin)
  const params = {
    page_location: location,
    page_path: sanitizePath(pathname),
    page_referrer: referrer,
    page_title: pageTitleFor(pathname),
  }
  // set 讓之後的自訂事件也帶清洗過的網址（gtag 預設會拿 document.location）
  window.gtag('set', params)
  window.gtag('event', 'page_view', params)
  lastPageKey = location
  lastLocation = location
}

export function trackEvent(name, params = {}) {
  if (!initialized) return
  window.gtag('event', name, params)
}
