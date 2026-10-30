import { useEffect, useMemo, useRef, useState } from 'react'
import {
  User, Bus, ChevronLeft, ChevronRight, CalendarDays, Check, X, ArrowLeftRight, Ban, ExternalLink, Lightbulb, Armchair,
  Phone, Pencil, Ellipsis, Plus, Lock, History,
} from 'lucide-react'
import FloorMap from '../floormap/FloorMap'
import SegmentedControl from '../../ui/SegmentedControl'
import { useBooking } from '../../../contexts/BookingContext'
import { useAuth } from '../../../contexts/AuthContext'
import { useHandoff } from '../../../contexts/HandoffContext'
import { useToast } from '../../ui/Toast'
import { seatingPerms } from '../../../utils/seatingPerms'
import { dayLabel, seatingForSlot, todayStr } from '../../../utils/timeSlots'
import { resolveSlotOccupancy, isSeatingClosed, isDayClosedForClosures, lockKindFor } from '../../../utils/capacity'
import { formatPhone } from '../../../utils/phoneFormat'
import {
  buildDaySeatingList, sectionSummaryText, firstUnassigned, nextUnassigned,
  assignableTables, pickTableError, evaluatePick, heldTableNumbers, undoUnassignBlocker, EDITABLE_STATUSES,
} from '../../../utils/daySeatingPlan'
import { suggestComboFromPool } from '../../../services/seatingService'
import { useBookingActions } from '../../booking/useBookingActions'
import EditBookingModal from '../../booking/EditBookingModal'
import BookingDetailSheet from '../../booking/BookingDetailSheet'

