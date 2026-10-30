// 開發專用：「現場頁需要處理提示」demo 假資料。
//   ?demo=ops       → 今天「有事」：3 組 90 分內將到、2 桌待清、3 桌用餐中、1 桌超時、候位 2 組
//   ?demo=ops-calm  → 今天「沒事」：同樣 3 桌用餐中（都還沒超時）、晚一點才有訂位，無待清／候位
// 注意：只在 dev 生效：main.jsx 以 import.meta.env.DEV 守住動態 import，正式 build 不會打包本檔。
// 寫入本機 localStorage（沙盒＝後端黑洞化），只動 OPSDEMO- 開頭的訂位、WDEMO- 開頭的候位；
// 桌況整份重設為空桌後再擺上 demo 狀態（沙盒專用，別在有真資料的瀏覽器帶這個參數）。
import { INITIAL_TABLES } from '../data/tables'

const BOOKINGS_KEY = 'chicken_bookings_v1'
const TABLES_KEY = 'chicken_tables_v3'
const WAITLIST_KEY = 'chicken_waitlist_v1'

function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function readJSON(key, fallback) {
  try { const v = JSON.parse(localStorage.getItem(key) || 'null'); return v == null ? fallback : v } catch { return fallback }
}

// 現在 + offset 分 → 'HH:MM'（取 5 分整；跨午夜就夾在 23:55，避免變成「今天 00:xx」被當成過時未到）
function slotAt(now, offsetMin) {
  const d = new Date(now + offsetMin * 60000)
  if (ymd(d) !== ymd(new Date(now))) return '23:55'
  const m = Math.round(d.getMinutes() / 5) * 5
  d.setMinutes(m, 0, 0)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
const isoAgo = (now, min) => new Date(now - min * 60000).toISOString()

export function buildOpsDemo({ calm = false, now = Date.now() } = {}) {
  const today = ymd(new Date(now))
  let seq = 0
  const bk = (timeSlot, name, guests, phone, extra = {}) => ({
    id: `OPSDEMO-${String(++seq).padStart(2, '0')}`,
    name, phone, guests, date: today, timeSlot,
    source: 'phone', status: 'confirmed',
    assignedTableId: null, extraTableIds: [],
    notes: {}, manageToken: `t-opsdemo-${seq}`, createdBy: 'staff',
    createdAt: new Date(now).toISOString(),
    ...extra,
  })
  // 用餐中（入座 20／35／50 分前，都還沒超時）
  const diningSpec = [['103', '林先生', 5, 35], ['107', '王小姐', 3, 20], ['202', '陳家', 6, 50]]
  const bookings = diningSpec.map(([table, name, guests, ago], i) => bk(slotAt(now, -ago), name, guests, `09120003${i}0`, {
    source: 'walkin', status: 'arrived', assignedTableId: table, actualArrivalTime: isoAgo(now, ago),
  }))
  const tableState = {}
  diningSpec.forEach(([table, , , ago], i) => {
    tableState[table] = { status: 'dining', currentBookingId: bookings[i].id, seatedAt: isoAgo(now, ago), updatedAt: isoAgo(now, ago) }
  })
  // 晚一點的訂位（> 90 分，兩種狀態都有，沒事時店員也看得到今日訂位）
  bookings.push(bk(slotAt(now, 150), '黃先生', 4, '0912000401'))
  bookings.push(bk(slotAt(now, 200), '趙小姐', 2, '0912000402'))

  const waitlist = []
  if (!calm) {
    // 超時：坐了 130 分（用餐 90＋緩衝 10 都過了）
    const over = bk(slotAt(now, -130), '周先生', 4, '0912000301', {
      source: 'walkin', status: 'arrived', assignedTableId: '110', actualArrivalTime: isoAgo(now, 130),
    })
    bookings.push(over)
    tableState['110'] = { status: 'dining', currentBookingId: over.id, seatedAt: isoAgo(now, 130), updatedAt: isoAgo(now, 130) }
    // 待清：兩桌（112 較早變待清 → 點「2 桌待清」先開 112）
    tableState['112'] = { status: 'cleaning', updatedAt: isoAgo(now, 12) }
    tableState['205'] = { status: 'cleaning', updatedAt: isoAgo(now, 4) }
    // 90 分內將到：3 組（第一組已預配 105，報到列會出現「到了」）
    bookings.push(bk(slotAt(now, 20), '吳小姐', 4, '0912000501', { assignedTableId: '105' }))
    bookings.push(bk(slotAt(now, 45), '張先生', 2, '0912000502'))
    bookings.push(bk(slotAt(now, 75), '李家', 6, '0912000503'))
    // 候位：一組等待中、一組已叫號
    const w = (n, name, partySize, ago, extra = {}) => ({
      id: `WDEMO-${n}`, queueNumber: n, takenAt: isoAgo(now, ago), name, phone: '', partySize,
      lineUserId: null, estimatedMin: 20, status: 'waiting',
      calledAt: null, seatedAt: null, leftAt: null, assignedTableNumber: null, notes: '', ...extra,
    })
    waitlist.push(w(1, '何先生', 4, 15, { status: 'called', calledAt: isoAgo(now, 3) }))
    waitlist.push(w(2, '郭小姐', 2, 6))
  }
  return { today, bookings, tableState, waitlist }
}

export function seedOpsDemo({ calm = false } = {}) {
  const { bookings, tableState, waitlist } = buildOpsDemo({ calm })
  const keepB = readJSON(BOOKINGS_KEY, []).filter(b => !String(b?.id || '').startsWith('OPSDEMO-'))
  localStorage.setItem(BOOKINGS_KEY, JSON.stringify([...keepB, ...bookings]))
  const tables = readJSON(TABLES_KEY, null) || INITIAL_TABLES.slice()
  localStorage.setItem(TABLES_KEY, JSON.stringify(tables.map(t => ({
    ...t, status: 'vacant', currentBookingId: null, currentRef: null, seatedAt: null,
    ...(tableState[String(t.number)] || {}),
  }))))
  const keepW = readJSON(WAITLIST_KEY, []).filter(x => !String(x?.id || '').startsWith('WDEMO-'))
  localStorage.setItem(WAITLIST_KEY, JSON.stringify([...keepW, ...waitlist]))
  localStorage.setItem('chicken_group_blank_purge_v1', '1')
  return { bookings: bookings.length, waitlist: waitlist.length }
}
