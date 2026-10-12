// Use the existing single-action toast API: viewing lasts independently of the server undo window.
// Undo is another cloud command; no local snapshot can free a table after another iPad used it.
export function toastWaitlistSeat(result, { message, toast, undoWaitlistSeat, onView }) {
  const tableNumber = result.item?.assignedTableNumber || result.item?.tableNumbers?.[0]
    || result.tables?.find(t => t.currentBookingId && t.currentBookingId === result.item?.bookingId)?.number
  const viewToastId = onView && tableNumber
    ? toast.action(message, { label: '查看', onClick: () => onView(String(tableNumber)) }) : undefined
  const duration = Math.min(5000, Math.max(0, new Date(result.undoUntil).getTime() - Date.now()))
  if (!duration || !undoWaitlistSeat) return onView && tableNumber ? viewToastId : toast.success(message)
  return toast.action(onView && tableNumber ? '候位入座已確認，可復原' : message, { label: '復原', onClick: async () => {
    const undo = await undoWaitlistSeat(result.item.id, result.commandId)
    if (!undo?.ok) return toast.error('復原未確認：' + (undo?.error || '請確認最新候位與桌況'))
    if (viewToastId !== undefined) toast.dismiss?.(viewToastId)
    toast.info('已復原入座，回到原候位；桌位與預配已由雲端確認')
  } }, { duration })
}
