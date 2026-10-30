// 現場頁「需要處理」提示（B 方案，Barry 2026-10-30）＋摘要分頁的全店管理數字。
// 純函式、注入 now 可單測；OpsHintBar（提示）與 OperationsView 摘要分頁（管理數字）共用。
//
// 取捨：原本頂端有兩處數字——「全店」六格統計列＋OpsHintBar 提示列，一半互相重複
// （可入座＝樓層鈕「可坐 N」、待清＝提示列、候位＝候位籤徽章），用餐中／在席人數看了也不會採取動作。
// 現在只留一條「需要處理」：數字是 0 的不出現；全部是 0 → 整條不渲染（平常完全不顯示）。
import { diffMin, stageOf } from './diningStage'
import { dayPhase } from './dayPhase'
import { diningTablePresentation } from './tableStatus'
import { isTableUsableOnDate } from './tableAvailability'

// 時間欄最舊的一筆（缺時間的排最後；同時間依桌號，結果穩定可預期）
function oldestBy(list, timeOf) {
  const ts = (t) => { const v = new Date(timeOf(t) || '').getTime(); return Number.isFinite(v) ? v : Infinity }
  return [...list].sort((a, b) => ts(a) - ts(b) || String(a.number).localeCompare(String(b.number)))[0]
}

const activeWaitlist = (waitlist) => (waitlist || []).filter(w => w.status === 'waiting' || w.status === 'called')
export function activeWaitlistCount(waitlist) { return activeWaitlist(waitlist).length }
const sumGuests = (list, key = 'guests') => list.reduce((s, x) => s + (Number(x?.[key]) || 0), 0)

// 需要處理的項目，依急迫度排序；數字 0 的不列。
// 每項：label（小字）＋count（大字）＋unit（小字）＋people（選填，「· N 人」）；text＝一句話版本（無障礙／測試用）。
// action：open-upcoming（今日訂位籤）｜open-table（打開那桌抽屜）｜open-waitlist（候位籤）
export function pickOpsAlerts({ pulse, tables, settings, waitlist, now }) {
  const alerts = []
  const p = pulse || { overdue: [], soon: [] }
  if (p.overdue?.length) {
    alerts.push({ key: 'overdue', level: 'danger', label: '過時未到', count: p.overdue.length, unit: '組', people: sumGuests(p.overdue),
      text: `過時未到 ${p.overdue.length} 組`, action: 'open-upcoming',
      title: '已過預約時間仍未到：點開今日訂位，聯絡或標記' })
  }
  // 刻意不過濾 isActive/outage：停用或維修中但仍佔用的桌（不一致狀態）更需要被提示處理。
  const overtime = (tables || []).filter(t => t.status === 'dining' && t.seatedAt
    && ['overtime', 'buffer-overtime'].includes(stageOf(diffMin(t.seatedAt, now), settings)))
  // 「N 桌超時／待清」點了直接處理：帶出最該先處理的那一桌（打開它的桌況抽屜）。
  // 超時＝坐最久的；待清＝最早變成待清的（updatedAt 最舊）。處理完 N−1，再點一次就是下一桌。
  if (overtime.length) {
    const first = oldestBy(overtime, t => t.seatedAt)
    alerts.push({ key: 'overtime', level: 'danger', label: '超時', count: overtime.length, unit: '桌',
      text: `超時 ${overtime.length} 桌`, action: 'open-table',
      tableNumber: String(first.number), title: `已超時用餐，可禮貌詢問結帳：點開 ${first.number}` })
  }
  if (p.soon?.length) {
    alerts.push({ key: 'soon', level: 'info', label: '將到', count: p.soon.length, unit: '組', people: sumGuests(p.soon),
      text: `將到 ${p.soon.length} 組（90 分內）`, action: 'open-upcoming',
      title: '點開今日訂位（地圖下方報到列也看得到）' })
  }
  const cleaning = (tables || []).filter(t => t.status === 'cleaning')
  if (cleaning.length) {
    const first = oldestBy(cleaning, t => t.updatedAt)
    alerts.push({ key: 'cleaning', level: 'warn', label: '待清', count: cleaning.length, unit: '桌',
      text: `待清 ${cleaning.length} 桌`, action: 'open-table',
      tableNumber: String(first.number), title: `點開最早待清的 ${first.number}` })
  }
  const w = activeWaitlist(waitlist)
  if (w.length) {
    alerts.push({ key: 'waitlist', level: 'queue', label: '候位', count: w.length, unit: '組', people: sumGuests(w, 'partySize'),
      text: `候位 ${w.length} 組`, action: 'open-waitlist', title: '點開候位' })
  }
  // 無障礙名稱（螢幕閱讀器／語音控制）：「超時 1 桌，點擊開啟 107」——先講是什麼、幾件，再講點了會去哪
  const dest = (a) => a.action === 'open-table' ? `點擊開啟 ${a.tableNumber}`
    : a.action === 'open-waitlist' ? '點擊開啟候位' : '點擊開啟今日訂位'
  return alerts.map(a => ({ ...a, ariaLabel: `${a.text}，${dest(a)}` }))
}

