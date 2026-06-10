// groupDaySummary：團體預排「日/月」彙總（純函式，給月曆 + 當日總覽用）。
// 設計原則：零複製容量邏輯 —— 座位/關閉/場次一律委派 capacity.js / timeSlots.js，
//          本模組只負責「篩選、分組、加總人數、合併文字」。
//
// 主要輸出：
//  - summarizeGroupDay / summarizeGroupMonth：月曆格 + 整月摘要（只吃 groups+tables，月迴圈不碰 bookings）
//  - summarizeDayPrep：當日備餐彙總（素食/兒童/行動不便/輪椅 + 過敏/桌邊/遊覽車，依團具名）
//  - buildArrivalTimeline：遊覽車抵達時間軸（依場次分組、時間排序、同時段碰撞）
//  - dayCapacityBySeating：各場次散客×團客合併容量（每場次呼叫一次 resolveSlotOccupancy）
//  - buildGroupDaySummary：面板一次取用的彙整（含 warnings：爆量 / 同時段多團 / 未對應場次）
import {
  resolveSlotOccupancy,
  groupTableNumbers,
  CAPACITY_EXCLUDED_STATUSES,
} from './capacity'
import { seatingForSlot } from './timeSlots'
import { isTableUsableOnDate } from './tableAvailability'

const NO_SEATING = '__none__' // 對不到任何場次的梯次桶鍵

// === 常用旅行社（給「新增團單」快速快選 chip）===
// 純由 groupReservations 即時彙算，不另存計數器。依 agencyId 計團數（可限近 N 天，排除取消），
// 取前 limit 名、過濾已封存，回傳 agency 物件陣列。
export function frequentAgencies(groupReservations = [], agencies = [], { sinceDate = null, limit = 5 } = {}) {
  const byId = {}
  ;(groupReservations || []).forEach(g => {
    if (!g.agencyId || g.status === 'cancelled') return
    if (sinceDate && g.date && g.date < sinceDate) return
    byId[g.agencyId] = (byId[g.agencyId] || 0) + 1
  })
  const agencyById = {}
  ;(agencies || []).forEach(a => { agencyById[a.id] = a })
  return Object.entries(byId)
    .map(([id, count]) => ({ agency: agencyById[id], count }))
    .filter(x => x.agency && !x.agency.archived)
    .sort((a, b) => b.count - a.count || String(a.agency.name || '').localeCompare(String(b.agency.name || '')))
    .slice(0, Math.max(0, limit))
    .map(x => x.agency)
}

// 整天公休？（只讀設定，非座位運算，故可在此判定）
function isDayClosed(settings, date) {
  const cd = settings?.closures?.closedDates
  return Array.isArray(cd) && cd.includes(date)
}

// 某日「仍佔位」的團（複用容量引擎的標準排除集：cancelled/noshow/completed 不算）。
export function activeGroupsOnDate(groupReservations = [], date) {
  return (groupReservations || []).filter(
    g => g.date === date && !CAPACITY_EXCLUDED_STATUSES.includes(g.status),
  )
}

