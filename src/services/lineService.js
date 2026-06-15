const DEFAULT_LIFF_URL = 'https://liff.line.me/2009996489-f1SCb75q'
const DEFAULT_LIFF_ID = '2009996489-f1SCb75q'
const DEFAULT_BIND_ENDPOINT = 'https://linebind-reaor76eyq-uc.a.run.app'
const DEFAULT_LOGIN_START_ENDPOINT = 'https://lineloginstart-reaor76eyq-uc.a.run.app'
const DEFAULT_PUSH_ENDPOINT = 'https://linepushbooking-reaor76eyq-uc.a.run.app'
const DEFAULT_MANAGE_ENDPOINT = 'https://linegetbooking-reaor76eyq-uc.a.run.app'
const DEFAULT_MYBOOKINGS_ENDPOINT = 'https://linemybookings-reaor76eyq-uc.a.run.app'

// 綁定入口連結：只帶 bookingId + token，不再夾帶 base64 的姓名/電話 payload——
// 那會把個資寫進 LINE 伺服器 log 與瀏覽器歷史。綁定頁顯示資料改由 lineGetBooking 端點回讀，
// 後端 lineBind 本來就權威重讀訂位，payload 從頭到尾只剩顯示用途，可以安全移除。
export function lineBindUrl(settings = {}, booking, manageUrl) {
  if (!booking) return ''
  const configuredLiff = settings.lineLiffUrl || import.meta.env.VITE_LINE_LIFF_URL || DEFAULT_LIFF_URL
  const localBind = `${window.location.origin}/line/bind`
  const targetManageUrl = manageUrl || `${window.location.origin}/manage/${booking.id}?token=${encodeURIComponent(booking.manageToken || '')}`
  const url = new URL(localBind)
  url.searchParams.set('bookingId', booking.id)
  url.searchParams.set('token', booking.manageToken || '')
  url.searchParams.set('manageUrl', targetManageUrl)
  if (settings.lineUseLiff && configuredLiff) url.searchParams.set('useLiff', '1')
  return url.toString()
}

export function lineLiffUrl(settings = {}) {
  return settings.lineLiffUrl || import.meta.env.VITE_LINE_LIFF_URL || DEFAULT_LIFF_URL
}

export function lineLoginStartEndpoint(settings = {}) {
  return settings.lineLoginStartEndpoint || import.meta.env.VITE_LINE_LOGIN_START_ENDPOINT || DEFAULT_LOGIN_START_ENDPOINT
}

// LINE Login 網頁授權綁定入口：純連結，瀏覽器整頁導向後端 lineLoginStart → LINE 授權 → 自動跳回。
// 取代舊 LIFF 自動綁定（client SDK 多段重導易卡在「一直載入」）。只帶 bookingId + token，不夾個資。
export function lineLoginStartUrl(settings = {}, booking) {
  if (!booking?.id) return ''
  const endpoint = lineLoginStartEndpoint(settings)
  if (!endpoint) return ''
  const url = new URL(endpoint)
  url.searchParams.set('bookingId', booking.id)
  url.searchParams.set('token', booking.manageToken || '')
  return url.toString()
}

export function lineOfficialUrl(settings = {}) {
  return settings.lineOfficialUrl || import.meta.env.VITE_LINE_OFFICIAL_URL || ''
}

export function lineBindEndpoint(settings = {}) {
  return settings.lineBindEndpoint || import.meta.env.VITE_LINE_BIND_ENDPOINT || DEFAULT_BIND_ENDPOINT
}

export function linePushEndpoint(settings = {}) {
  return settings.linePushEndpoint || import.meta.env.VITE_LINE_PUSH_ENDPOINT || DEFAULT_PUSH_ENDPOINT
}

export function lineManageEndpoint(settings = {}) {
  return settings.lineManageEndpoint || import.meta.env.VITE_LINE_MANAGE_ENDPOINT || DEFAULT_MANAGE_ENDPOINT
}

export function lineMyBookingsEndpoint(settings = {}) {
  return settings.lineMyBookingsEndpoint || import.meta.env.VITE_LINE_MYBOOKINGS_ENDPOINT || DEFAULT_MYBOOKINGS_ENDPOINT
}

