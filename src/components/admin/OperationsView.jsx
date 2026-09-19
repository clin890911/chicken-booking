import { useState, useMemo, useEffect, useRef } from 'react'
import FloorMap from './floormap/FloorMap'
import ArrivalStrip from './floormap/ArrivalStrip'
import StatusBar from './floormap/StatusBar'
import TableDrawer from './floormap/TableDrawer'
import ModeBanner from './ops/ModeBanner'
import OpsRail from './ops/OpsRail'
import OpsHintBar from './ops/OpsHintBar'
import OpsLogModal from './ops/OpsLogModal'
import TableScheduleView from './ops/TableScheduleView'
import TableSummaryView from './ops/TableSummaryView'
import { nextBookableSlot, pastSlotFix } from './ops/QuickReservePanel'
import LayoutEditor from './LayoutEditor'
import { useBooking } from '../../contexts/BookingContext'
import { useToast, useConfirm } from '../ui/Toast'
import { useAuth } from '../../contexts/AuthContext'
import { findPreassignedBooking, preassignConflicts, assignmentWindow, lockKindFor } from '../../utils/capacity'
import { assignmentKind, statusZh } from '../../utils/tableStatus'
import { isTableUsableOnDate } from '../../utils/tableAvailability'
import { conflictLine, releaseOverlappingPreassigns, restoreReleasedPreassigns, restoreNote } from '../../utils/preassignOverride'
import { buildGroupHolds, todayActiveGroups, reseatCandidateTables } from '../../utils/groupLive'
import { buildTableTurns } from '../../utils/tableTurns'
import { todayStr, nowSlot } from '../../utils/timeSlots'
import { STATUS_COLOR, GROUP_HOLD_COLOR, PREASSIGN_COLOR, DINING_STAGE_FILL } from './floormap/statusColors'
import SegmentedControl from '../ui/SegmentedControl'

// 桌況圖圖例的小色塊：吃 statusColors.js 同一份 hex，不再各寫一套 Tailwind class
// （之前圖例跟地圖實際填色對不上——例如「已預訂」圖例是 slate-100，跟桌況圖實際的淡藍不是同一色）。
// dashed：對應地圖上「同色但虛線」的狀態（預配＝桌實體仍空），圖例與地圖的線型也要對得上，
// 否則兩格同樣的藍會被讀成圖例畫錯。
function LegendSwatch({ fill, stroke, label, dashed = false }) {
  return (
    <span className="inline-flex items-center gap-1">
      <i className="h-2.5 w-2.5 rounded-sm" style={{ background: fill, border: `1.5px ${dashed ? 'dashed' : 'solid'} ${stroke}` }} />
      {label}
    </span>
  )
}

// 「✓ 到了」一鍵入座：抽成不依賴元件 state 的純函式方便單測（注入 seatBooking/setStatus/
// setTableStatus/toast）。不二次確認——這顆鈕本身就是「已經在合理時間窗內」的防呆。
// 復原必須同時倒回 booking（confirmed）與 table（reserved + seatedAt:null）兩邊，
// 不能只復原 booking——那是 repo 內其他復原路徑曾經犯過的不完整實作，這裡刻意都做。
// onMove（可選）：入座被擋（桌被別組佔用／停用）時，toast 直接帶「改桌」出口。
// 預配訂位（2026-09 起報到列也列預配：assignmentKind＝'preassign'，桌沒鎖給這筆）整條另走
// arrivePreassigned（見下）：團保／他筆預配重疊先確認、大組整組入座、復原走 undoSeatPreassigned。
// 鎖桌（held）那條——入座與復原——維持原樣不動（已確認安全的例外，見 undo-paths 記錄）。
export function handleArriveNow(table, booking, deps) {
  if (assignmentKind(booking, table) === 'preassign') return arrivePreassigned(table, booking, deps)   // 入座前判定
  const { seatBooking, setStatus, setTableStatus, toast, onMove } = deps
  const r = seatBooking(booking.id)
  if (!r?.ok) {
    const msg = '入座失敗：' + (r?.error || '未知錯誤')
    if (onMove && !(booking.extraTableIds || []).length) {
      toast.action(msg, { label: '改桌', onClick: () => onMove(booking) }, { type: 'error', duration: 8000 })
    } else {
      toast.error(msg)
    }
    return r
  }
  toast.action(
    `${booking.name} 已入座 ${table.number}`,
    {
      label: '↩ 復原',
      onClick: () => {
        setStatus(booking.id, 'confirmed')
        setTableStatus(table.number, 'reserved', { seatedAt: null })
      },
    },
    { duration: 5000 },
  )
  return r
}

// 預配訂位「到了」前的防呆（與今日訂位卡「客人到了」同一道：UpcomingPanel.handleSeat）：
// 桌（大組含額外桌）被今日團體圈桌未入座、或他筆訂位預配且用餐區間與「現在入座」重疊
// （PR #131 口徑：capacity.preassignConflicts＋assignmentWindow 'now'）→ 逐條列出，要店員確認。
export function preassignArriveConflictLines(booking, { bookings = [], groupHoldTables = {}, settings = {}, now = new Date() } = {}) {
  const nums = [...new Set([booking?.assignedTableId, ...(booking?.extraTableIds || [])].filter(Boolean).map(String))]
  const window = assignmentWindow({ mode: 'now', now }, settings)
  const lines = []
  nums.forEach(n => {
    const hold = groupHoldTables[n]
    if (hold?.holds?.length) {
      const h = hold.holds[0]
      lines.push(`${n} 為今日團體「${hold.agencyName || '旅行社'}」預留${h?.batch ? `（${h.batch.label} ${h.batch.timeSlot}）` : ''}`)
    }
    preassignConflicts(bookings, n, { date: booking.date, excludeBookingId: booking.id, window }, settings)
      .filter(c => c.overlaps)
      .forEach(c => lines.push(`${n} 已預先配給 ${c.booking.name}（${c.booking.guests} 位${c.booking.timeSlot ? ` · ${c.booking.timeSlot}` : ''}），用餐時段重疊`))
  })
  return lines
}

// 預配訂位的「到了」：
//   1) 桌此刻都空、但有團保／重疊預配 → 先 confirm（取消就不動）；桌已被別組佔 → 不問，直接嘗試入座讓守門擋下
//   2) 單桌 seatBooking；大組（有額外桌）seatBookingAllTables——整組都空才一起入座，任一張被佔整組不動
//   3) 被擋：單桌給「改桌」；大組不給（單桌 move 會留孤兒額外桌）→ 講清楚到今日訂位卡處理
//   4) 成功 toast 的復原走 undoSeatPreassigned：整組回空桌、訂位回待到且保留預配（只在仍由本筆用餐中時才倒）
// 需要確認時回 Promise（其餘同步回傳，與鎖桌路徑一致）。
function arrivePreassigned(table, booking, deps) {
  const { confirm, preassignConflictLines, getTable } = deps
  const nums = [...new Set([booking.assignedTableId, ...(booking.extraTableIds || [])].filter(Boolean).map(String))]
  const label = nums.length > 1 ? nums.join(' + ') : table.number
  const taken = nums.some(n => {
    const t = n === String(table.number) ? table : getTable?.(n)
    return t && t.status !== 'vacant' && String(t.currentBookingId ?? '') !== String(booking.id)
  })
  const lines = !taken && preassignConflictLines ? preassignConflictLines(booking) : []
  if (lines.length) {
    if (!confirm) { deps.toast.error(`${lines.join('；')}。請從今日訂位卡確認後入座`); return { ok: false, code: 'needs-confirm' } }
    return Promise.resolve(confirm(`${lines.join('；')}。\n仍要讓 ${booking.name} 入座 ${label}？`,
      { title: '桌位有預留', confirmLabel: '仍要入座', danger: true }))
      .then(ok => (ok ? seatPreassignedNow(table, booking, label, deps) : { ok: false, cancelled: true }))
  }
  return seatPreassignedNow(table, booking, label, deps)
}

function seatPreassignedNow(table, booking, label, { seatBooking, seatBookingAllTables, undoSeatPreassigned, toast, onMove }) {
  const isCombo = (booking.extraTableIds || []).length > 0
  const r = isCombo && seatBookingAllTables ? seatBookingAllTables(booking.id) : seatBooking(booking.id)
  if (!r?.ok) {
    const msg = '入座失敗：' + (r?.error || '未知錯誤')
    if (onMove && !isCombo) {
      toast.action(msg, { label: '改桌', onClick: () => onMove(booking) }, { type: 'error', duration: 8000 })
    } else {
      toast.error(isCombo ? `${msg}（併桌訂位不支援單桌改桌，請到今日訂位卡處理）` : msg)
    }
    return r
  }
  toast.action(
    `${booking.name} 已入座 ${label}`,
    {
      label: '↩ 復原',
      onClick: () => {
        const u = undoSeatPreassigned?.(booking.id, table.number)
        if (!u?.ok) toast.error('復原失敗：' + (u?.error || '未知錯誤'))
      },
    },
    { duration: 5000 },
  )
  return r
}

