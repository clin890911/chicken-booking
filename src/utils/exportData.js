// 匯出中心純邏輯：散客/團體的條件過濾 + CSV 組裝（不碰 DOM / 下載）。
// 口徑備忘：
//  - 日期過濾用 YYYY-MM-DD 字串比較（與 CalendarView 的月前綴過濾同模式）
//  - 團體的旅行社/導遊一律用 agencyId/guideId 過濾；Name 欄位只是顯示快照
//  - 場次（場次=餐期）由 timeSlot 經 settings.seatings 推導，永不持久化
import { seatingForSlot } from './timeSlots'

export const BOOKING_SOURCE_LABELS = {
  online: '線上',
  phone: '電話',
  walkin: '現場',
  line: 'LINE',
}

export const BOOKING_STATUS_LABELS = {
  confirmed: '已確認',
  arrived: '已到店',
  completed: '已完成',
  cancelled: '已取消',
  noshow: '未到',
}

export const GROUP_STATUS_LABELS = {
  planned: '預排',
  confirmed: '已確認',
  arrived: '已到店',
  completed: '已完成',
  cancelled: '已取消',
}

function inDateRange(date, dateFrom, dateTo) {
  const d = String(date || '')
  if (dateFrom && d < dateFrom) return false
  if (dateTo && d > dateTo) return false
  return true
}

function seatingIdForSlot(settings, timeSlot) {
  const s = seatingForSlot(settings, timeSlot)
  return s ? s.id : ''
}

// 散客訂位過濾。filters: { dateFrom, dateTo, source, status, seatingId, settings }
// source/status/seatingId 給 'all' 或空值 = 不限。
export function filterBookings(bookings = [], filters = {}) {
  const { dateFrom, dateTo, source, status, seatingId, settings } = filters
  return bookings
    .filter(b => {
      if (!inDateRange(b.date, dateFrom, dateTo)) return false
      if (source && source !== 'all' && b.source !== source) return false
      if (status && status !== 'all' && b.status !== status) return false
      if (seatingId && seatingId !== 'all' && seatingIdForSlot(settings, b.timeSlot) !== seatingId) return false
      return true
    })
    .sort((a, b) => `${a.date || ''} ${a.timeSlot || ''}`.localeCompare(`${b.date || ''} ${b.timeSlot || ''}`))
}

// 團體預排過濾。filters: { dateFrom, dateTo, status, agencyId, guideId, seatingId, settings }
// 場次過濾以「任一梯次屬於該場次」為準。
export function filterGroups(groups = [], filters = {}) {
  const { dateFrom, dateTo, status, agencyId, guideId, seatingId, settings } = filters
  return groups
    .filter(g => {
      if (!inDateRange(g.date, dateFrom, dateTo)) return false
      if (status && status !== 'all' && g.status !== status) return false
      if (agencyId && agencyId !== 'all' && g.agencyId !== agencyId) return false
      if (guideId && guideId !== 'all' && g.guideId !== guideId) return false
      if (seatingId && seatingId !== 'all') {
        const hit = (g.batches || []).some(bt => seatingIdForSlot(settings, bt.timeSlot) === seatingId)
        if (!hit) return false
      }
      return true
    })
    .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')))
}

// 團體展平成「一梯次一列」（Excel 樞紐分析友善；團級欄位每列重複）。
export function groupBatchRows(groups = [], settings) {
  const rows = []
  for (const g of groups) {
    const batches = (g.batches || []).length ? g.batches : [{}]
    for (const bt of batches) {
      rows.push({ group: g, batch: bt, seatingId: seatingIdForSlot(settings, bt.timeSlot) })
    }
  }
  return rows.sort((a, b) =>
    `${a.group.date || ''} ${a.batch.timeSlot || ''}`.localeCompare(`${b.group.date || ''} ${b.batch.timeSlot || ''}`))
}

// CSV 跳脫與 BOM：與 bookingService.exportCSV 既有口徑一致（測試已釘死該函式，這裡沿用同規則）。
function csvEscape(v) {
  const s = String(v ?? '')
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCSV(headers, rows) {
  const csv = [headers, ...rows].map(r => r.map(csvEscape).join(',')).join('\n')
  return '\uFEFF' + csv
}

function seatingNameById(settings, id) {
  const s = (settings?.seatings || []).find(x => x.id === id)
  return s ? s.name : ''
}

// 散客 CSV：含場次與中文來源/狀態（欄位為舊版「匯出全部訂位」的超集）。
export function buildBookingsCSV(bookings, settings) {
  const headers = ['訂位編號', '日期', '時段', '場次', '姓名', '電話', '人數', '來源', '狀態', '指派桌', '寵物', '兒童', '行動不便', '備註', '建立時間']
  const rows = bookings.map(b => [
    b.id, b.date, b.timeSlot,
    seatingNameById(settings, seatingIdForSlot(settings, b.timeSlot)),
    b.name, b.phone, b.guests,
    BOOKING_SOURCE_LABELS[b.source] || b.source || '',
    BOOKING_STATUS_LABELS[b.status] || b.status || '',
    b.assignedTableId || '',
    b.notes?.pet ? 'Y' : '', b.notes?.child ? 'Y' : '', b.notes?.mobility ? 'Y' : '',
    b.notes?.text || '', b.createdAt || '',
  ])
  return toCSV(headers, rows)
}

// 團體 CSV：一梯次一列。
export function buildGroupsCSV(groups, settings) {
  const headers = [
    '團單編號', '日期', '梯次', '抵達時段', '場次', '旅行社', '導遊', '導遊電話',
    '梯次人數', '桌號', '團總人數', '素食', '兒童餐', '行動不便', '輪椅',
    '過敏備註', '桌邊需求', '遊覽車', '狀態', '團備註',
  ]
  const rows = groupBatchRows(groups, settings).map(({ group: g, batch: bt, seatingId }) => [
    g.id, g.date, bt.label || '', bt.timeSlot || '',
    seatingNameById(settings, seatingId),
    g.agencyName || '', g.guideName || '', g.guidePhone || '',
    bt.guests ?? '', (bt.tableNumbers || []).join(' '),
    g.counts?.total ?? '', g.counts?.vegetarian ?? '', g.counts?.child ?? '',
    g.counts?.mobility ?? '', g.counts?.wheelchair ?? '',
    g.allergyText || '', g.tableSideNeeds || '', g.busInfo || '',
    GROUP_STATUS_LABELS[g.status] || g.status || '',
    g.notes || '',
  ])
  return toCSV(headers, rows)
}
