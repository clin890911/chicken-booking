// 當日排位（規劃頁「點日期 → 當天全部訂位 + 同畫面排桌」）的純邏輯。
// UI 在 components/admin/planning/DaySeatingPanel.jsx；這裡不碰 React／localStorage，方便單元測試。
//
// 口徑全部沿用既有引擎，不另立一套：
//   - 場次歸屬：timeSlots.seatingForSlot
//   - 同場次佔用（散客主桌＋併桌副桌、團體整桌保留）：capacity.resolveSlotOccupancy（ignoreOnlineClosure＝後台口徑）
//   - 跨場次的時間重疊：佔用區間只走 capacity.assignmentWindow（未來日／今天較早＝'preassign' [時段, 時段+佔位)；
//     今天離用餐 ≤ 30 分＝'hold' [min(現在, 時段), max(現在, 時段)+佔位)，鎖桌時機 capacity.lockKindFor），
//     散客用 capacity.overlappingBookedTables、團體用同一個 window 比梯次區間
//   - 今天的即時桌況：鎖桌型只能選此刻空桌（同 seatingService.findSuitableTables／assignBookingTablesMulti）；
//     今天的預配型由容器帶入 seatingService.preassignableTables 的結果（liveAllowed）
//   - 停用／維修：tableAvailability.isTableUsableOnDate
//   - 公休：capacity.isDayClosedForClosures（公休日不配桌）
//   - 席數門檻：capacity.squeezeSeats（擠一擠：每桌多坐 1 位；超過原席數只標黃字）
//   - 併桌只限同一樓層（與 SlotMapPanel／現場同規則）
import { seatingForSlot } from './timeSlots'
import {
  CAPACITY_EXCLUDED_STATUSES,
  resolveSlotOccupancy,
  assignmentWindow,
  overlappingBookedTables,
  rangesOverlap,
  occupancyMinutes,
  toMinutes,
  squeezeSeats,
  isDayClosedForClosures,
} from './capacity'
import { isTableUsableOnDate } from './tableAvailability'
import { assignmentKind, statusZh } from './tableStatus'

// 可以在這裡配桌／改桌／取消配桌的訂位狀態（已到、已完成的不動；那是現場頁的事）
export const EDITABLE_STATUSES = ['pending', 'confirmed']
// 清單不列的狀態：取消、未到
const HIDDEN_STATUSES = ['cancelled', 'noshow']

export function bookingTableList(b) {
  return [b?.assignedTableId, ...(Array.isArray(b?.extraTableIds) ? b.extraTableIds : [])]
    .filter(n => n != null && n !== '').map(String)
}

// 散客狀態：arrived（已到／已完成）＞ assigned（已配桌）＞ unassigned（未配桌）
export function walkinState(b) {
  if (b?.status === 'arrived' || b?.status === 'completed') return 'arrived'
  return bookingTableList(b).length ? 'assigned' : 'unassigned'
}

