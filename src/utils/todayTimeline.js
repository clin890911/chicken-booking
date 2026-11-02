// 現場左欄「今日」時間清單（方案 A，2026-11 demo）：散客訂位＋團體梯次併成一條依時間排的清單。
// 動機：尖峰時店員想的是「下一組是誰、幾點到、坐哪」，不分散客團體；過去要在「今日訂位」「團體」
// 兩個籤切來切去，而且「已入座」只有散客、看不到團體。
//
// 區段口徑沿用 bookingPulse.classifyTodayPulse（過時未到／90 分內／之後，寬限 15 分），團體梯次照同一把尺：
//   - 未入座且未釋出的梯 → 依 batch.timeSlot 落入 overdue／soon／later
//   - 進行中（有桌 dining 或 cleaning 且 currentRef 指向此梯，同 groupLive.batchInProgress）→ seated
//   - 已釋出（releasedAt）／團已完成 → 不在時間線上，移到底部「已完成」區（completedEntries，可印回傳單）
//   - 團已取消 → 不列
// 純函式、注入 now（epoch ms）與 today 可單測；不碰 service 狀態。
import { classifyTodayPulse, overdueMinOf } from './bookingPulse'
import { sortedBatches, todayGroupsByState } from './groupLive'
import { bookingTableNumbers } from './bookingTables'

const SOON_MIN = 90
const GRACE_MIN = 15

// 同一團多列的左側細邊條色：第一個團用團體保留紫（statusColors.GROUP_HOLD_COLOR），
// 同日第二團起換色相，一眼分得出「這幾列是同一團」。依當日團序（最早梯次時段，已完成的團也佔序）取色，
// 重新整理或別團完成都不會跳色。
export const GROUP_STRIPE_COLORS = ['#7c3aed', '#0e7490', '#be185d', '#4d7c0f', '#b45309']
export const groupStripeColor = (groupIndex) => GROUP_STRIPE_COLORS[(groupIndex || 0) % GROUP_STRIPE_COLORS.length]

function indexTables(tables) {
  const m = {}
  ;(tables || []).forEach(t => { if (t?.number != null) m[String(t.number)] = t })
  return m
}

// 今日團體梯次列（每一梯一列）。回傳 entry：
//   { kind:'batch', key, group, batch, timeSlot, isEscort, seq, seqTotal, groupIndex,
//     tableNumbers, diningTables, cleaningTables, inProgress, seatedAt }
// seq／seqTotal：旅客梯次序號（「1/2 梯」）；司領桌 seq＝null（標「司領」，人數不計入旅客）。
export function groupBatchEntries(groups, tables, today) {
  const tableList = Object.values(indexTables(tables))
  const out = []
  todayGroupsByState(groups, today).all.forEach((g, groupIndex) => {
    if (g.status === 'completed') return
    const batches = sortedBatches(g)
    const guestBatches = batches.filter(b => !b.isEscort)
    batches.forEach(b => {
      if (b.releasedAt) return // 已清桌釋出＝此梯已消化（比照散客已離席，不列）
      // 以桌況為準（同 batchInProgress）：逐桌換桌／加桌後 batch.tableNumbers 與桌況應一致，但以桌況最穩
      const live = tableList.filter(t => ['dining', 'cleaning'].includes(t.status)
        && t.currentRef?.groupId === g.id && t.currentRef?.batchId === b.id)
      const diningTables = live.filter(t => t.status === 'dining').map(t => String(t.number))
      const cleaningTables = live.filter(t => t.status === 'cleaning').map(t => String(t.number))
      const planned = (b.tableNumbers || []).map(String)
      const seatedAt = live.map(t => t.seatedAt).filter(Boolean).sort()[0] || null
      out.push({
        kind: 'batch',
        key: `${g.id}:${b.id}`,
        group: g,
        batch: b,
        timeSlot: b.timeSlot || '',
        isEscort: !!b.isEscort,
        seq: b.isEscort ? null : guestBatches.indexOf(b) + 1,
        seqTotal: guestBatches.length,
        groupIndex,
        tableNumbers: [...new Set([...planned, ...live.map(t => String(t.number))])],
        diningTables,
        cleaningTables,
        inProgress: live.length > 0,
        seatedAt,
      })
    })
  })
  return out
}

const bookingEntry = (b) => ({ kind: 'booking', key: b.id, booking: b, timeSlot: b.timeSlot })
// 正值＝N 分後；無時段的梯排到最後（「之後」）
const diffOf = (e, now) => (e.timeSlot ? -overdueMinOf(e.timeSlot, now) : Infinity)
const byTimeSlot = (a, b) => String(a.timeSlot || '99:99').localeCompare(String(b.timeSlot || '99:99'))
// 已入座排序鍵：散客＝實際入座時間、團體梯＝該梯最早入座桌的 seatedAt（都是 ISO 字串）
const seatedKey = (e) => String(e.kind === 'batch' ? e.seatedAt || '' : e.booking.actualArrivalTime || '')

