// 現場自動化留痕：系統自動動作（超時釋桌、換日掃除）的本機紀錄。
// 操作者要能回答「這桌怎麼自己空了」——toast 會過期，這裡留可查的痕跡。
// 本機 localStorage、cap 200 筆；不上雲（上雲需動 functions 集合白名單，列後續增強）。

const STORAGE_KEY = 'chicken_ops_log_v1'
const CAP = 200

function read() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const list = raw ? JSON.parse(raw) : []
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

function write(list) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, CAP)))
}

// entry: { kind: 'auto-release' | 'day-rollover', message, tableNumber?, bookingId?, groupId?, minutes? }
export function append(entry) {
  const e = {
    id: `OL${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    at: new Date().toISOString(),
    ...entry,
  }
  write([e, ...read()])
  return e
}

export function listAll() {
  return read()
}

// 今日（本機日期字串 YYYY-MM-DD）的紀錄
export function listToday(today) {
  return read().filter(e => String(e.at || '').slice(0, 10) === today)
}

export function clearAll() {
  localStorage.removeItem(STORAGE_KEY)
}
