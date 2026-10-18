// 今日訂位「脈動」：過時未到（最優先處理）/ 90 分內將到 / 之後（收合）。
// 之前只看未來 90 分窗：晚上時早上的 no-show 完全消失、無人處理 → 改為全日三段。
import { useMemo, useState, useEffect, useRef } from 'react'
import { useBooking } from '../../../contexts/BookingContext'
import { useAuth } from '../../../contexts/AuthContext'
import { useToast, useConfirm } from '../../ui/Toast'
import { todayStr } from '../../../utils/timeSlots'
import { classifyTodayPulse, overdueMinOf, fmtOverdueMin } from '../../../utils/bookingPulse'
import { buildGroupHolds, todayActiveGroups } from '../../../utils/groupLive'
import { seatAfterArriveConfirm, toastSeatedWithUndo } from '../../../utils/arriveSeat'
import { assignmentKind } from '../../../utils/tableStatus'
import { bookingTableNumbers } from '../../../utils/bookingTables'
import { getNoshowCount } from '../../../services/bookingService'
import Icon from '../../ui/Icon'
import { MOVE_COMBO_REASON } from '../../booking/useBookingActions'
import { formatPhone } from '../../../utils/phoneFormat'
import { splitSuffix } from '../../../utils/partySplit'
import { cancelWithUndo } from '../../../utils/bookingActions'
import EditBookingModal from '../../booking/EditBookingModal'
import { ArrowLeftRight, Phone, X } from 'lucide-react'


// 搜尋：姓名／電話（含末碼，忽略符號）／桌號（主桌＋副桌）
function matchesQuery(b, q) {
  const raw = q.trim().toLowerCase()
  if (!raw) return true
  const digits = raw.replace(/\D/g, '')
  return (
    (b.name || '').toLowerCase().includes(raw) ||
    (b.phone || '').toLowerCase().includes(raw) ||
    (digits.length > 0 && String(b.phone || '').replace(/\D/g, '').includes(digits)) ||
    bookingTableNumbers(b).some(n => String(n).toLowerCase().includes(raw))
  )
}

// 有可一鍵指派的建議桌：「指派 103」一下完成；旁邊「選桌」進原本的選桌模式（換別桌／併桌）
// withPick＝false：卡片上已有「到了 · 選桌入座」時不再多放「選桌」，改到地圖選別桌收進「⋯ 更多」
function QuickAssignButtons({ b, quick, onQuickAssign, onAssignTable, outline = false, withPick = true }) {
  return <>
    <button onClick={() => onQuickAssign?.(b)} aria-label={`${b.name} 指派 ${quick.table}`}
      className={`px-3 min-h-[44px] rounded-md text-xs font-bold ${outline ? 'border border-chicken-red/50 text-chicken-red' : 'bg-chicken-red text-white'}`}>
      {quick.lockKind === 'preassign' ? '預配' : '指派'} {quick.table}
    </button>
    {withPick && <button onClick={() => onAssignTable?.(b)} aria-label={`${b.name} 到地圖選別桌`} className="px-3 min-h-[44px] border rounded-md text-xs font-bold text-chicken-brown/70">選桌</button>}
  </>
}

