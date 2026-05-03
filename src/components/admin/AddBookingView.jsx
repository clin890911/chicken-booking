import { useState, useEffect } from 'react'
import DatePicker from '../booking/DatePicker'
import TimeSlotPicker from '../booking/TimeSlotPicker'
import BookingForm from '../booking/BookingForm'
import { Card } from '../ui'
import { useBooking } from '../../contexts/BookingContext'
import { useAuth } from '../../contexts/AuthContext'
import { todayStr, dayLabel } from '../../utils/timeSlots'

export default function AddBookingView({ onCreated }) {
  const { bookings, tables, settings, addBooking } = useBooking()
  const { user } = useAuth()
  const [date, setDate] = useState(todayStr())
  const [timeSlot, setTimeSlot] = useState('')
  const [guests, setGuests] = useState(2)
  const [isGroup, setIsGroup] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => { setTimeSlot('') }, [date])

  const handleSubmit = async (form) => {
    if (!timeSlot) {
      alert('請先選擇時段')
      return
    }
    setBusy(true)
    try {
      const b = addBooking({
        ...form,
        date,
        timeSlot,
        status: 'confirmed',
        createdBy: user?.email || 'staff'
      })
      alert(`✅ 已新增訂位：${b.id}\n${form.name} / ${form.guests} 位 / ${date} ${timeSlot}`)
      onCreated?.(b)
      setTimeSlot('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <h2 className="font-bold text-chicken-brown mb-3">📅 選擇日期</h2>
        <DatePicker value={date} onChange={setDate} maxDaysAhead={settings.maxDaysAhead} />
        <p className="text-xs text-chicken-brown/60 mt-2">已選：{dayLabel(date)}</p>
      </Card>

      <Card>
        <h2 className="font-bold text-chicken-brown mb-3">⏰ 選擇時段</h2>
        <TimeSlotPicker
          date={date}
          value={timeSlot}
          onChange={setTimeSlot}
          settings={settings}
          tables={tables}
          bookings={bookings}
          guests={guests}
          hideFull={false}
        />
      </Card>

      <Card>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-bold text-chicken-brown">📝 訂位資訊</h2>
          <label className="flex items-center gap-1.5 text-xs text-chicken-brown/70">
            <input type="checkbox" checked={isGroup} onChange={e => setIsGroup(e.target.checked)} />
            <span>團體（&gt; 20 人）</span>
          </label>
        </div>
        <BookingForm
          maxGuests={isGroup ? 100 : 20}
          showSource
          onSubmit={(f) => { setGuests(f.guests); handleSubmit(f) }}
          submitLabel={timeSlot ? `新增訂位 ${timeSlot}` : '請先選時段'}
          busy={busy}
        />
      </Card>
    </div>
  )
}
