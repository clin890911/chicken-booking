// 併桌同組標示（2026-11-27 C 包，walkthrough #21）：同一組散客佔多張桌（主桌＋extraTableIds）時，
// 地圖上每張桌都標同一個小標（姓氏＋「併」），非相鄰的桌之間再畫淡色連結線——外場送餐、結帳一眼知道是同一組。
// 口徑：只算「這張桌此刻確實由這筆持有」——桌 currentBookingId＝該筆、狀態 dining／reserved、且桌號在
// bookingTableNumbers（主＋副桌）裡；團體桌（currentRef）一律排除；預配（桌仍空、只記在訂位上）不標。
// 持有的桌少於 2 張（另一張已被釋出／換走）就不標，避免標出「只剩一張的併桌」。
import { bookingTableNumbers } from './bookingTables'

const GENERIC_NAME = /^(現場|散客|訪客|客人)/

// 小標文字：「王先生」→「王・併」；通稱（現場散客／訪客…）或沒名字 →「併」（不拿通稱第一個字誤導）
export function comboLabel(name) {
  const s = String(name || '').trim()
  if (!s || GENERIC_NAME.test(s)) return '併'
  return `${[...s][0]}・併`
}

// 回傳 { [桌號]: { bookingId, label, name, tableNumbers（同組全部持有中的桌，排序）, others（同組其他桌） } }
export function comboGroupsByTable(tables = [], bookings = []) {
  const byId = new Map()
  for (const b of bookings || []) if (b?.id != null) byId.set(String(b.id), b)
  const held = new Map()
  for (const t of tables || []) {
    if (!t || t.currentRef || t.currentBookingId == null) continue
    if (!['dining', 'reserved'].includes(t.status)) continue
    const id = String(t.currentBookingId)
    const b = byId.get(id)
    if (!b || !bookingTableNumbers(b).includes(String(t.number))) continue
    if (!held.has(id)) held.set(id, [])
    held.get(id).push(String(t.number))
  }
  const out = {}
  for (const [id, nums] of held) {
    const sorted = [...new Set(nums)].sort((a, b) => a.localeCompare(b))
    if (sorted.length < 2) continue
    const b = byId.get(id)
    const label = comboLabel(b.name)
    for (const n of sorted) {
      out[n] = { bookingId: id, label, name: b.name || '', tableNumbers: sorted, others: sorted.filter(x => x !== n) }
    }
  }
  return out
}

// 連結線：同組、同樓層的桌依桌心距離串成最短的樹（每張新桌接到已連上的最近一張）。
// floorTables 用「畫面上的座標」（轉向 180° 後的那份），回傳 [{ bookingId, x1, y1, x2, y2 }]。
// 線會穿過「不屬於這組」的桌就不畫（例：101＋103 中間隔著 102，畫了會讓人以為 102 也是同一組）——那一對只靠桌上的「併」小標。
export function comboLinks(floorTables = [], comboByTable = {}) {
  const center = (t) => ({ x: (Number(t.x) || 0) + (Number(t.w) || 0) / 2, y: (Number(t.y) || 0) + (Number(t.h) || 0) / 2 })
  const groups = new Map()
  for (const t of floorTables || []) {
    const c = comboByTable[String(t.number)]
    if (!c) continue
    if (!groups.has(c.bookingId)) groups.set(c.bookingId, [])
    groups.get(c.bookingId).push({ n: String(t.number), ...center(t) })
  }
  const links = []
  for (const [bookingId, pts] of groups) {
    if (pts.length < 2) continue
    pts.sort((a, b) => a.n.localeCompare(b.n))
    const done = [pts[0]]
    const rest = pts.slice(1)
    while (rest.length) {
      let bi = 0, bj = 0, bd = Infinity
      rest.forEach((p, i) => done.forEach((q, j) => {
        const d = (p.x - q.x) ** 2 + (p.y - q.y) ** 2
        if (d < bd) { bd = d; bi = i; bj = j }
      }))
      const p = rest.splice(bi, 1)[0]
      const q = done[bj]
      const blocked = (floorTables || []).some(t => comboByTable[String(t.number)]?.bookingId !== bookingId && segmentHitsRect(q, p, t))
      if (!blocked) links.push({ bookingId, from: q.n, to: p.n, x1: q.x, y1: q.y, x2: p.x, y2: p.y })
      done.push(p)
    }
  }
  return links
}

// 線段（桌心到桌心）是否穿過另一張桌（外框內縮 2 unit，擦邊不算）：沿線每 4 unit 取樣
function segmentHitsRect(a, b, t) {
  const x0 = (Number(t.x) || 0) + 2, y0 = (Number(t.y) || 0) + 2
  const x1 = (Number(t.x) || 0) + (Number(t.w) || 0) - 2, y1 = (Number(t.y) || 0) + (Number(t.h) || 0) - 2
  const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 4))
  for (let i = 0; i <= steps; i++) {
    const x = a.x + (b.x - a.x) * (i / steps), y = a.y + (b.y - a.y) * (i / steps)
    if (x > x0 && x < x1 && y > y0 && y < y1) return true
  }
  return false
}
