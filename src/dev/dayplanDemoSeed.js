// 開發專用：「當日排位」demo 假資料（網址加 ?demo=dayplan 才會灌）。
// 注意：只在 dev 生效：main.jsx 以 import.meta.env.DEV 守住動態 import，正式 build 不會打包本檔
//    （build 後 grep dist 驗證過：dist 內沒有本檔任何字串）。
// 寫入本機 localStorage（本機開發模式＝後端），只動 DEMO- 開頭的訂位、GDEMO- 開頭的團單，其餘資料不碰。
// 內容：明天 16 筆（午餐兩批＋晚餐、已配／未配、11 人與 10 人大組、1 筆取消、1 個旅行社團）＋後天 6 筆；
//       明天 113 桌設為維修停用（示範停用桌防呆）。
import { INITIAL_TABLES } from '../data/tables'

function ymd(offset) {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function readJSON(key, fallback) {
  try { const v = JSON.parse(localStorage.getItem(key) || 'null'); return v == null ? fallback : v } catch { return fallback }
}

export function buildDayplanDemo() {
  const d1 = ymd(1)
  const d2 = ymd(2)
  let seq = 0
  const bk = (date, timeSlot, name, guests, phone, extra = {}) => ({
    id: `DEMO-${String(++seq).padStart(2, '0')}`,
    name, phone, guests, date, timeSlot,
    source: 'phone', status: 'confirmed',
    assignedTableId: null, extraTableIds: [],
    notes: {}, manageToken: `t-demo-${seq}`, createdBy: 'staff',
    createdAt: new Date().toISOString(),
    ...extra,
  })
  const bookings = [
    // 明天 午餐第一批（11:00–12:30）
    bk(d1, '11:00', '王小姐', 4, '0912000101', { assignedTableId: '105' }),
    bk(d1, '11:30', '林老師', 11, '0912000102', { notes: { text: '同事聚餐，想坐一起' } }),
    bk(d1, '11:30', '陳先生', 2, '0912000103'),
    bk(d1, '12:00', '張太太', 6, '0912000104', { assignedTableId: '101' }),
    bk(d1, '12:00', '黃先生', 3, '0912000105'),
    // 明天 午餐第二批（12:30–14:30）
    bk(d1, '12:30', '李先生', 5, '0912000106'),
    bk(d1, '13:00', '吳小姐', 2, '0912000107', { assignedTableId: '107' }),
    bk(d1, '13:00', '周家', 8, '0912000108', { notes: { text: '有一位長輩坐輪椅' } }),
    // 明天 晚餐（17:00–19:00）
    bk(d1, '17:00', '蔡先生', 4, '0912000109', { assignedTableId: '102' }),
    bk(d1, '17:30', '許小姐', 2, '0912000110'),
    bk(d1, '17:30', '劉家', 6, '0912000111'),
    bk(d1, '18:00', '楊先生', 3, '0912000112', { assignedTableId: '111' }),
    bk(d1, '18:00', '謝小姐', 10, '0912000113'),
    bk(d1, '18:30', '蕭先生', 2, '0912000114'),
    bk(d1, '18:00', '何先生', 4, '0912000115', { status: 'cancelled' }), // 取消：清單不列
    bk(d1, '11:30', '鄭小姐', 4, '0912000116', { assignedTableId: '106' }),
    // 後天
    bk(d2, '11:30', '郭先生', 4, '0912000201'),
    bk(d2, '12:00', '洪小姐', 7, '0912000202'),
    bk(d2, '12:30', '曾先生', 2, '0912000203', { assignedTableId: '112' }),
    bk(d2, '17:30', '邱家', 9, '0912000204'),
    bk(d2, '18:00', '廖小姐', 4, '0912000205', { assignedTableId: '108' }),
    bk(d2, '18:30', '賴先生', 3, '0912000206'),
  ]
  const groups = [{
    id: 'GDEMO-1', date: d1, schemaVersion: 1,
    agencyId: null, agencyName: '山水旅行社', guideId: null, guideName: '陳導遊', guidePhone: '0933000111',
    batches: [{ id: 'BTDEMO1', label: '第一梯', timeSlot: '11:30', tableNumbers: ['201', '202', '203'], guests: 18, note: '', isEscort: false, releasedAt: null }],
    counts: { total: 18, vegetarian: 2, child: 0, mobility: 0, wheelchair: 0 },
    allergyText: '', tableSideNeeds: '', busInfo: '', notes: '', spend: 0,
    status: 'confirmed', createdBy: 'staff', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  }]
  return { d1, d2, bookings, groups, outageTable: '113' }
}

export function seedDayplanDemo() {
  const { d1, bookings, groups, outageTable } = buildDayplanDemo()
  const keepB = readJSON('chicken_bookings_v1', []).filter(b => !String(b?.id || '').startsWith('DEMO-'))
  localStorage.setItem('chicken_bookings_v1', JSON.stringify([...keepB, ...bookings]))
  const keepG = readJSON('chicken_group_reservations_v1', []).filter(g => !String(g?.id || '').startsWith('GDEMO-'))
  localStorage.setItem('chicken_group_reservations_v1', JSON.stringify([...keepG, ...groups]))
  const tables = readJSON('chicken_tables_v3', null) || INITIAL_TABLES.slice()
  localStorage.setItem('chicken_tables_v3', JSON.stringify(tables.map(t => (
    String(t.number) === outageTable ? { ...t, outage: { from: d1, to: d1, reason: '冷氣維修（demo）' } } : t
  ))))
  localStorage.setItem('chicken_group_blank_purge_v1', '1')
  return { bookings: bookings.length, groups: groups.length }
}