// 「LINE 我的訂位」：以 LIFF idToken 向後端查詢本人綁定的訂位清單。
// 身分由後端向 LINE 驗證 idToken 確立，前端不傳 userId。
export async function fetchLineMyBookings(settings = {}, idToken) {
  const endpoint = lineMyBookingsEndpoint(settings)
  if (!endpoint || !idToken) return { ok: false, error: 'not-configured' }
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || data.ok === false) return { ok: false, error: data.error || `HTTP ${res.status}` }
    return { ok: true, items: data.items || [], store: data.store || {}, line: data.line || {} }
  } catch (err) {
    console.warn('LINE my-bookings fetch failed:', err)
    return { ok: false, error: err.message || 'fetch-failed' }
  }
}

export function lineLiffId(settings = {}) {
  if (!settings.lineUseLiff) return ''
  if (settings.lineLiffId) return settings.lineLiffId
  if (import.meta.env.VITE_LINE_LIFF_ID) return import.meta.env.VITE_LINE_LIFF_ID
  if (!settings.lineLiffUrl) return DEFAULT_LIFF_ID
  try {
    const url = new URL(settings.lineLiffUrl)
    return url.pathname.replace(/^\//, '').split('/')[0]
  } catch {
    return ''
  }
}

// decode 保留：已寄出的舊版綁定連結仍帶 payload 參數，作為顯示資料的相容來源。
export function decodeLinePayload(value = '') {
  if (!value) return null
  try {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
    const binary = atob(padded)
    const bytes = Uint8Array.from(binary, char => char.charCodeAt(0))
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    return null
  }
}

export function loadLiffSdk() {
  if (window.liff) return Promise.resolve(window.liff)
  return new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-line-liff-sdk]')
    if (existing) {
      existing.addEventListener('load', () => resolve(window.liff))
      existing.addEventListener('error', reject)
      return
    }
    const script = document.createElement('script')
    script.src = 'https://static.line-scdn.net/liff/edge/2/sdk.js'
    script.async = true
    script.dataset.lineLiffSdk = '1'
    script.onload = () => resolve(window.liff)
    script.onerror = () => reject(new Error('LIFF SDK 載入失敗'))
    document.head.appendChild(script)
  })
}

// 注意：訂位修改/取消的 LINE 通知已改由後端 guestUpdateBooking / guestCancelBooking
// 內部權威送出（經 outbox 重試），前端不再有 notifyLineBooking——避免「客人關頁就漏發」。
// linePushEndpoint 仍保留：linePushBooking 端點供「重新傳送訂位資訊」類功能重用。

export async function fetchLineBooking(settings = {}, bookingId, token) {
  const endpoint = lineManageEndpoint(settings)
  if (!endpoint || !bookingId || !token) return { ok: false, reason: 'not-configured' }
  try {
    const url = new URL(endpoint)
    url.searchParams.set('bookingId', bookingId)
    url.searchParams.set('token', token)
    const res = await fetch(url.toString(), { method: 'GET' })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || data.ok === false) return { ok: false, error: data.error || `HTTP ${res.status}` }
    return { ok: true, booking: data.booking, store: data.store, line: data.line }
  } catch (err) {
    console.warn('LINE booking fetch failed:', err)
    return { ok: false, error: err.message || 'Load failed' }
  }
}

// 已綁定者「重新傳送訂位資訊到 LINE」：打 linePushBooking 端點（manageToken 驗證 +
// 後端 90 秒事件級防重，連點不會洗版）。type 固定 confirmed = 重發當前訂位卡片。
export async function resendLineBooking(settings = {}, booking) {
  const endpoint = linePushEndpoint(settings)
  if (!endpoint || !booking?.id) return { ok: false, reason: 'not-configured' }
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bookingId: booking.id, token: booking.manageToken || '', type: 'confirmed' }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || data.ok === false) return { ok: false, error: data.error || `HTTP ${res.status}` }
    return { ok: true, skipped: !!data.skippedPush }
  } catch (err) {
    return { ok: false, error: err.message || 'resend-failed' }
  }
}