function BookingCard({ b, now, kind, quick = null, onQuickAssign, onClickBooking, onOpenDetail, onAssignTable, onArriveSeat, onMoveTable, onMoveBlocked, onSeat, onNoshow, onComplete, onEdit, onCancel, perms, flash = false }) {
  const overdueMin = overdueMinOf(b.timeSlot, now)
  const overdue = overdueMin > 15 // 與 classifyTodayPulse graceMin 同口徑
  const assigned = !!b.assignedTableId
  // 「已指派」有兩種（見 utils/tableStatus.assignmentKind），過去徽章一律寫「已指派」，
  // 但地圖上 held 是藍色、preassign 是綠色可入座 —— 店員只看得到同樣的徽章卻兩個顏色。
  // 徽章改為與地圖同語意：held＝綠（桌已鎖）、preassign＝藍（桌還是空的，別人坐得進去）。
  const preassigned = kind === 'preassign'

  // 前端權限門（與 TableDrawer 的 can('table.update') 同慣例）：後端 staffAccess 會擋，
  // 但沒有前端門的話 kitchen 按下去會寫進本機 localStorage、推送時被剔除，
  // 畫面上卻毫無錯誤提示 → 本機與雲端永久不一致。權限不足一律不渲染。
  // 「指派桌位」「客人到了」都會同時寫 bookings 與 tables，故兩個權限都要。
  const showAssign = !assigned && perms.booking && perms.table
  // 未配桌的客人到了：選桌即入座（指派＋入座一步，見 OperationsView.startArriveSeat）——尖峰省 3–4 下
  const showArriveSeat = showAssign && !!onArriveSeat
  const showSeat = assigned && perms.booking && perms.table
  const showNoshow = overdue && perms.booking && perms.table   // markNoshow 會釋出本筆鎖住的桌
  const showComplete = overdue && (assigned ? perms.booking && perms.table : perms.booking)
  // 改桌：已有桌的待到訂位從更多操作進現場整組選桌。
  // 會同時寫 bookings 與 tables → 兩個權限都要；唯讀角色仍看到原本的唯讀徽章。
  // 未到可整組改桌；已入座併桌仍保留既有限制。
  const isCombo = (b.extraTableIds || []).length > 0 && !['confirmed', 'pending'].includes(b.status)
  const canMove = assigned && !!onMoveTable && perms.booking && perms.table
  // 現場直接改單／取消（不必繞去訂位頁）：會連動桌位（解除／釋桌）→ bookings＋tables 兩個權限都要
  const canEdit = !!onEdit && perms.booking && perms.table
  const canCancel = !!onCancel && perms.booking && perms.table
  // 更多選單：有任何寫入動作才出現（詳情、撥號跟著收進去）；唯讀角色只剩外面的「詳情 ›」
  const hasMenu = showNoshow || canEdit || canCancel || showComplete || (showArriveSeat && quick)
  const tableLabel = [b.assignedTableId, ...(b.extraTableIds || [])].filter(Boolean).join(' + ')
  // 已指派徽章是唯讀資訊，唯讀角色仍該看得到；整列全空時才不渲染（免留空白 margin）

  // 剛從現場內嵌面板新增的那筆：捲到可見＋醒目框約 2 秒（純 class 切換，不靠動畫回呼，內容永遠可見）
  const cardRef = useRef(null)
  useEffect(() => {
    if (flash) cardRef.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
  }, [flash])

  return (
    <div
      ref={cardRef}
      data-booking-id={b.id}
      data-flash={flash ? 'true' : undefined}
      className={`relative p-3 rounded-xl border-2 cursor-pointer transition-all
                 ${overdue ? 'border-chicken-red bg-chicken-red/5'
                   // 還沒配桌：淡琥珀外框＋底（與報到列「未配桌」同色），一眼分出「還要選位」的卡（Barry 2026-10-17）
                   : !assigned ? 'border-amber-300 bg-amber-50/70 hover:border-amber-400'
                   : 'border-chicken-brown/10 bg-white hover:border-chicken-yellow/40'}
                 ${flash ? 'ring-4 ring-chicken-yellow/60 !bg-chicken-yellow/10' : ''}`}
      onClick={() => onClickBooking?.(b)}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1.5">
            <span className="text-base font-bold text-chicken-brown tabular-nums">{b.timeSlot}</span>
            <span className="text-sm font-bold truncate min-w-0">{b.name}</span>
          </div>
          {/* 完整電話（取代過去的「…506」末碼）：店員要能照著撥；無電話不顯示。
              刻意是純文字、不是 tel: 連結——撥號走「⋯ 更多 → 撥打電話」，避免兩個撥號熱區相鄰，
              尖峰時點卡片常誤撥。電話不截斷，人數那段在窄欄時可截斷。 */}
          <div className="flex items-baseline gap-2 mt-0.5 min-w-0">
            {formatPhone(b.phone) && <span data-testid="phone-full" className="text-sm tabular-nums whitespace-nowrap flex-shrink-0 font-bold text-chicken-brown">{formatPhone(b.phone)}</span>}
            <span className="text-xs text-chicken-brown/60 truncate">{b.guests} 位{splitSuffix(b)}</span>
          </div>
        </div>
        {/* 右上角＝桌號徽章（Barry 2026-10-17：「幾分後到」與左邊時段重複，客人到領位台時最要看的是坐哪桌）。
            顏色同卡片既有語意：已指派＝綠實線、已預配＝藍虛線、未配桌＝淡琥珀。過時未到的紅色提醒仍在最上面。
            徽章文字是「已指派 112」一整句（小字＋大號碼），讀屏與既有測試／搜尋口徑不變。 */}
        <div className="flex-shrink-0 flex flex-col items-end gap-1">
          {overdue && (
            <span className="text-[10px] font-bold text-white bg-chicken-red px-2 py-0.5 rounded-full whitespace-nowrap">
              {fmtOverdueMin(overdueMin)}
            </span>
          )}
          {assigned ? (
            <span data-testid="table-badge" title={preassigned ? '已預配：只記在訂位上，桌子現在仍可帶別組' : '已指派：桌子已鎖給這組'}
              className={`inline-flex items-baseline gap-1 rounded-lg px-2 py-0.5 border-2 whitespace-nowrap
                ${preassigned ? 'border-dashed border-blue-500 bg-blue-50 text-blue-800' : 'border-chicken-green bg-chicken-green/10 text-chicken-green'}`}>
              <span className="text-[10px] font-bold">{preassigned ? '已預配' : '已指派'}</span>{' '}<span className="text-lg font-bold tabular-nums leading-tight">{tableLabel}</span>
            </span>
          ) : (
            <span data-testid="unassigned-tag" className="inline-flex items-center rounded-lg px-2 py-1 border-2 border-amber-300 bg-amber-100 text-amber-800 text-xs font-bold whitespace-nowrap">未配桌</span>
          )}
        </div>
      </div>

      <div className="mt-2 flex items-center gap-2 flex-wrap" onClick={e => e.stopPropagation()}>
        {showSeat ? <button onClick={() => onSeat?.(b)} className="px-3 min-h-[44px] bg-chicken-green text-white rounded-md text-xs font-bold">客人到了</button>
          : showArriveSeat ? <>
            <button onClick={() => onArriveSeat(b)} aria-label={`${b.name} 到了，選桌入座`} className="px-3 min-h-[44px] bg-chicken-green text-white rounded-md text-xs font-bold">到了 · 選桌入座</button>
            {quick ? <QuickAssignButtons b={b} quick={quick} onQuickAssign={onQuickAssign} onAssignTable={onAssignTable} outline withPick={false} />
              : <button onClick={() => onAssignTable?.(b)} className="px-3 min-h-[44px] border border-chicken-red/50 text-chicken-red rounded-md text-xs font-bold">指派桌位</button>}
          </>
          : showAssign ? (quick ? <QuickAssignButtons b={b} quick={quick} onQuickAssign={onQuickAssign} onAssignTable={onAssignTable} />
            : <button onClick={() => onAssignTable?.(b)} className="px-3 min-h-[44px] bg-chicken-red text-white rounded-md text-xs font-bold">指派桌位</button>) : null}
        {/* 2026-10-17 卡片減量（Barry：按鈕太多、「客人到了」和「已完成」看起來一樣）：
            第一層只留「聯絡＋主動作（客人到了／到了·選桌入座／指派）＋更多＋詳情」。
            「已完成」改名「補登：來過、已吃完」收進更多——它是事後補登（客人沒按入座就吃完走了），
            不是「到了」，放第一層會被當成同義鈕誤按。No-show 的「先聯絡」提醒已在確認框裡，選單不再重複。 */}
        {/* 第一排第二顆＝「改桌」（2026-10-17：撥號還沒接、到店最常做的是換桌）。聯絡改收進更多。 */}
        {canMove && <button type="button" aria-disabled={isCombo ? 'true' : undefined} onClick={() => isCombo ? onMoveBlocked?.() : onMoveTable(b)} title={isCombo ? MOVE_COMBO_REASON : `重新選擇桌位（目前${preassigned ? '預配' : ''} ${tableLabel}）`}
          className={`inline-flex items-center gap-1 min-h-[44px] px-3 border rounded-md text-xs font-bold ${isCombo ? 'text-chicken-brown/40' : 'text-chicken-brown'}`}><ArrowLeftRight size={14} strokeWidth={2.4} aria-hidden="true" className="shrink-0" />改桌</button>}
        {hasMenu ? <details data-popover>
          <summary className="cursor-pointer list-none min-h-[44px] px-3 flex items-center rounded-md border text-xs" aria-label={`${b.name} 更多操作`}>⋯ 更多</summary>
          {/* 浮出選單以「整張卡片」為定位基準（details 不設 relative）：左右貼齊卡片內距，
              垂直位置留在原本的流位置（top 不設）——不會往右溢出被側欄裁掉，也不會把下面的卡片推開 */}
          <div className="absolute left-3 right-3 z-20 mt-1 bg-white rounded-lg border shadow-lg p-1 flex flex-col" onKeyDown={e => { if (e.key === 'Escape') { const el = e.currentTarget.closest('details'); el.open = false; el.querySelector('summary').focus() } }}>
            {/* 「詳情」＝唯讀看完整資料（備註、來源、LINE、修改紀錄）；其餘都是會改資料的動作 */}
            <button onClick={e => { e.currentTarget.closest('details').open = false; (onOpenDetail || onClickBooking)?.(b) }} className="min-h-[44px] px-3 text-left text-xs font-bold">查看詳情</button>
            {showArriveSeat && quick && <button onClick={e => { e.currentTarget.closest('details').open = false; onAssignTable?.(b) }} className="min-h-[44px] px-3 text-left text-xs font-bold">到地圖選別桌指派</button>}
            {canEdit && <button onClick={e => { e.currentTarget.closest('details').open = false; onEdit(b) }} className="min-h-[44px] px-3 text-left text-xs font-bold">改人數／時段／備註</button>}
            {b.phone && <a href={`tel:${b.phone.replace(/[^+\d]/g, '')}`} aria-label={`聯絡 ${b.name} ${b.phone}`} className="min-h-[44px] px-3 flex items-center gap-1 text-xs"><Phone size={14} strokeWidth={2.2} aria-hidden="true" />撥打電話</a>}
            {showComplete && <button onClick={e => { e.currentTarget.closest('details').open = false; onComplete?.(b) }} title="客人其實有來、也吃完了，只是當時沒按入座" className="min-h-[44px] px-3 text-left text-xs text-chicken-green font-bold">補登：來過、已吃完</button>}
            {showNoshow && <button onClick={e => { e.currentTarget.closest('details').open = false; onNoshow?.(b) }} className="min-h-[44px] px-3 text-left text-chicken-red text-xs border-t border-chicken-brown/10">沒來：標 No-show</button>}
            {canCancel && <button onClick={e => { e.currentTarget.closest('details').open = false; onCancel(b) }} className={`min-h-[44px] px-3 text-left text-chicken-red text-xs ${showNoshow ? '' : 'border-t border-chicken-brown/10'}`}>取消訂位</button>}
          </div>
        </details>
          // 唯讀角色沒有任何動作 → 不給選單，只留一顆「詳情」
          : <button type="button" onClick={() => (onOpenDetail || onClickBooking)?.(b)} className="min-h-[44px] px-2 text-xs text-chicken-brown/60">詳情 ›</button>}
      </div>

      {(b.notes?.pet || b.notes?.child || b.notes?.mobility) && (
        <div className="flex gap-1 mt-1.5">
          {b.notes.pet && <span className="inline-flex items-center gap-0.5 text-[10px] bg-chicken-yellow/15 text-chicken-yellow px-1.5 py-0.5 rounded-full"><Icon name="paw" size={11} />寵物</span>}
          {b.notes.child && <span className="inline-flex items-center gap-0.5 text-[10px] bg-chicken-green/15 text-chicken-green px-1.5 py-0.5 rounded-full"><Icon name="child" size={11} />兒童</span>}
          {b.notes.mobility && <span className="inline-flex items-center gap-0.5 text-[10px] bg-chicken-brown/15 text-chicken-brown px-1.5 py-0.5 rounded-full"><Icon name="wheelchair" size={11} />行動</span>}
        </div>
      )}
    </div>
  )
}

