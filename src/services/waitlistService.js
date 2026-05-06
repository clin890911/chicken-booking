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
  const today = new Date().toISOString().slice(0, 10)
  const todayCount = list.filter(w => (w.takenAt || '').slice(0, 10) === today).length
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
export function call(id) {
  return update(id, { status: 'called', calledAt: new Date().toISOString() })
}

// 入座（綁桌）— 從候位變成 dining
export function seat(id, tableNumber) {
  return update(id, {
    status: 'seated',
    seatedAt: new Date().toISOString(),
    assignedTableNumber: tableNumber,
  })
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
