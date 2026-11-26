import { SEAT_UNDO_MS, SEAT_TOAST_PLACEMENT, toastSeatDone, seatUndoTextOf } from './seatFeedback'

// Use the existing single-action toast API: viewing lasts independently of the server undo window.
// Undo is another cloud command; no local snapshot can free a table after another iPad used it.
// B1：文字／位置與其他入座入口同一套（seatFeedback）；「查看」停 8 秒。
// 復原是唯一的例外：雲端指令只在後端 undoUntil（入座後 5 秒，functions/lib/waitlistCommands.js）內有效，
// 前端不能給比後端更長的復原鈕（按了必失敗），所以是 min(8 秒, 後端剩餘時間)。
export function toastWaitlistSeat(result, { message, toast, undoWaitlistSeat, onView }) {
  const tableNumber = result.item?.assignedTableNumber || result.item?.tableNumbers?.[0]
    || result.tables?.find(t => t.currentBookingId && t.currentBookingId === result.item?.bookingId)?.number
  const seatOpts = { duration: SEAT_UNDO_MS, placement: SEAT_TOAST_PLACEMENT }
  const viewToastId = onView && tableNumber
    ? toast.action(message, { label: '查看', onClick: () => onView(String(tableNumber)) }, seatOpts) : undefined
  const duration = Math.min(SEAT_UNDO_MS, Math.max(0, new Date(result.undoUntil).getTime() - Date.now()))
  if (!duration || !undoWaitlistSeat) return onView && tableNumber ? viewToastId : toastSeatDone(toast, message)
  // 現場頁（有復原欄）：「復原」進復原欄（對象文字＝入座句），不再另疊一則「可復原」提示（toast:false）；
  // 時效照後端 undoUntil（通常 5 秒），復原欄也照實只給這麼久。沒有復原欄的畫面行為不變。
  return toast.action(onView && tableNumber ? '候位入座已確認，可復原' : message, { label: '復原', slotText: seatUndoTextOf(message), toast: !(onView && tableNumber), onClick: async () => {
    const undo = await undoWaitlistSeat(result.item.id, result.commandId)
    if (!undo?.ok) return toast.error('復原未確認：' + (undo?.error || '請確認最新候位與桌況'))
    if (viewToastId !== undefined) toast.dismiss?.(viewToastId)
    toast.info('已復原入座，回到原候位；桌位與預配已由雲端確認')
  } }, { duration, placement: SEAT_TOAST_PLACEMENT })
}
