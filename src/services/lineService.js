import { dayLabel } from '../utils/timeSlots'

export function lineBindUrl(settings = {}, booking, manageUrl) {
  if (!booking) return ''
  const configuredLiff = settings.lineLiffUrl || ''
  const localBind = `${window.location.origin}/line/bind`
  const base = configuredLiff || localBind
  const url = new URL(base)
  url.searchParams.set('bookingId', booking.id)
  url.searchParams.set('token', booking.manageToken || '')
  url.searchParams.set('manageUrl', manageUrl || `${window.location.origin}/manage/${booking.id}?token=${encodeURIComponent(booking.manageToken || '')}`)
  return url.toString()
}

export function lineOfficialUrl(settings = {}) {
  return settings.lineOfficialUrl || import.meta.env.VITE_LINE_OFFICIAL_URL || ''
}

export function lineBindEndpoint(settings = {}) {
  return settings.lineBindEndpoint || import.meta.env.VITE_LINE_BIND_ENDPOINT || ''
}

export function linePushEndpoint(settings = {}) {
  return settings.linePushEndpoint || import.meta.env.VITE_LINE_PUSH_ENDPOINT || ''
}

export function lineLiffId(settings = {}) {
  if (settings.lineLiffId) return settings.lineLiffId
  if (import.meta.env.VITE_LINE_LIFF_ID) return import.meta.env.VITE_LINE_LIFF_ID
  if (!settings.lineLiffUrl) return ''
  try {
    const url = new URL(settings.lineLiffUrl)
    return url.pathname.replace(/^\//, '').split('/')[0]
  } catch {
    return ''
  }
}

export function bookingLinePayload(booking, settings = {}, manageUrl = '') {
  return {
    booking: {
      id: booking.id,
      token: booking.manageToken || '',
      name: booking.name,
      phone: booking.phone,
      guests: Number(booking.guests) || 1,
      date: booking.date,
      dateLabel: dayLabel(booking.date),
      timeSlot: booking.timeSlot,
      notes: booking.notes || {},
      manageUrl,
    },
    store: {
      name: settings.storeName || '雞王刷刷鍋',
      address: settings.storeAddress || '',
      phone: settings.storePhone || '',
      mapUrl: settings.storeMapUrl || '',
      latitude: settings.storeLatitude || '',
      longitude: settings.storeLongitude || '',
      lineOfficialUrl: lineOfficialUrl(settings),
    },
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

export async function notifyLineBooking(settings = {}, booking, type = 'updated') {
  const endpoint = linePushEndpoint(settings)
  if (!endpoint || !booking) return { ok: false, reason: 'not-configured' }
  const manageUrl = `${window.location.origin}/manage/${booking.id}?token=${encodeURIComponent(booking.manageToken || '')}`
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type,
        ...bookingLinePayload(booking, settings, manageUrl),
      }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || data.ok === false) return { ok: false, error: data.error || `HTTP ${res.status}` }
    return { ok: true }
  } catch (err) {
    console.warn('LINE notify failed:', err)
    return { ok: false, error: err.message }
  }
}
