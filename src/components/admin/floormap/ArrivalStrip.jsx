// 報到列（2026-08 三版）。
// 一版：疊在桌況圖上的「✓ 到了」浮動鈕——相鄰兩桌同時進窗時鈕會互相完全遮擋，點下去會
//   誤觸把不相干的訂位標記入座（獨立驗收抓到）。
// 二版：搬到地圖下方的 in-flow 橫向列，物理上不再疊到桌況圖或彼此，但驗收又抓到新問題：
//   chip 一多（6 筆時 scrollWidth 遠大於 clientWidth）超過一半內容捲出畫面外，
//   卻沒有任何「還有更多」的視覺信號（無漸層、無陰影、無總數），店員忙起來會漏接。
// 三版：加總筆數標籤（「等報到 N」，不管看不看得到都是真實總數）+ 左右緣捲動遮罩
//   （只在真的有內容被捲出去時出現、捲到底就消失）。這兩者都只是視覺提示，
//   不影響 isArriveEligible 判定或排序邏輯——判定/排序邏輯完全沒有改動。
//
// 涵蓋所有樓層（不受目前 1F/2F 切換影響）——客人到店不會管店員正在看哪一頁地圖；
// 點 chip 本體會自動切到該桌所在樓層並開抽屜（沿用 OpsRail 既有的跨樓層 focus 慣例）。
// 三版加碼：跨樓層的 chip 會在桌號前標樓層（例如「2F 201」），讓「點下去會切樓層、
// 打斷正在填的表單」變成可預期；同樓層的桌不標，避免視覺噪音。
// 四版（2026-09）：「預配」的待到訂位也列（isPreassignArriveEligible）——「接近時段才鎖」之後，
// 早上接的訂位多半只預配、桌況仍空，只看 reserved 桌會讓這些客人到了在報到列找不到。
// chip 標「預配」；桌此刻被別組佔著另標「桌被佔」（按到了會被擋下並給改桌出口）。
// 「等報到 N」一律是兩種合計。同一張桌可能同時有鎖桌那筆與預配那筆 → key 改用訂位 id。
// 五版（2026-10）：時間窗內「還沒配桌」的待到訂位也列（isUnassignedArriveEligible）——過去 12 組待到
// 只列出 3 組，其餘要繞去今日訂位籤「指派桌位 → 點桌 → 確認 → 客人到了」。chip 標「未配桌」，
// 「到了 · 選桌」進選桌入座模式（OperationsView.startArriveSeat，選好桌確認即指派＋入座）。
// 「等報到 N」是三種合計。
// 六版（2026-11 night-50）：預配·桌被佔的 chip 鈕改成「到了 · 換桌」（onArriveReseat，進選桌入座模式，
// 選好桌確認＝改配＋入座一次完成），不再先吃一顆「入座失敗」再走純改桌、還得再按一次到了。
// 預配／鎖桌的 chip 也顯示「N 位」（門口最快的確認是「幾位？」），與未配桌 chip 同款小字、不增加高度。
// 七版（2026-11-27 A3，Barry：「到了」維持按一下就入座，只加防連點和原位確認）：
//   ① 入座成功後該 chip 原位變成「［復原］✓ 林先生 3 位 → 105 已入座」，復原時效（8 秒）內寬度／位置不變——
//      名單不左滑，下一位的「到了」不會滑到剛才按的位置。這是報到列入口唯一的回饋（不另發 toast，只有一顆「復原」）。
//      「復原」放在卡片左側：原本「到了」在右側，隔一秒「不確定有沒有按到、再按一次」只會按到文字，不會復原。
//      時效一到，佔位以寬度動畫收起再移除（不留一塊透明空白）。
//   ② 防連點：同一張 chip 600ms 內重按無效（逐張計時，按另一位的「到了」不受影響）；處理中（確認框開著）全列無效，
//      另有逾時保底（BUSY_MAX_MS），確認框萬一沒結束也不會永遠卡住。確認卡的「復原」出現後 800ms 內不吃點擊。
//   ③ chip 最寬＝列寬，資訊區可截斷、「到了」鈕不縮：iPad 直向（列寬約 380px）鈕完整露出，不再只露 11px。
//   ④ disabled（選桌模式中）：列照樣佔位、看得到名單（地圖尺寸不因模式改變），但整列 inert 不可按。
import { useState, useEffect, useRef } from 'react'
import { preassignTakenByOthers, SEATED_UNDO_MS } from '../../../utils/arriveSeat'
import { overdueMinOf } from '../../../utils/bookingPulse'
import { formatDate } from '../../../utils/timeSlots'
import { isArriveEligible, isPreassignArriveEligible, ARRIVE_WINDOW_BEFORE_MIN, ARRIVE_WINDOW_AFTER_MIN } from './FloorMap'
import GlyphText from '../../ui/GlyphText'
import { formatPhone } from '../../../utils/phoneFormat'
import { seatedText } from '../../../utils/seatFeedback'
import { SEAT_PRIMARY, SEAT_SECONDARY } from '../ops/seatButtons'

