import { useMemo, useState, useEffect, useCallback } from 'react'
import { useBooking } from '../../contexts/BookingContext'
import { useAuth } from '../../contexts/AuthContext'
import { seatingPerms } from '../../utils/seatingPerms'
import { useToast, useConfirm } from '../ui/Toast'
import { getNoshowCount, revokeNoshow } from '../../services/bookingService'
import { bookingDayKind, todayStr } from '../../utils/timeSlots'
import { diffMin, stageOf } from '../../utils/diningStage'
import { formatBookingTables } from '../../utils/bookingTables'
import { markNoshow, restoreFromNoshow, cancelWithUndo, releaseAfterCheckout } from '../../utils/bookingActions'
import { toastSeatedWithUndo, seatAfterArriveConfirm } from '../../utils/arriveSeat'

// 用餐已坐分鐘數。分鐘級顯示只需要 30 秒 tick——原本每張「用餐中」卡片各自每秒 setState
// 一次，十張卡就是每秒十次重繪，手機上捲清單會明顯頓（後台卡頓根因之一）。
export function useDiningMinutes(seatedAt) {
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!seatedAt) return
    const id = setInterval(() => setTick(t => t + 1), 30000)
    return () => clearInterval(id)
  }, [seatedAt])
  if (!seatedAt) return 0
  return Math.max(0, diffMin(seatedAt))
}

// 舊介面的併桌限制提示；訂位卡／詳情已支援整組重選。
export const MOVE_COMBO_REASON = '已入座的併桌客人本輪不支援整組改桌，請保留原訂位與桌位'

