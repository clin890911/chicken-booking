import { useEffect, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import { AlertTriangle, CalendarDays, CheckCircle2, ChevronLeft, Clock, LockKeyhole, ShieldCheck, Trash2, Users } from 'lucide-react'
import { Button, Input, Textarea, Badge } from '../components/ui'
import { useConfirm, useToast } from '../components/ui/Toast'
import { useBooking } from '../contexts/BookingContext'
import * as bookingService from '../services/bookingService'
import * as tg from '../services/telegramService'
import { addDays, dayLabel, formatDate, generateTimeSlots, todayStr } from '../utils/timeSlots'
import { calcSlotCapacity } from '../utils/capacity'

const NOTE_OPTIONS = [
  { key: 'pet', label: '攜帶寵物' },
  { key: 'child', label: '有兒童' },
  { key: 'mobility', label: '行動不便' },
]

const EDITABLE_STATUS = ['confirmed']

const safeNotify = (fn) => {
  try { fn()?.catch?.(e => console.warn('TG notify error:', e)) }
  catch (e) { console.warn('TG notify error:', e) }
}

export default function ManageBookingPage() {
  const { id } = useParams()
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token') || ''
  const { bookings, tables, settings, refresh } = useBooking()
  const toast = useToast()
  const confirm = useConfirm()

  const [tail, setTail] = useState('')
  const [access, setAccess] = useState(null)
  const [booking, setBooking] = useState(null)
  const [form, setForm] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const b = bookingService.ensureManageToken(id)
    setBooking(b)
    if (b) setForm(toForm(b))
  }, [id])

  const maxDate = useMemo(() => {
    const today = new Date(todayStr() + 'T00:00:00')
    return formatDate(addDays(today, Math.max(0, Number(settings.maxDaysAhead || 30) - 1)))
  }, [settings.maxDaysAhead])

  const editable = useMemo(() => bookingService.isGuestEditable(booking), [booking])

  const slots = useMemo(() => {
    if (!form?.date) return []
    return generateTimeSlots(settings.openTime, settings.closeTime, settings.slotInterval).map(time => {
      const otherBookings = bookings.filter(b => b.id !== id)
      const remaining = calcSlotCapacity(tables, otherBookings, form.date, time)
      const full = remaining < Number(form.guests || 1)
      return {
        time,
        remaining,
        full,
        period: Number(time.slice(0, 2)) < 15 ? '午餐' : '晚餐',
      }
    })
  }, [bookings, form?.date, form?.guests, id, settings, tables])

  const groupedSlots = useMemo(() => ({
    午餐: slots.filter(s => s.period === '午餐' && !s.full),
    晚餐: slots.filter(s => s.period === '晚餐' && !s.full),
  }), [slots])

  const verify = () => {
    const result = bookingService.verifyGuestAccess(id, token, tail)
    setAccess(result)
    if (!result.ok) {
      setError(result.reason)
      return
    }
    setError('')
    const latest = bookingService.getById(id)
    setBooking(latest)
    setForm(toForm(latest))
  }

  const set = (key, value) => {
    setForm(current => {
      const next = { ...current, [key]: value }
      if (key === 'date' || key === 'guests') next.timeSlot = ''
      return next
    })
  }

  const toggleNote = (key) => {
    setForm(current => ({
      ...current,
      notes: { ...current.notes, [key]: !current.notes[key] },
    }))
  }

  const submit = async () => {
    if (!form || !access?.ok) return
    const errs = validateForm(form)
    if (errs) {
      setError(errs)
      return
    }

    const selectedSlot = slots.find(s => s.time === form.timeSlot)
    if (!selectedSlot || selectedSlot.full) {
      setError('此時段目前已無足夠座位，請改選其他時段')
      return
    }

    setBusy(true)
    try {
      const result = bookingService.updateBookingByGuest(id, token, {
        name: form.name.trim(),
        phone: form.phone.trim(),
        guests: Number(form.guests),
        date: form.date,
        timeSlot: form.timeSlot,
        notes: {
          pet: !!form.notes.pet,
          child: !!form.notes.child,
          mobility: !!form.notes.mobility,
          text: form.notes.text.trim(),
        },
      })
      if (!result.ok) {
        setError(result.reason)
        return
      }
      refresh()
      setBooking(result.booking)
      setForm(toForm(result.booking))
      safeNotify(() => tg.notifyBookingUpdated(result.booking, { ...result.changes, guestManaged: true }))
      toast.success('訂位已更新，同仁端也會同步看到')
      setError('')
    } finally {
      setBusy(false)
    }
  }

  const cancelBooking = async () => {
    if (!access?.ok) return
    const ok = await confirm('取消後此訂位會釋出，若要重新安排需重新訂位。確定取消嗎？', {
      title: '取消訂位',
      confirmLabel: '確定取消',
      danger: true,
    })
    if (!ok) return

    setBusy(true)
    try {
      const result = bookingService.cancelBookingByGuest(id, token)
      if (!result.ok) {
        setError(result.reason)
        return
      }
      refresh()
      setBooking(result.booking)
      setForm(toForm(result.booking))
      safeNotify(() => tg.notifyBookingCancelled(result.booking))
      toast.success('訂位已取消')
      setError('')
    } finally {
      setBusy(false)
    }
  }

  if (!booking || !form) {
    return (
      <Shell>
        <div className="surface p-6 text-center">
          <AlertTriangle className="mx-auto mb-3 text-chicken-red" size={36} />
          <h1 className="text-xl font-black text-chicken-brown">找不到此訂位</h1>
          <Link to="/book" className="mt-4 inline-flex text-sm font-bold text-chicken-red underline">重新訂位</Link>
        </div>
      </Shell>
    )
  }

  return (
    <Shell>
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
        <section className="surface overflow-hidden">
          <div className="bg-chicken-red px-5 py-4 text-white">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs font-bold opacity-85">雞王刷刷鍋</div>
                <h1 className="mt-1 text-2xl font-black">管理我的訂位</h1>
              </div>
              <Badge color={booking.status === 'cancelled' ? 'gray' : 'yellow'} className="bg-white text-chicken-red">
                {statusLabel(booking.status)}
              </Badge>
            </div>
          </div>
          <div className="grid gap-3 p-5 sm:grid-cols-3">
            <SummaryPill icon={CalendarDays} label="日期" value={dayLabel(booking.date)} />
            <SummaryPill icon={Clock} label="時間" value={booking.timeSlot} />
            <SummaryPill icon={Users} label="人數" value={`${booking.guests} 位`} />
          </div>
        </section>

        {!access?.ok ? (
          <section className="surface p-5">
            <div className="mb-4 flex items-start gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-chicken-red/10 text-chicken-red">
                <LockKeyhole size={20} />
              </div>
              <div>
                <h2 className="text-lg font-black text-chicken-brown">驗證電話末碼</h2>
                <p className="mt-1 text-sm leading-6 text-chicken-brown/60">
                  為保護訂位資料，請輸入訂位電話末 3 或 4 碼後再修改。
                </p>
              </div>
            </div>
            <div className="space-y-3">
              <Input
                label="電話末碼"
                inputMode="numeric"
                value={tail}
                maxLength={4}
                onChange={e => setTail(e.target.value.replace(/\D/g, '').slice(0, 4))}
                placeholder="例如 678"
              />
              {error && <p className="rounded-xl bg-chicken-red/10 px-3 py-2 text-sm font-bold text-chicken-red">{error}</p>}
              <Button className="w-full" onClick={verify}>進入訂位管理</Button>
            </div>
          </section>
        ) : !editable.ok || !EDITABLE_STATUS.includes(booking.status) ? (
          <section className="surface p-5 text-center">
            <AlertTriangle className="mx-auto mb-3 text-chicken-yellow" size={38} />
            <h2 className="text-xl font-black text-chicken-brown">此訂位目前無法線上修改</h2>
            <p className="mt-2 text-sm leading-6 text-chicken-brown/60">{editable.reason || '請改以電話聯絡店家協助處理。'}</p>
            <Link to="/" className="mt-4 inline-flex text-sm font-bold text-chicken-red underline">回首頁</Link>
          </section>
        ) : (
          <>
            <section className="surface space-y-4 p-5">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-chicken-green/10 text-chicken-green">
                  <ShieldCheck size={20} />
                </div>
                <div>
                  <h2 className="text-lg font-black text-chicken-brown">修改訂位內容</h2>
                  <p className="mt-1 text-sm leading-6 text-chicken-brown/60">
                    用餐前 2 小時以前可自行調整。若改日期、時間或人數，系統會重新安排桌位。
                  </p>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <Input label="姓名" value={form.name} onChange={e => set('name', e.target.value)} />
                <Input label="電話" type="tel" inputMode="numeric" value={form.phone} onChange={e => set('phone', e.target.value)} />
                <Input label="用餐日期" type="date" min={todayStr()} max={maxDate} value={form.date} onChange={e => set('date', e.target.value)} />
                <Input label="用餐人數" type="number" min="1" max="12" value={form.guests} onChange={e => set('guests', e.target.value)} />
              </div>

              <div>
                <label className="label">可訂時段</label>
                <div className="space-y-4">
                  {Object.entries(groupedSlots).map(([period, items]) => (
                    items.length > 0 && (
                      <div key={period}>
                        <div className="mb-2 flex items-center gap-2">
                          <span className="text-xs font-black text-chicken-brown/55">{period}</span>
                          <span className="h-px flex-1 bg-chicken-brown/10" />
                        </div>
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                          {items.map(slot => (
                            <button
                              key={slot.time}
                              type="button"
                              onClick={() => set('timeSlot', slot.time)}
                              className={`min-h-[58px] rounded-xl border-2 px-3 py-2 text-left transition-all ${
                                form.timeSlot === slot.time
                                  ? 'border-chicken-red bg-chicken-red text-white shadow-sm'
                                  : 'border-chicken-brown/15 bg-white text-chicken-brown hover:border-chicken-red/40'
                              }`}
                            >
                              <div className="font-black tabular-nums">{slot.time}</div>
                              <div className={`mt-1 text-[11px] font-black ${form.timeSlot === slot.time ? 'text-white/80' : 'text-chicken-green'}`}>
                                可訂位
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    )
                  ))}
                </div>
                {groupedSlots.午餐.length + groupedSlots.晚餐.length === 0 && (
                  <div className="empty-panel mt-2">
                    <p className="font-bold text-chicken-brown">此日期沒有符合人數的時段</p>
                  </div>
                )}
              </div>

              <div>
                <label className="label">特殊需求</label>
                <div className="grid grid-cols-3 gap-2">
                  {NOTE_OPTIONS.map(option => (
                    <button
                      key={option.key}
                      type="button"
                      onClick={() => toggleNote(option.key)}
                      className={`min-h-[46px] rounded-xl border px-2 text-sm font-bold transition-all ${
                        form.notes[option.key]
                          ? 'border-chicken-red bg-chicken-red text-white'
                          : 'border-chicken-brown/15 bg-white text-chicken-brown'
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
              <Textarea label="備註" value={form.notes.text} onChange={e => set('notes', { ...form.notes, text: e.target.value })} />

              {error && <p className="rounded-xl bg-chicken-red/10 px-3 py-2 text-sm font-bold text-chicken-red">{error}</p>}

              <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                <Button disabled={busy} onClick={submit}>{busy ? '儲存中...' : '儲存修改'}</Button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={cancelBooking}
                  className="inline-flex items-center justify-center gap-2 rounded-2xl border-2 border-chicken-red/20 px-4 py-3 text-sm font-black text-chicken-red transition hover:bg-chicken-red/5 disabled:opacity-50"
                >
                  <Trash2 size={16} />
                  取消訂位
                </button>
              </div>
            </section>

            <section className="rounded-2xl border border-chicken-yellow/30 bg-chicken-yellow/10 p-4">
              <div className="flex items-start gap-2 text-sm leading-6 text-chicken-brown">
                <CheckCircle2 className="mt-0.5 shrink-0 text-chicken-yellow" size={18} />
                <p>修改成功後，同仁端會同步更新。若距離用餐時間太近，請直接來電確認現場安排。</p>
              </div>
            </section>
          </>
        )}
      </motion.div>
    </Shell>
  )
}

function Shell({ children }) {
  return (
    <div className="min-h-screen bg-gradient-to-b from-chicken-red/5 via-chicken-cream to-white pb-12">
      <header className="sticky top-0 z-30 border-b border-chicken-brown/10 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
          <Link to="/" className="flex h-10 w-10 items-center justify-center rounded-full bg-chicken-brown/5 text-chicken-brown">
            <ChevronLeft size={22} />
          </Link>
          <div>
            <div className="text-base font-black text-chicken-brown">訂位管理</div>
            <div className="text-xs font-bold text-chicken-brown/55">修改、取消與確認訂位狀態</div>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-5">{children}</main>
    </div>
  )
}

function SummaryPill({ icon: Icon, label, value }) {
  return (
    <div className="rounded-2xl bg-chicken-brown/5 px-3 py-3">
      <div className="flex items-center gap-1.5 text-xs font-bold text-chicken-brown/55">
        <Icon size={14} />
        {label}
      </div>
      <div className="mt-1 text-base font-black text-chicken-brown">{value}</div>
    </div>
  )
}

function toForm(booking) {
  return {
    name: booking.name || '',
    phone: booking.phone || '',
    guests: Number(booking.guests) || 1,
    date: booking.date || todayStr(),
    timeSlot: booking.timeSlot || '',
    notes: {
      pet: !!booking.notes?.pet,
      child: !!booking.notes?.child,
      mobility: !!booking.notes?.mobility,
      text: booking.notes?.text || '',
    },
  }
}

function validateForm(form) {
  if (!form.name.trim()) return '請填寫姓名'
  if (!/^[\d\-+\s]{7,}$/.test(form.phone.trim())) return '電話格式不正確'
  if (!form.date) return '請選擇用餐日期'
  if (!form.timeSlot) return '請選擇可訂時段'
  const guests = Number(form.guests)
  if (!Number.isFinite(guests) || guests < 1 || guests > 12) return '用餐人數需為 1 到 12 位'
  return ''
}

function statusLabel(status) {
  const map = {
    confirmed: '已確認',
    arrived: '已入座',
    completed: '已完成',
    cancelled: '已取消',
    noshow: '未到',
  }
  return map[status] || status || '已確認'
}
