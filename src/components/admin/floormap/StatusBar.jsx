// 頂部統計列：6 個關鍵數字一眼看到（外場 iPad 不用換頁）
// 「90分內將到」看訂位組數（之前看桌況 reserved 數：開店有訂位卻顯示 0，誤導）；
// 過時未到另計紅字。「在席人數」優先用 booking 實際人數，團體桌以桌容量估。
import { useMemo } from 'react'
import { todayStr } from '../../../utils/timeSlots'
import { classifyTodayPulse } from '../../../utils/bookingPulse'
import { isTableUsableOnDate } from '../../../utils/tableAvailability'

export default function StatusBar({ tables, waitlist, bookings = [] }) {
  const counts = { vacant: 0, reserved: 0, dining: 0, cleaning: 0, blocked: 0 }
  const bookingById = {}
  bookings.forEach(b => { if (b.id) bookingById[b.id] = b })
  let occSeats = 0
  const today = todayStr()
  tables.forEach(t => {
    if (!isTableUsableOnDate(t, today)) return
    counts[t.status] = (counts[t.status] || 0) + 1
    if (t.status === 'dining') {
      const b = t.currentBookingId ? bookingById[t.currentBookingId] : null
      occSeats += Number(b?.guests) || t.capacity
    }
  })
  const waiting = waitlist.filter(w => w.status === 'waiting').length
  const called = waitlist.filter(w => w.status === 'called').length

  const pulse = useMemo(
    () => classifyTodayPulse(bookings, todayStr()),
    [bookings],
  )

  const items = [
    { label: '可入座',   value: counts.vacant,   color: 'text-emerald-700', className: 'status-vacant' },
    { label: '90分內將到', value: pulse.soon.length, color: 'text-sky-700', className: 'status-reserved',
      sub: pulse.overdue.length > 0 ? `+${pulse.overdue.length} 過時未到` : null },
    { label: '用餐中',   value: counts.dining,   color: 'text-orange-700', className: 'status-dining' },
    { label: '待清桌',   value: counts.cleaning, color: 'text-amber-700', className: 'status-cleaning' },
    { label: '候位需處理', value: waiting + called,color: 'text-red-700', className: 'status-danger', accent: true },
    { label: '在席人數', value: occSeats,        color: 'text-chicken-brown', className: 'bg-white text-chicken-brown border-chicken-brown/10' },
  ]
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2">
      {items.map(it => (
        <div key={it.label}
             className={`border rounded-xl px-3 py-2 flex flex-col items-center ${it.className}
                         ${it.accent && it.value > 0 ? 'ring-2 ring-red-100' : ''}`}>
          <div className={`text-2xl font-black tabular-nums leading-none ${it.color}`}>{it.value}</div>
          <div className="text-[11px] font-bold opacity-70 mt-1">{it.label}</div>
          {it.sub && <div className="text-[10px] font-black text-chicken-red mt-0.5">{it.sub}</div>}
        </div>
      ))}
    </div>
  )
}
