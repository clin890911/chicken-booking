// bookingService：統一封裝訂位 CRUD。目前後端是 localStorage，未來切到 Firestore 只改本檔即可。
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

export function listAll() {
  return read()
}

export function listByDate(date) {
  return read().filter(b => b.date === date)
}

export function getById(id) {
  return read().find(b => b.id === id) || null
}

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
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    createdBy: data.createdBy || 'guest'
  }
  list.push(booking)
  write(list)
  return booking
}

export function update(id, patch) {
  const list = read()
  const idx = list.findIndex(b => b.id === id)
  if (idx < 0) return null
  list[idx] = { ...list[idx], ...patch, updatedAt: new Date().toISOString() }
  write(list)
  return list[idx]
}

export function remove(id) {
  const list = read().filter(b => b.id !== id)
  write(list)
}

export function setStatus(id, status) {
  const b = update(id, { status })
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

// No-show 記錄
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

// 匯出 CSV
export function exportCSV() {
  const list = read()
  const headers = ['訂位編號', '姓名', '電話', '人數', '日期', '時段', '寵物', '兒童', '行動不便', '備註', '來源', '狀態', '建立時間']
  const rows = list.map(b => [
    b.id, b.name, b.phone, b.guests, b.date, b.timeSlot,
    b.notes.pet ? 'Y' : '', b.notes.child ? 'Y' : '', b.notes.mobility ? 'Y' : '',
    b.notes.text, b.source, b.status, b.createdAt
  ])
  const escape = (v) => {
    const s = String(v ?? '')
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const csv = [headers, ...rows].map(r => r.map(escape).join(',')).join('\n')
  return '﻿' + csv
}