// 當日排位：點日期就看到「當天全部訂位」＋同畫面排桌（Barry 2026-10-30：「按入日期後直接展開當天所有的訂位，並且可以排位子」）。
//   左：當天訂位（散客＋團體），依場次分組、組內依時段；每筆標未配桌／已配桌（桌號）／已到。
//   右：該場次桌況圖（散客暖色、團客冷色）。
// Smart defaults：進來就選「最早一筆未配桌」及其場次、地圖切到建議桌的樓層；排完自動跳下一筆。
// 寫入依日期分流（專案規則：今天走現場指派語意、未來走預配），一律呼叫既有的 BookingContext 函式，不另寫一套：
//   未來日 → 預配（preassignBookingTable(s)／clearBookingPreassign，只改 booking、不動桌況）
//   今天   → 與現場頁指派模式同一支：鎖桌時機 capacity.lockKindFor（離用餐 ≤ 30 分＝鎖桌）
//            新配桌：鎖桌型 assignBookingTablesMulti（此刻空桌才行、桌況鎖 reserved）；預配型 preassignBookingTable(s)
//            改桌：replacePendingBookingTables（現場改桌同一支，自己判斷鎖桌時機、只釋放本筆持有的桌）
//            取消配桌：releaseOverriddenAssignment（只釋放本筆持有的 reserved 桌）；復原走 restoreOverriddenAssignment
//            可選桌帶入現場口徑（鎖桌型 findSuitableTables＝此刻空桌；預配型 preassignableTables）
// 可選桌與防呆全在 utils/daySeatingPlan（沿用 resolveSlotOccupancy／assignmentWindow／squeezeSeats／isTableUsableOnDate）。
// 團體只顯示＋開團單詳情，這版不在這裡改圈桌。
// 選中散客時，訂位卡（BookingCard）原本的動作搬進來：聯絡／編輯／交班事項／更多（詳情、現場改桌、直接釋出、No-show、取消訂位），
// 一律走 useBookingActions（顯示條件、確認框、復原、權限門與訂位卡同一份），這裡不另寫一套。
// 不能排位的情況（只能看）：唯讀角色（kitchen，無 booking.update）、公休、過去日期、今天已在現場鎖桌（改桌走現場頁）。
// props：
//   headerStart（選用）：放在控制列最前面的節點（規劃頁放「當日總覽／當日排位／排位地圖」分頁，一下就切得回當日總覽）
//   onBackToCalendar（選用）：「月曆」返回鈕（訂位頁用）
//   onMoveTable（選用）：今天已鎖桌訂位的「改桌」→ 現場頁 move 模式（同訂位卡 onMove）
//   onAddBooking（選用）：當天沒有訂位時的「新增訂位」入口（過去日期不給）
export default function DaySeatingPanel({
  date, onShiftDay, onBackToCalendar, onOpenGroup, headerStart, onMoveTable, onAddBooking,
  seatingId: seatingIdProp, onSeatingChange, floor: floorProp, onFloorChange,
}) {
  const {
    settings, bookings, groupReservations, tables, fixtures, zones,
    preassignBookingTable, preassignBookingTables, clearBookingPreassign,
    assignBookingTablesMulti, replacePendingBookingTables, releaseOverriddenAssignment, restoreOverriddenAssignment,
    findSuitableTables, preassignableTables,
  } = useBooking()
  // 未來日預配只改 booking → 權限＝seatingPerms.booking（booking.update），與規劃「排位地圖」的配桌同一道門；
  // 今天走現場指派（可能鎖桌、釋桌 → 也寫 tables）→ 權限＝seatingPerms.seat（同現場指派）
  const perms = seatingPerms(useAuth()?.can)
  const isPast = date < todayStr()
  const isToday = date === todayStr()
  const canPreassign = isToday ? perms.seat : perms.booking
  const toast = useToast()

  const seatings = useMemo(() => (Array.isArray(settings?.seatings) ? settings.seatings : []), [settings])
  const [seatingLocal, setSeatingLocal] = useState('')
  const [floorLocal, setFloorLocal] = useState('1F')
  const seatingId = (onSeatingChange ? seatingIdProp : seatingLocal) || seatings[0]?.id || ''
  const floor = (onFloorChange ? floorProp : floorLocal) || '1F'
  const setSeatingId = (id) => (onSeatingChange ? onSeatingChange(id) : setSeatingLocal(id))
  const setFloor = (f) => (onFloorChange ? onFloorChange(f) : setFloorLocal(f))

  const [activeKey, setActiveKey] = useState(null) // 'b:<bookingId>' | 'g:<groupId>:<batchId>'
  const [editing, setEditing] = useState(false)    // 排位中（地圖可點選桌）
  const [picked, setPicked] = useState([])         // 已選桌（併桌累加）
  const [clock, setClock] = useState(0)            // 確認時跨過鎖桌門檻 → 重算可選桌（見 confirm）
  const listRef = useRef(null)

  const list = useMemo(
    () => buildDaySeatingList({ bookings, groupReservations, date, settings }),
    [bookings, groupReservations, date, settings],
  )
  const allItems = useMemo(() => [...list.sections.flatMap(s => s.items), ...list.unscheduled], [list])
  const section = list.sections.find(s => s.seating.id === seatingId) || list.sections[0] || null
  const seating = section?.seating || null
  const activeItem = activeKey ? allItems.find(i => i.key === activeKey) || null : null
  const activeBooking = activeItem?.kind === 'walkin' ? activeItem.booking : null
  const dayClosed = isDayClosedForClosures(settings, date)
  // 能不能在這裡配桌／改桌／取消配桌（單一判斷，清單選人、動作列、確認都用它）：
  //   公休日（utils 的 assignableTables／evaluatePick 也各自再擋一次）、過去日期、今天已現場鎖桌 → 只能看
  const canEditBooking = (b) => !!b && canPreassign && !dayClosed && !isPast
    && EDITABLE_STATUSES.includes(b.status) && heldTableNumbers(b, tables).length === 0
  const editable = canEditBooking(activeBooking)
  const assignMode = editing && editable
  const onlineClosed = seating ? isSeatingClosed(settings, date, seating) && !dayClosed : false

  // 最新資料給「復原」閉包用（toast 的 onClick 會在之後才觸發）
  const latest = useRef({})
  latest.current = { bookings, tables, groupReservations, settings, preassignableTables, restoreOverriddenAssignment, preassignBookingTable, preassignBookingTables }

  const selectItem = (item, { scroll = false } = {}) => {
    if (!item) { setActiveKey(null); setEditing(false); setPicked([]); return }
    setActiveKey(item.key)
    setPicked([])
    const sid = seatingForSlot(settings, item.timeSlot)?.id
    if (sid && sid !== seatingId) setSeatingId(sid)
    setEditing(item.kind === 'walkin' && canEditBooking(item.booking) && item.state === 'unassigned')
    // 地圖切到這筆的桌所在樓層（已配桌／團體）；未配桌的等建議桌算出來再切（見下方 effect）
    const first = item.tables?.[0] && tables.find(t => String(t.number) === String(item.tables[0]))
    if (first?.floor && first.floor !== floor) setFloor(first.floor)
    if (scroll) requestAnimationFrame(() => listRef.current?.querySelector(`[data-key="${CSS.escape(item.key)}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }))
  }

  // Smart default：換日（含首次進來）→ 選最早一筆未配桌＋其場次；都配好了 → 第一個有訂位的場次
  const defaultedFor = useRef(null)
  useEffect(() => {
    if (defaultedFor.current === date) return
    defaultedFor.current = date
    const d = firstUnassigned(list)
    if (d.seatingId) setSeatingId(d.seatingId)
    const item = d.bookingId ? allItems.find(i => i.key === `b:${d.bookingId}`) : null
    selectItem(item, { scroll: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date])

  // 可選桌（排位中才算）：扣掉自己後的同場次佔用＋assignmentWindow 重疊＋停用／維修＋公休
  const activeSeating = activeBooking ? (seatingForSlot(settings, activeBooking.timeSlot) || seating) : seating
  // 寫入語意：未來日一律預配；今天依鎖桌時機（與現場頁指派同一個判斷）。clock 只是讓確認時能強制重算
  const assignKind = assignMode && isToday ? lockKindFor({ date, timeSlot: activeBooking.timeSlot }) : 'preassign'
  // 今天：現場口徑的可選桌（鎖桌型＝此刻空桌；預配型＝此刻的佔用不延續進預配區間），與現場頁 startAssign 同一支
  const liveAllowed = useMemo(() => {
    if (!assignMode || !isToday) return null
    const list = assignKind === 'hold'
      ? findSuitableTables?.(1)
      : preassignableTables?.(1, { bookingId: activeBooking.id, date, timeSlot: activeBooking.timeSlot })
    return (list || []).map(t => String(t.number))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignMode, isToday, assignKind, tables, bookings, activeBooking, date, clock])
  const assign = useMemo(() => {
    if (!assignMode) return null
    return assignableTables({ tables, bookings, groupReservations, date, seating: activeSeating, settings, booking: activeBooking, lockKind: assignKind, liveAllowed })
  }, [assignMode, tables, bookings, groupReservations, date, activeSeating, settings, activeBooking, assignKind, liveAllowed])
  const free = useMemo(() => assign?.free || [], [assign])

  const occupancy = useMemo(
    () => resolveSlotOccupancy(tables, bookings, groupReservations, date, seating, settings, { ignoreOnlineClosure: true }),
    [tables, bookings, groupReservations, date, seating, settings],
  )
  const mapByTable = assign ? assign.byTable : occupancy.byTable

  const evalPick = assignMode ? evaluatePick({ booking: activeBooking, picked, free, tables, date, settings }) : null

  // 建議桌（未選任何桌時顯示，一鍵套用）：與現場「建議組合」同一個演算法，桌池換成這筆的可選桌
  const suggestion = useMemo(() => {
    if (!assignMode || picked.length) return null
    const pool = tables.filter(t => free.includes(String(t.number)))
    const s = suggestComboFromPool(pool, Number(activeBooking?.guests) || 1)
    return s.enough && s.tableNumbers.length ? s : null
  }, [assignMode, picked.length, tables, free, activeBooking])

  // 選到未配桌的那一刻，地圖切到建議桌的樓層（只在換人時切一次，不跟使用者搶樓層）
  const floorSyncedFor = useRef(null)
  useEffect(() => {
    if (!assignMode || !suggestion?.floor) return
    if (floorSyncedFor.current === activeKey) return
    floorSyncedFor.current = activeKey
    if (suggestion.floor !== floor) setFloor(suggestion.floor)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignMode, activeKey, suggestion?.floor])

  const handleTableClick = (number) => {
    const n = String(number)
    if (assignMode) {
      if (picked.includes(n)) return setPicked(prev => prev.filter(x => x !== n))
      const err = pickTableError({ number: n, picked, free, tables, date, settings, byTable: mapByTable, lockKind: assignKind, bookingId: activeBooking?.id, liveAllowed })
      if (err) return toast.error(err)
      return setPicked(prev => [...prev, n])
    }
    // 非排位中：點桌＝選中坐在這桌的那筆
    const occ = mapByTable[n]
    if (occ?.kind === 'walkin') return selectItem(allItems.find(i => i.key === `b:${occ.booking.id}`), { scroll: true })
    if (occ?.kind === 'group') return selectItem(allItems.find(i => i.kind === 'group' && i.group.id === occ.group.id && i.batch === occ.batch) || null, { scroll: true })
  }

  const confirm = () => {
    if (!assignMode) return
    const b = activeBooking
    // 選桌期間跨過鎖桌門檻（同現場頁 confirmWalkinMulti）：先重算可選桌與語意，讓店員再確認，不以舊口徑寫入
    const kindNow = isToday ? lockKindFor({ date, timeSlot: b.timeSlot }) : 'preassign'
    if (kindNow !== assignKind) {
      setClock(c => c + 1)
      return toast.info('已接近用餐時段，配桌將鎖桌；請確認更新後的可選桌，再按確認')
    }
    const ev = evaluatePick({ booking: b, picked, free, tables, date, settings })
    if (!ev.ok) return toast.error(ev.error)
    const wasUnassigned = activeItem.state === 'unassigned'
    if (isToday && !wasUnassigned) {
      // 今天改桌：現場改桌同一支（自己判斷鎖桌時機、只釋放本筆持有的桌、雙寫失敗會還原）
      const r = replacePendingBookingTables(b.id, picked)
      if (!r?.ok) return toast.error('改桌失敗：' + (r?.error || '未知錯誤'))
    } else if (assignKind === 'hold') {
      // 今天、離用餐 ≤ 30 分：現場指派同一支（此刻空桌才行，桌況鎖成 reserved）
      const r = assignBookingTablesMulti(b.id, picked)
      if (!r?.ok) return toast.error('配桌失敗：' + (r?.error || '未知錯誤'))
    } else {
      const ok = picked.length === 1 ? preassignBookingTable(b.id, picked[0]) : preassignBookingTables(b.id, picked)
      if (!ok) return toast.error('配桌失敗：訂位不存在（可能已被其他裝置刪除）')
    }
    const tail = ev.squeezed ? `（擠一擠超坐 ${ev.need - ev.seats} 位）` : ''
    const how = assignKind === 'hold' ? `已${picked.length > 1 ? '併桌' : ''}指派並鎖桌 ${picked.join(' + ')}`
      : isToday ? `已${picked.length > 1 ? '併桌' : ''}預配 ${picked.join(' + ')}（桌子現在仍可帶位）`
        : `已${picked.length > 1 ? '併桌' : ''}配到 ${picked.join(' + ')}`
    toast.success(`${b.name}（${ev.need} 位）${how}${tail}`)
    // 排完自動跳下一筆未配桌（改桌則留在原筆）
    const next = wasUnassigned ? nextUnassigned(list, b.id) : null
    if (next) {
      selectItem(allItems.find(i => i.key === `b:${next.bookingId}`), { scroll: true })
    } else {
      setEditing(false); setPicked([])
      if (wasUnassigned) toast.info('這天的散客都配好桌了')
    }
  }

  const startMove = () => {
    if (!editable) return
    setPicked(activeItem.tables.slice())
    setEditing(true)
  }

  const unassign = () => {
    if (!editable || !activeItem.tables.length) return
    const b = activeBooking
    const prev = activeItem.tables.slice()
    const today = isToday
    let released = []
    if (today) {
      // 今天：只釋放本筆持有的 reserved 桌（別人的桌、已入座的桌不動），再清桌號
      const r = releaseOverriddenAssignment(b.id)
      if (!r?.ok) return toast.error('取消配桌失敗：' + (r?.error || '未知錯誤'))
      released = r.released || []
    } else {
      clearBookingPreassign(b.id)
    }
    setEditing(true); setPicked([])
    toast.action(`已取消 ${b.name} 的配桌（${prev.join(' + ')}）`, {
      label: '復原',
      onClick: () => {
        // 復原前重驗（toast 還在的期間資料可能已變）：訂位仍待到、仍是這一天、仍未配桌；
        // 桌要仍可選（期間可能被別筆配走／停用）。任一不符就安全失敗，不硬搶
        const L = latest.current
        const fresh = L.bookings.find(x => x.id === b.id)
        const blocker = undoUnassignBlocker(fresh, date)
        if (blocker) return toast.error(blocker)
        const s = seatingForSlot(L.settings, fresh.timeSlot)
        // 寫回的是原本的預配（不鎖桌）；今天再帶現場口徑（此刻的佔用不可延續進用餐區間）
        const live = today ? (L.preassignableTables?.(1, { bookingId: b.id, date, timeSlot: fresh.timeSlot }) || []).map(t => String(t.number)) : null
        const { free: f } = assignableTables({ tables: L.tables, bookings: L.bookings, groupReservations: L.groupReservations, date, seating: s, settings: L.settings, booking: fresh, liveAllowed: live })
        const lost = prev.filter(n => !f.includes(n))
        if (lost.length) return toast.error(`無法復原：桌 ${lost.join('、')} 已被佔用或停用，請重新選桌`)
        if (today) {
          // 與現場覆蓋預配的復原同一支：原本鎖著的桌只在仍是空桌時才重新鎖回
          const r = L.restoreOverriddenAssignment({ bookingId: b.id, tableNumbers: prev, released })
          if (!r?.ok) return toast.error('無法復原：' + (r?.error || '未知錯誤'))
        } else if (prev.length === 1) L.preassignBookingTable(b.id, prev[0]); else L.preassignBookingTables(b.id, prev)
        setEditing(false); setPicked([])
        toast.success(`已復原 ${b.name} 的配桌（${prev.join(' + ')}）`)
      },
    })
  }

  const switchSeating = (id) => {
    if (id === seatingId) return
    setSeatingId(id)
    // 換場次 → 預設選該場次最早一筆未配桌（沒有就不選人）
    const sec = list.sections.find(s => s.seating.id === id)
    const hit = sec?.items.find(i => i.kind === 'walkin' && i.state === 'unassigned' && EDITABLE_STATUSES.includes(i.booking.status))
    selectItem(hit || null, { scroll: true })
  }

  if (!seating) {
    return <div className="rounded-xl border border-dashed border-chicken-brown/20 bg-white p-8 text-center text-sm text-chicken-brown/70">尚未設定場次，請先到「設定 → 場次設定」新增午餐／晚餐場次。</div>
  }

  const focusTables = assignMode ? picked : (activeItem?.tables || [])
  const totalUnassigned = list.sections.reduce((s, x) => s + x.unassigned, 0)

  return (
    <div className="space-y-3" data-testid="day-seating">
      {/* 控制層（玻璃）：月曆／日期／場次／一行摘要，一列放完（iPad 橫向的垂直空間留給地圖）。
          sticky：清單捲很長時仍可換場次／換日 */}
      <div className="lg-chrome sticky top-0 z-20 rounded-2xl px-2.5 py-1.5 flex items-center gap-x-2 gap-y-1.5 flex-wrap">
        {headerStart}
        {onBackToCalendar && (
          <button type="button" onClick={onBackToCalendar} className="tap inline-flex items-center gap-1.5 min-h-[44px] px-3 rounded-xl bg-white/80 border border-chicken-brown/15 text-[13px] font-semibold text-chicken-brown">
            <CalendarDays size={16} strokeWidth={2} aria-hidden="true" />月曆
          </button>
        )}
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => onShiftDay?.(-1)} aria-label="前一日" className="tap w-11 h-11 rounded-xl bg-white/80 border border-chicken-brown/15 text-chicken-brown flex items-center justify-center"><ChevronLeft size={18} strokeWidth={2.2} /></button>
          <span data-testid="day-seating-date" className="inline-flex items-center h-11 rounded-xl bg-white border border-chicken-brown/10 px-3 text-[15px] font-semibold text-chicken-brown tabular-nums whitespace-nowrap">
            {dayLabel(date)}{dayClosed ? ' · 公休' : ''}
          </span>
          <button type="button" onClick={() => onShiftDay?.(1)} aria-label="後一日" className="tap w-11 h-11 rounded-xl bg-white/80 border border-chicken-brown/15 text-chicken-brown flex items-center justify-center"><ChevronRight size={18} strokeWidth={2.2} /></button>
        </div>
        <SegmentedControl
          ariaLabel="場次"
          value={seating.id}
          onChange={switchSeating}
          options={list.sections.map(s => ({
            key: s.seating.id, label: s.seating.name, badge: s.unassigned,
            muted: isSeatingClosed(settings, date, s.seating),
            title: `${s.seating.start}–${s.seating.end} · ${s.count} 組${s.unassigned ? `，未配桌 ${s.unassigned}` : ''}`,
          }))}
        />
        <div className="ml-auto text-[13px] font-semibold text-chicken-brown/75 tabular-nums" data-testid="day-seating-summary">
          {sectionSummaryText(section)}
          {totalUnassigned > section.unassigned && <span className="ml-1.5 font-medium text-chicken-brown/60">（全天 {totalUnassigned}）</span>}
        </div>
      </div>

      {dayClosed && (
        <div role="alert" className="flex items-start gap-2 rounded-xl bg-rose-50 border border-rose-200 px-3 py-2.5 text-sm font-semibold text-rose-800">
          <Ban size={18} className="shrink-0 mt-px" aria-hidden="true" />
          <span>本日公休：只能看，不能配桌。要營業請先到「設定 → 休店」取消公休。</span>
        </div>
      )}
      {isPast && !dayClosed && (
        <div role="status" className="flex items-start gap-2 rounded-xl bg-slate-100 border border-slate-200 px-3 py-2 text-[13px] font-semibold text-slate-800">
          <History size={16} className="shrink-0 mt-px" aria-hidden="true" />
          <span>過去的日期：只能看，不能配桌（未到、取消等補登照訂位卡規則）。</span>
        </div>
      )}
      {!canPreassign && (
        <div role="status" className="flex items-start gap-2 rounded-xl bg-slate-100 border border-slate-200 px-3 py-2 text-[13px] font-semibold text-slate-800">
          <Lock size={16} className="shrink-0 mt-px" aria-hidden="true" />
          <span>唯讀：你的帳號只能查看當日訂位與桌況，不能配桌。</span>
        </div>
      )}
      {onlineClosed && (
        <div className="flex items-start gap-2 rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-[13px] font-semibold text-amber-900">
          <Ban size={16} className="shrink-0 mt-px" aria-hidden="true" />
          <span>{seating.name} 線上訂位已關閉（後台仍可配桌）</span>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-[minmax(250px,320px)_minmax(0,1fr)] gap-3 items-start">
        {/* 左：當天這個場次的全部訂位 */}
        <div ref={listRef} className="bg-white rounded-xl border border-chicken-brown/10 overflow-hidden" aria-label={`${seating.name} 訂位清單`}>
          {allItems.length === 0 ? (
            <div data-testid="day-seating-empty" className="px-4 py-8 text-center space-y-3">
              <p className="text-sm font-semibold text-chicken-brown/75">{dayLabel(date)} 還沒有任何訂位。</p>
              {onAddBooking && !isPast && !dayClosed && (
                <button type="button" onClick={() => onAddBooking(date)}
                  className="tap inline-flex items-center gap-1.5 min-h-[44px] px-4 rounded-lg bg-chicken-red text-white text-sm font-bold">
                  <Plus size={16} strokeWidth={2.4} aria-hidden="true" />新增訂位
                </button>
              )}
            </div>
          ) : section.items.length === 0 ? (
            <p className="px-4 py-6 text-sm text-chicken-brown/70">{seating.name} 沒有訂位，可切換上方場次。</p>
          ) : (
            <ul className="divide-y divide-chicken-brown/[0.08]">
              {section.items.map(item => (
                <li key={item.key}>
                  <BookingRow item={item} active={item.key === activeKey} onSelect={() => selectItem(item)} />
                  {item.key === activeKey && !assignMode && (item.kind === 'group' ? (
                    <GroupDetail group={item.group} onOpenGroup={onOpenGroup} />
                  ) : (
                    <WalkinDetail item={item} editable={editable}
                      dayClosed={dayClosed} isPast={isPast} held={heldTableNumbers(item.booking, tables).length > 0}
                      onAssign={() => { setEditing(true); setPicked([]) }}
                      onMove={startMove} onUnassign={unassign} onMoveTable={onMoveTable} />
                  ))}
                </li>
              ))}
            </ul>
          )}
          {list.unscheduled.length > 0 && (
            <p className="px-4 py-2 text-xs text-chicken-brown/70 border-t border-chicken-brown/[0.08]">另有 {list.unscheduled.length} 筆時段不在任何場次內（請到訂位頁處理）。</p>
          )}
        </div>

        {/* 右：排位橫幅＋該場次桌況圖（sticky：清單捲動時留在眼前） */}
        <div className="md:sticky md:top-[64px] space-y-2">
          {assignMode && (
            <div data-testid="seat-banner" className="lg-mode bg-orange-700 text-white px-3 py-2 rounded-xl space-y-1.5">
              <div className="flex items-center gap-2 flex-wrap">
                <Armchair size={18} aria-hidden="true" />
                <span className="text-sm font-bold">{activeItem.tables.length ? '改桌' : '排位'}：{activeBooking.name}（{activeBooking.guests} 位 · {activeBooking.timeSlot}）</span>
                <span className={`inline-flex items-center px-2 h-7 rounded-lg text-[13px] font-bold tabular-nums ${evalPick?.ok ? 'bg-white text-emerald-800' : 'bg-white text-chicken-brown'}`}>
                  已選 {evalPick?.seats || 0}/{evalPick?.need} 席 · {picked.length} 桌
                </span>
                {assignKind === 'hold' && <span data-testid="hold-badge" className="text-xs font-bold bg-white/20 text-white px-2 py-1 rounded">接近用餐：確認後鎖桌</span>}
                {evalPick?.squeezed && <span data-testid="squeeze-badge" className="text-xs font-bold bg-amber-300 text-amber-950 px-2 py-1 rounded">擠一擠 · 超坐 {evalPick.need - evalPick.seats} 位</span>}
                <span className="flex-1" />
                <button type="button" onClick={() => { setEditing(false); setPicked([]) }} aria-label="取消排位" className="tap inline-flex items-center justify-center w-11 h-11 rounded-lg bg-white/15 text-white"><X size={18} aria-hidden="true" /></button>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <div className="text-[13px] font-semibold flex-1 min-w-[12rem]">
                  {picked.length
                    ? <>已選：<span className="tabular-nums">{picked.join(' + ')}</span>{evalPick?.short > 0 && <span className="ml-2">— 擠一擠也還差 {evalPick.short} 位</span>}</>
                    : suggestion
                      ? <span className="inline-flex items-center gap-1.5"><Lightbulb size={16} aria-hidden="true" />建議 {suggestion.tableNumbers.join(' + ')}{suggestion.squeezed ? '（擠一擠）' : ''}，或點地圖上框起來的空桌</span>
                      : free.length ? '點地圖上框起來的空桌（可點多張同層小桌併桌）' : '這個時段沒有可用的空桌了'}
                </div>
                {!picked.length && suggestion && (
                  <button type="button" onClick={() => { setPicked(suggestion.tableNumbers.map(String)); if (suggestion.floor && suggestion.floor !== floor) setFloor(suggestion.floor) }}
                    className="tap min-h-[44px] px-3 rounded-lg bg-white/95 text-orange-800 text-sm font-bold whitespace-nowrap">套用建議</button>
                )}
                <button type="button" onClick={confirm} disabled={!evalPick?.ok}
                  className={`tap inline-flex items-center gap-1 min-h-[44px] px-4 rounded-lg text-sm font-bold whitespace-nowrap ${evalPick?.ok ? 'bg-white text-emerald-800' : 'bg-white/30 text-white cursor-not-allowed'}`}>
                  <Check size={16} strokeWidth={2.6} aria-hidden="true" />{picked.length > 1 ? '確認併桌' : '確認'}
                </button>
              </div>
            </div>
          )}
          <div className="bg-white rounded-xl border border-chicken-brown/10 p-2">
            <div className="flex items-center justify-between gap-2 mb-1 flex-wrap">
              <SegmentedControl options={[{ key: '1F', label: '1F' }, { key: '2F', label: '2F' }]} value={floor} onChange={setFloor} ariaLabel="樓層" />
              <div className="flex items-center gap-3 text-xs font-semibold text-chicken-brown/70 flex-wrap">
                <span className="inline-flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-sm" style={{ background: '#ea580c' }} />散客</span>
                <span className="inline-flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-sm" style={{ background: '#4f46e5' }} />團客</span>
                <span className="inline-flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-sm border border-slate-300" style={{ background: '#e2e8f0' }} />空桌</span>
                {assignMode && <span className="inline-flex items-center gap-1 text-emerald-800"><i className="h-2.5 w-2.5 rounded-sm border-2 border-dashed border-lime-600" />可選</span>}
              </div>
            </div>
            <div className={`rounded-lg overflow-hidden border border-chicken-brown/5 min-h-[340px] ${assignMode ? 'h-[calc(100dvh-330px)]' : 'h-[calc(100dvh-230px)]'} max-h-[640px]`} style={{ background: '#faf8f5' }}>
              <FloorMap
                floor={floor}
                tables={tables}
                settings={settings}
                selectedTableNumber={null}
                onSelectTable={handleTableClick}
                scopedMode
                scopedByTable={mapByTable}
                scopedClosed={dayClosed}
                scopedHighlightTables={assignMode ? free : []}
                scopedFocusTables={focusTables}
                mapDate={date}
                fixtures={fixtures}
                zones={zones}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

const STATE_CHIP = {
  unassigned: 'bg-chicken-red text-white',
  assigned: 'bg-emerald-50 text-emerald-800 ring-1 ring-inset ring-emerald-200',
  arrived: 'bg-slate-100 text-slate-700',
}

function stateText(item) {
  if (item.state === 'arrived') return '已到'
  if (item.kind === 'group') return item.tables.length ? `團保 ${item.tables.join('、')}` : '未圈桌'
  return item.state === 'assigned' ? `桌 ${item.tables.join('+')}` : '未配桌'
}

function BookingRow({ item, active, onSelect }) {
  const isGroup = item.kind === 'group'
  const chip = isGroup
    ? (item.tables.length ? 'bg-indigo-50 text-indigo-800 ring-1 ring-inset ring-indigo-200' : 'bg-amber-50 text-amber-900 ring-1 ring-inset ring-amber-200')
    : STATE_CHIP[item.state]
  return (
    <button type="button" data-key={item.key} onClick={onSelect} aria-pressed={active}
      className={`tap w-full text-left flex items-center gap-2.5 min-h-[56px] px-3 py-2 ${active ? 'bg-orange-50 shadow-[inset_3px_0_0_#c2410c]' : 'hover:bg-chicken-brown/[0.03]'}`}>
      <span className="w-11 shrink-0 text-[13px] font-semibold text-chicken-brown/75 tabular-nums">{item.timeSlot}</span>
      {isGroup ? <Bus size={18} className="shrink-0 text-indigo-700" aria-hidden="true" /> : <User size={18} className="shrink-0 text-amber-700" aria-hidden="true" />}
      <span className="flex-1 min-w-0">
        <span className="block text-[15px] font-semibold text-chicken-brown truncate">{item.name}{isGroup && item.label ? <span className="font-medium text-chicken-brown/70"> · {item.label}</span> : null}</span>
        <span className="block text-xs text-chicken-brown/70 tabular-nums">{isGroup ? `團體 ${item.guests} 位` : `${item.guests} 位`}</span>
      </span>
      <span className={`shrink-0 max-w-[45%] truncate rounded-md px-2 py-1 text-xs font-bold tabular-nums ${chip}`}>{stateText(item)}</span>
    </button>
  )
}

const BTN = 'tap inline-flex items-center justify-center gap-1.5 min-h-[44px] px-3 rounded-lg text-sm font-bold'

// 團體：只顯示＋開團單詳情（圈桌在團單裡改）
function GroupDetail({ group: g, onOpenGroup }) {
  return (
    <div className="px-3 pb-3 pt-1 bg-orange-50 space-y-2">
      <p className="text-xs text-chicken-brown/75 leading-5">
        {g.guideName ? `導遊 ${g.guideName}${g.guidePhone ? ` ${g.guidePhone}` : ''} · ` : ''}團體圈桌請在團單裡改（這裡只顯示）
      </p>
      {onOpenGroup && <button type="button" onClick={() => onOpenGroup(g.id)} className={`${BTN} bg-white border border-indigo-200 text-indigo-800`}><ExternalLink size={16} aria-hidden="true" />開團單詳情</button>}
    </div>
  )
}

// 不能在這裡排位的原因（kitchen 的唯讀提示在頂部橫幅，這裡不重複）
function seatNoteFor({ item, isPast, dayClosed, held }) {
  if (item.state === 'arrived') return '客人已到，換桌請到現場頁。'
  if (isPast) return '過去的日期，不能配桌。'
  if (dayClosed) return '本日公休，無法配桌。'
  if (held) return '今天已在現場鎖桌，改桌／取消配桌請到現場頁。'
  return null
}

// 散客：上半＝排位動作（配桌／改桌／取消配桌，只走預配路徑）；下半＝訂位卡原本的動作（useBookingActions）。
// 每顆鈕的顯示條件都來自 useBookingActions.show（內含 seatingPerms 權限門與日期三態），與訂位卡一致：
//   kitchen 這類唯讀角色只剩「聯絡」與「訂位詳情」。
function WalkinDetail({ item, editable, dayClosed, isPast, held, onAssign, onMove, onUnassign, onMoveTable }) {
  const b = item.booking
  // onAssign：訂位卡的「指派桌位」在這裡就是本畫面的配桌；onMove：已現場鎖桌的改桌 → 現場頁（容器沒給就不顯示）
  const toast = useToast()
  // 不能排時（公休／過去／已現場鎖桌）詳情裡的「指派桌位」要講原因，不能按了沒反應
  const assignOrExplain = editable ? onAssign : () => toast.info(seatNoteFor({ item, isPast, dayClosed, held }) || '這筆訂位目前不能在這裡配桌')
  const act = useBookingActions(b, { onAssign: assignOrExplain, onMove: onMoveTable })
  const { show } = act
  const handoff = useHandoff()
  const [editingBooking, setEditingBooking] = useState(false)
  const [detail, setDetail] = useState(false)
  const note = b.notes?.text || (typeof b.notes === 'string' ? b.notes : '')
  const tags = [b.notes?.pet && '寵物', b.notes?.child && '兒童', b.notes?.mobility && '行動不便'].filter(Boolean)
  const pendingTasks = (handoff.tasks || []).filter(t => t?.bookingId === b.id && t?.status === 'pending').length
  const phone = formatPhone(b.phone)

  const seatNote = seatNoteFor({ item, isPast, dayClosed, held })

  return (
    <div className="px-3 pb-3 pt-1 bg-orange-50 space-y-2" data-testid="day-seating-detail">
      <div className="text-xs text-chicken-brown/80 leading-5 space-y-0.5">
        {phone && <p className="text-sm font-bold text-chicken-brown tabular-nums">{phone}</p>}
        {(tags.length > 0 || act.noshowCount > 0) && (
          <p className="flex flex-wrap gap-1.5">
            {act.noshowCount > 0 && <span className="rounded px-1.5 py-0.5 bg-rose-100 text-rose-800 font-bold">no-show ×{act.noshowCount}</span>}
            {tags.map(t => <span key={t} className="rounded px-1.5 py-0.5 bg-white text-chicken-brown font-semibold ring-1 ring-inset ring-chicken-brown/15">{t}</span>)}
          </p>
        )}
        {note && <p>「{note}」</p>}
        {pendingTasks > 0 && <p className="font-bold text-amber-900">交班待辦 {pendingTasks} 筆（在現場頁「交班」處理）</p>}
      </div>

      {/* 排位動作 */}
      {seatNote ? (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-chicken-brown/75">{seatNote}</p>
          {/* 今天已鎖桌：改桌／取消配桌要走現場頁（同訂位卡「改桌」→ 現場頁 move 模式）；容器沒給（無 table.update）就只留提示 */}
          {held && item.state === 'assigned' && show.move && (
            <button type="button" onClick={act.move} className={`${BTN} bg-white border border-chicken-brown/15 text-chicken-brown`}>
              <ArrowLeftRight size={16} aria-hidden="true" />到現場頁改桌
            </button>
          )}
        </div>
      ) : editable && item.state === 'assigned' ? (
        <div className="flex gap-2 flex-wrap">
          <button type="button" onClick={onMove} className={`${BTN} bg-white border border-chicken-brown/15 text-chicken-brown`}><ArrowLeftRight size={16} aria-hidden="true" />改桌</button>
          <button type="button" onClick={onUnassign} className={`${BTN} bg-white border border-rose-200 text-rose-800`}><X size={16} aria-hidden="true" />取消配桌</button>
        </div>
      ) : editable ? (
        <button type="button" onClick={onAssign} className={`${BTN} bg-chicken-red text-white`}><Armchair size={16} aria-hidden="true" />配桌</button>
      ) : null}

      {/* 訂位卡原本的動作（同一份 useBookingActions） */}
      <div className="flex gap-2 flex-wrap items-start pt-1 border-t border-orange-200/70">
        {b.phone && (
          <a href={`tel:${b.phone.replace(/[^+\d]/g, '')}`} aria-label={`聯絡 ${b.name} ${b.phone}`}
            className={`${BTN} bg-white border border-chicken-brown/15 text-chicken-brown`}>
            <Phone size={15} strokeWidth={2.2} aria-hidden="true" />聯絡
          </a>
        )}
        {show.seat && <button type="button" onClick={act.seat} className={`${BTN} bg-chicken-green text-white`}>客人到了</button>}
        {show.checkout && <button type="button" onClick={act.checkout} className={`${BTN} bg-orange-700 text-white`}>客人已離席</button>}
        {show.edit && (
          <button type="button" onClick={() => setEditingBooking(true)} className={`${BTN} bg-white border border-chicken-brown/15 text-chicken-brown`}>
            <Pencil size={15} aria-hidden="true" />{b.status === 'arrived' ? '改人數／備註' : '編輯'}
          </button>
        )}
        {handoff.canWrite && (
          <button type="button" onClick={() => handoff.openTask({ bookingId: b.id })} className={`${BTN} bg-white border border-chicken-brown/15 text-chicken-brown`}>
            <Plus size={15} aria-hidden="true" />交班事項
          </button>
        )}
        {/* 更多：「訂位詳情」所有角色都有，所以這顆永遠在 */}
        <details data-popover className="relative">
          <summary aria-label={`${b.name} 更多操作`} className={`${BTN} cursor-pointer list-none bg-white border border-chicken-brown/15 text-chicken-brown`}>
            <Ellipsis size={16} aria-hidden="true" />更多
          </summary>
          <div className="mt-1 min-w-[200px] bg-white border border-chicken-brown/15 rounded-lg shadow-lg p-1 flex flex-col"
            onKeyDown={e => { if (e.key === 'Escape') { const el = e.currentTarget.closest('details'); el.open = false; el.querySelector('summary').focus() } }}>
            <button type="button" onClick={() => setDetail(true)} className="min-h-[44px] px-3 text-left text-sm text-chicken-brown">訂位詳情（顧客紀錄）</button>
            {show.move && !held && <button type="button" onClick={act.move} className="min-h-[44px] px-3 text-left text-sm text-chicken-brown">到現場頁改桌</button>}
            {show.checkout && <button type="button" onClick={act.finalize} className="min-h-[44px] px-3 text-left text-sm text-chicken-brown">直接釋出（已清桌）</button>}
            {show.noshow && (
              <>
                <p className="px-3 py-2 text-xs text-chicken-brown/70">未到客人請先聯絡，確認後再標記（會累計爽約次數）。</p>
                <button type="button" onClick={act.noshow} className="min-h-[44px] px-3 text-left text-sm text-rose-800">標 No-show</button>
              </>
            )}
            {/* 取消訂位跟訂位卡一樣收在「更多」：不跟上面的「取消配桌」並排，避免誤按（另有確認框＋復原） */}
            {show.cancel && <button type="button" onClick={act.cancel} className="min-h-[44px] px-3 text-left text-sm text-rose-800">取消訂位</button>}
          </div>
        </details>
      </div>

      {editingBooking && <EditBookingModal booking={b} onClose={() => setEditingBooking(false)} />}
      {/* 詳情裡的「指派桌位」＝本畫面的配桌（詳情會先關自己再呼叫） */}
      {detail && <BookingDetailSheet bookingId={b.id} onClose={() => setDetail(false)} onAssign={assignOrExplain} onMove={onMoveTable} />}
    </div>
  )
}