// 候位入座成功後的共同收尾（三條路徑共用：二步確認單桌、併桌、桌況抽屜候選名單）。
// 抽成純函式方便單測（同 handleArriveNow 同一套手法：注入 setSelectedTable/setMode/
// setPendingConfirm/setRailTab/toast，不必掛載整個 OperationsView——那需要
// BookingProvider/AuthProvider/ToastProvider 才能跑，不划算）。
// 店主原話：「候位的客人選定位子後，會直接回到帶位頁面，這樣 UX 比較順」——
// 入座當下客人已經在現場、桌也定了，不開桌況抽屜（那是給還要再操作這張桌的情境），
// 直接切回帶位籤讓店員接著帶下一組；toast 帶「查看」動作，店員想確認剛剛那桌仍隨時點得到。
export function seatedToWalkin(tableNumber, msg, { setSelectedTable, setMode, setPendingConfirm, setRailTab, toast }) {
  setSelectedTable(null)
  setMode(null)
  setPendingConfirm(null)
  setRailTab('walkin')
  toast.action(msg, { label: '查看', onClick: () => setSelectedTable(tableNumber) })
}

// 現場內嵌「新增今日訂位」的存檔（純函式，注入 context 動作與 toast 方便單測；同 handleArriveNow 手法）。
// 寫入語意依面板當下顯示的鎖桌時機（kind，capacity.lockKindFor）——按鈕上寫什麼就做什麼：
//   hold      → addBooking ＋ assignBookingToTable（鎖桌，含同步／Telegram）
//   preassign → addBooking ＋ preassignBookingTable（只記在訂位上，桌況不動）
// 訂位建不起來（例外／無回傳）→ 回 { ok:false }，面板保留全部欄位；
// 訂位已建、只有鎖桌失敗（桌剛被別台帶走）→ 仍算成功（不可留在面板，否則重按會重複建單），
//   toast 帶「指派桌位」出口。
export function saveQuickReserve(payload, { date, kind, table, needsCombo, createdBy, addBooking, assignBookingToTable, preassignBookingTable, toast, onAssignLater, now = new Date() }) {
  // 不存已過的時段（早於目前這個 30 分時段；目前時段本身仍可）——面板開著跨過時段時的最後一道
  if (payload?.timeSlot && payload.timeSlot < nowSlot(now)) {
    toast.error(`${payload.timeSlot} 已經過了，請改選目前或之後的時段`)
    return { ok: false }
  }
  let b
  try {
    b = addBooking({ ...payload, date, status: 'confirmed', createdBy })
  } catch (e) {
    toast.error('新增失敗：' + (e?.message || '未知錯誤'))
    return { ok: false }
  }
  if (!b?.id) { toast.error('新增失敗：未知錯誤'); return { ok: false } }
  let tail = ''
  let assigned = null
  if (table) {
    if (kind === 'preassign') {
      if (preassignBookingTable(b.id, table.number)) { tail = ` · 預配 ${table.number}`; assigned = table.number }
    } else {
      const r = assignBookingToTable(b.id, table.number)
      if (r?.ok) { tail = ` · 桌 ${table.number}`; assigned = table.number }
      else {
        toast.action(`已新增 ${b.name} ${b.timeSlot}，但鎖桌 ${table.number} 失敗：${r?.error || '未知錯誤'}`,
          { label: '指派桌位', onClick: () => onAssignLater?.(b) }, { type: 'error', duration: 8000 })
      }
    }
  }
  toast.success(`已新增 ${b.name} ${b.timeSlot}${tail}`)
  if (needsCombo) toast.info('大組請接近時段再到今日訂位指派併桌', { duration: 8000 })
  return { ok: true, booking: b, tableNumber: assigned }
}

