import { useState } from 'react'
import { Modal, Input, Button, Textarea } from '../ui'
import GuestCountField from '../admin/GuestCountField'
import { useToast } from '../ui/Toast'
import { useBooking } from '../../contexts/BookingContext'
import TimeSlotPicker from './TimeSlotPicker'
import MonthCalendar from './MonthCalendar'
import { dayLabel, todayStr, formatDate, addDays } from '../../utils/timeSlots'

const SOURCE_OPTIONS = [
  { value: 'phone',  label: '📞 電話' },
  { value: 'line',   label: '💚 LINE' },
  { value: 'walkin', label: '🚶 現場' },
  { value: 'online', label: '🌐 線上' },
]
const NOTE_OPTIONS = [
  { key: 'pet',      label: '🐾 寵物' },
  { key: 'child',    label: '👶 兒童' },
  { key: 'mobility', label: '♿ 行動不便' },
]
// 員工後台編輯既有訂位：姓名／電話／人數／日期／時段／來源／備註。
// 採「按需掛載」（父層 {editing && <EditBookingModal/>}）→ 每次開啟都以當前 booking 初始化。
// 結構性變更（日期/時段/人數）由 context.updateBooking → bookingService.updateByStaff
// 自動解除並釋放原桌，這裡僅在送出後提示店員「需重新指派」。
export default function EditBookingModal({ booking, onClose }) {
  const { settings, tables, bookings, groupReservations, updateBooking } = useBooking()
  const toast = useToast()

  const [name, setName] = useState(booking.name || '')
  const [phone, setPhone] = useState(booking.phone || '')
  const [guests, setGuests] = useState(Number(booking.guests) || 1)
  const [date, setDate] = useState(booking.date || todayStr())
  const [showCalendar, setShowCalendar] = useState(false)
  const [timeSlot, setTimeSlot] = useState(booking.timeSlot || '')
  const [source, setSource] = useState(booking.source || 'phone')
  const [notes, setNotes] = useState({
    pet: !!booking.notes?.pet,
    child: !!booking.notes?.child,
    mobility: !!booking.notes?.mobility,
    text: booking.notes?.text || '',
  })
  const [busy, setBusy] = useState(false)

  // 改日期就清空時段，逼使重選（舊時段對新日期可能已滿/關閉）；初始載入不清。
  const pickDate = (d) => {
    if (d !== date) setTimeSlot('')
    setDate(d)
    setShowCalendar(false)
  }

  const quickDates = [0, 1, 2].map(i => {
    const d = formatDate(addDays(new Date(), i))
    return { date: d, label: i === 0 ? '今天' : i === 1 ? '明天' : '後天' }
  })
  const isQuickDate = quickDates.some(q => q.date === date)

  const missing = [
    !phone.trim() && '電話',
    !name.trim() && '姓名',
    !(guests > 0) && '人數',
    !timeSlot && '時段',
  ].filter(Boolean)
  const valid = missing.length === 0

  const structuralChanged =
    date !== booking.date || timeSlot !== booking.timeSlot || Number(guests) !== Number(booking.guests)

  const handleSave = async () => {
    if (!valid) return toast.error(`還差：${missing.join('、')}`)
    setBusy(true)
    try {
      updateBooking(booking.id, {
        name: name.trim(), phone: phone.trim(), guests, date, timeSlot, source, notes,
      })
      if (structuralChanged && booking.assignedTableId) {
        toast.info(`已更新 ${name.trim()}（日期/時段/人數已變更，原桌位已解除，請重新指派）`)
      } else {
        toast.success(`已更新 ${name.trim()} 的訂位`)
      }
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`✏️ 編輯訂位 · #${booking.id}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>取消</Button>
          <Button onClick={handleSave} disabled={!valid || busy}>
            {busy ? '儲存中...' : valid ? '儲存變更' : `還差：${missing.join('、')}`}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input label="姓名" value={name} onChange={e => setName(e.target.value)} placeholder="王小姐" />
        <Input label="電話" type="tel" inputMode="numeric" value={phone} onChange={e => setPhone(e.target.value)} placeholder="0912345678" />

        {/* 人數：1–8 快選 + 9+ 自由輸入（上限 200） */}
        <GuestCountField value={guests} onChange={setGuests} />

        {/* 日期：快選 chips + 月曆 */}
        <div>
          <label className="label">日期</label>
          <div className="flex flex-wrap gap-1.5">
            {quickDates.map(q => (
              <button key={q.date} type="button" onClick={() => pickDate(q.date)}
                className={`px-3 py-2 rounded-xl border-2 text-sm font-bold transition-all ${
                  date === q.date ? 'border-chicken-red bg-chicken-red text-white' : 'border-chicken-brown/15 bg-white text-chicken-brown'}`}>
                {q.label}
              </button>
            ))}
            <button type="button" onClick={() => setShowCalendar(s => !s)}
              className={`px-3 py-2 rounded-xl border-2 text-sm font-bold transition-all ${
                !isQuickDate ? 'border-chicken-red bg-chicken-red/10 text-chicken-red' : 'border-chicken-brown/15 bg-white text-chicken-brown/70'}`}>
              📅 {!isQuickDate ? `已選 ${dayLabel(date)}` : showCalendar ? '收合月曆 ▴' : '選月曆 ▾'}
            </button>
          </div>
          {showCalendar && (
            <div className="mt-2">
              <MonthCalendar value={date} onChange={pickDate} />
            </div>
          )}
        </div>

        {/* 來源 */}
        <div>
          <label className="label">來源</label>
          <div className="flex flex-wrap gap-1.5">
            {SOURCE_OPTIONS.map(o => (
              <button key={o.value} type="button" onClick={() => setSource(o.value)}
                className={`px-3 py-2 rounded-xl border-2 text-sm font-bold transition-all ${
                  source === o.value ? 'border-chicken-red bg-chicken-red/10 text-chicken-red' : 'border-chicken-brown/15 bg-white text-chicken-brown/70'}`}>
                {o.label}
              </button>
            ))}
          </div>
        </div>

        {/* 時段 */}
        <div>
          <label className="label">時段（{dayLabel(date)}）</label>
          <TimeSlotPicker
            date={date}
            value={timeSlot}
            onChange={setTimeSlot}
            settings={settings}
            tables={tables}
            bookings={bookings}
            groupReservations={groupReservations}
            guests={guests}
            hideFull={false}
          />
        </div>

        {/* 備註 */}
        <div>
          <label className="label">特殊需求（選填）</label>
          <div className="mb-2 grid grid-cols-3 gap-2">
            {NOTE_OPTIONS.map(n => {
              const active = notes[n.key]
              return (
                <button key={n.key} type="button" onClick={() => setNotes(p => ({ ...p, [n.key]: !p[n.key] }))}
                  className={`px-3 py-2.5 rounded-xl border-2 text-sm font-bold transition-all ${
                    active ? 'border-chicken-red bg-chicken-red/10 text-chicken-red' : 'border-chicken-brown/15 bg-white text-chicken-brown'}`}>
                  {n.label}
                </button>
              )
            })}
          </div>
          <Textarea value={notes.text} onChange={e => setNotes(p => ({ ...p, text: e.target.value }))}
            placeholder="例：靠窗、慶生、長輩需軟食..." />
        </div>
      </div>
    </Modal>
  )
}
