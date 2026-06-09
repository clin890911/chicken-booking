// customerService：顧客檔案
// 用 phone 當主鍵，自動去重；訂位/候位建立時自動 upsert
// schema: { phone, name, lineUserId, visits, lastVisit, totalGuests, totalSpend,
//           notes, allergies, blacklisted, vipTier, archived, source, createdAt, updatedAt }
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
  // 以「只留數字」當主鍵，與 utils/validation.isValidTwPhone 一致；
  // 確保同一電話不論輸入時帶空白/連字號/括號/點號都對應同一顧客檔（正確去重）。
  return String(phone || '').replace(/\D/g, '')
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
  // normalize 去掉所有非數字，純文字查詢會變空字串；空字串不可拿去做 phone.includes（會 match 全部），
  // 故只有查詢含數字時才比對電話，否則僅以姓名比對。
  const digits = normalize(q)
  return listAll().filter(c =>
    (digits !== '' && normalize(c.phone).includes(digits)) ||
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
      archived: false,
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

// 歸檔（死帳 / 黑名單可歸檔，預設列表會隱藏）
export function archive(phone) {
  return update(phone, { archived: true })
}

export function unarchive(phone) {
  return update(phone, { archived: false })
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