// 當天全部訂位（散客＋團體梯次），依場次分組、組內依時段排序。
// 回傳 { sections: [{ seating, items, count, unassigned, guests }], unscheduled: items }
// item：{ key, kind:'walkin'|'group', timeSlot, name, guests, tables, state, booking? | group?+batch? }
export function buildDaySeatingList({ bookings = [], groupReservations = [], date, settings = {} } = {}) {
  const seatings = Array.isArray(settings?.seatings) ? settings.seatings : []
  const buckets = new Map(seatings.map(s => [s.id, []]))
  const unscheduled = []
  const put = (item) => {
    const s = seatingForSlot(settings, item.timeSlot)
    if (s && buckets.has(s.id)) buckets.get(s.id).push(item)
    else unscheduled.push(item)
  }

  ;(bookings || []).forEach(b => {
    if (!b || b.date !== date || HIDDEN_STATUSES.includes(b.status)) return
    put({
      key: `b:${b.id}`, kind: 'walkin', booking: b,
      timeSlot: b.timeSlot || '', name: b.name || '散客', guests: Number(b.guests) || 0,
      tables: bookingTableList(b), state: walkinState(b),
    })
  })

  ;(groupReservations || []).forEach(g => {
    if (!g || g.date !== date || CAPACITY_EXCLUDED_STATUSES.includes(g.status)) return
    ;(g.batches || []).forEach((bt, i) => {
      const tables = (bt.tableNumbers || []).map(String)
      put({
        key: `g:${g.id}:${bt.id || i}`, kind: 'group', group: g, batch: bt,
        timeSlot: bt.timeSlot || '', name: g.agencyName || '團體', guests: bt.isEscort ? 0 : (Number(bt.guests) || 0),
        label: bt.isEscort ? '司領桌' : (bt.label || ''),
        tables, state: g.status === 'arrived' ? 'arrived' : tables.length ? 'assigned' : 'unassigned',
      })
    })
  })

  const sortItems = (list) => list.sort((a, b) =>
    String(a.timeSlot).localeCompare(String(b.timeSlot)) ||
    (a.kind === b.kind ? 0 : a.kind === 'walkin' ? -1 : 1) ||
    // 不依狀態排序：配好桌的那筆留在原位，清單不會在店員眼前跳動
    b.guests - a.guests || // 同時段先排大組（最難安排，先佔好位置）
    String(a.name).localeCompare(String(b.name)))

  const sections = seatings.map(seating => {
    const items = sortItems(buckets.get(seating.id))
    return {
      seating,
      items,
      count: items.length,
      // 「未配桌」只算散客（團體圈桌在團單精靈做，這版不在這裡改）
      unassigned: items.filter(i => i.kind === 'walkin' && i.state === 'unassigned').length,
      guests: items.reduce((s, i) => s + i.guests, 0),
    }
  })
  return { sections, unscheduled: sortItems(unscheduled) }
}

// 一行摘要：「午餐第一批 6 組・未配桌 3」
export function sectionSummaryText(section) {
  if (!section) return ''
  const base = `${section.seating.name} ${section.count} 組`
  return section.unassigned > 0 ? `${base}・未配桌 ${section.unassigned}` : `${base}・全部配好`
}

const isPendingWalkin = (i) => i.kind === 'walkin' && i.state === 'unassigned' && EDITABLE_STATUSES.includes(i.booking?.status)

// Smart default：最早一筆「未配桌」散客與其場次。都配好了 → 第一個有訂位的場次、不選人。
export function firstUnassigned(list) {
  for (const sec of list?.sections || []) {
    const hit = sec.items.find(isPendingWalkin)
    if (hit) return { seatingId: sec.seating.id, bookingId: hit.booking.id }
  }
  const busy = (list?.sections || []).find(s => s.count > 0)
  return { seatingId: busy?.seating.id || list?.sections?.[0]?.seating.id || '', bookingId: null }
}

// 排完一筆後自動跳下一筆：同場次排在它後面的未配桌 → 同場次前面的 → 後面場次 → 前面場次。
// list 是「排桌前」的清單（currentId 那筆仍是未配桌，這裡直接略過它）。
export function nextUnassigned(list, currentId) {
  const sections = list?.sections || []
  const secIdx = sections.findIndex(s => s.items.some(i => i.kind === 'walkin' && i.booking.id === currentId))
  const candidates = (sec) => sec.items.filter(i => isPendingWalkin(i) && i.booking.id !== currentId)
  if (secIdx >= 0) {
    const sec = sections[secIdx]
    const pos = sec.items.findIndex(i => i.kind === 'walkin' && i.booking.id === currentId)
    const after = sec.items.slice(pos + 1).find(i => isPendingWalkin(i) && i.booking.id !== currentId)
    const hit = after || candidates(sec)[0]
    if (hit) return { seatingId: sec.seating.id, bookingId: hit.booking.id }
  }
  const order = secIdx >= 0
    ? [...sections.slice(secIdx + 1), ...sections.slice(0, secIdx)]
    : sections
  for (const sec of order) {
    const hit = candidates(sec)[0]
    if (hit) return { seatingId: sec.seating.id, bookingId: hit.booking.id }
  }
  return null
}

