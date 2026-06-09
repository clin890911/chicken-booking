// groupReservationService：旅行社團體預排單
// 用隨機 id 當主鍵。一張團單 = 一個旅行社/導遊 + 一個日期 + 一到多個梯次(batch) + 人數結構。
// schema:
// { id, date, schemaVersion, agencyId, guideId, agencyName, guideName, guidePhone,
//   batches:[{ id, label, timeSlot, tableNumbers:[], guests, note }],
//   counts:{ total, vegetarian, child, mobility, wheelchair },
//   allergyText, tableSideNeeds, busInfo, notes, spend, status,
//   createdBy, createdAt, updatedAt }
// 重要規則：
//  - 所有彙算/關聯一律用 agencyId/guideId；agencyName/guideName/guidePhone 僅供顯示快照。
//  - 團體生命週期內永不建立任何 booking 文件（避免與容量整桌扣除雙扣）。
//  - 容量採「嚴格扣整桌」：見 utils/capacity.js 的 groupHeldSeats / groupOccupancyWindow。
import {
  occupancyMinutes,
  groupOccupancyWindow,
  groupTableNumbers,
  toMinutes,
  CAPACITY_EXCLUDED_STATUSES,
} from '../utils/capacity'

const STORAGE_KEY = 'chicken_group_reservations_v1'
export const GROUP_SCHEMA_VERSION = 1

export const GROUP_STATUSES = ['planned', 'confirmed', 'arrived', 'completed', 'cancelled']

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
  return 'G' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6).toUpperCase()
}

function batchUid() {
  return 'BT' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5).toUpperCase()
}

function normalizeCounts(counts = {}) {
  return {
    total: Number(counts.total) || 0,
    vegetarian: Number(counts.vegetarian) || 0,
    child: Number(counts.child) || 0,
    mobility: Number(counts.mobility) || 0,
    wheelchair: Number(counts.wheelchair) || 0,
  }
}

function normalizeBatch(b = {}) {
  return {
    id: b.id || batchUid(),
    label: b.label || '第一梯',
    timeSlot: b.timeSlot || '11:00',
    tableNumbers: Array.isArray(b.tableNumbers) ? b.tableNumbers.map(String) : [],
    guests: Number(b.guests) || 0,
    note: b.note || '',
  }
}

// === 讀取 ===
export function listAll() {
  return read().map(g => ({
    schemaVersion: GROUP_SCHEMA_VERSION,
    agencyId: null,
    guideId: null,
    agencyName: '',
    guideName: '',
    guidePhone: '',
    allergyText: '',
    tableSideNeeds: '',
    busInfo: '',
    notes: '',
    spend: 0,
    status: 'planned',
    ...g,
    batches: Array.isArray(g.batches) ? g.batches.map(normalizeBatch) : [],
    counts: normalizeCounts(g.counts),
  }))
}

export function getById(id) {
  return listAll().find(g => g.id === id) || null
}

export function listByDate(date) {
  return listAll().filter(g => g.date === date)
}

// 某日「仍佔位」的團（排除 cancelled/completed）— 給今日疊加與容量推導用
export function listActiveByDate(date) {
  return listByDate(date).filter(g => !CAPACITY_EXCLUDED_STATUSES.includes(g.status))
}

// === 新增 ===
export function create(data) {
  const list = read()
  const now = new Date().toISOString()
  const batches = (Array.isArray(data.batches) && data.batches.length
    ? data.batches
    : [{ label: '第一梯', timeSlot: data.timeSlot || '11:00', tableNumbers: [], guests: data.counts?.total || 0 }]
  ).map(normalizeBatch)

  const group = {
    id: uid(),
    date: data.date,
    schemaVersion: GROUP_SCHEMA_VERSION,
    agencyId: data.agencyId || null,
    guideId: data.guideId || null,
    agencyName: data.agencyName?.trim() || '',
    guideName: data.guideName?.trim() || '',
    guidePhone: data.guidePhone?.trim() || '',
    batches,
    counts: normalizeCounts(data.counts),
    allergyText: data.allergyText?.trim() || '',
    tableSideNeeds: data.tableSideNeeds?.trim() || '',
    busInfo: data.busInfo?.trim() || '',
    notes: data.notes?.trim() || '',
    spend: Number(data.spend) || 0,
    status: data.status || 'planned',
    createdBy: data.createdBy || 'staff',
    createdAt: now,
    updatedAt: now,
  }
  list.push(group)
  write(list)
  return group
}

// === 更新 ===
export function update(id, patch) {
  const list = read()
  const idx = list.findIndex(g => g.id === id)
  if (idx < 0) return null
  const next = { ...list[idx], ...patch, updatedAt: new Date().toISOString() }
  if (patch.batches) next.batches = patch.batches.map(normalizeBatch)
  if (patch.counts) next.counts = normalizeCounts(patch.counts)
  list[idx] = next
  write(list)
  return next
}

export function setStatus(id, status) {
  if (!GROUP_STATUSES.includes(status)) return null
  return update(id, { status })
}

export function remove(id) {
  write(read().filter(g => g.id !== id))
}

// === 梯次（batch）操作 ===
export function setBatchTables(id, batchId, tableNumbers) {
  const group = getById(id)
  if (!group) return null
  const batches = group.batches.map(b =>
    b.id === batchId ? { ...b, tableNumbers: tableNumbers.map(String) } : b
  )
  return update(id, { batches })
}