// 訂位卡（BookingCard）與訂位詳情（BookingDetailSheet）共用的「衍生資訊 + 動作」。
// 兩個入口的按鈕顯示條件、確認文案、toast 一律以這裡為準，避免同一筆訂位在兩處行為不一致。
//   onAssign(booking)：沒有桌時「指派桌位」的跨頁導向（今天→現場、未來→規劃排位地圖），由容器決定。
//   onMove(booking)：今日待到或已入座、已有桌時「改桌」的跨頁導向（→ 現場頁 move 模式），由容器決定；沒給就不顯示改桌。
export function useBookingActions(booking, { onAssign, onMove } = {}) {
  const {
    tables, bookings, groupReservations, settings, seatBooking, undoSeatBooking, checkoutBooking, finalizeBooking, cancelBooking, undoCancelBooking,
    setStatus, markBookingNoshow, undoMarkBookingNoshow, releaseCheckedOutTables, findReserveCandidates, clearBookingPreassign,
  } = useBooking()
  const toast = useToast()
  const confirm = useConfirm()
  // 前端權限門：每顆鈕依「實際寫入的集合」判定（見 utils/seatingPerms.js），與後端 adminPushData 一致。
  // 沒有權限就不渲染——否則按得下去、寫進本機，推送時被後端剔除，雲端沒有而畫面毫無提示。
  // useAuth() 無 Provider 時是 null → 一律視為無權（fail-closed）。
  const perms = seatingPerms(useAuth()?.can)

  // 日期三態 guard：未來日不可「客人到了/標No-show」、過去日只可補登（離席/No-show/取消）
  const dayKind = bookingDayKind(booking.date, todayStr())
  const status = booking.status

  const table = useMemo(
    () => booking.assignedTableId ? tables.find(t => t.number === booking.assignedTableId) || null : null,
    [tables, booking.assignedTableId],
  )
  const seatedAt = booking.actualArrivalTime || table?.seatedAt
  const minutes = useDiningMinutes(status === 'arrived' ? seatedAt : null)
  const stage = status === 'arrived' ? stageOf(minutes, settings) : 'normal'

  // No-show 次數讀 localStorage（JSON.parse）：改成只在電話／狀態變動時重算，不再每次 render 讀一次。
  const noshowCount = useMemo(() => getNoshowCount(booking.phone), [booking.phone, status])

  // 建議桌查的是「今日即時桌況」，對未來/過去日無意義且誤導。
  // 與按「指派桌位」後現場指派模式的建議桌同一支 helper（findReserveCandidates）：依鎖桌時機
  // （capacity.lockKindFor）分流——離用餐 ≤ 30 分＝鎖桌型（此刻空桌、依鎖桌區間不撞他筆），
  // 更早＝預配型（桌子不必此刻空著）；兩者都排除用餐區間重疊的他筆預配／持有與今日團保桌。
  // 走 service 讀資料；以 tables/bookings/團體 state 當 key，資料一變才重算。
  const suggestion = useMemo(
    () => (dayKind === 'today' && status === 'confirmed' && !booking.assignedTableId)
      ? (findReserveCandidates(booking.guests, { bookingId: booking.id, date: booking.date, timeSlot: booking.timeSlot }).tables[0] || null)
      : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tables, bookings, groupReservations, dayKind, status, booking.id, booking.date, booking.timeSlot, booking.assignedTableId, booking.guests],
  )

  // === 按鈕顯示條件（兩個入口共用）===
  const isOpen = status === 'confirmed' || status === 'pending'
  const isCombo = (booking.extraTableIds || []).length > 0
  // perms.seat＝bookings＋tables（指派／入座／改桌／離席／取消／編輯都會連動桌位）；
  // perms.booking＝只改 booking（標／恢復 No-show、解除未來預配）。
  const show = {
    assign: perms.seat && status === 'confirmed' && !booking.assignedTableId && dayKind !== 'past',
    seat: perms.seat && status === 'confirmed' && !!booking.assignedTableId && dayKind === 'today',
    // 改桌：今日待到或已入座、已有桌；單桌與併桌整組重選。
    move: perms.seat && !!onMove && (isOpen || status === 'arrived') && !!booking.assignedTableId && dayKind === 'today',
    futureAssignedNote: status === 'confirmed' && !!booking.assignedTableId && dayKind === 'future',
    checkout: perms.seat && status === 'arrived',
    // 編輯：待到可改全部欄位；已入座只開放人數＋備註（EditBookingModal 依 status 收起其他欄位）。
    // updateByStaff 改日期／時段才解除桌位；只改人數坐得下保留；已入座一律不動桌。
    edit: perms.seat && (isOpen || status === 'arrived'),
    noshow: perms.seat && isOpen && dayKind !== 'future',   // markNoshow 會釋出本筆鎖住的桌 → bookings＋tables
    cancel: perms.seat && isOpen,
    restore: perms.booking && status === 'noshow',
    // 預配（未來日）解除：預配只記在 booking 上、不動桌況，解除不會留下孤兒桌；
    // 今天的「已指派」可能已鎖桌（reserved），解除要走現場抽屜，這裡不提供。
    unpreassign: perms.booking && isOpen && !!booking.assignedTableId && dayKind === 'future',
    pastNote: dayKind === 'past' && status !== 'completed' && status !== 'cancelled',
  }

  const moveDisabledReason = ''

  // === 動作 ===
  const move = useCallback(() => {
    if (moveDisabledReason) { toast.info(moveDisabledReason); return }
    onMove?.(booking)
  }, [moveDisabledReason, onMove, booking, toast])

  // 入座前的預留確認與今日訂位卡／桌抽屜同一套（seatAfterArriveConfirm：時段重疊的他筆預配、今日團保才確認）。
  // 店員在確認框按取消 → 回 false（詳情頁據此不關閉）。
  const seat = useCallback(() => {
    if (!booking.assignedTableId) {
      onAssign?.(booking)
      toast.info('請先指派桌位再標記入座')
      return
    }
    return seatAfterArriveConfirm(booking, { confirm, bookings, groupReservations, tables, settings, now: new Date() }, () => {
      const r = seatBooking(booking.id)
      if (!r.ok) {
        // 桌被別組佔用／停用維修 → 直接給「改桌」出口（不必再自己找入口）
        if (onMove && !isCombo) {
          return toast.action('入座失敗：' + r.error, { label: '改桌', onClick: () => onMove(booking) }, { type: 'error', duration: 8000 })
        }
        return toast.error('入座失敗：' + r.error)
      }
      // 5 秒復原：與現場四個「客人到了」入口共用（booking 與桌一起倒、被別組佔走不搶）
      toastSeatedWithUndo(r, { message: `${booking.name} 已入座 ${formatBookingTables(booking)}`, name: booking.name, undoSeatBooking, toast })
    })
  }, [booking, onAssign, onMove, isCombo, seatBooking, undoSeatBooking, toast, confirm, bookings, groupReservations, tables, settings])

  const checkout = useCallback(async () => {
    const ok = await confirm(`${booking.name} 已離席？\n桌位將進入「等待清桌」狀態`,
      { title: '客人已離席', confirmLabel: '已離席' })
    if (!ok) return false
    const r = checkoutBooking(booking.id)
    if (!r.ok) { toast.error(r.error); return false }
    toast.action(`${booking.name} 已離席（用餐 ${minutes} 分）`,
      { label: '一鍵釋出', onClick: () => releaseAfterCheckout(booking, { releaseCheckedOutTables, toast }) })
    return true
  }, [booking, confirm, checkoutBooking, releaseCheckedOutTables, minutes, toast])

  const finalize = useCallback(async () => {
    const ok = await confirm(`${booking.name} 已離席且桌面已清理？\n桌位將立即可給下一組使用`,
      { title: '一鍵釋出桌位', confirmLabel: '已離席+清桌' })
    if (!ok) return false
    const r = finalizeBooking(booking.id)
    if (!r.ok) { toast.error(r.error); return false }
    toast.success(`${booking.name} 已離席 · ${formatBookingTables(booking)} 已釋出（用餐 ${minutes} 分）`)
    return true
  }, [booking, confirm, finalizeBooking, minutes, toast])

  const cancel = useCallback(async () => {
    const ok = await confirm(`取消 ${booking.name} ${booking.timeSlot} 的訂位？`,
      { title: '取消訂位', confirmLabel: '取消訂位', danger: true })
    if (!ok) return false
    cancelWithUndo(booking, { cancelBooking, undoCancelBooking, toast })
    return true
  }, [booking, confirm, cancelBooking, undoCancelBooking, toast])

  // 確認對話框留在這裡（非同步、綁 hook）；確認後的邏輯見 utils/bookingActions.markNoshow。
  const noshow = useCallback(async () => {
    const ok = await confirm(`標記 ${booking.name} 為 No-show？`,
      { title: 'No-show', confirmLabel: '標記', danger: true })
    if (!ok) return false
    markNoshow(booking, { markBookingNoshow, undoMarkBookingNoshow, getNoshowCount, toast })
    return true
  }, [booking, confirm, markBookingNoshow, undoMarkBookingNoshow, toast])

  const restore = useCallback(() => {
    restoreFromNoshow(booking, { setStatus, revokeNoshow, toast })
  }, [booking, setStatus, toast])

  const unpreassign = useCallback(async () => {
    const ok = await confirm(`解除 ${booking.name} 的預先配桌（${formatBookingTables(booking)}）？\n之後可再到排位地圖重新配桌。`,
      { title: '解除預先配桌', confirmLabel: '解除' })
    if (!ok) return false
    clearBookingPreassign(booking.id)
    toast.info(`已解除 ${booking.name} 的預先配桌`)
    return true
  }, [booking, confirm, clearBookingPreassign, toast])

  const assign = useCallback(() => { onAssign?.(booking) }, [onAssign, booking])

  return {
    dayKind, table, minutes, stage, noshowCount, suggestion, show, moveDisabledReason,
    seat, checkout, finalize, cancel, noshow, restore, unpreassign, assign, move,
  }
}