// === (a) 月曆單格摘要 ===
// 回傳 { groupCount, guests, heldSeats, heldTableCount, bySeating:{[id]:seats}, overCapacityGroupOnly, closed }
//  - guests：Σ counts.total
//  - heldTableCount / heldSeats：整天「相異桌號」去重後的桌數 / 席數（與既有 tablesHeldOnDate 口徑一致）
//  - bySeating：各場次團客保留席（場次內桌號去重）
//  - overCapacityGroupOnly：任一場次「團客保留席 > 全店座位」（純團爆量；月曆不碰 bookings，故只看團）
export function summarizeGroupDay(groupReservations = [], tables = [], date, settings = {}) {
  const groups = activeGroupsOnDate(groupReservations, date)
  const capByNum = {}
  let totalSeats = 0
  ;(tables || []).forEach(t => {
    capByNum[t.number] = Number(t.capacity) || 0
    if (isTableUsableOnDate(t, date)) totalSeats += Number(t.capacity) || 0
  })

  let guests = 0
  const dayTables = new Set()              // 整天相異桌號
  const bySeatingTables = {}               // seatingId -> Set(桌號)
  groups.forEach(g => {
    guests += Number(g.counts?.total) || 0
    ;(g.batches || []).forEach(b => {
      const sid = seatingForSlot(settings, b.timeSlot)?.id || NO_SEATING
      const set = bySeatingTables[sid] || (bySeatingTables[sid] = new Set())
      ;(b.tableNumbers || []).forEach(n => {
        const key = String(n)
        dayTables.add(key)
        set.add(key)
      })
    })
  })

  const seatsOf = (nums) => [...nums].reduce((s, n) => s + (capByNum[n] || 0), 0)
  const bySeating = {}
  let overCapacityGroupOnly = false
  Object.entries(bySeatingTables).forEach(([sid, set]) => {
    const seats = seatsOf(set)
    bySeating[sid] = seats
    if (sid !== NO_SEATING && totalSeats > 0 && seats > totalSeats) overCapacityGroupOnly = true
  })

  return {
    groupCount: groups.length,
    guests,
    heldSeats: seatsOf(dayTables),
    heldTableCount: dayTables.size,
    bySeating,
    overCapacityGroupOnly,
    closed: isDayClosed(settings, date),
  }
}

// === 整月地圖（一次 pass 依日期分桶，再逐日彙總；O(groups)）===
// month 為 0-indexed（同 Date.getMonth()）。回傳 { byDate:{[date]:summarizeGroupDay}, month:{groupCount,guests} }。
export function summarizeGroupMonth(groupReservations = [], tables = [], year, month, settings = {}) {
  const prefix = `${year}-${String(month + 1).padStart(2, '0')}-`
  const byDateGroups = {}
  ;(groupReservations || []).forEach(g => {
    if (!g.date || !g.date.startsWith(prefix)) return
    if (CAPACITY_EXCLUDED_STATUSES.includes(g.status)) return
    ;(byDateGroups[g.date] = byDateGroups[g.date] || []).push(g)
  })

  const byDate = {}
  let groupCount = 0
  let guests = 0
  Object.entries(byDateGroups).forEach(([date, groups]) => {
    const sum = summarizeGroupDay(groups, tables, date, settings)
    byDate[date] = sum
    groupCount += sum.groupCount
    guests += sum.guests
  })
  return { byDate, month: { groupCount, guests } }
}

// === (b) 當日備餐彙總 ===
// 過敏/桌邊/遊覽車「依團具名」保留（廚房需知道是哪一團，不可盲目串接）。
export function summarizeDayPrep(groupReservations = [], date) {
  const groups = activeGroupsOnDate(groupReservations, date)
  const counts = { total: 0, vegetarian: 0, child: 0, mobility: 0, wheelchair: 0 }
  const allergies = []
  const tableSideNeeds = []
  const buses = []
  const mobilityGroups = []

  groups.forEach(g => {
    const c = g.counts || {}
    counts.total += Number(c.total) || 0
    counts.vegetarian += Number(c.vegetarian) || 0
    counts.child += Number(c.child) || 0
    counts.mobility += Number(c.mobility) || 0
    counts.wheelchair += Number(c.wheelchair) || 0

    const agencyName = g.agencyName || '（未填旅行社）'
    if ((g.allergyText || '').trim()) allergies.push({ agencyName, text: g.allergyText.trim() })
    if ((g.tableSideNeeds || '').trim()) tableSideNeeds.push({ agencyName, text: g.tableSideNeeds.trim() })
    if ((g.busInfo || '').trim()) buses.push({ agencyName, busInfo: g.busInfo.trim() })
    if ((Number(c.mobility) || 0) > 0 || (Number(c.wheelchair) || 0) > 0) {
      mobilityGroups.push({ agencyName, tableNumbers: groupTableNumbers(g) })
    }
  })

  return { counts, allergies, tableSideNeeds, buses, mobilityGroups, groupCount: groups.length }
}

