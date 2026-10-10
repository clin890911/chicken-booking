// 「客人到了」四個入口（報到列、今日訂位卡、桌抽屜、訂位卡）＋「到了 · 選桌入座」共用的純函式。
// 不碰 React：確認框（useConfirm）留在元件內；這裡注入 context 動作與 toast，方便單測。
import { assignmentWindow, preassignConflicts } from './capacity'
import { restoreReleasedPreassigns, restoreNote } from './preassignOverride'

// 入座前的預留警示（報到列與今日訂位卡同一個口徑）：
// 桌（大組含副桌）被今日團體圈桌未入座、或他筆訂位預配且用餐區間與「現在入座」重疊
// （capacity.preassignConflicts＋assignmentWindow 'now'）→ 逐條列出，要店員確認。
// 不重疊的他筆預配（例：12:00 入座、20:30 的預配）不擋——那筆會保留，跳確認只是多按一下。
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

// 入座成功後的 toast＋5 秒復原（四個入口與選桌入座共用，不各寫一套）。
// r＝入座結果（seatBooking／seatBookingAllTables／assignAndSeatBooking），r.undo 是 service 入座前拍的快照。
// 復原走 undoSeatBooking：booking 與 table 兩邊一起倒；只倒仍由本筆用餐中、或已空的桌——
// 被別組佔走就整組不動並明講（不搶桌）。帶位時解除掉的他筆預配（releasedPreassigns）一併還回去。
export function toastSeatedWithUndo(r, { message, name, undoSeatBooking, toast, releasedPreassigns = [], restoreOverriddenAssignment, onUndone }) {
  toast.action(
    message,
    {
      label: '復原',
      onClick: () => {
        const u = undoSeatBooking?.(r?.undo)
        if (!u?.ok) return toast.error('復原失敗：' + (u?.error || '未知錯誤'))
        const note = releasedPreassigns.length && restoreOverriddenAssignment
          ? restoreNote(restoreReleasedPreassigns(releasedPreassigns, { restoreOverriddenAssignment }))
          : ''
        toast.info(`已復原：${name || '這組'} 回到待到${note}`)
        onUndone?.(u)
      },
    },
    { duration: 5000 },
  )
}
