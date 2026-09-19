import { useMemo, useState, useEffect, useCallback } from 'react'
import { useBooking } from '../../contexts/BookingContext'
import { useToast, useConfirm } from '../ui/Toast'
import { getNoshowCount, revokeNoshow } from '../../services/bookingService'
import { bookingDayKind, todayStr } from '../../utils/timeSlots'
import { diffMin, stageOf } from '../../utils/diningStage'
import { markNoshow, restoreFromNoshow, cancelWithUndo } from '../../utils/bookingActions'

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

// 併桌（主桌＋額外桌）訂位不支援單桌改桌：現場 move 模式只換主桌，會留下孤兒額外桌
// （seatingService.moveTable 也會擋）。按鈕照樣顯示但停用，並寫明原因。
export const MOVE_COMBO_REASON = '併桌訂位不支援單桌改桌，請取消後重新指派，或到現場頁整組處理'

// 訂位卡（BookingCard）與訂位詳情（BookingDetailSheet）共用的「衍生資訊 + 動作」。
// 兩個入口的按鈕顯示條件、確認文案、toast 一律以這裡為準，避免同一筆訂位在兩處行為不一致。
//   onAssign(booking)：沒有桌時「指派桌位」的跨頁導向（今天→現場、未來→規劃排位地圖），由容器決定。
//   onMove(booking)：今日待到、已有桌時「改桌」的跨頁導向（→ 現場頁 move 模式），由容器決定；沒給就不顯示改桌。
export function useBookingActions(booking, { onAssign, onMove } = {}) {
  const {
    tables, bookings, groupReservations, settings, seatBooking, checkoutBooking, finalizeBooking, cancelBooking, undoCancelBooking,
    setStatus, clearTable, suggestTable, clearBookingPreassign,
  } = useBooking()
  const toast = useToast()
  const confirm = useConfirm()

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

  // 建議桌查的是「今日即時空桌」，對未來/過去日無意義且誤導。
  // 按「指派桌位」會在現場頁鎖桌（現在就 reserveTable）→ 佔用區間用 'hold'：[min(現在, 時段), 時段+佔位)，
  // 排除「別筆訂位已預配/持有、用餐區間重疊」的桌與今日團保桌（與新增表單候選同一個 helper）。
  // suggestTable 走 service 讀資料；以 tables/bookings/團體 state 當 key，資料一變才重算。
  const suggestion = useMemo(
    () => (dayKind === 'today' && status === 'confirmed' && !booking.assignedTableId)
      ? suggestTable(booking.guests, { bookingId: booking.id, date: booking.date, timeSlot: booking.timeSlot, mode: 'hold' })
      : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tables, bookings, groupReservations, dayKind, status, booking.id, booking.date, booking.timeSlot, booking.assignedTableId, booking.guests],
  )

  // === 按鈕顯示條件（兩個入口共用）===
  const isOpen = status === 'confirmed' || status === 'pending'
  const isCombo = (booking.extraTableIds || []).length > 0
  const show = {
    assign: status === 'confirmed' && !booking.assignedTableId && dayKind !== 'past',
    seat: status === 'confirmed' && !!booking.assignedTableId && dayKind === 'today',
    // 改桌：今日待到、已有桌（現場鎖桌或預配都算）。過去只有「客人到了」，指派後就再也改不了桌。
    move: !!onMove && status === 'confirmed' && !!booking.assignedTableId && dayKind === 'today',
    futureAssignedNote: status === 'confirmed' && !!booking.assignedTableId && dayKind === 'future',
    checkout: status === 'arrived',
    edit: isOpen,
    noshow: isOpen && dayKind !== 'future',
    cancel: isOpen,
    restore: status === 'noshow',
    // 預配（未來日）解除：預配只記在 booking 上、不動桌況，解除不會留下孤兒桌；
    // 今天的「已指派」可能已鎖桌（reserved），解除要走現場抽屜，這裡不提供。
    unpreassign: isOpen && !!booking.assignedTableId && dayKind === 'future',
    pastNote: dayKind === 'past' && status !== 'completed' && status !== 'cancelled',
  }

  const moveDisabledReason = isCombo ? MOVE_COMBO_REASON : ''

  // === 動作 ===
  const move = useCallback(() => {
    if (isCombo) { toast.info(MOVE_COMBO_REASON); return }
    onMove?.(booking)
  }, [isCombo, onMove, booking, toast])

  const seat = useCallback(() => {
    if (!booking.assignedTableId) {
      onAssign?.(booking)
      toast.info('請先指派桌位再標記入座')
      return
    }
    const r = seatBooking(booking.id)
    if (!r.ok) {
      // 桌被別組佔用／停用維修 → 直接給「改桌」出口（不必再自己找入口）
      if (onMove && !isCombo) {
        return toast.action('入座失敗：' + r.error, { label: '改桌', onClick: () => onMove(booking) }, { type: 'error', duration: 8000 })
      }
      return toast.error('入座失敗：' + r.error)
    }
    toast.success(`${booking.name} 已入座 ${booking.assignedTableId}`)
  }, [booking, onAssign, onMove, isCombo, seatBooking, toast])

  const checkout = useCallback(async () => {
    const ok = await confirm(`${booking.name} 已離席？\n桌位將進入「等待清桌」狀態`,
      { title: '客人已離席', confirmLabel: '已離席' })
    if (!ok) return false
    const r = checkoutBooking(booking.id)
    if (!r.ok) { toast.error(r.error); return false }
    toast.action(`${booking.name} 已離席（用餐 ${minutes} 分）`,
      { label: '一鍵釋出', onClick: () => {
          if (booking.assignedTableId) {
            clearTable(booking.assignedTableId)
            toast.success(`${booking.assignedTableId} 已釋出`)
          }
      }})
    return true
  }, [booking, confirm, checkoutBooking, clearTable, minutes, toast])

  const finalize = useCallback(async () => {
    const ok = await confirm(`${booking.name} 已離席且桌面已清理？\n桌位將立即可給下一組使用`,
      { title: '一鍵釋出桌位', confirmLabel: '已離席+清桌' })
    if (!ok) return false
    const r = finalizeBooking(booking.id)
    if (!r.ok) { toast.error(r.error); return false }
    toast.success(`${booking.name} 已離席 · ${booking.assignedTableId || ''} 已釋出（用餐 ${minutes} 分）`)
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
    markNoshow(booking, { setStatus, getNoshowCount, revokeNoshow, toast })
    return true
  }, [booking, confirm, setStatus, toast])

  const restore = useCallback(() => {
    restoreFromNoshow(booking, { setStatus, revokeNoshow, toast })
  }, [booking, setStatus, toast])

  const unpreassign = useCallback(async () => {
    const ok = await confirm(`解除 ${booking.name} 的預先配桌（${booking.assignedTableId}）？\n之後可再到排位地圖重新配桌。`,
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
