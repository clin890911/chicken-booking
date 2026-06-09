// guideService：導遊名冊
// 用隨機 id 當主鍵；agencyId 為所屬旅行社外鍵。
// schema: { id, agencyId, name, phone, lineId, note, archived, createdAt, updatedAt }
// 後端：localStorage（v1）+ 差異同步到 Firestore（cloudDataService 已註冊此集合）
const STORAGE_KEY = 'chicken_guides_v1'

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
  return 'GD' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6).toUpperCase()
}

function digits(value) {
  return String(value || '').replace(/\D/g, '')
}

// === 讀取 ===
export function listAll() {
  return read().map(g => ({
    agencyId: null,
    lineId: '',
    note: '',
    archived: false,
    ...g,
  }))
}

export function listActive() {
  return listAll().filter(g => !g.archived)
}

export function getById(id) {
  return listAll().find(g => g.id === id) || null
}

export function listByAgency(agencyId) {
  if (!agencyId) return []
  return listActive().filter(g => g.agencyId === agencyId)
}

export function getByPhone(phone) {
  const d = digits(phone)
  if (!d) return null
  return listAll().find(g => digits(g.phone) === d) || null
}

export function search(query) {
  const q = (query || '').trim().toLowerCase()
  if (!q) return listActive()
  return listAll().filter(g =>
    (g.name || '').toLowerCase().includes(q) ||
    digits(g.phone).includes(digits(q))
  )
}

// === 新增 ===
export function create(data) {
  const list = read()
  const now = new Date().toISOString()
  const guide = {
    id: uid(),
    agencyId: data.agencyId || null,
    name: data.name?.trim() || '',
    phone: data.phone?.trim() || '',
    lineId: data.lineId?.trim() || '',
    note: data.note?.trim() || '',
    archived: false,
    createdAt: now,
    updatedAt: now,
  }
  list.push(guide)
  write(list)
  return guide
}

// 依電話 upsert（同一旅行社下）：建團時若已有同電話導遊則回傳既有，否則新建
export function upsertByPhone(data) {
  const existing = getByPhone(data.phone)
  if (existing) {
    // 補綁 agencyId（舊資料可能沒填）
    if (data.agencyId && !existing.agencyId) return update(existing.id, { agencyId: data.agencyId })
    return existing
  }
  return create(data)
}

// === 更新 ===
export function update(id, patch) {
  const list = read()
  const idx = list.findIndex(g => g.id === id)
  if (idx < 0) return null
  list[idx] = { ...list[idx], ...patch, updatedAt: new Date().toISOString() }
  write(list)
  return list[idx]
}

export function archive(id) {
  return update(id, { archived: true })
}

export function unarchive(id) {
  return update(id, { archived: false })
}