// 已入座清單的一列：桌號＋客人＋用餐分鐘，動作只放「改桌」「改人數」「桌況 ›」——
// 結帳／清桌／撤回入座等收在桌況抽屜（同一套守門），這裡不另做一份。
const SOURCE_ZH = { walkin: '現場', waitlist: '候位' }
function SeatedRow({ b, now, onOpenTable, onMoveTable, onEdit, perms }) {
  const tables = bookingTableNumbers(b)
  const since = b.actualArrivalTime ? Math.max(0, Math.floor((now - new Date(b.actualArrivalTime).getTime()) / 60000)) : null
  // 已入座（含併桌）走 OperationsView.startMove 的 arrived 分支：整組重選桌，主＋副桌一起換
  const canMove = !!onMoveTable && perms.booking && perms.table && tables.length > 0
  const canEdit = !!onEdit && perms.booking && perms.table
  return (
    <div className="p-2.5 rounded-lg border border-chicken-brown/15 bg-white">
      <div className="flex items-center gap-2 min-w-0">
        <span className="shrink-0 min-w-[44px] text-center rounded-md bg-chicken-brown/10 px-1.5 py-1 text-xs font-bold text-chicken-brown">{tables.join('+') || '—'}</span>
        <span className="font-bold text-sm text-chicken-brown truncate">{b.name}</span>
        {formatPhone(b.phone) && <span data-testid="phone-full" className="text-xs font-bold tabular-nums whitespace-nowrap shrink-0 text-chicken-brown">{formatPhone(b.phone)}</span>}
        <span className="text-xs text-chicken-brown/60 truncate">{b.guests} 位{SOURCE_ZH[b.source] ? ` · ${SOURCE_ZH[b.source]}` : ''}</span>
        {since != null && <span className="ml-auto shrink-0 text-[11px] font-bold text-chicken-brown/60">用餐 {since} 分</span>}
      </div>
      <div className="mt-1.5 flex items-center gap-2 flex-wrap">
        {canMove && <button type="button" onClick={() => onMoveTable(b)} title="換到別桌"
          className="inline-flex items-center gap-1 min-h-[44px] px-3 border rounded-md text-xs font-bold"><ArrowLeftRight size={14} strokeWidth={2.4} aria-hidden="true" />改桌</button>}
        {canEdit && <button type="button" onClick={() => onEdit(b)} className="min-h-[44px] px-3 border rounded-md text-xs font-bold">改人數／備註</button>}
        {tables.length > 0 && <button type="button" onClick={() => onOpenTable(b)} className="min-h-[44px] px-2 text-xs text-chicken-brown/60">桌況 ›</button>}
      </div>
    </div>
  )
}

