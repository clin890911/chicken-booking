import { useMemo, useState } from 'react'
import BookingCard from '../booking/BookingCard'
import { Card, EmptyState } from '../ui'
import { useBooking } from '../../contexts/BookingContext'
import { todayStr, formatDate } from '../../utils/timeSlots'

export default function CalendarView({ onAssignTable }) {
  const { bookings } = useBooking()
  const [cursor, setCursor] = useState(() => {
    const d = new Date()
    return { year: d.getFullYear(), month: d.getMonth() }
  })
  const [selected, setSelected] = useState(todayStr())

  const days = useMemo(() => {
    const first = new Date(cursor.year, cursor.month, 1)
    const last = new Date(cursor.year, cursor.month + 1, 0)
    const startWeekday = first.getDay()
    const daysInMonth = last.getDate()
    const cells = []
    for (let i = 0; i < startWeekday; i++) cells.push(null)
    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(cursor.year, cursor.month, d)
      cells.push(formatDate(date))
    }
    return cells
  }, [cursor])

  const counts = useMemo(() => {
    const map = {}
    bookings.forEach(b => {
      if (b.status === 'cancelled') return
      map[b.date] = (map[b.date] || 0) + 1
    })
    return map
  }, [bookings])

  const dayBookings = useMemo(() => {
    return bookings
      .filter(b => b.date === selected && b.status !== 'cancelled')
      .sort((a, b) => (a.timeSlot || '').localeCompare(b.timeSlot || ''))
  }, [bookings, selected])

  const goPrev = () => setCursor(c => c.month === 0 ? { year: c.year - 1, month: 11 } : { year: c.year, month: c.month - 1 })
  const goNext = () => setCursor(c => c.month === 11 ? { year: c.year + 1, month: 0 } : { year: c.year, month: c.month + 1 })

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-center justify-between mb-3">
          <button onClick={goPrev} className="px-3 py-1 rounded-lg hover:bg-chicken-brown/5 text-chicken-brown">‹</button>
          <h3 className="font-black text-lg text-chicken-brown">{cursor.year}年 {cursor.month + 1}月</h3>
          <button onClick={goNext} className="px-3 py-1 rounded-lg hover:bg-chicken-brown/5 text-chicken-brown">›</button>
        </div>

        <div className="grid grid-cols-7 gap-1 text-center text-xs font-bold text-chicken-brown/50 mb-1">
          {['日', '一', '二', '三', '四', '五', '六'].map(w => <div key={w} className="py-1">{w}</div>)}
        </div>

        <div className="grid grid-cols-7 gap-1">
          {days.map((dateStr, i) => {
            if (!dateStr) return <div key={i} />
            const cnt = counts[dateStr] || 0
            const isSelected = dateStr === selected
            const isToday = dateStr === todayStr()
            const dayNum = Number(dateStr.split('-')[2])
            return (
              <button
                key={dateStr}
                onClick={() => setSelected(dateStr)}
                className={`aspect-square rounded-xl flex flex-col items-center justify-center transition-all border-2 ${
                  isSelected
                    ? 'border-chicken-red bg-chicken-red text-white'
                    : isToday
                      ? 'border-chicken-yellow bg-chicken-yellow/10 text-chicken-brown'
                      : 'border-transparent hover:bg-chicken-brown/5 text-chicken-brown'
                }`}
              >
                <span className="text-sm font-bold">{dayNum}</span>
                {cnt > 0 && (
                  <span className={`text-[9px] mt-0.5 font-bold ${isSelected ? 'text-white' : 'text-chicken-red'}`}>
                    {cnt} 組
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </Card>

      <div>
        <h3 className="font-bold text-chicken-brown mb-2 px-1">📋 {selected} 訂位</h3>
        {dayBookings.length === 0 ? (
          <EmptyState icon="📭" title="這天沒有訂位" />
        ) : (
          <div className="space-y-2">
            {dayBookings.map(b => (
              <BookingCard
                key={b.id}
                booking={b}
                onAssign={onAssignTable}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