// 團體梯次與 window 重疊的桌（跨場次也算：午餐第一批 12:00 的團，會壓到 13:00 的散客）
function overlappingGroupTables(groupReservations = [], { date, window } = {}, settings = {}) {
  const set = new Set()
  const occ = occupancyMinutes(settings)
  ;(groupReservations || []).forEach(g => {
    if (!g || g.date !== date || CAPACITY_EXCLUDED_STATUSES.includes(g.status)) return
    ;(g.batches || []).forEach(bt => {
      if (!bt?.timeSlot) return
      const start = toMinutes(bt.timeSlot)
      if (window && !rangesOverlap(start, start + occ, window.start, window.end - window.start)) return
      ;(bt.tableNumbers || []).forEach(n => set.add(String(n)))
    })
  })
  return set
}

// 這筆訂位此刻可選的桌（地圖高亮）：
//   該日可用（非停用／維修）∧ 同場次沒人佔（扣掉自己，改桌時自己的舊桌可再選）
//   ∧ 不與同日他筆預配／團體在 assignmentWindow 重疊。公休日一律空。
// lockKind（capacity.lockKindFor）：'preassign'（預設；未來日一律如此）／'hold'（今天、離用餐 ≤ 30 分 → 寫入會鎖桌）：
//   hold 的佔用區間起點＝min(現在, 時段)，且只能選此刻空桌（或本筆自己鎖著的桌）。
// liveAllowed（選用，今天才帶）：現場口徑的可選桌號（seatingService.findSuitableTables／preassignableTables），再取交集。
// 回傳 { free: 桌號[], byTable }（byTable＝扣掉自己後的同場次佔用，給地圖上色）
export function assignableTables({ tables = [], bookings = [], groupReservations = [], date, seating, settings = {}, booking, lockKind = 'preassign', now = new Date(), liveAllowed = null } = {}) {
  if (!booking || !seating) return { free: [], byTable: {} }
  const others = (bookings || []).filter(b => b.id !== booking.id)
  const { byTable } = resolveSlotOccupancy(tables, others, groupReservations, date, seating, settings, { ignoreOnlineClosure: true })
  if (isDayClosedForClosures(settings, date)) return { free: [], byTable }
  const hold = lockKind === 'hold'
  const window = assignmentWindow({ mode: hold ? 'hold' : 'preassign', timeSlot: booking.timeSlot, date, now }, settings)
  const bookedOverlap = overlappingBookedTables(bookings, { date, window, excludeBookingId: booking.id }, settings)
  const groupOverlap = overlappingGroupTables(groupReservations, { date, window }, settings)
  const live = liveAllowed ? new Set([...liveAllowed].map(String)) : null
  const ownLocked = (t) => t.status === 'reserved' && t.currentBookingId != null && String(t.currentBookingId) === String(booking.id)
  const free = (tables || [])
    .filter(t => isTableUsableOnDate(t, date))
    .filter(t => (Number(t.capacity) || 0) > 0)
    .filter(t => !hold || (t.status || 'vacant') === 'vacant' || ownLocked(t))
    .map(t => String(t.number))
    .filter(n => !live || live.has(n))
    .filter(n => !byTable[n] && !bookedOverlap.has(n) && !groupOverlap.has(n))
  return { free, byTable }
}

// 「取消配桌 → 復原」寫回前的訂位重驗（toast 還在的期間，這筆可能被取消、標 No-show、到店、改日或已重新配桌）。
// 回傳錯誤字串（安全失敗、不寫回）；null＝訂位本身仍可寫回（桌是否仍可用另由 assignableTables 判斷）。
const UNDO_STATUS_TEXT = { cancelled: '已取消', noshow: '已標 No-show', arrived: '已到店', completed: '已完成' }
export function undoUnassignBlocker(fresh, date) {
  if (!fresh) return '無法復原：這筆訂位已不存在'
  if (!EDITABLE_STATUSES.includes(fresh.status)) return `無法復原：這筆訂位${UNDO_STATUS_TEXT[fresh.status] || '狀態已變更'}`
  if (fresh.date !== date) return `無法復原：這筆訂位已改到 ${fresh.date || '其他日期'}，請到該日重新配桌`
  if (bookingTableList(fresh).length) return '無法復原：這筆訂位已有新配桌'
  return null
}

