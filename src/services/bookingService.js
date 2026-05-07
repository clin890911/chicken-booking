// bookingService：統一封裝訂位 CRUD
// schema: { id, name, phone, guests, date, timeSlot, notes, source, status,
//           assignedTableId, lineUserId, manageToken, lastGuestEditAt,
//           guestEditCount, createdAt, updatedAt, createdBy }
// 後端：localStorage（v0），未來切到 Firestore 只改本檔
import * as customerService from './customerService'

const STORAGE_KEY = 'chicken_bookings_v1'
const NOSHOW_KEY = 'chicken_noshow_v1'

function read() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
  } catch {
    return []
  }
}

function write(list) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list))
}

function uid() {
  return 'B' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6).toUpperCase()
}

export function createManageToken() {
  if (window.crypto?.getRandomValues) {
    const bytes = new Uint8Array(24)
    window.crypto.getRandomValues(bytes)
    return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`.slice(0, 48)
}

function digits(value) {
  return String(value || '').replace(/\D/g, '')
}

export function phoneTail(phone, length = 3) {
  const d = digits(phone)
  return d.slice(-length)
}

export function isGuestEditable(booking, now = new Date()) {
  if (!booking) return { ok: false, reason: '找不到此訂位' }
  if (['arrived', 'completed', 'cancelled', 'noshow'].includes(booking.status)) {
    return { ok: false, reason: '此訂位狀態已無法由客人自行修改' }
  }
  if (!booking.date || !booking.timeSlot) return { ok: false, reason: '訂位資料不完整，請聯絡店家' }
  const dineAt = new Date(`${booking.date}T${booking.timeSlot}:00`)
  if (Number.isNaN(dineAt.getTime())) return { ok: false, reason: '訂位時間不正確，請聯絡店家' }
  const cutoff = new Date(dineAt.getTime() - 2 * 60 * 60 * 1000)
  if (now >= cutoff) return { ok: false, reason: '用餐前 2 小時內請改以電話聯絡店家' }
  return { ok: true }
}

// === 讀取 ===
export function listAll() {
  // 補上新欄位的預設值（向後相容）
  return read().map(b => ({
    assignedTableId: null,
    lineUserId: null,
    manageToken: null,
    lastGuestEditAt: null,
    guestEditCount: 0,
    ...b,
  }))
}

export function listByDate(date) {
  return listAll().filter(b => b.date === date)
}

export function listByTable(tableNumber) {
  return listAll().filter(b => b.assignedTableId === tableNumber)
}

export function getById(id) {
  return listAll().find(b => b.id === id) || null
}

export function ensureManageToken(id) {
  const booking = getById(id)
  if (!booking) return null
  if (booking.manageToken) return booking
  return update(id, { manageToken: createManageToken() })
}

// === 新增 ===
export function create(data) {
  const list = read()
  const booking = {
    id: uid(),
    name: data.name?.trim() || '',
    phone: data.phone?.trim() || '',
    guests: Number(data.guests) || 1,
    date: data.date,
    timeSlot: data.timeSlot,
    notes: {
      pet: !!data.notes?.pet,
      child: !!data.notes?.child,
      mobility: !!data.notes?.mobility,
      text: data.notes?.text || ''
    },
    source: data.source || 'online',
    status: data.status || 'confirmed',
    assignedTableId: data.assignedTableId || null,
    lineUserId: data.lineUserId || null,
    manageToken: data.manageToken || createManageToken(),
    lastGuestEditAt: data.lastGuestEditAt || null,
    guestEditCount: Number(data.guestEditCount) || 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    createdBy: data.createdBy || 'guest'
  }
  list.push(booking)
  write(list)

  // upsert 到 customers（自動建立顧客檔）
  if (booking.phone) {
    customerService.upsert({
      phone: booking.phone,
      name: booking.name,
      lineUserId: booking.lineUserId,
      partySize: booking.guests,
      source: booking.source,
      notes: booking.notes.text,
    })
  }

  return booking
}

// === 更新 ===
export function update(id, patch) {
  const list = read()
  const idx = list.findIndex(b => b.id === id)
  if (idx < 0) return null
  list[idx] = { ...list[idx], ...patch, updatedAt: new Date().toISOString() }
  write(list)
  return list[idx]
}

export function verifyGuestAccess(id, token, tail) {
  const booking = ensureManageToken(id)
  if (!booking) return { ok: false, reason: '找不到此訂位' }
  if (!token || token !== booking.manageToken) return { ok: false, reason: '管理連結無效，請確認是否使用最新連結' }

  const normalized = digits(tail)
  if (![3, 4].includes(normalized.length)) return { ok: false, reason: '請輸入手機末 3 或 4 碼' }
  if (phoneTail(booking.phone, normalized.length) !== normalized) return { ok: false, reason: '電話末碼不符合此訂位' }

  return { ok: true, booking }
}

export function updateBookingByGuest(id, token, patch) {
  const booking = ensureManageToken(id)
  if (!booking) return { ok: false, reason: '找不到此訂位' }
  if (!token || token !== booking.manageToken) return { ok: false, reason: '管理連結無效' }
  const editable = isGuestEditable(booking)
  if (!editable.ok) return editable

  const structuralKeys = ['date', 'timeSlot', 'guests']
  const shouldUnassign = structuralKeys.some(key => patch[key] !== undefined && String(patch[key]) !== String(booking[key]))
  const cleanPatch = {
    ...patch,
    ...(shouldUnassign ? { assignedTableId: null } : {}),
    lastGuestEditAt: new Date().toISOString(),
    guestEditCount: (Number(booking.guestEditCount) || 0) + 1,
  }
  const updated = update(id, cleanPatch)
  return { ok: true, booking: updated, changes: cleanPatch }
}

export function cancelBookingByGuest(id, token) {
  const booking = ensureManageToken(id)
  if (!booking) return { ok: false, reason: '找不到此訂位' }
  if (!token || token !== booking.manageToken) return { ok: false, reason: '管理連結無效' }
  const editable = isGuestEditable(booking)
  if (!editable.ok) return editable
  const updated = update(id, {
    status: 'cancelled',
    assignedTableId: null,
    lastGuestEditAt: new Date().toISOString(),
    guestEditCount: (Number(booking.guestEditCount) || 0) + 1,
  })
  return { ok: true, booking: updated }
}

export function remove(id) {
  const list = read().filter(b => b.id !== id)
  write(list)
}

// === 狀態 ===
export function setStatus(id, status) {
  const patch = { status }
  // 從非到達狀態變成 arrived → 記錄實際到達時間
  if (status === 'arrived') {
    const cur = getById(id)
    if (cur && !cur.actualArrivalTime) patch.actualArrivalTime = new Date().toISOString()
  }
  // 從 arrived 變回 confirmed（誤觸復原）→ 清掉
  if (status === 'confirmed') {
    patch.actualArrivalTime = null
  }
  const b = update(id, patch)
  if (status === 'noshow' && b) recordNoshow(b)
  return b
}

// 狀態循環：confirmed -> arrived -> completed
export function cycleStatus(id) {
  const b = getById(id)
  if (!b) return null
  const order = ['confirmed', 'arrived', 'completed']
  const i = order.indexOf(b.status)
  const next = order[(i + 1) % order.length]
  return setStatus(id, next)
}

// === 桌位指派 ===
export function assignTable(bookingId, tableNumber) {
  return update(bookingId, { assignedTableId: tableNumber })
}

export function unassignTable(bookingId) {
  return update(bookingId, { assignedTableId: null })
}

// === No-show 記錄 ===
function readNoshow() {
  try {
    return JSON.parse(localStorage.getItem(NOSHOW_KEY) || '{}')
  } catch {
    return {}
  }
}

function writeNoshow(obj) {
  localStorage.setItem(NOSHOW_KEY, JSON.stringify(obj))
}

export function recordNoshow(booking) {
  const all = readNoshow()
  const phone = booking.phone
  if (!phone) return
  if (!all[phone]) all[phone] = { count: 0, dates: [] }
  all[phone].count += 1
  all[phone].dates.push({ date: booking.date, bookingId: booking.id })
  writeNoshow(all)
}

export function getNoshowCount(phone) {
  if (!phone) return 0
  return readNoshow()[phone]?.count || 0
}

export function searchNoshow(phone) {
  if (!phone) return []
  const all = readNoshow()
  return Object.entries(all)
    .filter(([k]) => k.includes(phone))
    .map(([k, v]) => ({ phone: k, ...v }))
}

// === 工具 ===
// 找出指定時段「即將到達」的訂位（用於即時通知外場）
export function listUpcoming(date, withinMinutes = 60) {
  const now = new Date()
  return listByDate(date).filter(b => {
    if (b.status !== 'confirmed') return false
    if (!b.timeSlot) return false
    const [hh, mm] = b.timeSlot.split(':').map(Number)
    const slot = new Date(now)
    slot.setHours(hh, mm, 0, 0)
    const diffMin = (slot - now) / 60000
    return diffMin >= -15 && diffMin <= withinMinutes
  }).sort((a, b) => (a.timeSlot || '').localeCompare(b.timeSlot || ''))
}

// === 匯出 CSV ===
export function exportCSV() {
  const list = read()
  const headers = ['訂位編號', '姓名', '電話', '人數', '日期', '時段', '指派桌', '寵物', '兒童', '行動不便', '備註', '來源', '狀態', '建立時間']
  const rows = list.map(b => [
    b.id, b.name, b.phone, b.guests, b.date, b.timeSlot, b.assignedTableId || '',
    b.notes?.pet ? 'Y' : '', b.notes?.child ? 'Y' : '', b.notes?.mobility ? 'Y' : '',
    b.notes?.text || '', b.source, b.status, b.createdAt
  ])
  const escape = (v) => {
    const s = String(v ?? '')
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const csv = [headers, ...rows].map(r => r.map(escape).join(',')).join('\n')
  return '﻿' + csv
}
