import { formatDate, todayStr } from '../utils/timeSlots'
import { splitFields } from '../utils/partySplit'
// waitlistService：候位記錄管理
// 使用情境：客人現場到店、桌位已滿，門口取號加入候位
// schema: { id, takenAt, name, phone, partySize, lineUserId, estimatedMin,
//           status: 'waiting'|'called'|'seated'|'left',
//           calledAt, seatedAt, leftAt, assignedTableNumber, notes }
const STORAGE_KEY = 'chicken_waitlist_v1'

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
  return 'W' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5).toUpperCase()
}

function nextNumber(list) {
  // 取號：今日已取號數量 + 1
  const today = todayStr()
  const todayCount = list.filter(w => waitlistDay(w) === today).length
  return todayCount + 1
}

export function listAll() {
  return read()
}

export function listActive() {
  return read().filter(w => w.status === 'waiting' || w.status === 'called')
}

export function getById(id) {
  return read().find(w => w.id === id) || null
}

export function create(data) {
  const list = read()
  const item = {
    id: uid(),
    queueNumber: nextNumber(list),
    takenAt: new Date().toISOString(),
    name: (data.name || '').trim() || '訪客',
    phone: (data.phone || '').trim(),
    partySize: Number(data.partySize) || 2,
    ...splitFields(Number(data.partySize) || 2, data.children), // 大人／小孩（選填，partySize = 兩者相加）
    lineUserId: data.lineUserId || null,
    estimatedMin: Number(data.estimatedMin) || 20,
    status: 'waiting',
    calledAt: null,
    seatedAt: null,
    leftAt: null,
    assignedTableNumber: null,
    notes: data.notes || '',
  }
  list.push(item)
  write(list)
  return item
}

export function update(id, patch) {
  const list = read()
  const idx = list.findIndex(w => w.id === id)
  if (idx < 0) return null
  list[idx] = { ...list[idx], ...patch }
  write(list)
  return list[idx]
}

export function remove(id) {
  write(read().filter(w => w.id !== id))
}

// 叫號（即將上桌）— 推 LINE 通知用
export function waitlistDay(w) {
  const at=new Date(w?.takenAt)
  return Number.isNaN(at.getTime())?'':formatDate(at)
}
export function isSeatEligible(w) {
  return !!w && ['waiting','called'].includes(w.status) && waitlistDay(w)===todayStr()
}
export function call(id) {
  if (!isSeatEligible(getById(id))) return null
  return update(id, { status: 'called', calledAt: new Date().toISOString() })
}

// 入座（綁桌）— 從候位變成 dining
export function seat(id, tableNumber) {
  if (!isSeatEligible(getById(id))) return null
  return update(id, {
    status: 'seated',
    seatedAt: new Date().toISOString(),
    assignedTableNumber: tableNumber,
  })
}

// 候位轉訂位：訂位建好後把候位結掉用的原因（與一般棄號區分）
export const LEAVE_REASON_CONVERTED = 'converted'
// 預估等待顯示：超過 90 分的精確分鐘數沒意義（組數×估時只是粗估），改顯示「等待較久」
export const LONG_WAIT_MIN = 90
export function formatEstWait(min, prefix = '') {
  const n = Number(min)
  if (!Number.isFinite(n)) return ''
  return n > LONG_WAIT_MIN ? '等待較久' : `${prefix}${n} 分`
}
// 候位轉訂位的備註與收尾：訂位建立成功才結掉候位；失敗（ok:false）不動候位。
// leaveWaitlist 為 BookingContext 的棄號 transition（目前只收 id；reason 先隨參數帶上，後端支援後即生效）。
export function convertNote(w) { return `由候位 #${w?.queueNumber ?? ''} 轉入` }
export async function finishConvertedWaitlist(waitlistId, saveResult, leaveWaitlist) {
  if (!waitlistId || !saveResult?.ok) return { skipped: true }
  return leaveWaitlist(waitlistId, undefined, LEAVE_REASON_CONVERTED)
}

// 棄號（客人離開不等了）
export function leave(id) {
  return update(id, { status: 'left', leftAt: new Date().toISOString() })
}

// 預估等待時間（依目前候位數 × 平均等待時間）
export function estimateWait(activeCount, avgMin = 8) {
  return activeCount * avgMin
}

// 統計
export function summary() {
  const all = read()
  const waiting = all.filter(w => w.status === 'waiting').length
  const called = all.filter(w => w.status === 'called').length
  const seated = all.filter(w => w.status === 'seated').length
  return { waiting, called, seated, active: waiting + called }
}
