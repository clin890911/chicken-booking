// 「客人到了」四個入口（報到列、今日訂位卡、桌抽屜、訂位卡）＋「到了 · 選桌入座」共用的純函式。
// 不碰 React：確認框（useConfirm）留在元件內；這裡注入 context 動作與 toast，方便單測。
import { assignmentWindow, preassignConflicts } from './capacity'
import { restoreReleasedPreassigns, restoreNote } from './preassignOverride'
import { buildGroupHolds, todayActiveGroups } from './groupLive'
import { todayStr } from './timeSlots'
import { bookingTableNumbers } from './bookingTables'

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

// 「客人到了」入座前的預留確認（今日訂位卡、訂位詳情／訂位卡、桌抽屜共用，不各寫一套）：
// 只有「時段重疊的他筆預配」或「今日團保桌」才跳確認（preassignArriveConflictLines），不重疊的不擋。
// groupHoldTables 沒給時由 groupReservations＋tables 依今日團體算（與現場頁同一支 buildGroupHolds）。
// proceed＝真正入座的動作：無衝突時同步執行並回傳其結果；有衝突時先 confirm，
// 店員按「仍要入座」才執行（回傳 Promise），按取消回 false（不入座）。
export function seatAfterArriveConfirm(booking, { confirm, bookings = [], groupHoldTables, groupReservations = [], tables = [], settings = {}, now = new Date() } = {}, proceed) {
  if (!booking) return false
  const holds = groupHoldTables || buildGroupHolds(todayActiveGroups(groupReservations || [], todayStr()), tables || [])
  const lines = preassignArriveConflictLines(booking, { bookings, groupHoldTables: holds, settings, now })
  if (!lines.length) return proceed()
  const tableNo = bookingTableNumbers(booking).join('、')
  return Promise.resolve(confirm?.(`${lines.join('；')}。\n仍要讓 ${booking.name} 入座 ${tableNo}？`,
    { title: '桌位有預留', confirmLabel: '仍要入座', danger: true }))
    .then(ok => (ok ? proceed() : false))
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
