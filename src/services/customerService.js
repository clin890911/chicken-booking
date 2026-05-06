// customerService：顧客檔案
// 用 phone 當主鍵，自動去重；訂位/候位建立時自動 upsert
// schema: { phone, name, lineUserId, visits, lastVisit, totalGuests, totalSpend,
//           notes, allergies, blacklisted, vipTier, source, createdAt, updatedAt }
const STORAGE_KEY = 'chicken_customers_v1'

function read() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
  } catch {
    return {}
  }
}

function write(map) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(map))
}

function normalize(phone) {
  // 簡易標準化：去除空白與符號
  return (phone || '').replace(/[\s\-+]/g, '')
}

export function listAll() {
  const map = read()
  return Object.values(map).sort((a, b) => (b.lastVisit || '').localeCompare(a.lastVisit || ''))
}

export function getByPhone(phone) {
  const key = normalize(phone)
  if (!key) return null
  return read()[key] || null
}

export function search(query) {
  const q = (query || '').trim().toLowerCase()
  if (!q) return []
  return listAll().filter(c =>
    normalize(c.phone).includes(normalize(q)) ||
    (c.name || '').toLowerCase().includes(q)
  )
}

// upsert：訂位/候位/到店時呼叫
export function upsert({ phone, name, lineUserId, partySize, source, notes }) {
  const key = normalize(phone)
  if (!key) return null
  const map = read()
  const now = new Date().toISOString()
  const existing = map[key]
  const next = existing
    ? {
      ...existing,
      name: name || existing.name,
      lineUserId: lineUserId || existing.lineUserId,
      visits: (existing.visits || 0) + 1,
      lastVisit: now,
      totalGuests: (existing.totalGuests || 0) + (Number(partySize) || 0),
      updatedAt: now,
    }
    : {
      phone: key,
      name: name || '',
      lineUserId: lineUserId || null,
      visits: 1,
      lastVisit: now,
      totalGuests: Number(partySize) || 0,
      totalSpend: 0,
      notes: notes || '',
      allergies: '',
      blacklisted: false,
      vipTier: 'none', // none | bronze | silver | gold
      source: source || 'walk-in',
      createdAt: now,
      updatedAt: now,
    }
  map[key] = next
  write(map)
  return next
}

// 完整 patch
export function update(phone, patch) {
  const key = normalize(phone)
  if (!key) return null
  const map = read()
  if (!map[key]) return null
  map[key] = { ...map[key], ...patch, updatedAt: new Date().toISOString() }
  write(map)
  return map[key]
}

export function remove(phone) {
  const key = normalize(phone)
  const map = read()
  delete map[key]
  write(map)
}

// 黑名單
export function setBlacklist(phone, value, reason = '') {
  return update(phone, { blacklisted: value, blacklistReason: reason })
}

// VIP 等級
export function setVipTier(phone, tier) {
  if (!['none', 'bronze', 'silver', 'gold'].includes(tier)) return null
  return update(phone, { vipTier: tier })
}

// 統計
export function summary() {
  const all = listAll()
  return {
    total: all.length,
    vip: all.filter(c => c.vipTier !== 'none').length,
    blacklisted: all.filter(c => c.blacklisted).length,
    repeatGuests: all.filter(c => c.visits > 1).length,
  }
}