// 點桌時的即時防呆（回傳錯誤字串；null＝可以加入）。已選的桌一律可移除（不走這裡）。
// lockKind／bookingId／liveAllowed 同 assignableTables（今天才有意義），只用來把「為什麼不能選」講清楚。
export function pickTableError({ number, picked = [], free = [], tables = [], date, settings = {}, byTable = {}, lockKind = 'preassign', bookingId = null, liveAllowed = null } = {}) {
  const n = String(number)
  if (isDayClosedForClosures(settings, date)) return '本日公休，無法配桌'
  const t = (tables || []).find(x => String(x.number) === n)
  if (!t || !isTableUsableOnDate(t, date)) return `${n} 停用/維修中`
  if (byTable[n]) return `${n} 在此場次已被佔用`
  const status = t.status || 'vacant'
  const own = status === 'reserved' && bookingId != null && String(t.currentBookingId) === String(bookingId)
  if (lockKind === 'hold' && status !== 'vacant' && !own) return `${n} 此刻不是空桌（${statusZh(status)}），接近用餐時段只能配此刻的空桌`
  if (liveAllowed && !liveAllowed.map(String).includes(n)) return `${n} 目前有人使用，會延續到這組的用餐時段`
  if (!free.includes(n)) return `${n} 與同日其他預配或團體時間重疊`
  if (picked.length) {
    const f0 = (tables || []).find(x => String(x.number) === String(picked[0]))?.floor
    if (f0 && t.floor && f0 !== t.floor) return '併桌需在同一樓層，請改選同層的桌'
  }
  return null
}

// 已選桌的席數試算（橫幅即時顯示）與確認前的最後一道把關。
// 回傳 { ok, error, seats（原席數）, maxSeats（擠一擠上限）, need, squeezed（超過原席數）, short（擠一擠也差幾位） }
export function evaluatePick({ booking, picked = [], free = [], tables = [], date, settings = {} } = {}) {
  const need = Math.max(1, Number(booking?.guests) || 1)
  const chosen = picked.map(n => (tables || []).find(t => String(t.number) === String(n))).filter(Boolean)
  const seats = chosen.reduce((s, t) => s + (Number(t.capacity) || 0), 0)
  const maxSeats = squeezeSeats(chosen)
  const short = Math.max(0, need - maxSeats)
  const base = { seats, maxSeats, need, short, squeezed: picked.length > 0 && short === 0 && seats < need }
  const fail = (error) => ({ ...base, ok: false, error })
  if (!booking) return fail('請先選一筆訂位')
  if (!EDITABLE_STATUSES.includes(booking.status)) return fail('這筆訂位狀態不能在這裡配桌')
  if (isDayClosedForClosures(settings, date)) return fail('本日公休，無法配桌')
  if (!picked.length) return fail('請先點地圖上的空桌')
  if (chosen.length !== picked.length || picked.some(n => !free.includes(String(n)))) return fail('所選桌已不可用，請重新選桌')
  if (new Set(chosen.map(t => t.floor)).size > 1) return fail('併桌需在同一樓層')
  if (short > 0) return fail(`擠一擠也還差 ${short} 位，請再加桌`)
  return { ...base, ok: true, error: null }
}

// 今天已在現場「鎖桌」的訂位（桌況 reserved／dining 且 currentBookingId＝本筆，口徑＝tableStatus.assignmentKind）。
// 當日排位的寫入只改 booking（預配路徑），不碰桌況；對已鎖桌的訂位改桌／取消配桌會留下仍鎖著的孤兒桌，
// 違反「釋桌只動本筆持有、走現場釋桌路徑」→ 這種訂位在這裡唯讀，改桌請到現場頁（useBookingActions 的 move）。
export function heldTableNumbers(booking, tables = []) {
  if (!booking) return []
  return bookingTableList(booking).filter(n => {
    const t = tables.find(x => String(x.number) === n)
    return assignmentKind({ ...booking, assignedTableId: n }, t) === 'held'
  })
}