// === (c) 遊覽車抵達時間軸 ===
// 攤平每團每梯為抵達列，依場次分組（seatingForSlot），場次依 start 排序、null 桶置末；
// 列內依 timeSlot 排序；collisions = 同場次同 timeSlot 有 2+ 團。
// 回傳 [{ seating:{id,name,start,end}|null, rows:[{timeSlot,group,batch,guests,tableNumbers}], collisions:[{timeSlot,count,guests}] }]
export function buildArrivalTimeline(groupReservations = [], date, settings = {}) {
  const groups = activeGroupsOnDate(groupReservations, date)
  const seatings = Array.isArray(settings?.seatings) ? settings.seatings : []
  const buckets = new Map() // sid -> { seating, rows }

  groups.forEach(g => {
    ;(g.batches || []).forEach(b => {
      const seating = seatingForSlot(settings, b.timeSlot)
      const sid = seating?.id || NO_SEATING
      if (!buckets.has(sid)) buckets.set(sid, { seating: seating || null, rows: [] })
      buckets.get(sid).rows.push({
        timeSlot: b.timeSlot || '',
        group: g,
        batch: b,
        guests: Number(b.guests) || 0,
        tableNumbers: (b.tableNumbers || []).map(String),
      })
    })
  })

  // 場次順序：依 start 排序，null 桶最後
  const ordered = []
  ;[...seatings]
    .sort((a, b) => String(a.start).localeCompare(String(b.start)))
    .forEach(s => { if (buckets.has(s.id)) ordered.push(buckets.get(s.id)) })
  if (buckets.has(NO_SEATING)) ordered.push(buckets.get(NO_SEATING))

  ordered.forEach(bucket => {
    bucket.rows.sort((a, b) => String(a.timeSlot).localeCompare(String(b.timeSlot)))
    const byTime = {}
    bucket.rows.forEach(r => {
      const slot = byTime[r.timeSlot] || (byTime[r.timeSlot] = { timeSlot: r.timeSlot, groupIds: new Set(), guests: 0 })
      slot.groupIds.add(r.group.id)
      slot.guests += r.guests
    })
    bucket.collisions = Object.values(byTime)
      .filter(s => s.groupIds.size >= 2)
      .map(s => ({ timeSlot: s.timeSlot, count: s.groupIds.size, guests: s.guests }))
      .sort((a, b) => String(a.timeSlot).localeCompare(String(b.timeSlot)))
  })

  return ordered
}

// === (d2) 當日散客名單彙總 ===
// 規劃當日總覽用：把當日散客訂位依場次分桶（seatingForSlot 委派），給領位看名單、配桌。
// 回傳 { count, guests, unassignedCount, unassignedGuests, bySeating:[{ seating, rows }], unscheduled: rows }
//  row = { booking, timeSlot, guests, assignedTableId, status }；rows 依 timeSlot 排序。
// 篩選：b.date === date 且排除 CAPACITY_EXCLUDED_STATUSES（與容量引擎同口徑）。
export function buildWalkinDaySummary(bookings = [], date, settings = {}) {
  const seatings = Array.isArray(settings?.seatings) ? settings.seatings : []
  const buckets = new Map() // sid -> rows

  let count = 0
  let guests = 0
  let unassignedCount = 0
  let unassignedGuests = 0
  ;(bookings || []).forEach(b => {
    if (b.date !== date) return
    if (CAPACITY_EXCLUDED_STATUSES.includes(b.status)) return
    const g = Number(b.guests) || 0
    count += 1
    guests += g
    if (!b.assignedTableId) {
      unassignedCount += 1
      unassignedGuests += g
    }
    const sid = seatingForSlot(settings, b.timeSlot)?.id || NO_SEATING
    if (!buckets.has(sid)) buckets.set(sid, [])
    buckets.get(sid).push({
      booking: b,
      timeSlot: b.timeSlot || '',
      guests: g,
      assignedTableId: b.assignedTableId || null,
      status: b.status,
    })
  })

  const sortRows = (rows) => rows.sort((a, b) => String(a.timeSlot).localeCompare(String(b.timeSlot)))
  const bySeating = [...seatings]
    .sort((a, b) => String(a.start).localeCompare(String(b.start)))
    .filter(s => buckets.has(s.id))
    .map(s => ({ seating: s, rows: sortRows(buckets.get(s.id)) }))
  const unscheduled = buckets.has(NO_SEATING) ? sortRows(buckets.get(NO_SEATING)) : []

  return { count, guests, unassignedCount, unassignedGuests, bySeating, unscheduled }
}