// 「現場營運」主畫面
// 模式：normal | assign-booking | seat-waitlist | move-table | group-reseat
// ★ 現場帶位（walk-in）v3 不再是「模式」：帶位籤常駐左欄，點桌／選人數順序不拘，
//   兩者到齊由面板滑動入座（walkin / walkin-multi 兩個舊 mode 已移除）。
// 每個模式有對應的 banner、桌位 highlight、確認 toast
// 候位入座由右側欄（OpsRail > WaitlistPanel）頁內觸發；指派桌仍可由「訂位」分頁跨頁觸發（pendingAssign）
export default function OperationsView({ pendingAssign, onAssignDone, pendingMove, onMoveDone, onAddBooking }) {
  const {
    tables, bookings, waitlist, settings, groupReservations, fixtures, zones,
    assignBookingToTable, assignBookingTablesMulti, seatWaitlist, seatWaitlistMulti, walkInSeat, walkInSeatMulti, moveTable, reseatGroupBatchTable,
    cancelBooking, seatBooking, seatBookingAllTables, undoSeatPreassigned, setStatus, setTableStatus,
    releaseOverriddenAssignment, restoreOverriddenAssignment, undoAssignBooking,
    findSuitableTables, suggestTable, suggestTableCombo, findReserveCandidates, preassignableTables,
    preassignBookingTable, addBooking,
  } = useBooking()
  const toast = useToast()
  const confirm = useConfirm()
  const { can, user } = useAuth()

  const [floor, setFloor] = useState('1F')
  const [view, setView] = useState('map') // map=SVG 桌況圖 ｜ schedule=當日排程（每桌 turns）
  const [selectedTable, setSelectedTable] = useState(null)
  const [railTab, setRailTab] = useState('walkin') // 左側操作欄籤（預設帶位）；ESC/關閉抽屜不重設
  const [mode, setMode] = useState(null)
  const [justAssigned, setJustAssigned] = useState(null) // 剛指派的桌號（綠光）
  const [pendingConfirm, setPendingConfirm] = useState(null) // 指派/候位/換桌：待確認的桌號（二步確認）
  const [showLayoutEditor, setShowLayoutEditor] = useState(false)
  const [showOpsLog, setShowOpsLog] = useState(false) // 系統自動處理紀錄（自動清檯留痕）

  // === 現場內嵌「新增今日訂位」面板 ===
  // 人數／時段／選的桌放這裡（不放面板內）：桌況圖點桌與面板共用同一份，與帶位面板同一套做法。
  // tablePick：'auto'＝跟著建議（候選第一張）｜'none'＝先不指派｜桌號＝在桌況圖點選的桌。
  const [reserveOpen, setReserveOpen] = useState(false)
  const [reserveGuests, setReserveGuests] = useState(2)
  const [reserveSlot, setReserveSlot] = useState('')
  const [reserveTablePick, setReserveTablePick] = useState('auto')
  const [reserveNotice, setReserveNotice] = useState('')
  const [reserveNow, setReserveNow] = useState(() => Date.now()) // 30 秒 tick：跨過「前 30 分」門檻時語意跟著換
  const [reserveSlotNotice, setReserveSlotNotice] = useState('') // 所選時段已過、自動改選目前時段時的說明
  // 面板開著時，toast 上的「查看／改桌／指派桌位」等動作不可卸載面板或進模式（onClick 閉包會抓舊值 → 用 ref）
  const reserveOpenRef = useRef(false)
  reserveOpenRef.current = reserveOpen
  const [flashBookingId, setFlashBookingId] = useState(null)   // 剛新增的那筆（今日訂位籤閃一下）

  // === 現場帶位 v3（順序不拘）===
  // 系統只需要「桌」和「人數」：先點桌或先選人數都行，兩者到齊由面板的滑動手勢入座。
  // 桌的真相放這裡（不放面板內），桌況圖與帶位面板共用同一份，避免兩邊各記一套。
  const [walkinGuests, setWalkinGuests] = useState(2)
  const [walkinTableNumbers, setWalkinTableNumbers] = useState([])
  const [lastSeated, setLastSeated] = useState(null) // M2b 短復原：{ bookingId, tableNumbers, name, guests, at }
  // M6 沿用上一組：{ guests, notes }。放在這裡（不放面板內）是因為切籤會把 FastWalkInPanel
  // 卸載，state 會消失；連續同型客人（一直來 2 位）才是這功能要救的情境。
  // 刻意不記姓名／電話——那是每組不同的資料，沿用會把上一組的客人資料掛到新客人身上。
  const [lastParty, setLastParty] = useState(null)
  // 復原時要讀「當下」的訂位狀態（toast 的 onClick 閉包會抓到入座當時的舊值）
  const bookingsRef = useRef(bookings)
  bookingsRef.current = bookings

  // 今日團體 hold：今日（未取消/未完成）團體的桌位，若尚未實際入座（非 dining）則於圖上標示 🚌。
  // value = { agencyName, holds: [{ group, batch }] }（未入座梯次，依時段排序）：
  // FloorMap 只讀 truthiness 畫標記；TableDrawer 用 holds 顯示團資訊與「梯次入座」
  const groupHoldTables = useMemo(
    () => buildGroupHolds(todayActiveGroups(groupReservations, todayStr()), tables),
    [groupReservations, tables],
  )

  // 今日預配標記：被今日訂位「預先配走」的桌號 → { timeSlot }。
  // 預配只記在 booking 上、不動桌況（桌仍 vacant）——地圖上需給視覺線索（📌 時段 預配），
  // 否則店員要到帶位確認那一步才會被 pendingConflicts 警告撞桌。
  // 只標「還會來」的：pending/confirmed；arrived 桌已 dining、completed/cancelled/noshow 不標。
  // 同桌多筆預配（午、晚兩輪）取最早時段。
  const preassignTables = useMemo(() => {
    const map = {}
    const today = todayStr()
    bookings.forEach(b => {
      if (b.date !== today || !b.assignedTableId) return
      if (!['pending', 'confirmed'].includes(b.status)) return
      const key = String(b.assignedTableId)
      if (!map[key] || String(b.timeSlot || '99:99') < String(map[key].timeSlot || '99:99')) {
        map[key] = { timeSlot: b.timeSlot || '' }
      }
    })
    return map
  }, [bookings])

  // 排程視圖資料：每張桌今天的各批用餐（turns）。散客（含預先配桌）+ 團體梯次合併、依時段排序。
  const turnsByTable = useMemo(
    () => buildTableTurns(tables, bookings, groupReservations, todayStr()),
    [tables, bookings, groupReservations],
  )

  // 帶位/指派等模式一律在 SVG 桌況圖操作；排程視圖為總覽用途，模式進行中強制切回地圖。
  // 內嵌新增面板開著時也強制地圖（選桌要點地圖）。
  const showSchedule = !mode && !reserveOpen && view === 'schedule'
  const showSummary = !mode && !reserveOpen && view === 'summary'

  // 進入指派桌模式（含自動建議）。無單桌容納（大組）→ 改走多桌指派（併桌）。
  // 單桌指派依鎖桌時機（capacity.lockKindFor，店主 2026-09 拍板「接近時段才鎖」）：
  //   hold      離用餐 ≤ 30 分（含已過）→ 指派並鎖桌（assignBookingToTable → reserved）
  //   preassign 更早 → 只預配（booking.assignedTableId，桌況仍空、現場帶位照樣可用、會被警示）
  // 大組併桌維持鎖桌：seatBooking 只把主桌設成用餐中，預配型併桌的額外桌到店時不會被佔起來。
  // 面板開著就擋下（回 true）並說明；不卸載面板、不進模式
  const blockedByReserve = () => {
    if (!reserveOpenRef.current) return false
    toast.info('新增訂位中，請先完成或返回')
    return true
  }

  const startAssign = (booking) => {
    if (blockedByReserve()) return
    const guests = Number(booking.guests) || 0
    const date = booking.date || todayStr()
    const lockKind = lockKindFor({ date, timeSlot: booking.timeSlot })
    const reserveOpts = { bookingId: booking.id, date, timeSlot: booking.timeSlot }
    // 可點選集合（suitable）不因他筆預配／團保縮小（那些走警示＋「將解除／會保留」）：
    //   hold＝此刻空桌；preassign＝桌子不必此刻空著，只要此刻的佔用不延續進預配區間
    const suitable = (lockKind === 'preassign' ? preassignableTables(guests, reserveOpts) : findSuitableTables(guests))
      .map(t => t.number)
    if (suitable.length > 0) {
      // 建議桌看佔用區間（依 lockKind），避開他筆預配重疊的桌與團保桌
      const suggestion = findReserveCandidates(guests, reserveOpts).tables[0]
      setMode({ type: 'assign', booking, lockKind, suitable, suggestion: suggestion?.number })
      setSelectedTable(null)
      setPendingConfirm(null)
      if (suggestion) setFloor(suggestion.floor)
      return
    }
    // 無單桌容納（大組）→ 多桌指派（併桌）：系統建議組合，店員可在地圖加減桌後確認
    const combo = suggestTableCombo(guests)
    if (!combo.enough) {
      return toast.error(`目前沒有單一樓層能容納 ${guests} 位（同層最多 ${combo.seats} 席），可改用候位取號或分成兩組`)
    }
    startMultiMode({ kind: 'booking', booking, need: guests, combo })
  }

  // 進入併桌模式（訂位指派與候位入座共用）。mode.kind 決定確認時走哪條 service 路徑
  // 與 banner 文案；選桌／加減／同層守門等互動完全相同，故共用同一個 mode.type。
  const startMultiMode = ({ kind, booking = null, wait = null, need, combo }) => {
    const vacantNums = findSuitableTables(1).map(t => t.number) // 所有今日可用空桌（容量≥1）= 可加減的池
    setMode({
      type: 'assign-multi',
      kind,
      booking,
      wait,
      need,
      selected: combo.tableNumbers, // 預選建議組合
      suitable: vacantNums,
    })
    setSelectedTable(null)
    setPendingConfirm(null)
    const firstTable = tables.find(t => t.number === combo.tableNumbers[0])
    if (firstTable) setFloor(firstTable.floor)
  }

  // 候位入座（含自動建議）。與 startAssign 同結構：無單桌容納 → 改走併桌。
  // 過去這裡沒有併桌 fallback，9 位客人碰上只剩 4 人桌時只會得到「目前無符合容量的空桌」，
  // 即使併兩三張小桌明明坐得下（店主 2026-08 回報）。
  const startSeatWaitlist = (wait) => {
    if (blockedByReserve()) return
    const guests = Number(wait.partySize) || 0
    const suitable = findSuitableTables(guests).map(t => t.number)
    if (suitable.length > 0) {
      // 候位客人是「現在」入座：佔用區間 [現在, 現在+佔位)，避開其間已被預配的桌與團保桌
      const suggestion = suggestTable(guests, { date: todayStr(), mode: 'now' })
      setMode({ type: 'seat-waitlist', wait, suitable, suggestion: suggestion?.number })
      setSelectedTable(null)
      setPendingConfirm(null)
      if (suggestion) setFloor(suggestion.floor)
      return
    }
    const combo = suggestTableCombo(guests)
    if (!combo.enough) {
      return toast.error(`目前沒有單一樓層能容納 ${guests} 位（同層最多 ${combo.seats} 席），請等候翻桌或分成兩組`)
    }
    startMultiMode({ kind: 'waitlist', wait, need: guests, combo })
  }

  // 改派桌位模式：團體梯次入座被佔桌卡住 → 逐桌挑替代空桌（queue 依序處理）
  const startGroupReseat = (group, batch, blocked) => {
    if (blockedByReserve()) return
    const queue = (blocked || []).map(b => b.tableNumber)
    if (!queue.length) return
    const current = queue[0]
    const fromTable = tables.find(t => t.number === current)
    const suitable = reseatCandidateTables({
      tables, holds: groupHoldTables, group, batch, fromTable,
    }).map(t => t.number)
    if (!suitable.length) {
      return toast.error(`目前沒有可改派的空桌（${current} 被佔）`)
    }
    setMode({ type: 'group-reseat', group, batch, queue, current, suitable, suggestion: suitable[0] })
    setSelectedTable(null)
    setPendingConfirm(null)
    const sug = tables.find(t => t.number === suitable[0])
    if (sug) setFloor(sug.floor)
  }

  // 換桌／改桌模式：用餐中、現場鎖桌、預配的訂位都走這裡 → 選一張新空桌（二步確認＋預配/團保警示）。
  // 入口：抽屜（用餐中／已預訂）、今日訂位籤、訂位分頁卡片／詳情（經 pendingMove 跨頁）。
  const startMove = (booking) => {
    if (blockedByReserve()) { onMoveDone?.(); return }
    if (!booking) return
    if ((booking.extraTableIds || []).length) {
      onMoveDone?.()
      return toast.error('併桌訂位不支援單桌改桌，請取消後重新指派，或整組清桌後重新帶位')
    }
    if (!booking.assignedTableId) {
      onMoveDone?.()
      return toast.error('這筆訂位還沒有桌，請改用「指派桌位」')
    }
    // 自己目前這張不列入（預配訂位的舊桌仍是空桌，過去點了要等到確認才報「同桌無需換桌」）
    const suitable = findSuitableTables(booking.guests).map(t => t.number).filter(n => n !== booking.assignedTableId)
    if (suitable.length === 0) { onMoveDone?.(); return toast.error('沒有可換的空桌') }
    // 佔用區間依改桌後的語意：用餐中＝現在入座、鎖桌（held）＝現在就鎖、預配＝只記在訂位上
    const moveKind = moveKindOf(booking)
    const suggestion = findSuitableTables(booking.guests, {
      bookingId: booking.id, date: booking.date || todayStr(), timeSlot: booking.timeSlot, mode: moveKind,
    }).find(t => t.number !== booking.assignedTableId)
    setMode({ type: 'move', booking, moveKind, suitable, suggestion: suggestion?.number })
    setSelectedTable(null)
    setPendingConfirm(null)
    const focus = tables.find(t => t.number === (suggestion?.number || booking.assignedTableId))
    if (focus) setFloor(focus.floor)
  }

  // 改桌後的佔用語意（assignmentWindow 的 mode）
  function moveKindOf(booking) {
    if (booking.status === 'arrived') return 'now'
    const t = tables.find(x => x.number === booking.assignedTableId)
    return assignmentKind(booking, t) === 'held' ? 'hold' : 'preassign'
  }

  // 目前模式「新佔用區間」：指派＝現在就鎖桌、候位＝現在入座、改桌＝依原本語意
  const modeWindow = (m) => {
    if (!m) return null
    if (m.type === 'seat-waitlist') return assignmentWindow({ mode: 'now' }, settings)
    const b = m.booking
    const kind = m.type === 'move' ? (m.moveKind || 'hold') : (m.lockKind || 'hold')
    return assignmentWindow({ mode: kind, timeSlot: b?.timeSlot, date: b?.date || todayStr() }, settings)
  }

  // 某桌上他筆的預配，逐筆標記是否與新佔用區間重疊（重疊才解除）。警示與實際解除共用這一份。
  const preassignConflictsFor = (number, m = mode) => {
    if (!m || !['assign', 'seat-waitlist', 'move'].includes(m.type)) return []
    const excludeBookingId = m.booking?.id // seat-waitlist 無 booking（新建 walk-in），任何預配都算他人
    const date = m.type === 'seat-waitlist' ? todayStr() : (m.booking?.date || todayStr())
    return preassignConflicts(bookings, number, { date, excludeBookingId, window: modeWindow(m) }, settings)
  }

  const cancelMode = () => { setMode(null); setPendingConfirm(null) }

  // seatedToWalkin（純函式，見上方）綁上這個畫面的真實 setter——三條候位入座路徑共用
  // toast「查看」開抽屜會把左欄（含新增面板）換掉 → 面板開著時擋下（清空選取 null 不擋）
  const selectTableGuarded = (n) => { if (n != null && blockedByReserve()) return; setSelectedTable(n) }
  const finishWaitlistSeat = (tableNumber, msg) =>
    seatedToWalkin(tableNumber, msg, { setSelectedTable: selectTableGuarded, setMode, setPendingConfirm, setRailTab, toast })

  // === 內嵌新增面板：開／關、候選、選桌 ===
  const canReserveAssign = can('booking.update') && can('table.update')
  const openReserve = () => {
    const now = new Date()
    setReserveNow(now.getTime())
    setReserveGuests(2)
    setReserveSlot(nextBookableSlot({ settings, tables, bookings, groupReservations, date: todayStr(), guests: 2, now }))
    setReserveTablePick('auto')
    setReserveNotice('')
    setReserveSlotNotice('')
    setSelectedTable(null)
    cancelMode()
    setReserveOpen(true)
  }
  const closeReserve = () => {
    setReserveOpen(false)
    setRailTab('upcoming')
  }
  useEffect(() => {
    if (!reserveOpen) return
    const id = setInterval(() => setReserveNow(Date.now()), 30000)
    return () => clearInterval(id)
  }, [reserveOpen])

  // 面板開著跨過時段：所選時段變成已過（早於目前這個 30 分時段）→ 自動改選目前時段並說明
  useEffect(() => {
    if (!reserveOpen || !reserveSlot) return
    const fix = pastSlotFix(reserveSlot, new Date(reserveNow), settings)
    if (!fix) return
    setReserveSlot(fix.slot)
    setReserveSlotNotice(fix.notice)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reserveOpen, reserveSlot, reserveNow])

  // 候選＋鎖桌時機（findReserveCandidates：hold＝此刻空桌不撞鎖桌區間；preassign＝屆時會空、不撞預配區間）
  const reserveCalc = useMemo(() => {
    if (!reserveOpen || !reserveSlot || !(reserveGuests > 0)) return { kind: null, tables: [] }
    return findReserveCandidates(reserveGuests, { date: todayStr(), timeSlot: reserveSlot, now: new Date(reserveNow) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reserveOpen, reserveSlot, reserveGuests, reserveNow, tables, bookings, groupReservations])
  const reserveCandidateNums = useMemo(() => reserveCalc.tables.map(t => t.number), [reserveCalc])
  // 沒有任何今日可用單桌坐得下（大組）→ 不選桌（面板說明、存檔後再到今日訂位指派併桌）
  const reserveNeedsCombo = reserveOpen && reserveGuests > 0
    && !tables.some(t => isTableUsableOnDate(t, todayStr()) && (Number(t.capacity) || 0) >= reserveGuests)
  const reserveTable = useMemo(() => {
    if (!reserveOpen || !reserveSlot || !canReserveAssign || reserveTablePick === 'none') return null
    if (reserveTablePick !== 'auto') return reserveCalc.tables.find(t => t.number === reserveTablePick) || null
    return reserveCalc.tables[0] || null
  }, [reserveOpen, reserveSlot, canReserveAssign, reserveTablePick, reserveCalc])

  // 人數／時段／桌況變了、點選的桌不再是候選 → 改回建議並明講（不讓桌號悄悄變掉）
  useEffect(() => {
    if (!reserveOpen || !reserveSlot || ['auto', 'none'].includes(reserveTablePick)) return
    if (reserveCandidateNums.includes(reserveTablePick)) return
    const next = reserveCalc.tables[0]
    setReserveNotice(next
      ? `${reserveTablePick} 不適用目前的人數／時段，已改回建議桌 ${next.number}`
      : `${reserveTablePick} 不適用目前的人數／時段，已改為先不指派`)
    setReserveTablePick(next ? 'auto' : 'none')
  }, [reserveOpen, reserveSlot, reserveTablePick, reserveCandidateNums, reserveCalc])

  // 跟著建議走時，建議桌換到另一層 → 地圖跟過去（店員才看得到選的是哪張）
  useEffect(() => {
    if (reserveOpen && reserveTablePick === 'auto' && reserveTable?.floor) setFloor(reserveTable.floor)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reserveOpen, reserveTable?.number])

  // 點到非候選桌：講清楚為什麼不能選（不選取）
  const reserveBlockReason = (number) => {
    const t = tables.find(x => x.number === number)
    if (!t) return `${number} 不存在`
    const today = todayStr()
    if (!isTableUsableOnDate(t, today)) return `${number} 今日停用／維修中`
    if ((Number(t.capacity) || 0) < reserveGuests) return `${number} 只有 ${t.capacity} 席，坐不下 ${reserveGuests} 位`
    const kind = reserveCalc.kind
    const now = new Date(reserveNow)
    if (kind === 'hold' && t.status !== 'vacant') {
      return `${number} 目前${statusZh(t.status)}；離用餐 30 分內要現在鎖桌，只能選空桌`
    }
    if (kind === 'preassign' && t.status !== 'vacant'
      && !preassignableTables(reserveGuests, { date: today, timeSlot: reserveSlot, now }).some(x => x.number === number)) {
      return `${number} 目前${statusZh(t.status)}，到 ${reserveSlot} 可能還沒空出來`
    }
    const window = assignmentWindow({ mode: kind || 'hold', timeSlot: reserveSlot, date: today, now }, settings)
    const c = preassignConflicts(bookings, number, { date: today, window }, settings).find(x => x.overlaps)
    if (c) return `${number} 已預留給 ${c.booking.name}（${c.booking.timeSlot}），用餐時段重疊`
    const hold = groupHoldTables[number]
    if (hold?.holds?.length) return `${number} 為今日團體 ${hold.agencyName || '旅行社'} 預留`
    return `${number} 這個時段不能用`
  }

  const handleReserveTableClick = (number) => {
    if (!canReserveAssign) return toast.info('這個帳號不能指派桌位，存檔後由店長指派')
    if (!reserveSlot) return toast.info('請先選時段，再點桌況圖選桌')
    if (reserveNeedsCombo) return toast.info('大組請接近時段再到今日訂位指派併桌')
    if (!reserveCandidateNums.includes(number)) return toast.error(reserveBlockReason(number))
    // 一律「選這張」（不做點第二下取消）：iPad 觸控同一 tick 可能送兩次 click，toggle 會自己抵銷
    setReserveTablePick(number)
    setReserveNotice('')
  }

  const handleReserveSave = (payload) => {
    const r = saveQuickReserve(payload, {
      date: todayStr(),
      kind: reserveCalc.kind,
      table: reserveTable,
      needsCombo: reserveNeedsCombo && canReserveAssign,
      createdBy: user?.email || 'staff',
      addBooking, assignBookingToTable, preassignBookingTable, toast,
      onAssignLater: (b) => startAssign(bookingsRef.current.find(x => x.id === b.id) || b),
      now: new Date(),
    })
    if (!r.ok) return false
    closeReserve()
    setFlashBookingId(r.booking.id)
    if (r.tableNumber) flashAssigned(r.tableNumber)
    return true
  }

  // 剛新增那筆的醒目框約 2 秒後收掉
  useEffect(() => {
    if (!flashBookingId) return
    const id = setTimeout(() => setFlashBookingId(null), 2200)
    return () => clearTimeout(id)
  }, [flashBookingId])

  // 桌位點選 — 依模式分流
  const handleTableClick = (number) => {
    // 內嵌新增面板開著：點桌＝為這筆選桌（不開抽屜、不進 mode）
    if (reserveOpen) return handleReserveTableClick(number)
    if (!mode) {
      // 帶位 v3：帶位籤上點「今日可入座的空桌」＝加入/移出帶位面板（不開抽屜、不進 mode）。
      // 一桌＝單桌帶位、多桌＝併桌，同一條路徑，人數與桌到齊後由面板滑動入座。
      if (railTab === 'walkin' && walkinSelectable.includes(number)) {
        const isRemove = walkinTableNumbers.includes(number)
        // 同樓層守門：切樓層後想加別層的桌 → 擋（併桌不可跨層；移除一律允許）
        if (!isRemove && walkinTableNumbers.length) {
          const selFloor = tables.find(x => x.number === walkinTableNumbers[0])?.floor
          const thisFloor = tables.find(x => x.number === number)?.floor
          if (selFloor && thisFloor && selFloor !== thisFloor) {
            return toast.error('併桌需在同一樓層，請改選同層的桌')
          }
        }
        // 加/移一律在 updater 內依 prev 判斷：iPad 觸控可能同一個 tick 內送出兩次 click
        // （touch → 合成 click），若沿用 render 當下的 isRemove，兩次都會判定「加入」→
        // 同一張桌被塞進陣列兩次 → 席數加倍、入座時帶錯桌數。
        setWalkinTableNumbers(prev => prev.includes(number) ? prev.filter(n => n !== number) : [...prev, number])
        setSelectedTable(null) // 抽屜開著時也要退回帶位面板，選了什麼桌才看得見
        return
      }
      setSelectedTable(prev => prev === number ? null : number)
      return
    }
    // 多桌指派（大組併桌）：點桌加入/移除已選集合，不走二步確認（確認在 banner 按鈕）
    if (mode.type === 'assign-multi') {
      if (!mode.suitable.includes(number)) return toast.error('此桌目前不可加入（非空桌或維修中）')
      const isRemove = mode.selected.includes(number)
      // 同樓層守門：切樓層後若想加別層的桌 → 擋（併桌不可跨層；移除一律允許）
      if (!isRemove && mode.selected.length) {
        const selFloor = tables.find(x => x.number === mode.selected[0])?.floor
        const thisFloor = tables.find(x => x.number === number)?.floor
        if (selFloor && thisFloor && selFloor !== thisFloor) {
          return toast.error('併桌需在同一樓層，請改選同層的桌')
        }
      }
      const selected = isRemove ? mode.selected.filter(n => n !== number) : [...mode.selected, number]
      setMode({ ...mode, selected })
      return
    }
    // 指派 / 候位入座 / 換桌 / 團體改派：二步確認
    // 第一次點合適桌 → 進入「待確認」預覽；第二次點同一桌（或按確認鈕）才真正執行
    if (['assign', 'seat-waitlist', 'move', 'group-reseat'].includes(mode.type)) {
      if (mode.type === 'move' && number === mode.booking?.assignedTableId) {
        return toast.info(`${number} 是 ${mode.booking.name} 目前的桌，請點要換過去的桌`)
      }
      if (!mode.suitable.includes(number)) {
        return toast.error(mode.type === 'group-reseat' ? '此桌非空桌或已被其他團體保留'
          : mode.lockKind === 'preassign' ? '此桌容量不足、停用，或到那個時段仍有客'
          : '此桌不符合容量或非空桌')
      }
      if (pendingConfirm === number) { executeAssign(number); return }
      setPendingConfirm(number)
      return
    }
  }

  // 真正執行指派/候位入座/換桌（由二步確認的第二步或確認鈕觸發）
  const executeAssign = (number) => {
    if (!mode || !number) return
    // 動手前先記下這張桌上的預配與「會不會被解除」（指派後 bookings 會變；警示講什麼就做什麼）
    const overridden = preassignConflictsFor(number)
    const releaseOpts = { releaseOverriddenAssignment, toast }
    if (mode.type === 'assign') {
      const booking = mode.booking
      const preassign = mode.lockKind === 'preassign'
      if (preassign) {
        // 預配：只寫 booking.assignedTableId（Context 包裝含 refresh／同步），桌況不動
        if (!preassignBookingTable(booking.id, number)) return toast.error('指派失敗：訂位不存在')
      } else {
        const r = assignBookingToTable(booking.id, number)
        if (!r.ok) return toast.error('指派失敗：' + r.error)
      }
      const released = releaseOverlappingPreassigns(overridden, releaseOpts)
      const msg = preassign
        ? `${booking.name}（${booking.guests} 位）已預配 ${number}（桌子現在仍可帶位）· 可指派下一組`
        : `${booking.name}（${booking.guests} 位）指派至 ${number} · 可指派下一組`
      if (released.length) {
        // 解除了別人的預配 → 給復原：撤回這次指派（只清不搶），並把被解除的預配寫回
        toast.action(msg, { label: '↩ 復原', onClick: () => {
          const u = undoAssignBooking(booking.id, number)
          if (!u?.ok) return toast.error('復原失敗：' + (u?.error || '未知錯誤'))
          const note = restoreNote(restoreReleasedPreassigns(released, { restoreOverriddenAssignment }))
          toast.info(`已復原：${booking.name} 回到未配桌${note}`)
        } }, { duration: 8000 })
      } else {
        toast.success(msg)
      }
      flashAssigned(number)
      cancelMode()
      setSelectedTable(number)
      onAssignDone?.()
      return
    }
    if (mode.type === 'seat-waitlist') {
      const r = seatWaitlist(mode.wait.id, number)
      if (!r.ok) return toast.error('入座失敗：' + r.error)
      releaseOverlappingPreassigns(overridden, releaseOpts)
      flashAssigned(number)
      finishWaitlistSeat(number, `${mode.wait.name}（候位 #${mode.wait.queueNumber}）入座 ${number} · 可指派下一組`)
      return
    }
    if (mode.type === 'move') {
      const r = moveTable(mode.booking.id, number)
      if (!r.ok) return toast.error('換桌失敗：' + r.error)
      releaseOverlappingPreassigns(overridden, releaseOpts)
      toast.success(`${mode.booking.name} 已從 ${mode.booking.assignedTableId} 改到 ${number} · 可指派下一組`)
      flashAssigned(number)
      cancelMode()
      setSelectedTable(number)
      onMoveDone?.()
      return
    }
    if (mode.type === 'group-reseat') {
      const { group, batch, current } = mode
      const r = reseatGroupBatchTable(group.id, batch.id, current, number)
      if (!r.ok) { setPendingConfirm(null); return toast.error('改派失敗：' + r.error) }
      if (r.seated) {
        toast.success(`已改派 ${current} → ${number}，${group.agencyName || '團體'} ${batch.label || ''} 整梯入座`)
        flashAssigned(number)
        cancelMode()
        setSelectedTable(number)
        return
      }
      // 改派已落地但其他桌仍被佔 → 換下一張被佔桌繼續處理
      const nextQueue = (r.blocked || []).map(b => b.tableNumber)
      toast.info(`已改派 ${current} → ${number}，尚有 ${nextQueue.length} 桌被佔`)
      const nextCurrent = nextQueue[0]
      const fromTable = tables.find(t => t.number === nextCurrent)
      const suitable = reseatCandidateTables({
        tables, holds: groupHoldTables, group, batch, fromTable,
      }).map(t => t.number)
      if (!suitable.length) {
        cancelMode()
        return toast.error(`目前沒有可改派的空桌（${nextCurrent} 被佔）`)
      }
      setMode({ type: 'group-reseat', group, batch, queue: nextQueue, current: nextCurrent, suitable, suggestion: suitable[0] })
      setPendingConfirm(null)
      return
    }
  }

  const flashAssigned = (number) => {
    setJustAssigned(number)
    setTimeout(() => setJustAssigned(null), 3500)
  }

  // 多桌指派：已選桌的合計席數（給 banner 顯示 + 確認門檻）
  const walkinMultiSeats = useMemo(() => {
    if (mode?.type !== 'assign-multi') return 0
    return (mode.selected || []).reduce((s, n) => s + (tables.find(t => t.number === n)?.capacity || 0), 0)
  }, [mode, tables])

  // 多桌確認：席數夠 → 一筆 booking 佔多桌。
  // kind='booking' → 指派該訂位（桌況 reserved，客人到了再入座）
  // kind='waitlist' → 候位直接入座（桌況 dining，客人已在現場）
  // （現場帶位併桌是另一條路徑，走 handleWalkinSeat）
  const confirmWalkinMulti = () => {
    if (mode?.type !== 'assign-multi') return
    if (walkinMultiSeats < mode.need) return toast.error(`還差 ${mode.need - walkinMultiSeats} 席，請再加桌`)
    const tablesText = mode.selected.join(' + ')
    if (mode.kind === 'waitlist') {
      const r = seatWaitlistMulti(mode.wait.id, mode.selected)
      if (!r.ok) return toast.error('入座失敗：' + r.error)
      flashAssigned(mode.selected[0])
      finishWaitlistSeat(mode.selected[0], `${mode.wait.name}（候位 #${mode.wait.queueNumber}・${mode.need} 位）併桌入座 ${tablesText} · 可指派下一組`)
      return
    }
    const r = assignBookingTablesMulti(mode.booking.id, mode.selected)
    if (!r.ok) return toast.error('指派失敗：' + r.error)
    toast.success(`${mode.booking.name}（${mode.need} 位）併桌指派至 ${tablesText} · 可指派下一組`)
    flashAssigned(mode.selected[0])
    cancelMode()
    setSelectedTable(mode.selected[0])
    onAssignDone?.()
  }

  // === 帶位 v3：可選桌池 / 已選桌 / 兩道防呆 / 入座 + 短復原 ===

  // 可加入帶位的桌＝今日可用（非維修）且空桌（沿用指派流程同一個判定來源）
  const walkinSelectable = useMemo(
    () => findSuitableTables(1).map(t => t.number),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tables],
  )

  // 已選桌物件（面板顯示用）。桌被別台裝置帶走/進維修 → 自動從已選清單消失，不會帶著失效桌去入座。
  const walkinTables = useMemo(
    () => walkinTableNumbers
      .filter(n => walkinSelectable.includes(n))
      .map(n => tables.find(t => t.number === n))
      .filter(Boolean),
    [walkinTableNumbers, walkinSelectable, tables],
  )

  // 已選桌被別人佔走/進維修 → 直接從 walkinTableNumbers 剪掉，並告知店員是哪一張。
  // 不能只靠 walkinTables 過濾顯示：留在 walkinTableNumbers 的「幽靈桌」會①在桌況圖上
  // 仍畫成已選 ②被同層守門當成基準桌，害之後選別層的桌跳莫名錯誤 ③只剩一張時面板
  // 連「移除」鈕都不會渲染，店員在 UI 上完全清不掉。
  useEffect(() => {
    if (!walkinTableNumbers.length) return
    const gone = walkinTableNumbers.filter(n => !walkinSelectable.includes(n))
    if (!gone.length) return
    setWalkinTableNumbers(prev => prev.filter(n => walkinSelectable.includes(n)))
    toast.info(`${gone.join('、')} 已被佔用或停用，已從帶位清單移除`)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walkinSelectable, walkinTableNumbers])

  // 防呆（v3 綁在「已選的桌」而非二次確認上）：任一張桌有問題就示警，面板要勾「仍要帶」才滑得動。
  // 1) 被別筆 booking 預先配走（預配不動桌況，桌仍 vacant，會默默被現場帶位覆蓋）
  // 2) 今日團體圈桌未入座（findSuitableTables 只看桌況，不知道團體圈桌）
  // ★ 舊版 walkin-multi 沒有這兩道防呆（白名單不含 multi），v3 併桌一併補上。
  // 併桌時**每一張**有問題的桌都要列出來：只報第一張的話，店員勾了「仍要帶」就會把
  // 後面那張沒被告知的團體桌/預配桌一起放行——擋是擋住了，但他不知道自己在覆蓋什麼。
  // 帶位＝現在入座：新佔用區間 [現在, 現在+佔位)。某桌上他筆的預配逐筆講清楚「將解除／會保留」。
  const walkinConflictsFor = (number) => preassignConflicts(
    bookings, number, { date: todayStr(), window: assignmentWindow({ mode: 'now' }, settings) }, settings)

  const walkinWarning = useMemo(() => {
    if (!walkinTables.length) return null
    const lines = []
    for (const t of walkinTables) {
      // 觸發條件與過去相同（桌上有任何他筆預配就警示＋要勾選解鎖，M1 不變），只是文字依時段據實
      const conflicts = walkinConflictsFor(t.number)
      if (conflicts.length) {
        conflicts.forEach(c => lines.push(conflictLine(t.number, c, '帶位')))
        continue // 同一張桌只報最嚴重的那一項（預配優先於團保），避免同桌洗版
      }
      const hold = groupHoldTables[t.number]
      if (hold?.holds?.length) {
        const batch = hold.holds[0]?.batch
        const when = batch ? `（${batch.label || ''} ${batch.timeSlot || ''}）`.replace(/\s+/g, ' ') : ''
        lines.push(`${t.number} 為今日團體 ${hold.agencyName || '旅行社'} 預留${when}。帶位後散客將佔用團體桌。`)
      }
    }
    return lines.length ? { text: lines.join('\n'), lines } : null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walkinTables, bookings, groupHoldTables, settings])

  // M2b 短復原：把剛剛那筆 walk-in 取消並釋回空桌（沿用既有 cancelBooking：
  // clearTable 主桌+額外桌 → vacant、status→cancelled、解除桌號指派）。
  const undoLastSeat = (snap) => {
    if (!snap?.bookingId) return
    const current = bookingsRef.current.find(b => b.id === snap.bookingId)
    if (!current || current.status !== 'arrived') {
      return toast.error('已無法復原（這筆訂位的狀態已被更動）')
    }
    const r = cancelBooking(snap.bookingId)
    if (!r?.ok) return toast.error('復原失敗：' + (r?.error || '未知錯誤'))
    // 帶位時解除掉的預配一併還回去（只在那筆仍未配桌時寫回，見 restoreOverriddenAssignment）
    const note = restoreNote(restoreReleasedPreassigns(snap.releasedPreassigns, { restoreOverriddenAssignment }))
    setLastSeated(null)
    setWalkinTableNumbers(snap.tableNumbers || []) // 桌回到已選狀態，方便馬上改帶別組
    toast.info(`↩️ 已復原：${snap.tableNumbers.join(' + ')} 回到空桌${note}`)
  }

  // 帶位入座：一桌走 walkInSeat、多桌走 walkInSeatMulti（同一個手勢靠陣列長度分派）。
  // 回傳 false = 失敗（面板保留欄位，方便改人數或改走候位）。
  const handleWalkinSeat = (payload) => {
    const nums = payload?.tableNumbers || []
    if (!nums.length) { toast.error('請先點桌況圖選一張桌'); return false }
    const guestData = {
      name: payload.name, phone: payload.phone, guests: payload.guests, notes: payload.notes,
    }
    // 帶位前記下被覆蓋的預配（面板警示逐桌列出的那幾筆；店員已勾「仍要帶」才滑得動）
    const overridden = nums.flatMap(n => walkinConflictsFor(n))
    const r = nums.length === 1 ? walkInSeat(nums[0], guestData) : walkInSeatMulti(nums, guestData)
    if (!r.ok) { toast.error('入座失敗：' + r.error); return false }
    // 只解除用餐時段重疊的；快照帶進復原，按「復原」時一併還回去
    const releasedPreassigns = releaseOverlappingPreassigns(overridden, { releaseOverriddenAssignment, toast })
    const label = nums.join(' + ')
    const name = r.booking?.name || '散客'
    const guests = r.booking?.guests || payload.guests
    const snap = { bookingId: r.booking?.id, tableNumbers: nums, name, guests, at: Date.now(), releasedPreassigns }
    setLastSeated(snap)
    // M6：供下一組一鍵沿用。只存店員手打的 staffNotes——payload.notes 還含著
    // 由電話帶出的「過敏：xxx」，沿用會把上一位客人的過敏資訊掛到新客人身上。
    setLastParty({ guests, notes: payload.staffNotes || '' })
    flashAssigned(nums[0])
    setWalkinTableNumbers([])
    // 不 setSelectedTable：留在帶位面板才能直接帶下一組（舊版會被 TableDrawer 蓋掉）
    // M2b：成功 toast 直接帶「復原」，8 秒內可反悔（拿掉二次確認換來的安全網）
    toast.action(
      `${name}（${guests} 位）入座 ${label} · 可帶下一組`,
      { label: '復原', onClick: () => undoLastSeat(snap) },
      { duration: 8000 },
    )
    return true
  }

  // 復原提示 8 秒後失效（toast 也同步消失）
  useEffect(() => {
    if (!lastSeated) return
    const id = setTimeout(() => setLastSeated(null), 8000)
    return () => clearTimeout(id)
  }, [lastSeated])

  // 當前選中桌的物件 + 對應 booking
  const selectedTableObj = useMemo(
    () => selectedTable ? tables.find(t => t.number === selectedTable) : null,
    [selectedTable, tables]
  )
  const selectedBooking = useMemo(() => {
    if (!selectedTableObj?.currentBookingId) return null
    return bookings.find(b => b.id === selectedTableObj.currentBookingId) || null
  }, [selectedTableObj, bookings])

  // 防呆：待確認桌是否已被「別筆 booking」於排位規劃預先配走（assignedTableId 指向此桌）。
  // 預配不動桌況（桌仍 vacant），會默默被現場指派覆蓋；指派前先示警讓店員知情。
  // 只示警「不同 booking 的預配」：現場指派的就是被預配的那位客人（id 相同）時不觸發。
  // 每筆標記「會不會被解除」（與新佔用區間重疊才解除），banner 據實寫「將解除／會保留」。
  const pendingConflicts = useMemo(() => {
    if (!pendingConfirm || !mode) return null
    const list = preassignConflictsFor(pendingConfirm)
    return list.length ? list : null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingConfirm, mode, bookings, settings])

  // 防呆：待確認桌是否被「今日團體」hold（圈桌未入座）。
  // findSuitableTables 只看桌況（vacant），不知道團體圈桌 → 指派/換桌/候位入座前先示警，避免散客坐掉團體桌。
  const pendingGroupHold = useMemo(() => {
    if (!pendingConfirm || !mode) return null
    if (!['assign', 'seat-waitlist', 'move'].includes(mode.type)) return null
    const hold = groupHoldTables[pendingConfirm]
    return hold?.holds?.length ? hold : null
  }, [pendingConfirm, mode, groupHoldTables])

  // 桌位詳情用：選中的「空桌」是否已被別筆 booking 預先配走（被動提示，未進指派模式也看得到）。
  const selectedTablePreassign = useMemo(() => {
    if (!selectedTableObj || selectedTableObj.status !== 'vacant') return null
    return findPreassignedBooking(bookings, selectedTable, {
      date: todayStr(),
      excludeBookingId: selectedTableObj.currentBookingId,
    })
  }, [selectedTableObj, selectedTable, bookings])

  // ESC 取消模式
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { cancelMode(); setSelectedTable(null) } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // 從外部觸發指派模式
  useEffect(() => {
    if (pendingAssign && (!mode || mode.booking?.id !== pendingAssign.id)) {
      startAssign(pendingAssign)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingAssign?.id])

  // 從外部觸發改桌模式（訂位卡／詳情／新增後 toast 的「改桌」）。
  // 以當下 bookings 為準重新取這筆（跨頁帶來的是按鈕當時的快照，桌號可能已變）。
  useEffect(() => {
    if (!pendingMove?.booking) return
    const fresh = bookings.find(b => b.id === pendingMove.booking.id) || pendingMove.booking
    startMove(fresh)
    // 一觸發就消耗掉：ESC 取消模式時不會回報，若留著，下次切回現場頁（元件重掛）會又自動進改桌模式
    onMoveDone?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingMove?.seq])

  const cancelModeAndNotify = () => {
    // 只有「訂位指派」是跨頁來的（BookingsView 的指派桌 → pendingAssign），取消時要回報消耗掉；
    // 候位併桌是現場頁內互動，沒有待消耗的跨頁請求。
    const isBookingAssign = mode?.type === 'assign'
      || (mode?.type === 'assign-multi' && mode.kind !== 'waitlist')
    if (isBookingAssign) onAssignDone?.()
    if (mode?.type === 'move') onMoveDone?.()
    cancelMode()
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* 上部チップ群：高さ固定（捲動しない）。地図＋右側欄に最大高さを譲る。
          ⚠️ 用 flex gap 而不是 space-y-*：`space-y` 的 `> * + *` 會替 display:none 的
          兄弟（lg 以上被隱藏的手機版 StatusBar）照樣算一份 margin，白吃 8px 高度，
          左欄就會從「剛好不捲」變成捲。flex gap 不會替 display:none 的子項留空隙。 */}
      <div className="flex-shrink-0 flex flex-col gap-2">
      {/* 統計列：lg 以上壓成單列 pill（把高度還給桌況圖）；lg 以下用原本的六格 grid。
          ⚠️ compact 單列不可用在窄螢幕——375px 時六格 pill 會被整個擠出可視範圍
          （不是可橫向捲，是直接看不到），店員在手機上永遠讀不到那些數字。 */}
      <div className="lg:hidden">
        <StatusBar tables={tables} waitlist={waitlist} bookings={bookings} />
      </div>

      {/* lg 以上＝一條頂列（約 44px）：現場・時間 + 六格 pill + 樓層 + 視圖 + 編輯佈局 + 登入者。
          lg 以下＝改版前的樓層/視圖列（大尺寸、可換行），統計已在上面那塊 grid。 */}
      <div className="flex items-center gap-2 flex-wrap lg:flex-nowrap">
        <div className="hidden lg:flex min-w-0">
          <StatusBar variant="compact" tables={tables} waitlist={waitlist} bookings={bookings} />
        </div>

        <div className="hidden lg:block flex-1 min-w-0" />

        {/* 樓層：分段控制（全名在 title；桌數附在代號後） */}
        <SegmentedControl
          className="flex-none"
          options={['1F', '2F'].map(f => ({ key: f, label: `${f} · ${tables.filter(t => t.floor === f).length}`, title: f === '1F' ? '1F 主用餐區' : '2F 用餐區' }))}
          value={floor} onChange={setFloor} ariaLabel="樓層" />

        {/* 視圖切換：桌況（SVG 即時圖）｜排程（每桌當日 turns）。帶位模式中隱藏，避免在排程視圖操作。 */}
        {!mode && !reserveOpen && (
          <SegmentedControl
            className="flex-none"
            options={[{ key: 'map', label: '地圖' }, { key: 'summary', label: '摘要' }, { key: 'schedule', label: '排程' }]}
            value={view} onChange={setView} ariaLabel="現場視圖" />
        )}

        {!mode && !reserveOpen && can('table.config') && (
          <button
            onClick={() => setShowLayoutEditor(true)}
            className="tap flex-none h-8 px-3 rounded-[9px] text-xs font-semibold bg-white border border-chicken-brown/15 text-chicken-brown"
          >編輯佈局</button>
        )}

        {/* 登入者/角色：現場分頁不渲染桌面版頁首，這裡是它唯一的落點。
            lg 以下不顯示——手機版頂部 Header 本來就有，重複只是佔空間。 */}
        <div className="flex-none hidden lg:block text-right leading-tight">
          <div className="text-[11px] font-bold text-chicken-brown">{user?.displayName}</div>
          <div className="text-[10px] text-chicken-brown/60">{user?.roleLabel}</div>
        </div>
      </div>

      {/* 「現在該做什麼」提示列：過時未到 / 超時 / 待清 / 自動處理紀錄 / 節奏單句 */}
      <OpsHintBar
        onOpenUpcoming={() => { setSelectedTable(null); setRailTab('upcoming') }}
        onOpenLog={() => setShowOpsLog(true)}
      />

      {/* Mode banner — 依模式不同底色 + emoji，避免誤判 */}
      <ModeBanner
        mode={mode}
        pendingConfirm={pendingConfirm}
        pendingConflicts={pendingConflicts}
        pendingGroupHold={pendingGroupHold}
        multiSeats={walkinMultiSeats}
        onCancel={cancelModeAndNotify}
        onConfirm={() => executeAssign(pendingConfirm)}
        onConfirmMulti={confirmWalkinMulti}
        onClearPending={() => setPendingConfirm(null)}
      />
      </div>

      {/* 主區：左＝操作/帶位欄（常駐、內部捲動）｜右＝桌況（地圖/摘要/排程，填滿）。
          一面式機制不變：外層 flex-1 min-h-0；左欄自身 overflow-y-auto；右欄 flex-1 min-h-0、SVG 自動縮放 */}
      <div className="flex-1 min-h-0 mt-2 grid grid-cols-1 md:grid-cols-[400px_1fr] lg:grid-cols-[470px_1fr] gap-3">
        {/* 左欄：選中桌→TableDrawer；否則→OpsRail（帶位/今日訂位/候位/團體）
            TableDrawer 是長內容 → 外層捲動；OpsRail 自己管內部捲動與釘底動作列 → 外層只給 flex 容器 */}
        <div className={`h-full min-h-0 ${selectedTableObj ? 'overflow-y-auto space-y-3' : 'flex flex-col'}`}>
          {selectedTableObj ? (
            <TableDrawer
              table={selectedTableObj}
              booking={selectedBooking}
              preassign={selectedTablePreassign}
              groupHold={groupHoldTables[selectedTable] || null}
              onClose={() => setSelectedTable(null)}
              onStartMove={() => startMove(selectedBooking)}
              onReseatBatch={startGroupReseat}
              onWaitlistSeated={finishWaitlistSeat}
              mode={{ assigning: mode?.type === 'assign' }}
            />
          ) : (
            <OpsRail
              activeTab={railTab}
              onTabChange={setRailTab}
              walkinGuests={walkinGuests}
              onWalkinGuestsChange={setWalkinGuests}
              walkinTables={walkinTables}
              onRemoveWalkinTable={(n) => setWalkinTableNumbers(prev => prev.filter(x => x !== n))}
              onClearWalkinTables={() => setWalkinTableNumbers([])}
              walkinWarning={walkinWarning}
              onWalkinSeat={handleWalkinSeat}
              lastParty={lastParty}
              onClickBooking={(b) => {
                if (b.assignedTableId) setSelectedTable(b.assignedTableId)
              }}
              onAssignTable={startAssign}
              onMoveTable={can('booking.update') && can('table.update') ? startMove : null}
              onSeatWaitlist={startSeatWaitlist}
              onReseatBatch={startGroupReseat}
              onAddBooking={can('booking.create') ? openReserve : null}
              flashBookingId={flashBookingId}
              reserve={reserveOpen ? {
                guests: reserveGuests,
                onGuestsChange: (g) => { setReserveGuests(g); setReserveNotice('') },
                timeSlot: reserveSlot,
                onTimeSlotChange: (t) => { setReserveSlot(t); setReserveNotice(''); setReserveSlotNotice('') },
                slotNotice: reserveSlotNotice,
                lockKind: reserveCalc.kind,
                table: reserveTable,
                tablePick: reserveTablePick,
                onTablePickChange: (v) => { setReserveTablePick(v); setReserveNotice('') },
                suggestedNumber: reserveCalc.tables[0]?.number || null,
                notice: reserveNotice,
                needsCombo: reserveNeedsCombo,
                canAssign: canReserveAssign,
                onSave: handleReserveSave,
                onBack: closeReserve,
                // 其他日期／完整表單：沿用 AdminPage 既有的「訂位 → 新增」入口（名冊開單等也走它）
                onOpenFullForm: onAddBooking || null,
              } : null}
              onFocusTable={(n) => {
                const t = tables.find(x => x.number === n)
                if (t) setFloor(t.floor)
                setSelectedTable(n)
              }}
            />
          )}
        </div>

        {/* 右欄：桌況（地圖 SVG／摘要／排程）。高度填滿剩餘空間，SVG 自動縮放 */}
        <div className="bg-white rounded-xl border border-chicken-brown/10 p-2 sm:p-3 h-full min-h-[260px] overflow-hidden flex flex-col">
          {showSchedule ? (
            // 排程視圖＝縱向堆疊卡片，會長 → 內部捲動避免裁切
            <div className="flex-1 min-h-0 overflow-y-auto">
              <TableScheduleView
                tables={tables.filter(t => t.floor === floor)}
                turnsByTable={turnsByTable}
                selectedTableNumber={selectedTable}
                onSelectTable={(n) => setSelectedTable(prev => prev === n ? null : n)}
              />
            </div>
          ) : showSummary ? (
            // 摘要視圖＝可坐存量 + 依狀態分組（不估時間）
            <div className="flex-1 min-h-0">
              <TableSummaryView
                tables={tables.filter(t => t.floor === floor)}
                groupHoldTables={groupHoldTables}
                settings={settings}
                onSelectTable={(n) => setSelectedTable(prev => prev === n ? null : n)}
              />
            </div>
          ) : (
            <>
              <div className="mb-2 flex-shrink-0 flex flex-wrap items-center gap-2 px-1 text-[11px] font-bold text-chicken-brown/55">
                <LegendSwatch fill={STATUS_COLOR.vacant.fill} stroke={STATUS_COLOR.vacant.stroke} label="可入座" />
                <LegendSwatch fill={STATUS_COLOR.reserved.fill} stroke={STATUS_COLOR.reserved.stroke} label="已預訂" />
                <LegendSwatch fill={PREASSIGN_COLOR.fill} stroke={PREASSIGN_COLOR.stroke} dashed label="預配（桌仍可坐）" />
                <LegendSwatch fill={DINING_STAGE_FILL.normal} stroke={STATUS_COLOR.dining.stroke} label="用餐中" />
                <LegendSwatch fill={STATUS_COLOR.cleaning.fill} stroke={STATUS_COLOR.cleaning.stroke} label="待清桌" />
                <LegendSwatch fill={DINING_STAGE_FILL.overtime} stroke={DINING_STAGE_FILL.overtime} label="超時" />
                <LegendSwatch fill={GROUP_HOLD_COLOR.fill} stroke={GROUP_HOLD_COLOR.stroke} label="團體保留" />
                <span className="inline-flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-sm bg-white ring-2 ring-chicken-red ring-inset" />選中</span>
              </div>
              <div className="flex-1 min-h-0">
              <FloorMap
                floor={floor}
                tables={tables}
                bookings={bookings}
                settings={settings}
                selectedTableNumber={selectedTable}
                selectedTableNumbers={reserveOpen ? (reserveTable ? [reserveTable.number] : []) : walkinTableNumbers}
                onSelectTable={handleTableClick}
                // 內嵌新增面板：選好時段後，候選高亮、其餘淡化（大組／無權限時不進選桌呈現）
                assignMode={['assign', 'seat-waitlist', 'move', 'group-reseat', 'assign-multi'].includes(mode?.type)
                  || (reserveOpen && !!reserveSlot && canReserveAssign && !reserveNeedsCombo)}
                highlightTables={
                  reserveOpen ? reserveCandidateNums
                    : mode?.type === 'assign-multi' ? mode.selected   // 多桌：已選桌高亮（其餘空桌 dimmed 但可點加入）
                    : ['assign', 'seat-waitlist', 'move', 'group-reseat'].includes(mode?.type) ? mode.suitable
                    : []
                }
                suggestionTable={mode?.suggestion || null}
                pendingConfirmTable={pendingConfirm}
                justAssignedTable={justAssigned}
                groupHoldTables={groupHoldTables}
                preassignTables={preassignTables}
                fixtures={fixtures}
                zones={zones}
              />
              </div>
              {/* 報到列：地圖下方 in-flow（不是疊在地圖上），無符合條件的訂位時完全不佔高度。
                  模式進行中（指派/換桌/候位/團體改派）或無 table.update 權限時不顯示——
                  這些情境下桌況圖的點擊語意已被模式接管，疊加一條會觸發別的動作的列是額外誤觸風險。 */}
              {!mode && !reserveOpen && can('table.update') && (
                <ArrivalStrip
                  tables={tables}
                  bookings={bookings}
                  currentFloor={floor}
                  onSelectTable={(n) => {
                    const t = tables.find(x => x.number === n)
                    if (t) setFloor(t.floor)
                    setSelectedTable(n)
                  }}
                  onArrive={(table, booking) => handleArriveNow(table, booking, {
                    seatBooking, seatBookingAllTables, setStatus, setTableStatus, undoSeatPreassigned, toast, onMove: startMove,
                    // 預配那條的防呆（團保／他筆預配重疊先確認）；鎖桌那條不用這些
                    confirm,
                    getTable: (n) => tables.find(t => String(t.number) === String(n)),
                    preassignConflictLines: (b) => preassignArriveConflictLines(b, {
                      bookings: bookingsRef.current, groupHoldTables, settings, now: new Date(),
                    }),
                  })}
                />
              )}
            </>
          )}
        </div>
      </div>

      <div className="flex-shrink-0 hidden sm:block text-center text-[11px] text-chicken-brown/45 mt-2">
        {reserveOpen
          ? '新增今日訂位中：點桌況圖為這筆選桌（綠框＝可用）· ESC 返回今日訂位'
          : '帶位籤點空桌＝選位（可多桌併桌）· 其他情況點桌位看詳情 · 紅色超時桌可禮貌詢問結帳 · ESC 取消'}
      </div>

      {/* 桌位佈局編輯器 */}
      <LayoutEditor open={showLayoutEditor} onClose={() => setShowLayoutEditor(false)} />

      {/* 系統自動處理紀錄（自動清檯留痕） */}
      <OpsLogModal open={showOpsLog} onClose={() => setShowOpsLog(false)} />
    </div>
  )
}