export default function UpcomingPanel({ onClickBooking, onOpenDetail = null, onAssignTable, quickAssignFor = null, onQuickAssign = null, onArriveSeat = null, onMoveTable, flashBookingId = null }) {
  const { bookings, tables, groupReservations, settings, markBookingNoshow, undoMarkBookingNoshow, seatBooking, undoSeatBooking, completeWithoutSeating, undoCompleteWithoutSeating, cancelBooking, undoCancelBooking } = useBooking()
  const { can } = useAuth() || {}
  const toast = useToast()
  const confirm = useConfirm()
  const today = todayStr()
  const [showLater, setShowLater] = useState(false)
  const [showSeated, setShowSeated] = useState(false)
  const [query, setQuery] = useState('')
  // 現場直接改單：以 id 追 live booking（存檔後卡片即時反映；被別台取消／刪除就自動關掉）
  const [editingId, setEditingId] = useState(null)
  const editingBooking = editingId ? (bookings || []).find(x => x.id === editingId) || null : null

  // 卡片上四顆動作鈕的權限底料（誰要哪個組合由 BookingCard 決定）。
  // 後端 functions/lib/staffAccess.js 對 bookings/tables 集合各自把關，前端這道門是為了
  // 不讓唯讀角色（kitchen）按了才發現寫不上雲——那會造成本機／雲端不一致且無錯誤提示。
  const perms = { booking: !!can?.('booking.update'), table: !!can?.('table.update') }

  // 今日團體圈桌（未入座）→ 散客直接入座前用來防呆，避免坐掉團體保留桌
  const groupHoldTables = useMemo(
    () => buildGroupHolds(todayActiveGroups(groupReservations, today), tables),
    [groupReservations, tables, today],
  )

  // 徽章要分辨「桌況已鎖」與「只是預配」，需要對應的桌 → 先建號碼索引（桌數不多但卡片會重繪很多次）
  const tableByNumber = useMemo(() => {
    const m = {}
    ;(tables || []).forEach(t => { if (t?.number != null) m[String(t.number)] = t })
    return m
  }, [tables])
  const kindOf = (b) => assignmentKind(b, tableByNumber[String(b.assignedTableId)])
  // 未配桌卡片的一鍵建議桌（OperationsView.quickAssignFor；沒給或無合適桌 → null，卡片維持「指派桌位」）
  const quickOf = (b) => (!b.assignedTableId && quickAssignFor ? quickAssignFor(b) : null)

  // 30 秒 tick：時間推移會讓卡片從「將到」掉進「過時未到」
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000)
    return () => clearInterval(id)
  }, [])

  const pulse = useMemo(
    () => classifyTodayPulse(bookings, today, now),
    [bookings, today, now],
  )
  const searching = query.trim().length > 0
  const { overdue, soon, later } = useMemo(() => searching
    ? { overdue: pulse.overdue.filter(b => matchesQuery(b, query)), soon: pulse.soon.filter(b => matchesQuery(b, query)), later: pulse.later.filter(b => matchesQuery(b, query)) }
    : pulse, [pulse, query, searching])

  // 剛新增的那筆落在收合的「之後」段 → 自動展開，才看得到它閃
  useEffect(() => {
    if (flashBookingId && later.some(b => b.id === flashBookingId)) setShowLater(true)
  }, [flashBookingId, later])

  // No-show 會計入該電話的爽約次數：先確認已聯絡、說明後果，
  // 改在 toast 裡把後果講清楚：現在是第幾次。復原時要把 recordNoshow 加上去的那一次扣回，
  // 否則店員按錯再復原，客人身上仍會留著一次爽約紀錄（2026-08 抓到的既有 bug）。
  const handleNoshow = async (b) => {
    const ok = await confirm(`已聯絡 ${b.name} 並確認未到？標記 No-show 會計入電話爽約紀錄。`, { title: '標記 No-show', confirmLabel: '確認標記', danger: true })
    if (!ok) return
    // 標記時一併釋出本訂位鎖住的 reserved 桌（seatingService.markNoshow）；復原帶回快照，桌仍空才搶回。
    const r = markBookingNoshow(b.id)
    if (!r?.ok) return toast.error('標記失敗：' + (r?.error || '未知錯誤'))
    const count = getNoshowCount(b.phone)
    const countMsg = count > 0 ? `這支電話累計第 ${count} 次，之後訂位會提醒` : '已記錄這支電話的爽約次數'
    const tableMsg = r.releasedTables?.length ? `，${r.releasedTables.join('、')} 已釋出空桌` : ''
    toast.action(`已標記 ${b.name} No-show — ${countMsg}${tableMsg}`,
      { label: '↩ 復原', onClick: () => {
          const u = undoMarkBookingNoshow(b.id, { tableNumbers: r.releasedTables, status: r.previousStatus })
          if (!u?.ok) return toast.error('復原失敗：' + (u?.error || '未知錯誤'))
          const failMsg = u.failed?.length ? `（${u.failed.join('、')} 已被占用，桌位未搶回，請重新指派）` : ''
          toast.success(`已復原 ${b.name} 為待到，爽約次數已扣回${failMsg}`)
      } },
      { duration: 8000 })
  }

  // 過時未到補登「已完成」：客人其實有來、也吃完了，只是當下沒點系統入座（見
  // seatingService.completeWithoutSeating）。無二次確認，改用 5 秒可復原的 toast——
  // 復原要同時倒回 booking 狀態與桌位（若當時有釋出），不能只倒 booking（既有的
  // BookingCard.jsx 一鍵釋出復原只倒 booking、沒倒桌，是已知的不完整實作，這裡不重蹈）。
  const handleComplete = (b) => {
    const r = completeWithoutSeating(b.id)
    if (!r?.ok) return toast.error('標記完成失敗：' + (r?.error || '未知錯誤'))
    const tableMsg = r.releasedTables?.length ? `，${r.releasedTables.join('、')} 已釋出空桌` : ''
    toast.action(`${b.name}（${b.timeSlot}）已標記完成${tableMsg}`,
      { label: '↩ 復原', onClick: () => {
          const u = undoCompleteWithoutSeating(b.id)
          if (!u?.ok) return toast.error('復原失敗：' + (u?.error || '未知錯誤'))
          const failMsg = u.failed?.length ? `（${u.failed.join('、')} 已被占用，桌位未搶回，請重新指派）` : ''
          toast.success(`已復原 ${b.name} 為待到${failMsg}`)
      } },
      { duration: 5000 })
  }

  // 取消訂位：確認框必須保留——取消會排入 LINE 通知給客人，「復原」倒得回訂位與桌，但收不回已送出的通知。
  // 確認後走與訂位頁／桌抽屜同一套 cancelWithUndo（復原只搶回仍是空桌的桌）。
  const handleCancel = async (b) => {
    const lineMsg = b.lineUserId ? '\n客人會收到 LINE 取消通知（復原收不回通知）。' : ''
    const ok = await confirm(`取消 ${b.name} ${b.timeSlot} 的訂位？${lineMsg}`,
      { title: '取消訂位', confirmLabel: '取消訂位', danger: true })
    if (!ok) return
    cancelWithUndo(b, { cancelBooking, undoCancelBooking, toast })
  }

  // 客人到了（含遲到後才到）：對已指派的訂位直接入座（status→arrived、桌→用餐中）。
  // 防呆與報到列同一個口徑（utils/arriveSeat.seatAfterArriveConfirm → preassignArriveConflictLines）：主桌＋副桌每張都查，
  //   今日團體保留 → 確認；他筆預配「與現在入座的用餐區間重疊」→ 確認；不重疊的預配（晚上那輪）不擋。
  //   （過去用 seatTableWarnings 不看時段，12:00 入座也會為 20:30 的預配跳確認，白多一下。）
  // 成功 toast 帶 5 秒復原（共用 toastSeatedWithUndo：booking 與桌一起倒、被別組佔走不搶）。
  const handleSeat = (b) => seatAfterArriveConfirm(b, { confirm, bookings, groupHoldTables, settings, now: new Date() }, () => {
    const tableNo = bookingTableNumbers(b).join('、')
    const r = seatBooking(b.id)
    if (!r?.ok) {
      const msg = '入座失敗：' + (r?.error || '未知錯誤')
      // 桌被別組佔用／停用 → toast 直接帶「改桌」出口
      if (onMoveTable && ['confirmed', 'pending'].includes(b.status)) {
        return toast.action(msg, { label: '改桌', onClick: () => onMoveTable(b) }, { type: 'error', duration: 8000 })
      }
      return toast.error(msg)
    }
    toastSeatedWithUndo(r, { message: `${b.name} 已入座 ${tableNo}`, name: b.name, undoSeatBooking, toast })
  })

  // 今日已入座（訂位、現場、候位入座都是 status＝arrived 的 booking；結帳後轉 completed 就離開清單）。
  // 最近入座的排最前——剛帶進去的最可能要改桌／改人數。
  const seatedAll = useMemo(() => (bookings || [])
    .filter(b => b.date === today && b.status === 'arrived')
    .sort((a, b) => String(b.actualArrivalTime || '').localeCompare(String(a.actualArrivalTime || ''))),
  [bookings, today])
  const seated = searching ? seatedAll.filter(b => matchesQuery(b, query)) : seatedAll

  if (pulse.overdue.length + pulse.soon.length + pulse.later.length + seatedAll.length === 0) {
    return (
      <div className="text-center py-6 text-xs text-chicken-brown/40">
        今日已無待到訂位
      </div>
    )
  }

  const matchCount = overdue.length + soon.length + later.length + seated.length
  return (
    <div className="space-y-3">
      {editingBooking && <EditBookingModal booking={editingBooking} onClose={() => setEditingId(null)} />}
      <div className="relative">
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="搜尋姓名／電話／桌號"
          aria-label="搜尋今日訂位"
          enterKeyHint="search"
          autoComplete="off"
          className="w-full min-h-[44px] rounded-lg border border-chicken-brown/20 bg-white pl-3 pr-11 text-sm"
        />
        {query && (
          <button type="button" onClick={() => setQuery('')} aria-label="清除搜尋"
            className="absolute right-0 top-0 h-full min-w-[44px] inline-flex items-center justify-center text-chicken-brown/60"><X size={18} strokeWidth={2.4} aria-hidden="true" /></button>
        )}
      </div>
      {seatedAll.length > 0 && (
        <div>
          <button type="button" onClick={() => setShowSeated(v => !v)} aria-expanded={showSeated || (searching && seated.length > 0)}
            className="w-full min-h-[44px] flex items-center justify-between px-3 rounded-lg bg-chicken-brown/5 text-xs font-bold text-chicken-brown/65 hover:bg-chicken-brown/10">
            <span>已入座（{searching ? `${seated.length}／` : ''}{seatedAll.length} 組）· 可改桌／改人數</span>
            <span className="text-[10px]">{showSeated || (searching && seated.length > 0) ? '收合 ▲' : '展開 ▼'}</span>
          </button>
          {(showSeated || (searching && seated.length > 0)) && (
            <div className="mt-2 space-y-2">
              {seated.map(b => (
                <SeatedRow key={b.id} b={b} now={now} perms={perms} onOpenTable={onClickBooking} onMoveTable={onMoveTable}
                  onEdit={b => setEditingId(b.id)} />
              ))}
            </div>
          )}
        </div>
      )}
      {!searching && overdue.length + soon.length + later.length === 0 && (
        <div className="text-center py-6 text-xs text-chicken-brown/40">今日已無待到訂位</div>
      )}
      {searching && matchCount === 0 && (
        <div role="status" className="text-center py-6 text-xs text-chicken-brown/60">找不到符合「{query.trim()}」的今日訂位</div>
      )}
      {overdue.length > 0 && (
        <div className="space-y-2">
          <div className="text-[11px] font-bold text-chicken-red">過時未到（{overdue.length} 組）— 請聯絡或標記</div>
          {overdue.map(b => (
            <BookingCard key={b.id} b={b} now={now} kind={kindOf(b)} quick={quickOf(b)} onQuickAssign={onQuickAssign}
              onClickBooking={onClickBooking} onOpenDetail={onOpenDetail} onEdit={b => setEditingId(b.id)} onCancel={handleCancel} onAssignTable={onAssignTable} onArriveSeat={onArriveSeat} onMoveTable={onMoveTable} onMoveBlocked={() => toast.info(MOVE_COMBO_REASON)} onSeat={handleSeat} onNoshow={handleNoshow}
              onComplete={handleComplete} perms={perms} flash={b.id === flashBookingId} />
          ))}
        </div>
      )}

      {soon.length > 0 && (
        <div className="space-y-2">
          <div className="text-[11px] font-bold text-chicken-brown/65">90 分內將到（{soon.length} 組）</div>
          {soon.map(b => (
            <BookingCard key={b.id} b={b} now={now} kind={kindOf(b)} quick={quickOf(b)} onQuickAssign={onQuickAssign}
              onClickBooking={onClickBooking} onOpenDetail={onOpenDetail} onEdit={b => setEditingId(b.id)} onCancel={handleCancel} onAssignTable={onAssignTable} onArriveSeat={onArriveSeat} onMoveTable={onMoveTable} onMoveBlocked={() => toast.info(MOVE_COMBO_REASON)} onSeat={handleSeat} onNoshow={handleNoshow}
              onComplete={handleComplete} perms={perms} flash={b.id === flashBookingId} />
          ))}
        </div>
      )}

      {later.length > 0 && (
        <div>
          <button
            onClick={() => setShowLater(v => !v)}
            className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-chicken-brown/5 text-xs font-bold text-chicken-brown/65 hover:bg-chicken-brown/10"
          >
            <span>之後（{later.length} 組）</span>
            <span className="text-[10px]">{showLater || searching ? '收合 ▲' : '展開 ▼'}</span>
          </button>
          {(showLater || searching) && (
            <div className="mt-2 space-y-2">
              {later.map(b => (
                <BookingCard key={b.id} b={b} now={now} kind={kindOf(b)} quick={quickOf(b)} onQuickAssign={onQuickAssign}
                  onClickBooking={onClickBooking} onOpenDetail={onOpenDetail} onEdit={b => setEditingId(b.id)} onCancel={handleCancel} onAssignTable={onAssignTable} onArriveSeat={onArriveSeat} onMoveTable={onMoveTable} onMoveBlocked={() => toast.info(MOVE_COMBO_REASON)} onSeat={handleSeat} onNoshow={handleNoshow}
                  onComplete={handleComplete} perms={perms} flash={b.id === flashBookingId} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
