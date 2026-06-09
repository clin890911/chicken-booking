import { useMemo } from 'react'
import { useBooking } from '../../../contexts/BookingContext'
import { useToast } from '../../ui/Toast'
import { todayStr } from '../../../utils/timeSlots'

// 點空桌時顯示「可入座」候選名單
// - 待指派訂位（今日 confirmed + assignedTableId=null + 人數 ≤ 桌容量）
// - 候位中（waiting/called + 人數 ≤ 桌容量）
// 排序：訂位按時段、候位按取號順序
// 主要動作：
//   - 訂位列：[入座]（指派+客人到了）/ [預訂]（只指派、status reserved）
//   - 候位列：[入座]
export default function TableCandidatePanel({ table, onPicked }) {
  const { bookings, waitlist, assignBookingToTable, seatBooking, seatWaitlist } = useBooking()
  const toast = useToast()

  const today = todayStr()

  // 時段已過幾分鐘（正值＝已過、客人應已到場但尚未入座）
  const slotOverdueMin = (timeSlot) => {
    if (!timeSlot) return -Infinity
    const [hh, mm] = timeSlot.split(':').map(Number)
    const slot = new Date()
    slot.setHours(hh, mm, 0, 0)
    return Math.round((Date.now() - slot.getTime()) / 60000)
  }

  // === 候選訂位 ===
  const pendingBookings = useMemo(() => {
    return bookings
      .filter(b =>
        b.date === today &&
        b.status === 'confirmed' &&
        !b.assignedTableId &&
        b.guests <= table.capacity
      )
      .sort((a, b) => (a.timeSlot || '').localeCompare(b.timeSlot || ''))
  }, [bookings, today, table.capacity])

  // B3：訂位再依「是否已到場（時段已過）未入座」拆兩組
  //  - arrivedBookings：時段已過、應已到場、仍未入座 → 最高優先（過越久越前）
  //  - upcomingBookings：時段未到（即將到）→ 最低優先（依時段先後）
  const arrivedBookings = useMemo(
    () => pendingBookings
      .filter(b => slotOverdueMin(b.timeSlot) > 0)
      .sort((a, b) => slotOverdueMin(b.timeSlot) - slotOverdueMin(a.timeSlot)),
    [pendingBookings],
  )
  const upcomingBookings = useMemo(
    () => pendingBookings.filter(b => slotOverdueMin(b.timeSlot) <= 0),
    [pendingBookings],
  )

  // === 候選候位 ===
  // B3：候位中（waiting）排在已叫號（called）之前；同組內依取號先後
  const pendingWaitlist = useMemo(() => {
    const rank = (w) => (w.status === 'waiting' ? 0 : 1)
    return waitlist
      .filter(w =>
        (w.status === 'waiting' || w.status === 'called') &&
        w.partySize <= table.capacity
      )
      .sort((a, b) =>
        rank(a) - rank(b) ||
        (a.takenAt || '').localeCompare(b.takenAt || ''))
  }, [waitlist, table.capacity])

  // === 動作 ===
  const assignAndSeat = (booking) => {
    const r1 = assignBookingToTable(booking.id, table.number)
    if (!r1.ok) return toast.error('指派失敗：' + r1.error)
    const r2 = seatBooking(booking.id)
    if (!r2.ok) {
      toast.warning(`已指派但入座失敗：${r2.error}`)
      onPicked?.()
      return
    }
    toast.success(`✅ ${booking.name}（${booking.guests} 位）入座 ${table.number}`)
    onPicked?.()
  }

  const assignOnly = (booking) => {
    const r = assignBookingToTable(booking.id, table.number)
    if (!r.ok) return toast.error('指派失敗：' + r.error)
    toast.success(`📋 ${booking.name} 已預訂 ${table.number}（${booking.timeSlot}）`)
    onPicked?.()
  }

  const seatWait = (wait) => {
    const r = seatWaitlist(wait.id, table.number)
    if (!r.ok) return toast.error('入座失敗：' + r.error)
    toast.success(`✅ ${wait.name}（候位 #${wait.queueNumber}）入座 ${table.number}`)
    onPicked?.()
  }

  const totalCount = pendingBookings.length + pendingWaitlist.length
  if (totalCount === 0) return null

  // 計算「即將到達」（30 分內）標記
  const isImminent = (timeSlot) => {
    if (!timeSlot) return false
    const [hh, mm] = timeSlot.split(':').map(Number)
    const slot = new Date()
    slot.setHours(hh, mm, 0, 0)
    const diff = (slot - Date.now()) / 60000
    return diff >= -10 && diff <= 30
  }

  const waitMinutes = (takenAt) => {
    if (!takenAt) return 0
    const created = new Date(takenAt).getTime()
    if (!Number.isFinite(created)) return 0
    return Math.max(0, Math.floor((Date.now() - created) / 60000))
  }

  // 共用：座位適配 badge（剛好／空 N 位）
  const fitBadge = (count) => {
    const waste = table.capacity - count
    return (
      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded
        ${waste === 0 ? 'bg-chicken-green text-white'
          : waste <= 1 ? 'bg-chicken-green/20 text-chicken-green'
          : 'bg-chicken-brown/10 text-chicken-brown/60'}`}>
        {waste === 0 ? '剛好' : `空 ${waste} 位`} · {count}/{table.capacity}
      </span>
    )
  }

  // 訂位列：arrived=true 時加紅 badge「已到場 X 分」
  const renderBookingRow = (b, { arrived } = {}) => {
    const imminent = !arrived && isImminent(b.timeSlot)
    const over = slotOverdueMin(b.timeSlot)
    return (
      <div key={b.id} className={`bg-white rounded-lg p-2 border-2 ${arrived ? 'border-chicken-red' : imminent ? 'border-chicken-yellow' : 'border-chicken-brown/10'}`}>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-black text-chicken-brown tabular-nums">{b.timeSlot}</span>
          <span className="text-sm font-bold text-chicken-brown truncate flex-1 min-w-0">{b.name}</span>
          {fitBadge(b.guests)}
          {arrived ? (
            <span className="text-[10px] font-bold text-white bg-chicken-red px-1.5 py-0.5 rounded-full">已到場 {over} 分</span>
          ) : imminent ? (
            <span className="text-[10px] font-bold text-amber-700">🔔 即將到</span>
          ) : null}
        </div>
        <div className="flex gap-1 mt-1.5">
          <button
            onClick={() => assignAndSeat(b)}
            className="flex-1 min-h-[44px] text-[11px] py-1.5 bg-chicken-green text-white rounded font-bold hover:opacity-90"
          >
            ✅ 入座
          </button>
          <button
            onClick={() => assignOnly(b)}
            className="flex-1 min-h-[44px] text-[11px] py-1.5 bg-white border border-chicken-brown/15 text-chicken-brown rounded font-bold hover:border-chicken-yellow"
          >
            📋 預訂
          </button>
        </div>
      </div>
    )
  }

  // 候位列
  const renderWaitRow = (w) => (
    <div key={w.id} className="bg-white rounded-lg p-2 border-2 border-chicken-brown/10">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm font-black text-chicken-red">#{w.queueNumber}</span>
        <span className="text-sm font-bold text-chicken-brown truncate flex-1 min-w-0">{w.name}</span>
        <span className="text-[10px] font-bold text-chicken-brown/50">已等 {waitMinutes(w.takenAt)} 分</span>
        {fitBadge(w.partySize)}
        {w.status === 'called' && (
          <span className="text-[10px] font-bold text-amber-800 bg-amber-100 px-1.5 py-0.5 rounded-full">已叫號</span>
        )}
      </div>
      <button
        onClick={() => seatWait(w)}
        className="w-full min-h-[44px] mt-1.5 text-[11px] py-1.5 bg-chicken-green text-white rounded font-bold hover:opacity-90"
      >
        ✅ 入座
      </button>
    </div>
  )

  return (
    <div className="mt-3 -mx-5 px-5 py-3 bg-chicken-cream/50 border-y border-chicken-brown/10">
      <div className="text-[11px] font-bold text-chicken-brown/60 mb-2">
        💡 可入座 {table.number}（{totalCount} 組候選 · 容量 {table.capacity} 人）
      </div>

      {/* B3 優先級：已到未入座 > 候位中 > 已叫號 > 即將到 */}

      {/* 1) 已到場、未入座的訂位（最高優先） */}
      {arrivedBookings.length > 0 && (
        <>
          <div className="text-[10px] text-chicken-red font-bold mt-1 mb-1.5">⏰ 已到場未入座</div>
          <div className="space-y-1.5">
            {arrivedBookings.map(b => renderBookingRow(b, { arrived: true }))}
          </div>
        </>
      )}

      {/* 2) 候位中＋已叫號（waiting 已排在 called 之前） */}
      {pendingWaitlist.length > 0 && (
        <>
          <div className="text-[10px] text-chicken-brown/50 font-bold mt-3 mb-1.5">🚦 候位中</div>
          <div className="space-y-1.5">
            {pendingWaitlist.map(renderWaitRow)}
          </div>
        </>
      )}

      {/* 3) 即將到的訂位（最低優先） */}
      {upcomingBookings.length > 0 && (
        <>
          <div className="text-[10px] text-chicken-brown/50 font-bold mt-3 mb-1.5">📋 即將到（待指派訂位）</div>
          <div className="space-y-1.5">
            {upcomingBookings.map(b => renderBookingRow(b))}
          </div>
        </>
      )}

      <div className="text-[10px] text-chicken-brown/40 text-center mt-2.5">
        剛好表示桌型最貼近 · ⏰ 已過時段未入座優先 · 🔔 30 分內到達
      </div>
    </div>
  )
}
