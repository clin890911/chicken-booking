// agencyService：旅行社名冊
// 用隨機 id 當主鍵（旅行社可能換電話、共用市話、無電話，故不用 phone 當鍵）。
// schema: { id, name, phone, contactName, lineId, note, blacklisted, archived, createdAt, updatedAt }
// 後端：localStorage（v1）+ 差異同步到 Firestore（cloudDataService 已註冊此集合）
const STORAGE_KEY = 'chicken_agencies_v1'

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
  return 'AG' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6).toUpperCase()
}

function digits(value) {
  return String(value || '').replace(/\D/g, '')
}

// === 讀取 ===
export function listAll() {
  // 補上新欄位的預設值（向後相容）
  return read().map(a => ({
    contactName: '',
    lineId: '',
    note: '',
    blacklisted: false,
    archived: false,
    ...a,
  }))
}

// 未封存的旅行社（名冊／下拉預設只顯示這些）
export function listActive() {
  return listAll().filter(a => !a.archived)
}

export function getById(id) {
  return listAll().find(a => a.id === id) || null
}

// 用電話找旅行社（建團 smart-fill 用；比對純數字）
export function getByPhone(phone) {
  const d = digits(phone)
  if (!d) return null
  return listAll().find(a => digits(a.phone) === d) || null
}

export function search(query) {
  const q = (query || '').trim().toLowerCase()
  if (!q) return listActive()
  return listAll().filter(a =>
    (a.name || '').toLowerCase().includes(q) ||
    digits(a.phone).includes(digits(q)) ||
    (a.contactName || '').toLowerCase().includes(q)
  )
}

// === 新增 ===
export function create(data) {
  const list = read()
  const now = new Date().toISOString()
  const agency = {
    id: uid(),
    name: data.name?.trim() || '',
    phone: data.phone?.trim() || '',
    contactName: data.contactName?.trim() || '',
    lineId: data.lineId?.trim() || '',
    note: data.note?.trim() || '',
    blacklisted: !!data.blacklisted,
    archived: false,
    createdAt: now,
    updatedAt: now,
  }
  list.push(agency)
  write(list)
  return agency
}

// 依電話 upsert：建團時若已有同電話旅行社則回傳既有，否則新建
export function upsertByPhone(data) {
  const existing = getByPhone(data.phone)
  if (existing) return existing
  return create(data)
}

// === 更新 ===
export function update(id, patch) {
  const list = read()
  const idx = list.findIndex(a => a.id === id)
  if (idx < 0) return null
  list[idx] = { ...list[idx], ...patch, updatedAt: new Date().toISOString() }
  write(list)
  return list[idx]
}

// 軟刪（保 guides / groupReservations 外鍵完整）
export function archive(id) {
  return update(id, { archived: true })
}

export function unarchive(id) {
  return update(id, { archived: false })
}

export function setBlacklist(id, value) {
  return update(id, { blacklisted: !!value })
}
