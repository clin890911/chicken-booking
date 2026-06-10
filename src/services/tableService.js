// tableService：桌位 CRUD + 即時運營狀態管理
// schema: { number, capacity, floor, x, y, w, h, isActive,
//           status, currentBookingId, seatedAt, mergedWith, blockReason, updatedAt }
import { INITIAL_TABLES, tableDims } from '../data/tables'

const STORAGE_KEY = 'chicken_tables_v3'   // v3: 改為「雞王座號圖」桌號（101–113 / 201–267）
const LEGACY_KEYS = ['chicken_tables_v2', 'chicken_tables_v1']

function read() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      // 第一次載入（或升級到新桌號圖）：寫入新版預設
      localStorage.setItem(STORAGE_KEY, JSON.stringify(INITIAL_TABLES))
      // 清掉舊版桌號（A1–B19），避免與新桌號（101–267）混淆
      try { LEGACY_KEYS.forEach(k => localStorage.removeItem(k)) } catch {}
      return INITIAL_TABLES.slice()
    }
    const parsed = JSON.parse(raw)
    // 防呆：若舊資料缺欄位，補上預設值
    return parsed.map(t => ({
      isActive: true,
      status: 'vacant',
      currentBookingId: null,
      currentRef: null,      // 團體梯次入座時 = { type:'group', groupId, batchId }
      seatedAt: null,
      mergedWith: null,
      blockReason: null,
      updatedAt: null,
      ...t
    }))
  } catch {
    return INITIAL_TABLES.slice()
  }
}

function write(list) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list))
}

function patchOne(number, patch) {
  const list = read()
  const idx = list.findIndex(t => t.number === number)
  if (idx < 0) return null
  list[idx] = { ...list[idx], ...patch, updatedAt: new Date().toISOString() }
  write(list)
  return list[idx]
}

// === 讀取 ===
export function listAll() {
  return read()
}

export function getByNumber(number) {
  return read().find(t => t.number === number) || null
}

export function listByFloor(floor) {
  return read().filter(t => t.floor === floor)
}

// === 啟用/停用 ===
export function toggle(number) {
  const t = getByNumber(number)
  if (!t) return null
  return patchOne(number, { isActive: !t.isActive })
}

export function setActive(number, isActive) {
  return patchOne(number, { isActive })
}

// === 即時狀態（vacant / reserved / dining / cleaning / blocked）===
export function setStatus(number, status, extra = {}) {
  return patchOne(number, { status, ...extra })
}

// 入座：標記 dining + 連到 booking
export function seatTable(number, bookingId) {
  return patchOne(number, {
    status: 'dining',
    currentBookingId: bookingId,
    currentRef: null,
    seatedAt: new Date().toISOString(),
  })
}

// 團體梯次入座：標記 dining + 連到 group/batch（currentBookingId 清空，避免與散客 booking 混淆）
export function seatTableForGroup(number, groupId, batchId) {
  return patchOne(number, {
    status: 'dining',
    currentBookingId: null,
    currentRef: { type: 'group', groupId, batchId },
    seatedAt: new Date().toISOString(),
  })
}

// 預約：標記 reserved + 連到 booking
export function reserveTable(number, bookingId) {
  return patchOne(number, {
    status: 'reserved',
    currentBookingId: bookingId,
    currentRef: null,
    seatedAt: null,
  })
}

// 結帳離席：dining → cleaning
export function checkoutTable(number) {
  return patchOne(number, {
    status: 'cleaning',
    seatedAt: null,
  })
}

// 清桌完成：cleaning → vacant + 解除 booking / group 綁定
export function clearTable(number) {
  return patchOne(number, {
    status: 'vacant',
    currentBookingId: null,
    currentRef: null,
    seatedAt: null,
  })
}

// 設為不可用 / 恢復可用
export function blockTable(number, reason = '臨時保留') {
  return patchOne(number, { status: 'blocked', blockReason: reason })
}

export function unblockTable(number) {
  return patchOne(number, { status: 'vacant', blockReason: null })
}

// === 併桌 ===
export function mergeTables(numberA, numberB) {
  const list = read()
  const a = list.find(t => t.number === numberA)
  const b = list.find(t => t.number === numberB)
  if (!a || !b) return { ok: false, error: '桌位不存在' }
  if (a.floor !== b.floor) return { ok: false, error: '不同樓層無法併桌' }
  // 距離檢查（避免亂選）
  const dx = Math.abs((a.x + a.w / 2) - (b.x + b.w / 2))
  const dy = Math.abs((a.y + a.h / 2) - (b.y + b.h / 2))
  if (dx > 200 && dy > 200) return { ok: false, error: '兩桌距離過遠' }
  patchOne(numberA, { mergedWith: numberB })
  patchOne(numberB, { mergedWith: numberA })
  return { ok: true, totalCapacity: a.capacity + b.capacity }
}

export function unmergeTable(number) {
  const t = getByNumber(number)
  if (!t || !t.mergedWith) return null
  const partner = t.mergedWith
  patchOne(number, { mergedWith: null })
  patchOne(partner, { mergedWith: null })
  return t
}

// === 統計 ===
export function summary() {
  const list = read()
  const counts = { vacant: 0, reserved: 0, dining: 0, cleaning: 0, blocked: 0 }
  let occupiedSeats = 0
  list.forEach(t => {
    if (!t.isActive) return
    counts[t.status] = (counts[t.status] || 0) + 1
    if (t.status === 'dining') occupiedSeats += t.capacity
  })
  return { counts, occupiedSeats, total: list.filter(t => t.isActive).length }
}

// === 重設 ===
export function reset() {
  write(INITIAL_TABLES.slice())
}

// === 編輯桌位位置（後台設定用）===
export function updatePosition(number, { x, y, w, h }) {
  return patchOne(number, { x, y, w, h })
}

// === 批次寫入（編輯器存檔用）===
export function bulkWrite(list) {
  write(list)
}

// === 新增桌位 ===
// 自動分配下一個可用桌號（依 capacity：4 人 = A 系列、6 人 = B 系列）
export function addTable({ capacity = 4, floor = '1F', x = 200, y = 200 }) {
  const list = read()
  const prefix = capacity === 6 ? 'B' : 'A'
  const usedNumbers = new Set(list.filter(t => t.number.startsWith(prefix)).map(t => parseInt(t.number.slice(1), 10)).filter(n => !isNaN(n)))
  let n = 1
  while (usedNumbers.has(n)) n++
  const newTable = {
    number: `${prefix}${n}`,
    capacity,
    floor,
    x, y,
    ...tableDims(capacity),
    isActive: true,
    status: 'vacant',
    currentBookingId: null,
    seatedAt: null,
    mergedWith: null,
    blockReason: null,
    updatedAt: new Date().toISOString(),
  }
  list.push(newTable)
  write(list)
  return newTable
}

// === 刪除桌位 ===
export function removeTable(number) {
  const list = read()
  const target = list.find(t => t.number === number)
  if (!target) return { ok: false, error: '桌位不存在' }
  if (target.currentBookingId) return { ok: false, error: '此桌目前有訂位/用餐，無法刪除' }
  write(list.filter(t => t.number !== number))
  return { ok: true }
}
