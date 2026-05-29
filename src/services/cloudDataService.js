import { getSettings, saveSettings } from './settingsService'

const DEFAULT_FUNCTION_BASE = 'https://us-central1-chicken-booking-tw.cloudfunctions.net'

const KEYS = {
  bookings: 'chicken_bookings_v1',
  tables: 'chicken_tables_v2',
  waitlist: 'chicken_waitlist_v1',
  customers: 'chicken_customers_v1',
  migration: 'chicken_firestore_migrated_v1',
}

function endpoint(name) {
  const base = (import.meta.env.VITE_FUNCTION_BASE_URL || DEFAULT_FUNCTION_BASE).replace(/\/$/, '')
  return `${base}/${name}`
}

// === 員工身分 Token 提供者 ===
// admin 端點（pull/push）需要帶 Firebase ID Token。
// AuthContext / BookingContext 在啟動時呼叫 setAuthTokenProvider 注入取 token 的函式，
// 避免本檔案直接依賴 React context（這是純 service 模組）。
let _tokenProvider = null
export function setAuthTokenProvider(fn) {
  _tokenProvider = typeof fn === 'function' ? fn : null
}

async function authHeader() {
  if (!_tokenProvider) return {}
  try {
    const token = await _tokenProvider()
    return token ? { Authorization: `Bearer ${token}` } : {}
  } catch {
    return {}
  }
}

function readJson(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback))
  } catch {
    return fallback
  }
}

function writeJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value))
}

function customersArrayToMap(customers = []) {
  return customers.reduce((map, customer) => {
    if (customer?.phone) map[customer.phone] = customer
    return map
  }, {})
}

export function localDataset() {
  return {
    bookings: readJson(KEYS.bookings, []),
    tables: readJson(KEYS.tables, []),
    waitlist: readJson(KEYS.waitlist, []),
    customers: Object.values(readJson(KEYS.customers, {})),
    settings: getSettings(),
  }
}

export function applyCloudSnapshot(data = {}) {
  if (Array.isArray(data.bookings)) writeJson(KEYS.bookings, data.bookings)
  if (Array.isArray(data.tables) && data.tables.length > 0) writeJson(KEYS.tables, data.tables)
  if (Array.isArray(data.waitlist)) writeJson(KEYS.waitlist, data.waitlist)
  if (Array.isArray(data.customers)) writeJson(KEYS.customers, customersArrayToMap(data.customers))
  if (data.settings) saveSettings(data.settings)
}

async function requestJson(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || data.ok === false) {
    const err = new Error(data.error || data.reason || `request-failed-${res.status}`)
    err.status = res.status
    err.code = data.error || data.reason || ''
    throw err
  }
  return data
}

export async function pullCloudData() {
  return requestJson(endpoint('adminPullData'), {
    method: 'GET',
    headers: await authHeader(),
  })
}

export async function pushCloudData(dataset = localDataset()) {
  return requestJson(endpoint('adminPushData'), {
    method: 'POST',
    headers: await authHeader(),
    body: JSON.stringify({ dataset }),
  })
}

export async function migrateLocalToCloudOnce() {
  if (localStorage.getItem(KEYS.migration) === '1') return { ok: true, skipped: true }
  const result = await pushCloudData(localDataset())
  localStorage.setItem(KEYS.migration, '1')
  return result
}

export async function guestGetAvailability(date) {
  return requestJson(endpoint('guestGetAvailability'), {
    method: 'POST',
    body: JSON.stringify({ date }),
  })
}

export async function guestCreateBooking(payload) {
  return requestJson(endpoint('guestCreateBooking'), {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function guestLookupBooking(payload) {
  return requestJson(endpoint('guestLookupBooking'), {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function guestGetBooking(bookingId, token) {
  return requestJson(endpoint('guestGetBooking'), {
    method: 'POST',
    body: JSON.stringify({ bookingId, token }),
  })
}

export async function guestUpdateBooking(bookingId, token, patch) {
  return requestJson(endpoint('guestUpdateBooking'), {
    method: 'POST',
    body: JSON.stringify({ bookingId, token, patch }),
  })
}

export async function guestCancelBooking(bookingId, token, reason) {
  return requestJson(endpoint('guestCancelBooking'), {
    method: 'POST',
    body: JSON.stringify({ bookingId, token, reason }),
  })
}
