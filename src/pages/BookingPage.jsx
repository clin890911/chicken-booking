import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
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
  const [errorMsg, setErrorMsg] = useState('')
  const timeSectionRef = useRef(null)

  useEffect(() => {
    setTimeSlot('')
  }, [date])

  useEffect(() => {
    if (timeSlot) setErrorMsg('')
  }, [timeSlot])

  const handleSubmit = async (form) => {
    if (!timeSlot) {
      setErrorMsg('請先選擇用餐時段，再送出訂位')
      timeSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
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

      {/* 即時訂位摘要：給客人持續的「確認感」 */}
      <div className="sticky top-[60px] z-20 bg-chicken-cream/95 backdrop-blur border-b border-chicken-brown/5">
        <div className="max-w-md mx-auto px-4 py-2.5">
          <div className="flex items-center gap-3 text-sm">
            <span className="text-chicken-brown/60 text-xs shrink-0">您的選擇</span>
            <div className="flex-1 flex items-center gap-2 flex-wrap">
              <SummaryChip active>{dayLabel(date)}</SummaryChip>
              <SummaryChip active={!!timeSlot} accent={!!timeSlot}>
                {timeSlot || '尚未選時段'}
              </SummaryChip>
              <SummaryChip active>{guests} 位</SummaryChip>
            </div>
          </div>
        </div>
      </div>

      <main className="max-w-md mx-auto px-4 py-4 space-y-4">
        <Card>
          <h2 className="font-bold text-chicken-brown mb-3">📅 選擇日期</h2>
          <DatePicker value={date} onChange={setDate} maxDaysAhead={settings.maxDaysAhead} />
          <p className="text-xs text-chicken-brown/60 mt-2">已選：{dayLabel(date)}</p>
        </Card>

        <div ref={timeSectionRef}>
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
            <AnimatePresence>
              {errorMsg && (
                <motion.div
                  initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
                  className="mt-3 px-3 py-2 rounded-xl bg-chicken-red/10 border border-chicken-red/30 text-chicken-red text-sm font-bold flex items-center gap-2"
                >
                  <span>⚠️</span> {errorMsg}
                </motion.div>
              )}
            </AnimatePresence>
          </Card>
        </div>

        <Card>
          <h2 className="font-bold text-chicken-brown mb-3">📝 訂位資訊</h2>
          <BookingForm
            onSubmit={(f) => { setGuests(f.guests); handleSubmit(f) }}
            submitLabel={timeSlot ? `確認訂位 · ${timeSlot}` : '請先選時段'}
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

function SummaryChip({ children, active = false, accent = false }) {
  const cls = accent
    ? 'bg-chicken-red text-white border-chicken-red'
    : active
      ? 'bg-white text-chicken-brown border-chicken-brown/15'
      : 'bg-chicken-brown/5 text-chicken-brown/40 border-dashed border-chicken-brown/20'
  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-full border text-xs font-bold ${cls}`}>
      {children}
    </span>
  )
}