// 遲到判定沿用 UpcomingPanel/BookingCard 既有口徑（graceMin=15，見 utils/bookingPulse.js）。
const LATE_GRACE_MIN = 15

// 完整電話（Barry 2026-10-17：iPad 上電話一律完整顯示，不再只秀末 3 碼）：同名「陳先生」靠它分辨、
// 也能直接照著撥；whitespace-nowrap＋shrink-0 不截斷（姓名才 truncate）；無電話不顯示。
const phoneFull = (phone) => (String(phone || '').replace(/\D/g, '').length >= 3 ? formatPhone(phone) : '')

// 未配桌的待到訂位：今天、confirmed/pending、沒有任何桌號、時間窗同鎖桌／預配（前 60／後 60 分）。
export function isUnassignedArriveEligible(booking, now = Date.now()) {
  if (!booking?.id || !booking.timeSlot) return false
  if (!['confirmed', 'pending'].includes(booking.status)) return false
  if (booking.assignedTableId || (booking.extraTableIds || []).filter(Boolean).length) return false
  if (booking.date !== formatDate(new Date(now))) return false
  const overdue = overdueMinOf(booking.timeSlot, now)
  return overdue >= -ARRIVE_WINDOW_BEFORE_MIN && overdue <= ARRIVE_WINDOW_AFTER_MIN
}

// 這筆訂位的全部桌號（主桌＋併桌額外桌，去重去空）
const bookingNums = (b) => [...new Set([b?.assignedTableId, ...(b?.extraTableIds || [])].filter(Boolean).map(String))]

