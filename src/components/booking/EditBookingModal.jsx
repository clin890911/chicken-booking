import { useState } from 'react'
import { Modal, Input, Button, Textarea } from '../ui'
import PartySizeField from '../admin/PartySizeField'
import { guestSplit, normalizeSplit, splitFields } from '../../utils/partySplit'
import { useToast } from '../ui/Toast'
import { useBooking } from '../../contexts/BookingContext'
import TimeSlotPicker from './TimeSlotPicker'
import MonthCalendar from './MonthCalendar'
import { dayLabel, todayStr, formatDate, addDays } from '../../utils/timeSlots'
import { slotForDateChange } from '../../utils/staffSlots'
import { squeezeSeats } from '../../utils/capacity'
import { bookingTableNumbers } from '../../utils/bookingTables'

const SOURCE_OPTIONS = [
  { value: 'phone',  label: '電話' },
  { value: 'line',   label: 'LINE' },
  { value: 'walkin', label: '現場' },
  { value: 'online', label: '線上' },
]
const NOTE_OPTIONS = [
  { key: 'pet',      label: '寵物' },
  { key: 'child',    label: '兒童' },
  { key: 'mobility', label: '行動不便' },
]
// 員工後台編輯既有訂位：姓名／電話／人數／日期／時段／來源／備註。
// 採「按需掛載」（父層 {editing && <EditBookingModal/>}）→ 每次開啟都以當前 booking 初始化。
// 桌位連動由 context.updateBooking → bookingService.updateByStaff 決定（改日期／時段解除；只改人數、
// 指派桌擠一擠坐得下就保留；已入座一律不動桌），這裡只把結果講清楚：解除了就提示「請重新指派」。
// 已入座（arrived）只開放改人數與備註（日期、時段、電話、姓名、來源對已坐下的客人沒有意義，且改了會動到桌）。
export default function EditBookingModal({ booking, onClose }) {
  const { settings, tables, bookings, groupReservations, updateBooking } = useBooking()
  const toast = useToast()
  const seated = booking.status === 'arrived'

  const [name, setName] = useState(booking.name || '')
  const [phone, setPhone] = useState(booking.phone || '')
  const [guests, setGuests] = useState(Number(booking.guests) || 1)
  // 舊單沒有拆分 → 預填 大人＝guests、小孩＝0（guestSplit）
  const [kids, setKids] = useState(() => guestSplit(booking).children)
  // 有小孩 →「兒童」自動勾且鎖住；notes.child 只記店員自己點的
  const hasKids = normalizeSplit(guests, kids).children > 0
  const [date, setDate] = useState(booking.date || todayStr())
  const [showCalendar, setShowCalendar] = useState(false)
  const [timeSlot, setTimeSlot] = useState(booking.timeSlot || '')
  const [source, setSource] = useState(booking.source || 'phone')
  const [notes, setNotes] = useState({
    pet: !!booking.notes?.pet,
    // 原單已有小孩時「兒童」視為自動勾的（service 會強制補上）→ 小孩改回 0 會跟著取消；店員可再自己勾
    child: !!booking.notes?.child && guestSplit(booking).children === 0,
    mobility: !!booking.notes?.mobility,
    text: booking.notes?.text || '',
  })
  const [busy, setBusy] = useState(false)

  // 改日期：原時段在新日期仍可訂（非公休、席數夠、未過）就保留；否則今天預選下一個可訂時段、
  // 其他日清空重選（與新增表單同一個 helper，utils/staffSlots）。初始載入不動。
  // 席數以「扣掉這筆自己」的佔用計算——不然改到同一時段的別天時，這筆自己會把自己算成「已滿」。
  const pickDate = (d) => {
    if (d !== date) {
      const others = bookings.filter(b => b.id !== booking.id)
      setTimeSlot(prev => slotForDateChange(prev, { settings, tables, bookings: others, groupReservations, date: d, guests }))
    }
    setDate(d)
    setShowCalendar(false)
  }

  const quickDates = [0, 1, 2].map(i => {
    const d = formatDate(addDays(new Date(), i))
    return { date: d, label: i === 0 ? '今天' : i === 1 ? '明天' : '後天' }
  })
  const isQuickDate = quickDates.some(q => q.date === date)

  // 與新增表單同口徑：來源＝現場時電話選填（現場客常不留電話；空電話不建/不併顧客檔）。
  // 否則在新增時沒留電話的現場訂位，一打開編輯就被「還差：電話」卡住存不了。
  const phoneOptional = source === 'walkin'
  // 已入座只送人數＋備註：其他欄位不在表單上，也不該卡住儲存（現場客常沒電話）
  const missing = (seated ? [!(guests > 0) && '人數'] : [
    !phoneOptional && !phone.trim() && '電話',
    !name.trim() && '姓名',
    !(guests > 0) && '人數',
    !timeSlot && '時段',
  ]).filter(Boolean)
  const valid = missing.length === 0

  // 桌位預告（與 updateByStaff 同口徑：主桌＋併桌副桌的擠一擠上限，capacity.squeezeSeats）
  const heldNums = bookingTableNumbers(booking)
  const heldTables = heldNums.map(n => (tables || []).find(t => String(t.number) === String(n))).filter(Boolean)
  const maxSeats = heldTables.length === heldNums.length ? squeezeSeats(heldTables) : 0
  const slotChanged = date !== booking.date || timeSlot !== booking.timeSlot
  const guestsChanged = Number(guests) !== Number(booking.guests)
  const overCapacity = heldNums.length > 0 && Number(guests) > maxSeats
  const tableNote = !heldNums.length ? null
    : seated ? (overCapacity && guestsChanged ? { tone: 'warn', text: `${heldNums.join(' + ')} 擠一擠最多 ${maxSeats} 位，桌位不變，請留意是否要加桌` } : null)
      : slotChanged ? { tone: 'warn', text: `改了日期／時段，儲存後會解除 ${heldNums.join(' + ')}，請重新指派` }
        : guestsChanged ? (overCapacity
          ? { tone: 'warn', text: `${heldNums.join(' + ')} 擠一擠最多 ${maxSeats} 位，儲存後會解除桌位，請重新指派` }
          : { tone: 'ok', text: `${heldNums.join(' + ')} 坐得下，桌位保留` })
          : null

  const handleSave = async () => {
    if (!valid) return toast.error(`還差：${missing.join('、')}`)
    setBusy(true)
    try {
      const common = {
        guests, notes: { ...notes, child: notes.child || hasKids },
        // 有小孩、或原單本來就有拆分（要能改回 0）才寫 adults/children；舊單只有大人時形狀不變
        ...splitFields(guests, kids, { force: booking.children != null || booking.adults != null }),
      }
      const patch = seated ? common : { ...common, name: name.trim(), phone: phone.trim(), date, timeSlot, source }
      const updated = updateBooking(booking.id, patch)
      const who = seated ? booking.name : name.trim()
      if (booking.assignedTableId && updated && !updated.assignedTableId) {
        toast.info(`已更新 ${who}，已解除桌位 ${heldNums.join(' + ')}，請重新指派`, { duration: 8000 })
      } else if (seated && overCapacity && guestsChanged) {
        toast.info(`已更新 ${who}（${guests} 位），超過 ${heldNums.join(' + ')} 擠一擠上限，桌位未變`)
      } else {
        toast.success(`已更新 ${who} 的訂位`)
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
      title={seated ? `改人數／備註 · ${booking.name}` : `編輯訂位 · #${booking.id}`}
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
        {!seated && <Input label="姓名" value={name} onChange={e => setName(e.target.value)} placeholder="王小姐" />}
        {!seated && <Input label={phoneOptional ? '電話（選填 · 現場客可不填）' : '電話'} type="tel" inputMode="numeric" value={phone} onChange={e => setPhone(e.target.value)} placeholder={phoneOptional ? '現場客可不填' : '0912345678'} />}

        {/* 人數：大人 1–8 快選 + 9+ 自由輸入＋小孩步進器（總數上限 200） */}
        <PartySizeField total={guests} kids={kids} onChange={(t, c) => { setKids(c); setGuests(t) }} />
        {tableNote && (
          <p data-testid="edit-table-note" role="status"
            className={`-mt-2 text-xs font-bold ${tableNote.tone === 'ok' ? 'text-chicken-green' : 'text-amber-700'}`}>
            {tableNote.text}
          </p>
        )}

        {/* 日期：快選 chips + 月曆（已入座不開放） */}
        {!seated && <div>
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
              {!isQuickDate ? `已選 ${dayLabel(date)}` : showCalendar ? '收合月曆 ▴' : '選月曆 ▾'}
            </button>
          </div>
          {showCalendar && (
            <div className="mt-2">
              <MonthCalendar value={date} onChange={pickDate} />
            </div>
          )}
        </div>}

        {/* 來源 */}
        {!seated && <div>
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
        </div>}

        {/* 時段（已入座不開放） */}
        {!seated && <div>
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
            ignoreOnlineClosure
            allowFull
          />
        </div>}

        {/* 備註 */}
        <div>
          <label className="label">特殊需求（選填）</label>
          <div className="mb-2 grid grid-cols-3 gap-2">
            {NOTE_OPTIONS.map(n => {
              const locked = n.key === 'child' && hasKids
              const active = notes[n.key] || locked
              return (
                <button key={n.key} type="button" aria-pressed={!!active} disabled={locked}
                  title={locked ? '有小孩已自動標記' : undefined}
                  onClick={() => setNotes(p => ({ ...p, [n.key]: !p[n.key] }))}
                  className={`px-3 py-2.5 rounded-xl border-2 text-sm font-bold transition-all disabled:cursor-not-allowed ${
                    active ? 'border-chicken-red bg-chicken-red/10 text-chicken-red' : 'border-chicken-brown/15 bg-white text-chicken-brown'}`}>
                  {n.label}
                </button>
              )
            })}
          </div>
          {hasKids && <p className="-mt-1 mb-2 text-xs font-bold text-chicken-red/80">有小孩，已自動標記「兒童」</p>}
          <Textarea aria-label="訂位備註" value={notes.text} onChange={e => setNotes(p => ({ ...p, text: e.target.value }))}
            placeholder="例：靠窗、慶生、長輩需軟食..." />
        </div>
      </div>
    </Modal>
  )
}
