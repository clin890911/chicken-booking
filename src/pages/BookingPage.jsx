import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Header from '../components/layout/Header'
import DatePicker from '../components/booking/DatePicker'
import TimeSlotPicker from '../components/booking/TimeSlotPicker'
import BookingForm from '../components/booking/BookingForm'
import { Card } from '../components/ui'
import { useBooking } from '../contexts/BookingContext'
import { todayStr, dayLabel } from '../utils/timeSlots'

export default function BookingPage() {
  const navigate = useNavigate()
  const { bookings, tables, settings, addBooking } = useBooking()
  const [date, setDate] = useState(todayStr())
  const [timeSlot, setTimeSlot] = useState('')
  const [guests, setGuests] = useState(2)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setTimeSlot('') // 換日重設時段
  }, [date])

  const handleSubmit = async (form) => {
    if (!timeSlot) {
      alert('請先選擇用餐時段')
      return
    }
    setBusy(true)
    try {
      const b = addBooking({
        ...form,
        date,
        timeSlot,
        source: 'online',
        status: 'confirmed',
        createdBy: 'guest'
      })
      navigate(`/confirm/${b.id}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen bg-chicken-cream pb-10">
      <Header title="雞王刷刷鍋" subtitle="線上訂位" />
      <main className="max-w-md mx-auto px-4 py-4 space-y-4">
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
            hideFull
          />
        </Card>

        <Card>
          <h2 className="font-bold text-chicken-brown mb-3">📝 訂位資訊</h2>
          <BookingForm
            onSubmit={(f) => { setGuests(f.guests); handleSubmit(f) }}
            submitLabel={timeSlot ? `確認訂位 ${timeSlot}` : '請先選時段'}
            busy={busy}
          />
        </Card>

        <p className="text-center text-xs text-chicken-brown/50 mt-6">
          訂位後請於時段前 5 分鐘到店，逾時 15 分鐘恕不保留
        </p>
      </main>
    </div>
  )
}