// 「可入座／可坐」唯一口徑（Barry 2026-10-30「可入座統一」）：現在就能坐的桌＝opsTablePresentation.canSeatNow
// （空桌、今日可用、不撞下一組時段）。頂端常駐「可入座」、樓層鈕「可坐 N」、摘要分頁「可入座」三處一律走這支，
// 所以 1F＋2F 一定等於常駐列。帶位面板「依人數篩可選桌」（walkinSelectable）是選桌邏輯，不走這支、也不受影響。
// 沒有桌況字典時（極少數呼叫端）退回「vacant 且今日可用」。
export function isSeatableNow(table, tablePresentation = null, today = undefined) {
  if (!table) return false
  if (tablePresentation) return !!tablePresentation[table.number]?.canSeatNow
  return table.status === 'vacant' && isTableUsableOnDate(table, today)
}
export function seatableNowTables(tables, tablePresentation = null, { floor = null, today } = {}) {
  return (tables || []).filter(t => (floor == null || t.floor === floor) && isSeatableNow(t, tablePresentation, today))
}

// 全店數字：頂端常駐兩格（可入座／用餐中）與摘要分頁共用。
// 可入座＝seatableNowTables（與樓層鈕「可坐 N」同一支）；可坐位數（vacantSeats，畫面寫「可坐 M 位」）＝那些桌的容量加總、用餐中桌數、在席人數、待清、候位、今日還沒到的訂位。
// 「在席人數」優先用 booking 實際人數；大組併桌只在主桌算一次；團體桌（無 booking）以桌容量估。
export function computeStoreStats({ tables = [], bookings = [], waitlist = [], tablePresentation = null, pulse = null, today }) {
  const counts = { vacant: 0, reserved: 0, dining: 0, cleaning: 0, blocked: 0 }
  const bookingById = {}
  bookings.forEach(b => { if (b.id) bookingById[b.id] = b })
  let occSeats = 0
  tables.forEach(storedTable => {
    const t = diningTablePresentation(storedTable, bookingById[storedTable.currentBookingId], tables)
    // 維修/停用只剔除「空著的」桌；有客人的桌（跨午夜進維修窗等不一致狀態）必須照常計入。
    const occupied = ['dining', 'reserved', 'cleaning'].includes(t.status) || t.currentBookingId || t.currentRef
    if (!isTableUsableOnDate(t, today) && !occupied) return
    counts[t.status] = (counts[t.status] || 0) + 1
    if (t.status === 'dining') {
      const b = t.currentBookingId ? bookingById[t.currentBookingId] : null
      if (b) {
        const isExtra = (b.extraTableIds || []).map(String).includes(String(t.number)) && String(b.assignedTableId) !== String(t.number)
        if (!isExtra) occSeats += Number(b.guests) || t.capacity
      } else {
        occSeats += t.capacity
      }
    }
  })
  const vacantTables = seatableNowTables(tables, tablePresentation, { today })
  return {
    vacant: vacantTables.length,
    vacantSeats: vacantTables.reduce((s, t) => s + (Number(t.capacity) || 0), 0),
    dining: counts.dining,
    cleaning: counts.cleaning,
    occSeats,
    waitlist: activeWaitlistCount(waitlist),
    waitlistPeople: sumGuests(activeWaitlist(waitlist), 'partySize'),
    soon: pulse?.soon?.length || 0,
    overdue: pulse?.overdue?.length || 0,
    later: pulse?.later?.length || 0,
  }
}

// 一天節奏單句（原本提示列「沒事時」顯示的那句，移到摘要分頁）
export function phaseLine({ settings, now, pulse, groups }) {
  const parts = []
  const upcoming = (pulse?.soon?.length || 0) + (pulse?.later?.length || 0)
  if (upcoming > 0) parts.push(`${upcoming} 組訂位`)
  if ((groups || []).length) parts.push(`${groups.length} 團`)
  const rest = parts.length ? `今日還有 ${parts.join('、')}` : '今日無待到訂位'
  const p = dayPhase(settings, now)
  if (p.phase === 'before-open') return `開店前 · ${rest}`
  if (p.phase === 'service') return `${p.seating?.name || '營業中'} · ${rest}`
  if (p.phase === 'between') return `場次空檔${p.next ? ` · ${p.next.start} ${p.next.name}` : ''} · ${rest}`
  return '已過打烊時間 · 桌況乾淨即可收工'
}