// 「已完成」區（左欄底部摺疊）：今日已完成的團＋還沒結團但已跑完的梯，依時段排。
// entry：{ kind:'group', key, group, timeSlot, tableNumbers }（整張團卡）
//     或 { kind:'released', key, group, batch, timeSlot, tableNumbers }（團還在進行、這一梯已釋出）
// 團沒結但已經沒有未釋出的梯（例：編輯器刪掉最後一梯，或根本沒梯）時間線上沒有它的列，
// 也走整張團卡：卡片沒結團會給「整團完成」，否則這團在現場頁就結不了。
export function completedEntries(groups, today) {
  const out = []
  todayGroupsByState(groups, today).all.forEach(g => {
    const batches = sortedBatches(g)
    if (g.status === 'completed' || batches.every(b => b.releasedAt)) {
      out.push({
        kind: 'group',
        key: g.id,
        group: g,
        timeSlot: batches[0]?.timeSlot || '',
        tableNumbers: [...new Set(batches.flatMap(b => (b.tableNumbers || []).map(String)))],
      })
      return
    }
    batches.filter(b => b.releasedAt).forEach(b => {
      out.push({ kind: 'released', key: `${g.id}:${b.id}`, group: g, batch: b, timeSlot: b.timeSlot || '', tableNumbers: (b.tableNumbers || []).map(String) })
    })
  })
  return out.sort(byTimeSlot)
}

// 今日時間清單。回傳 { overdue, soon, later, seated, done, pendingBatchCount }，每段都是 entry 陣列
// （kind:'booking' → entry.booking；kind:'batch' → 見 groupBatchEntries）。
//   overdue：過越久越前（同 classifyTodayPulse）；soon／later：依時段；seated：最近入座的排最前
//   （剛帶進去的最可能要改桌／改人數，與原「已入座」清單同序）；done：見 completedEntries。
// pendingBatchCount：未入座的團體梯次數（OpsRail「今日」籤徽章要加上它）。
export function buildTodayTimeline(bookings, groups, tables, now = Date.now(), today) {
  const pulse = classifyTodayPulse(bookings, today, now, { soonMin: SOON_MIN, graceMin: GRACE_MIN })
  const batches = groupBatchEntries(groups, tables, today)
  const waiting = batches.filter(e => !e.inProgress)

  const overdue = [...pulse.overdue.map(bookingEntry), ...waiting.filter(e => diffOf(e, now) < -GRACE_MIN)]
    .sort((a, b) => diffOf(a, now) - diffOf(b, now))
  const soon = [...pulse.soon.map(bookingEntry), ...waiting.filter(e => { const d = diffOf(e, now); return d >= -GRACE_MIN && d <= SOON_MIN })]
    .sort(byTimeSlot)
  const later = [...pulse.later.map(bookingEntry), ...waiting.filter(e => diffOf(e, now) > SOON_MIN)]
    .sort(byTimeSlot)
  const seated = [
    ...(bookings || []).filter(b => b.date === today && b.status === 'arrived').map(bookingEntry),
    ...batches.filter(e => e.inProgress),
  ].sort((a, b) => seatedKey(b).localeCompare(seatedKey(a)))

  return { overdue, soon, later, seated, done: completedEntries(groups, today), pendingBatchCount: waiting.length }
}

// 搜尋：姓名／電話（含末碼，忽略符號）／桌號（主桌＋副桌）
export function matchesBookingQuery(b, q) {
  const raw = String(q || '').trim().toLowerCase()
  if (!raw) return true
  const digits = raw.replace(/\D/g, '')
  return (
    (b.name || '').toLowerCase().includes(raw) ||
    (b.phone || '').toLowerCase().includes(raw) ||
    (digits.length > 0 && String(b.phone || '').replace(/\D/g, '').includes(digits)) ||
    bookingTableNumbers(b).some(n => String(n).toLowerCase().includes(raw))
  )
}

// 搜尋（時間清單版）：散客同 matchesBookingQuery；團體梯次與已完成區比對旅行社名、導遊名、導遊電話、梯次名、桌號。
export function matchesTimelineQuery(entry, q) {
  if (entry.kind === 'booking') return matchesBookingQuery(entry.booking, q)
  const raw = String(q || '').trim().toLowerCase()
  if (!raw) return true
  const g = entry.group || {}
  const digits = raw.replace(/\D/g, '')
  return (
    (g.agencyName || '').toLowerCase().includes(raw) ||
    (g.guideName || '').toLowerCase().includes(raw) ||
    (entry.batch?.label || '').toLowerCase().includes(raw) ||
    (digits.length > 0 && String(g.guidePhone || '').replace(/\D/g, '').includes(digits)) ||
    (entry.tableNumbers || []).some(n => String(n).toLowerCase().includes(raw))
  )
}