// === 平面圖規劃：桌位衝突偵測（前端即時提示；後端 groupReserveTables 為原子真相）===
// 回傳 { tableNumber: { type, ... } }，列出在同日、時間窗與 candidateTimeSlot 重疊而不可選的桌號：
//   - type:'group'   其他團佔用（{ groupId, agencyName, label }）
//   - type:'booking' 一般訂位已指派桌（{ bookingId, name }）
// excludeGroupId 為正在編輯的本團；bookings 由呼叫端（含 context）傳入做一般訂位衝突檢查。
export function tableConflictsForBatch({ date, timeSlot, settings = {}, excludeGroupId = null, bookings = [] }) {
  const durationMin = occupancyMinutes(settings)
  const candStart = toMinutes(timeSlot)
  const candEnd = candStart + durationMin
  const overlaps = (s) => s < candEnd && candStart < s + durationMin
  const conflicts = {}

  // 1) 其他團佔用
  listActiveByDate(date).forEach(g => {
    if (g.id === excludeGroupId) return
    g.batches.forEach(b => {
      if (!overlaps(toMinutes(b.timeSlot))) return
      ;(b.tableNumbers || []).forEach(n => {
        if (!conflicts[n]) conflicts[n] = { type: 'group', groupId: g.id, agencyName: g.agencyName, label: b.label }
      })
    })
  })

  // 2) 一般訂位已指派桌（同日、時間窗重疊、未取消/未到/未完成）
  ;(bookings || []).forEach(b => {
    if (b.date !== date || !b.assignedTableId) return
    if (CAPACITY_EXCLUDED_STATUSES.includes(b.status)) return
    if (!overlaps(toMinutes(b.timeSlot))) return
    const n = String(b.assignedTableId)
    if (!conflicts[n]) conflicts[n] = { type: 'booking', bookingId: b.id, name: b.name }
  })

  return conflicts
}

// 是否為「未完成的空白草稿」：無旅行社、總人數 0、未圈任何桌。
// 用於防止連點「新增團單」產生多筆空白團單（已有空白草稿則改為選取它）。
export function isBlankGroup(g) {
  return !!g && !g.agencyId && !(g.agencyName || '').trim() &&
    (g.counts?.total || 0) === 0 && groupTableNumbers(g).length === 0
}

// 儲存前驗證（純函式，供 UI 與測試共用）。回傳錯誤訊息字串；null = 通過。
// capByNum: { 桌號: 容量 } 用來計算各梯/全團保留席數。
export function validateGroupForSave(group, capByNum = {}) {
  if (!group) return '尚未選取團單'
  if (!group.agencyId && !(group.agencyName || '').trim()) return '請選擇或新增旅行社'
  const total = Number(group.counts?.total) || 0
  if (total <= 0) return '請填寫總人數（需大於 0）'
  const batches = group.batches || []
  if (!batches.length) return '請至少新增一個梯次'
  const seatsOf = (nums) => (nums || []).reduce((s, n) => s + (Number(capByNum[n]) || 0), 0)
  for (const b of batches) {
    if ((Number(b.guests) || 0) <= 0) return `「${b.label}」用餐人數需大於 0`
    if (!(b.tableNumbers || []).length) return `「${b.label}」請至少圈一桌`
    const seats = seatsOf(b.tableNumbers)
    if ((Number(b.guests) || 0) > seats) return `「${b.label}」人數 ${b.guests} 超過該梯保留席數 ${seats}，請再多圈桌`
  }
  const held = seatsOf(groupTableNumbers(group))
  if (held <= 0) return '請至少圈一桌'
  // 單梯：總人數不可超過保留席數（坐不下）。多梯次（兩段用餐）允許輪替，由 UI 端提示。
  if (batches.length === 1 && total > held) return `總人數 ${total} 超過保留席數 ${held}，請多圈桌或調整人數`
  return null
}

// 某日已被任何團佔用的桌號集合（給今日疊加顯示用）
export function tablesHeldOnDate(date) {
  const map = {}
  listActiveByDate(date).forEach(g => {
    groupTableNumbers(g).forEach(n => {
      if (!map[n]) map[n] = { groupId: g.id, agencyName: g.agencyName }
    })
  })
  return map
}

// === 歷史彙算（即時，不用計數器；用 id 關聯，禁用名稱字串 join）===
function statsFor(predicate) {
  const groups = listAll().filter(g => g.status !== 'cancelled').filter(predicate)
  const totalGuests = groups.reduce((s, g) => s + (Number(g.counts?.total) || 0), 0)
  const totalSpend = groups.reduce((s, g) => s + (Number(g.spend) || 0), 0)
  const lastVisit = groups.reduce((acc, g) => (g.date > acc ? g.date : acc), '')
  return {
    visits: groups.length,
    totalGuests,
    totalSpend,
    lastVisit,
    history: groups.slice().sort((a, b) => (b.date || '').localeCompare(a.date || '')),
  }
}

export function statsForAgency(agencyId) {
  return statsFor(g => g.agencyId === agencyId)
}

export function statsForGuide(guideId) {
  return statsFor(g => g.guideId === guideId)
}

// 旅行社貢獻排名（依 totalSpend 由大到小）
export function agencyContributionRanking() {
  const byAgency = {}
  listAll().filter(g => g.status !== 'cancelled' && g.agencyId).forEach(g => {
    const a = byAgency[g.agencyId] || { agencyId: g.agencyId, agencyName: g.agencyName, visits: 0, totalGuests: 0, totalSpend: 0, lastVisit: '' }
    a.visits += 1
    a.totalGuests += Number(g.counts?.total) || 0
    a.totalSpend += Number(g.spend) || 0
    if (g.date > a.lastVisit) a.lastVisit = g.date
    a.agencyName = g.agencyName || a.agencyName
    byAgency[g.agencyId] = a
  })
  return Object.values(byAgency).sort((a, b) => b.totalSpend - a.totalSpend)
}