// === (d) 各場次散客×團客合併容量 ===
// 每場次呼叫一次 resolveSlotOccupancy（與容量引擎同口徑）。回傳 [{ seating, summary }]。
export function dayCapacityBySeating(tables = [], bookings = [], groupReservations = [], date, settings = {}) {
  const seatings = Array.isArray(settings?.seatings) ? settings.seatings : []
  return seatings.map(seating => ({
    seating,
    summary: resolveSlotOccupancy(tables, bookings, groupReservations, date, seating, settings).summary,
  }))
}

// === 面板一次取用的彙整 ===
// 回傳 { date, groupCount, guests, heldSeats, heldTableCount, prep, timeline, seatings, walkins, warnings, closed }
//  warnings：
//   overcapacity — 某場次 groupHeldSeats + walkinGuests > totalSeats（含散客；僅異常時跳，非常駐儀表）
//   collision    — 同場次同時段 2+ 團
//   unscheduled  — 有梯次對不到任何已設定場次（提醒確認帶位；未設定任何場次時不發此警示）
export function buildGroupDaySummary({ groupReservations = [], bookings = [], tables = [], date, settings = {} }) {
  const day = summarizeGroupDay(groupReservations, tables, date, settings)
  const prep = summarizeDayPrep(groupReservations, date)
  const timeline = buildArrivalTimeline(groupReservations, date, settings)
  const seatings = dayCapacityBySeating(tables, bookings, groupReservations, date, settings)
  const walkins = buildWalkinDaySummary(bookings, date, settings)
  const hasSeatings = Array.isArray(settings?.seatings) && settings.seatings.length > 0

  const warnings = []

  // 爆量（散客 + 團客 > 全店座位）
  seatings.forEach(({ seating, summary }) => {
    if (summary.closed) return
    const used = (summary.groupHeldSeats || 0) + (summary.walkinGuests || 0)
    if (summary.totalSeats > 0 && used > summary.totalSeats) {
      warnings.push({
        type: 'overcapacity',
        seatingId: seating.id,
        seatingName: seating.name,
        used,
        totalSeats: summary.totalSeats,
        over: used - summary.totalSeats,
      })
    }
  })

  // 同時段多團
  timeline.forEach(bucket => {
    ;(bucket.collisions || []).forEach(col => {
      warnings.push({
        type: 'collision',
        seatingId: bucket.seating?.id || null,
        seatingName: bucket.seating?.name || '未對應場次',
        timeSlot: col.timeSlot,
        count: col.count,
        guests: col.guests,
      })
    })
  })

  // 未對應場次（僅在有設定場次時提醒）
  const nullBucket = timeline.find(b => b.seating === null)
  if (hasSeatings && nullBucket && nullBucket.rows.length) {
    warnings.push({
      type: 'unscheduled',
      count: nullBucket.rows.length,
      rows: nullBucket.rows.map(r => ({
        timeSlot: r.timeSlot,
        agencyName: r.group.agencyName || '（未填旅行社）',
        guests: r.guests,
      })),
    })
  }

  return {
    date,
    groupCount: day.groupCount,
    guests: day.guests,
    heldSeats: day.heldSeats,
    heldTableCount: day.heldTableCount,
    prep,
    timeline,
    seatings,
    walkins,
    warnings,
    closed: day.closed,
  }
}