// 判定：鎖桌（桌 reserved、currentBookingId 指向訂位）＋預配（訂位 assignedTableId 指向空桌/他人佔用的桌）。
// 一筆訂位只出一顆 chip（「等報到 N」＝訂位數）：鎖桌的大組每張桌都 reserved 指向同一筆，
// 依訂位去重、優先用主桌（過去同一筆會出兩顆、React key 重複）。
// 每筆帶 nums（整組桌號，chip 顯示「106+105」）與 taken（預配的桌此刻有任一張被別組佔）。
// 排序邏輯不變。純函式匯出方便單測。
export function buildTargets(tables, bookings, now) {
  const bookingMap = {}
  bookings.forEach(b => { if (b.id) bookingMap[b.id] = b })
  const tableMap = {}
  tables.forEach(t => { if (t?.number != null) tableMap[String(t.number)] = t })
  const byBooking = new Map()
  tables.forEach(t => {
    const booking = t.currentBookingId ? bookingMap[t.currentBookingId] : null
    if (!isArriveEligible(t, booking, now)) return
    const isMain = String(booking.assignedTableId) === String(t.number)
    const prev = byBooking.get(booking.id)
    if (!prev || (isMain && !prev.isMain)) {
      byBooking.set(booking.id, { table: t, booking, preassigned: false, taken: false, isMain, nums: bookingNums(booking) })
    }
  })
  bookings.forEach(b => {
    if (!b?.id || byBooking.has(b.id) || !b.assignedTableId) return
    const t = tableMap[String(b.assignedTableId)]
    if (!isPreassignArriveEligible(t, b, now)) return
    const nums = bookingNums(b)
    // 「桌被別組佔」與今日卡／抽屜／到了同一支判斷（arriveSeat.preassignTakenByOthers）
    const taken = preassignTakenByOthers(b, tables)
    byBooking.set(b.id, { table: t, booking: b, preassigned: true, taken, isMain: true, nums })
  })
  bookings.forEach(b => {
    if (!b?.id || byBooking.has(b.id) || !isUnassignedArriveEligible(b, now)) return
    byBooking.set(b.id, { table: null, booking: b, preassigned: false, unassigned: true, taken: false, isMain: true, nums: [] })
  })
  const list = [...byBooking.values()]
  // 排序：遲到（已過訂位時間 >15 分）優先，且越晚到的排越前面；其餘依訂位時段由早到晚。
  return list.sort((a, b) => {
    const oa = overdueMinOf(a.booking.timeSlot, now)
    const ob = overdueMinOf(b.booking.timeSlot, now)
    const lateA = oa > LATE_GRACE_MIN
    const lateB = ob > LATE_GRACE_MIN
    if (lateA !== lateB) return lateA ? -1 : 1
    if (lateA && lateB) return ob - oa
    return String(a.booking.timeSlot || '').localeCompare(String(b.booking.timeSlot || ''))
  })
}

// 防連點／佔位的時間常數（匯出給測試）
export const ARRIVE_GUARD_MS = 600
export const GHOST_UNDO_GUARD_MS = 800
export const GHOST_COLLAPSE_MS = 300   // 復原時效到 → 寬度收起的動畫時間，之後移除
export const BUSY_MAX_MS = 30000       // 處理中（確認框）旗標的逾時保底

// 把「已入座確認卡／佔位」插回原本的位置：優先插在當時右邊那顆之前，其次左邊那顆之後，否則照原索引。
// 尾端的佔位（後面已沒有真的 chip）直接拿掉——拿掉不會讓任何按鈕移位。純函式匯出方便單測。
export function mergeSeatedGhosts(targets = [], ghosts = []) {
  const ghostIds = new Set(ghosts.map(g => g.id))
  const items = targets.filter(t => !ghostIds.has(t.booking.id)).map(t => ({ kind: 'target', key: String(t.booking.id), t }))
  ;[...ghosts].sort((a, b) => a.at - b.at).forEach(g => {
    let pos = g.nextKey != null ? items.findIndex(x => x.key === g.nextKey) : -1
    if (pos < 0) {
      const p = g.prevKey != null ? items.findIndex(x => x.key === g.prevKey) : -1
      pos = p >= 0 ? p + 1 : Math.min(g.index ?? items.length, items.length)
    }
    items.splice(pos, 0, { kind: 'ghost', key: `ghost-${g.id}`, g })
  })
  while (items.length && items[items.length - 1].kind === 'ghost' && items[items.length - 1].g.phase === 'spacer') items.pop()
  return items
}

