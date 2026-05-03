import { useMemo } from 'react'
import BookingCard from '../booking/BookingCard'
import StatsCard from './StatsCard'
import { EmptyState } from '../ui'
import { useBooking } from '../../contexts/BookingContext'
import { todayStr, generateTimeSlots } from '../../utils/timeSlots'

export default function TodayView() {
  const { bookings, settings, cycleStatus, setStatus } = useBooking()
  const today = todayStr()

  const stats = useMemo(() => {
    const todayBookings = bookings.filter(b => b.date === today && b.status !== 'cancelled')
    const totalGroups = todayBookings.length
    const totalGuests = todayBookings.reduce((s, b) => s + Number(b.guests || 0), 0)
    const arrivedGroups = todayBookings.filter(b => b.status === 'arrived' || b.status === 'completed').length
    return { totalGroups, totalGuests, arrivedGroups, todayBookings }
  }, [bookings, today])

  const grouped = useMemo(() => {
    const slots = generateTimeSlots(settings.openTime, settings.closeTime, settings.slotInterval)
    const map = {}
    slots.forEach(s => { map[s] = [] })
    stats.todayBookings.forEach(b => {
      if (!map[b.timeSlot]) map[b.timeSlot] = []
      map[b.timeSlot].push(b)
    })
    return Object.entries(map).filter(([, list]) => list.length > 0)
  }, [stats.todayBookings, settings])

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2">
        <StatsCard icon="📋" label="今日訂位" value={`${stats.totalGroups} 組`} color="red" />
        <StatsCard icon="👥" label="總人數" value={`${stats.totalGuests} 位`} color="yellow" />
        <StatsCard icon="✅" label="已到" value={`${stats.arrivedGroups} 組`} color="green" />
      </div>

      {grouped.length === 0 ? (
        <EmptyState icon="🍽️" title="今日尚無訂位" hint="客人線上訂位後會出現在這裡" />
      ) : (
        grouped.map(([slot, list]) => (
          <div key={slot}>
            <div className="flex items-center gap-2 mb-2 px-1">
              <span className="text-base font-black text-chicken-red">{slot}</span>
              <div className="flex-1 h-px bg-chicken-brown/10" />
              <span className="text-xs text-chicken-brown/60">{list.length} 組 / {list.reduce((s, b) => s + Number(b.guests || 0), 0)} 位</span>
            </div>
            <div className="space-y-2">
              {list.map(b => (
                <BookingCard
                  key={b.id}
                  booking={b}
                  onCycleStatus={() => cycleStatus(b.id)}
                  onNoshow={() => { if (confirm(`標記 ${b.name} 為 no-show?`)) setStatus(b.id, 'noshow') }}
                />
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  )
}