export default function ArrivalStrip({ tables, bookings, onSelectTable, onArrive, onArriveUnassigned, onArriveReseat, currentFloor = null, now = null, disabled = false }) {
  const scrollRef = useRef(null)
  const [edge, setEdge] = useState({ left: false, right: false })
  const [, setTick] = useState(0)
  // 每 30 秒重繪，讓訂位隨時間推移自然進出視窗、遲到標記即時更新（與 UpcomingPanel 同節奏）。
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 30000)
    return () => clearInterval(id)
  }, [])
  const effectiveNow = now ?? Date.now()

  // 已入座確認卡：{ id, name, guests, label, width, height, undo, seq, armed, gone, phase:'done'|'spacer', prevKey, nextKey, index }
  // phase 'spacer'＝復原時效已過、正在收起（寬度動畫到 0，GHOST_COLLAPSE_MS 後移除）。
  // 計時一律用 setTimeout（不讀 Date.now 比大小）：頁面時鐘被固定（e2e page.clock）或跳動時行為一樣。
  const [ghosts, setGhosts] = useState([])
  // busy：確認框開著（全列）；blocked：逐張 chip 的 600ms 防連點（key＝訂位 id → timer）
  const busy = useRef(false)
  const busyTimer = useRef(null)
  const blocked = useRef(new Map())
  const ghostTimers = useRef({})
  const seq = useRef(0)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    const timers = ghostTimers.current
    const blocks = blocked.current
    return () => {
      mounted.current = false
      clearTimeout(busyTimer.current)
      blocks.forEach(clearTimeout); blocks.clear()
      Object.values(timers).forEach(ids => ids.forEach(clearTimeout))
    }
  }, [])
  const updateGhost = (id, patch) => setGhosts(gs => gs.map(g => (g.id === id ? { ...g, ...patch } : g)))
  const addGhost = (ghost) => {
    ;(ghostTimers.current[ghost.id] || []).forEach(clearTimeout)
    ghostTimers.current[ghost.id] = [
      // 確認卡的「復原」出現後 800ms 才吃點擊（一下觸控送兩次 click 的第二下）
      setTimeout(() => { if (mounted.current) updateGhost(ghost.id, { armed: true }) }, GHOST_UNDO_GUARD_MS),
      // 過了復原時效 → 寬度收起（動畫），收完移除：報到列開頭不留一塊透明空白
      setTimeout(() => { if (mounted.current) updateGhost(ghost.id, { phase: 'spacer', undo: null }) }, SEATED_UNDO_MS),
      setTimeout(() => { if (mounted.current) dropGhost(ghost.id) }, SEATED_UNDO_MS + GHOST_COLLAPSE_MS),
    ]
    setGhosts(gs => [...gs.filter(g => g.id !== ghost.id), ghost])
  }
  const dropGhost = (id) => {
    ;(ghostTimers.current[id] || []).forEach(clearTimeout)
    delete ghostTimers.current[id]
    setGhosts(gs => gs.filter(g => g.id !== id))
  }

  const targets = buildTargets(tables || [], bookings || [], effectiveNow)
  // 確認卡對應的訂位又回到待到（從 toast 或別處復原了）→ 確認卡不再擋住它，讓它照常顯示
  const targetIds = new Set(targets.map(t => String(t.booking.id)))
  const liveGhosts = ghosts.filter(g => !(g.gone && targetIds.has(String(g.id))))
  const items = mergeSeatedGhosts(targets, liveGhosts)
  // 記下「已離開待到名單」（之後又出現＝被復原了）；清掉已被復原的確認卡
  useEffect(() => {
    const toMark = ghosts.filter(g => !g.gone && !targetIds.has(String(g.id)))
    const toDrop = ghosts.filter(g => g.gone && targetIds.has(String(g.id)))
    if (toMark.length) setGhosts(gs => gs.map(g => (toMark.some(x => x.id === g.id) ? { ...g, gone: true } : g)))
    toDrop.forEach(g => dropGhost(g.id))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ghosts, targets.map(t => t.booking.id).join(',')])

  // 純視覺：量測捲動容器，決定左右緣遮罩是否顯示。捲到底/捲到頂就自動消失（不是靠計時器關掉）。
  const updateEdge = () => {
    const el = scrollRef.current
    if (!el) return
    const { scrollLeft, scrollWidth, clientWidth } = el
    setEdge({
      left: scrollLeft > 2,
      right: scrollLeft + clientWidth < scrollWidth - 2,
    })
  }
  // chip 數量變動（訂位進出視窗）時內容寬度會變，重新量一次。
  useEffect(() => {
    updateEdge()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.length])
  // 視窗尺寸變動（例如 iPad 轉向）容器寬度會變，重新量一次。
  useEffect(() => {
    window.addEventListener('resize', updateEdge)
    return () => window.removeEventListener('resize', updateEdge)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!items.length) return null

  // 「到了」：防連點（同一張 600ms 內重按無效；處理中全列無效）；成功（鎖桌／預配一鍵入座）→ 原位留確認卡
  const pressArrive = (e, idx, fire, target, chipId) => {
    e.stopPropagation()
    const key = String(chipId ?? idx)
    if (disabled || busy.current || blocked.current.has(key)) return
    blocked.current.set(key, setTimeout(() => { blocked.current.delete(key) }, ARRIVE_GUARD_MS))
    busy.current = true
    clearTimeout(busyTimer.current)
    // 逾時保底：確認框萬一沒結束（Promise 永不 resolve），也不會讓整列「到了」永遠按不動
    busyTimer.current = setTimeout(() => { busy.current = false }, BUSY_MAX_MS)
    const item = e.currentTarget?.closest?.('[role="listitem"]')
    const rect = item?.getBoundingClientRect?.() || {}
    const place = { prevKey: items[idx - 1]?.key ?? null, nextKey: items[idx + 1]?.key ?? null, index: idx, width: rect.width || 0, height: rect.height || 0 }
    const release = () => { clearTimeout(busyTimer.current); busy.current = false }
    const settle = (r) => {
      if (!target || !r?.ok || !mounted.current) return
      const { booking, table, nums } = target
      const label = r.seatedLabel || ((nums && nums.length > 1) ? nums.join('+') : table?.number)
      addGhost({ id: booking.id, name: booking.name, guests: booking.guests, label, undo: typeof r.undoSeat === 'function' ? r.undoSeat : null, at: ++seq.current, armed: false, gone: false, phase: 'done', ...place })
    }
    let res
    try { res = fire() } catch (err) { release(); throw err }
    // 有確認框（Promise）：框本身擋住連點；框關掉後不再吃下一下（店員取消後重按是刻意的）
    if (res && typeof res.then === 'function') {
      res.then(settle, () => {}).finally(() => { blocked.current.delete(key); release() })
    } else { settle(res); release() }
  }
  const pressGhostUndo = (e, g) => {
    e.stopPropagation()
    if (!g.armed) return
    const u = g.undo?.()
    if (u?.ok) dropGhost(g.id)
  }

  return (
    <div
      data-testid="arrival-strip"
      data-disabled={disabled ? 'true' : undefined}
      inert={disabled ? '' : undefined}
      aria-disabled={disabled || undefined}
      className={`flex-shrink-0 mt-2 pt-2 border-t border-chicken-brown/10 short:col-span-2 short:min-w-0 ${disabled ? 'opacity-45' : ''}`}
    >
      <div className="flex items-center px-0.5 mb-1">
        {/* 總筆數：永遠是真實總數，不管畫面上看得到幾顆——店員看到「等報到 6」但只數到
            3 顆，就知道要往右滑，不會被「看起來已經滿版」的錯覺騙走。 */}
        <span className="text-[11px] font-bold text-chicken-brown/60">等報到 {targets.length}{disabled ? ' · 選桌中，完成後再按到了' : ''}</span>
      </div>
      <div className="relative">
        {edge.left && (
          <div
            data-edge="left"
            aria-hidden="true"
            className="pointer-events-none absolute left-0 top-0 bottom-0 w-8 z-10 bg-gradient-to-r from-white via-white/80 to-transparent"
          />
        )}
        <div
          ref={scrollRef}
          role="list"
          aria-label="可入座名單"
          onScroll={updateEdge}
          className="flex items-center gap-2.5 overflow-x-auto overflow-y-hidden pb-1"
        >
          {items.map((it, idx) => {
            if (it.kind === 'ghost') {
              const g = it.g
              // spacer＝收起中：寬度動畫到 0（負的右邊距吃掉 gap），GHOST_COLLAPSE_MS 後移除
              const spacer = g.phase === 'spacer'
              const size = spacer
                ? { width: 0, minWidth: 0, height: g.height || undefined, marginRight: -10, paddingLeft: 0, paddingRight: 0, borderWidth: 0, overflow: 'hidden' }
                : { width: g.width || undefined, minWidth: g.width || undefined, height: g.height || undefined }
              return (
                <div
                  key={it.key}
                  role="listitem"
                  data-seated-ghost={g.id}
                  data-phase={g.phase}
                  aria-hidden={spacer ? 'true' : undefined}
                  style={size}
                  className={`flex items-center gap-2 shrink-0 max-w-full rounded-full border-2 pl-1.5 pr-3 py-1
                    motion-safe:transition-[width,min-width,margin,padding,opacity] motion-safe:duration-300
                    ${spacer ? 'opacity-0 pointer-events-none border-transparent' : 'bg-chicken-green/10 border-chicken-green/50'}`}
                >
                  {!spacer && (
                    <>
                      {/* 復原放左側：原本的「到了」在 chip 右端，再按一次同一個位置只會落在文字上 */}
                      {g.undo && (
                        <button
                          type="button"
                          data-testid="seated-ghost-undo"
                          disabled={!g.armed}
                          onClick={(e) => pressGhostUndo(e, g)}
                          aria-label={`復原入座 ${g.name}`}
                          className={`${SEAT_SECONDARY} !rounded-full text-xs shrink-0`}
                          style={{ height: 44, minWidth: 44, paddingLeft: 12, paddingRight: 12 }}
                        >
                          復原
                        </button>
                      )}
                      <span role="status" className="min-w-0 flex-1 truncate text-sm font-bold text-chicken-green">
                        {seatedText({ name: g.name, guests: g.guests, tables: g.label })}
                      </span>
                    </>
                  )}
                </div>
              )
            }
            const { table, booking, preassigned, unassigned, taken, nums } = it.t
            const overdueMin = overdueMinOf(booking.timeSlot, effectiveNow)
            const late = overdueMin > LATE_GRACE_MIN
            // 未配桌：沒有桌可看，chip 本體與「到了 · 選桌」都進選桌入座模式（不寫資料、可取消）
            // 預配·桌被佔：有 onArriveReseat 就直接進「換桌入座」（選桌確認＝改配＋入座），不先撞一次入座失敗
            const reseat = !unassigned && preassigned && taken && !!onArriveReseat
            const arrive = unassigned ? () => onArriveUnassigned?.(booking)
              : reseat ? () => onArriveReseat(booking)
              : () => onArrive(table, booking)
            // 只有「一鍵入座」那條會留確認卡；選桌／換桌是進模式，不入座
            const seatsNow = !unassigned && !reseat
            if (unassigned) {
              return (
                <div
                  key={it.key}
                  data-unassigned="true"
                  role="listitem"
                  onClick={arrive}
                  className={`flex items-center gap-2 shrink-0 max-w-full cursor-pointer rounded-full border-2 pl-3 pr-1.5 py-1 transition-colors
                    ${late ? 'bg-chicken-red/5 border-chicken-red/40' : 'bg-white border-chicken-brown/15 hover:border-chicken-brown/30'}`}
                >
                  <span className="flex items-center gap-2 min-w-0 overflow-hidden">
                    <span className={`tabular-nums text-xs font-bold ${late ? 'text-chicken-red' : 'text-chicken-brown'}`}>
                      {booking.timeSlot}
                    </span>
                    <span className="text-sm font-bold text-chicken-brown truncate max-w-[7rem]">{booking.name}</span>
                    {phoneFull(booking.phone) && <span data-testid="phone-full" className="text-xs font-bold text-chicken-brown/70 tabular-nums whitespace-nowrap shrink-0 -ml-1">{phoneFull(booking.phone)}</span>}
                    <span className="text-[11px] font-bold text-chicken-brown/50 tabular-nums whitespace-nowrap">{booking.guests} 位</span>
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0 bg-amber-100 text-amber-800"
                      title="還沒配桌：按到了在桌況圖選一張空桌，確認即入座">
                      未配桌
                    </span>
                    {late && (
                      <span className="text-[10px] font-bold text-white bg-chicken-red px-1.5 py-0.5 rounded-full shrink-0">
                        遲到
                      </span>
                    )}
                  </span>
                  <button
                    type="button"
                    onClick={(e) => pressArrive(e, idx, arrive, null, booking.id)}
                    aria-label={`${booking.name} 到了，選桌入座`}
                    className={`${SEAT_PRIMARY} !rounded-full text-xs shrink-0`}
                    style={{ height: 44, minWidth: 44, paddingLeft: 12, paddingRight: 12 }}
                  >
                    到了 · 選桌
                  </button>
                </div>
              )
            }
            // 跨樓層標記：只有桌所在樓層跟目前顯示的樓層不同才標，避免同樓層 chip 多一截視覺噪音。
            const crossFloor = currentFloor != null && table.floor !== currentFloor
            // 大組顯示整組桌號（主桌在前）
            const label = (nums && nums.length > 1) ? nums.join('+') : table.number
            return (
              <div
                key={it.key}
                data-preassigned={preassigned ? 'true' : undefined}
                role="listitem"
                onClick={() => onSelectTable(table.number)}
                className={`flex items-center gap-2 shrink-0 max-w-full cursor-pointer rounded-full border-2 pl-3 pr-1.5 py-1 transition-colors
                  ${late ? 'bg-chicken-red/5 border-chicken-red/40' : 'bg-white border-chicken-brown/15 hover:border-chicken-brown/30'}`}
              >
                <span className="flex items-center gap-2 min-w-0 overflow-hidden">
                  <span className={`tabular-nums text-xs font-bold ${late ? 'text-chicken-red' : 'text-chicken-brown'}`}>
                    {booking.timeSlot}
                  </span>
                  <span className="text-sm font-bold text-chicken-brown truncate max-w-[7rem]">{booking.name}</span>
                  {phoneFull(booking.phone) && <span data-testid="phone-full" className="text-xs font-bold text-chicken-brown/70 tabular-nums whitespace-nowrap shrink-0 -ml-1">{phoneFull(booking.phone)}</span>}
                  <span
                    className={`text-[11px] font-bold whitespace-nowrap ${crossFloor ? 'text-chicken-brown/70' : 'text-chicken-brown/50'}`}
                    title={crossFloor ? `此桌在 ${table.floor}，點選會自動切換樓層` : undefined}
                  >
                    {crossFloor ? `${table.floor} ${label}` : label}
                  </span>
                  <span data-testid="arrival-guests" className="text-[11px] font-bold text-chicken-brown/50 tabular-nums whitespace-nowrap shrink-0">{booking.guests} 位</span>
                  {preassigned && (
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0 ${
                      taken ? 'bg-amber-100 text-amber-800' : 'bg-blue-100 text-blue-800'}`}
                      title={taken ? `${label} 此刻有別組：按「到了 · 換桌」選一張空桌，確認即入座` : '預配：桌子沒鎖，按到了直接入座'}>
                      {taken ? '預配·桌被佔' : '預配'}
                    </span>
                  )}
                  {late && (
                    <span className="text-[10px] font-bold text-white bg-chicken-red px-1.5 py-0.5 rounded-full shrink-0">
                      遲到
                    </span>
                  )}
                </span>
                <button
                  type="button"
                  onClick={(e) => pressArrive(e, idx, arrive, seatsNow ? it.t : null, booking.id)}
                  aria-label={reseat ? `${booking.name} 到了，換桌入座` : `${booking.name} 到了，入座 ${table.number}`}
                  className={`${SEAT_PRIMARY} !rounded-full text-xs shrink-0`}
                  style={{ height: 44, minWidth: 44, paddingLeft: 12, paddingRight: 12 }}
                >
                  {reseat ? '到了 · 換桌' : <GlyphText size={15}>✓ 到了</GlyphText>}
                </button>
              </div>
            )
          })}
        </div>
        {edge.right && (
          <div
            data-edge="right"
            aria-hidden="true"
            className="pointer-events-none absolute right-0 top-0 bottom-0 w-8 z-10 bg-gradient-to-l from-white via-white/80 to-transparent"
          />
        )}
      </div>
    </div>
  )
}
