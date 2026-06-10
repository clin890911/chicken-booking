import { useEffect, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import {
  AlertTriangle,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronLeft,
  Clock,
  Edit3,
  LockKeyhole,
  MessageCircle,
  Phone,
  ShieldCheck,
  Trash2,
  Users,
} from 'lucide-react'
import { Button, Input, Textarea, Badge, SlotSkeleton } from '../components/ui'
import { useConfirm, useToast } from '../components/ui/Toast'
import { useBooking } from '../contexts/BookingContext'
import * as bookingService from '../services/bookingService'
import { lineBindUrl } from '../services/lineService'
import { guestCancelBooking, guestGetAvailability, guestGetBooking, guestUpdateBooking } from '../services/cloudDataService'
import { addDays, dayLabel, formatDate, todayStr } from '../utils/timeSlots'
import { isValidTwPhone } from '../utils/validation'

const NOTE_OPTIONS = [
  { key: 'pet', label: '攜帶寵物' },
  { key: 'child', label: '有兒童' },
  { key: 'mobility', label: '行動不便' },
]

const CANCEL_REASONS = ['行程改變', '人數變更', '時間不方便', '改天再訂', '其他']

export default function ManageBookingPage() {
  const { id } = useParams()
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token') || ''
  const { settings, refresh } = useBooking()
  const toast = useToast()
  const confirm = useConfirm()

  const [tail, setTail] = useState('')
  const [access, setAccess] = useState(null)
  const [booking, setBooking] = useState(null)
  const [form, setForm] = useState(null)
  const [mode, setMode] = useState('home')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [cancelReason, setCancelReason] = useState('')
  const [cancelOther, setCancelOther] = useState('')
  const [loadingRemote, setLoadingRemote] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function loadBooking() {
      setLoadingRemote(true)
      setAccess(null)
      setTail('')
      setMode('home')
      setError('')
      const remote = await guestGetBooking(id, token).catch(err => ({ ok: false, error: err.message }))
      if (cancelled) return
      if (remote.ok && remote.booking) {
        const restored = bookingService.upsertFromRemote({
          ...remote.booking,
          manageToken: remote.booking.manageToken || remote.booking.token || token,
        })
        setBooking(restored)
        setForm(toForm(restored))
        setError('')
      } else {
        const local = bookingService.ensureManageToken(id)
        if (local && (!token || token === local.manageToken)) {
          setBooking(local)
          setForm(toForm(local))
          setError('')
        } else {
          setBooking(null)
          setForm(null)
          setError(remote.error || '找不到此訂位')
        }
      }
      setLoadingRemote(false)
    }
    loadBooking()
    return () => { cancelled = true }
  }, [id, token])

  const maxDate = useMemo(() => {
    const today = new Date(todayStr() + 'T00:00:00')
    return formatDate(addDays(today, Math.max(0, Number(settings.maxDaysAhead || 30) - 1)))
  }, [settings.maxDaysAhead])

  const editable = useMemo(() => bookingService.isGuestEditable(booking), [booking])

  // 改期可訂時段：與訂位頁同一來源（後端 guestGetAvailability 即時可訂），
  // 避免改用本機桌位／空訂位算出「每格都可訂」的假象，也自動濾掉今天已過的時段。
  const [serverSlots, setServerSlots] = useState([])
  const [slotsLoading, setSlotsLoading] = useState(false)
  const [slotsError, setSlotsError] = useState('')

  useEffect(() => {
    if (mode !== 'schedule' || !form?.date) return
    let cancelled = false
    setSlotsLoading(true)
    setSlotsError('')
    guestGetAvailability(form.date)
      .then(res => { if (!cancelled) setServerSlots(Array.isArray(res.slots) ? res.slots : []) })
      .catch(err => { if (!cancelled) { setServerSlots([]); setSlotsError(err.message || '無法載入可訂時段，請稍後再試') } })
      .finally(() => { if (!cancelled) setSlotsLoading(false) })
    return () => { cancelled = true }
  }, [mode, form?.date])

  const slots = useMemo(() => {
    return serverSlots
      .filter(s => s && typeof s.time === 'string' && /^\d{2}:\d{2}/.test(s.time))
      .map(({ time, remaining }) => {
        let rem = Number(remaining) || 0
        // 同一天的原時段：把本訂位自己佔的座位加回（自己改自己，不該被自己擋住）。
        if (booking && form?.date === booking.date && time === booking.timeSlot) {
          rem += Number(booking.guests) || 0
        }
        return {
          time,
          remaining: rem,
          full: rem < Number(form?.guests || 1),
          period: Number(time.slice(0, 2)) < 15 ? '午餐' : '晚餐',
        }
      })
  }, [serverSlots, form?.guests, form?.date, booking])

  const groupedSlots = useMemo(() => ({
    午餐: slots.filter(s => s.period === '午餐' && !s.full),
    晚餐: slots.filter(s => s.period === '晚餐' && !s.full),
  }), [slots])

  const changed = useMemo(() => {
    if (!booking || !form) return false
    return ['name', 'phone', 'date', 'timeSlot'].some(key => String(form[key] || '') !== String(booking[key] || '')) ||
      Number(form.guests) !== Number(booking.guests) ||
      JSON.stringify(form.notes) !== JSON.stringify({
        pet: !!booking.notes?.pet,
        child: !!booking.notes?.child,
        mobility: !!booking.notes?.mobility,
        text: booking.notes?.text || '',
      })
  }, [booking, form])

  const verify = () => {
    const result = bookingService.verifyGuestAccess(id, token, tail)
    setAccess(result)
    if (!result.ok) {
      setError(result.reason)
      return
    }
    const latest = bookingService.getById(id)
    setBooking(latest)
    setForm(toForm(latest))
    setError('')
  }

  const set = (key, value) => {
    setForm(current => {
      const next = { ...current, [key]: value }
      if (key === 'date' || key === 'guests') next.timeSlot = ''
      return next
    })
  }

  const toggleNote = (key) => {
    setForm(current => ({ ...current, notes: { ...current.notes, [key]: !current.notes[key] } }))
  }

  const resetForm = () => {
    setForm(toForm(booking))
    setMode('home')
    setError('')
  }

  const submit = async () => {
    if (!form || !access?.ok) return
    const errs = validateForm(form)
    if (errs) return setError(errs)
    if (!changed) return setError('目前沒有修改內容')

    const selectedSlot = slots.find(s => s.time === form.timeSlot)
    if (!selectedSlot || selectedSlot.full) return setError('此時段目前已無足夠座位，請改選其他時段')

    setBusy(true)
    try {
      const patch = {
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
      }
      // 雲端為唯一真實來源：失敗就誠實報錯，不退回「只改本機」的假成功
      // （客人端本機資料對店家無意義，會造成「以為改好、店家卻沒收到」）。
      const result = await guestUpdateBooking(id, token, patch).catch(err => ({ ok: false, reason: err.message }))
      if (!result.ok) return setError(result.reason || '更新失敗，請稍後再試，或來電由專人協助')
      bookingService.upsertFromRemote({ ...result.booking, manageToken: result.booking.manageToken || token })
      refresh()
      setBooking(result.booking)
      setForm(toForm(result.booking))
      setMode('success')
      setError('')
      // Telegram 與 LINE 通知皆由後端 guestUpdateBooking 經 outbox 權威送出，
      // 不再由前端觸發（客人關頁/斷網會漏發）。
      toast.success('訂位已更新，同仁端也會同步看到')
    } finally {
      setBusy(false)
    }
  }

  const cancelBooking = async () => {
    if (!access?.ok) return
    const reason = cancelReason === '其他' ? cancelOther.trim() : cancelReason
    if (!reason) return setError('請選擇取消原因')

    const ok = await confirm('取消後此訂位會釋出，若要重新安排需重新訂位。確定取消嗎？', {
      title: '取消訂位',
      confirmLabel: '確定取消',
      danger: true,
    })
    if (!ok) return

    setBusy(true)
    try {
      // 同 submit：雲端失敗就誠實報錯，不退回本機假成功。
      const result = await guestCancelBooking(id, token, reason).catch(err => ({ ok: false, reason: err.message }))
      if (!result.ok) return setError(result.reason || '取消失敗，請稍後再試，或來電由專人協助')
      bookingService.upsertFromRemote({ ...result.booking, manageToken: result.booking.manageToken || token })
      refresh()
      setBooking(result.booking)
      setForm(toForm(result.booking))
      setMode('cancelled')
      setError('')
      // Telegram 與 LINE 通知皆由後端 guestCancelBooking 經 outbox 權威送出。
      toast.success('訂位已取消')
    } finally {
      setBusy(false)
    }
  }

  if (loadingRemote) {
    return (
      <Shell>
        <div className="surface p-6 text-center">
          <Clock className="mx-auto mb-3 animate-spin text-chicken-red" size={34} />
          <h1 className="text-xl font-black text-chicken-brown">正在讀取訂位</h1>
          <p className="mt-2 text-sm font-bold text-chicken-brown/55">請稍候，正在確認您的管理連結。</p>
        </div>
      </Shell>
    )
  }

  if (!booking || !form) {
    return (
      <Shell>
        <div className="surface p-6 text-center">
          <AlertTriangle className="mx-auto mb-3 text-chicken-red" size={36} />
          <h1 className="text-xl font-black text-chicken-brown">找不到此訂位</h1>
          {error && <p className="mt-2 text-sm font-bold text-chicken-brown/55">{error}</p>}
          <Link to="/book" className="mt-4 inline-flex text-sm font-bold text-chicken-red underline">重新訂位</Link>
        </div>
      </Shell>
    )
  }

  return (
    <Shell>
      <div className="animate-soft-enter space-y-4">
        <BookingHero booking={booking} editable={editable} />

        {!access?.ok ? (
          <VerifyPanel tail={tail} setTail={setTail} verify={verify} error={error} />
        ) : mode !== 'cancelled' && (!editable.ok || booking.status !== 'confirmed') ? (
          <LockedPanel reason={editable.reason} booking={booking} />
        ) : (
          <>
            {/* mode 切換不用 AnimatePresence mode="wait"（v11 exit 回呼遺失 bug 會讓新畫面永不掛載、
                手機白屏），改 key 重掛 + 純 CSS 進場動畫，與 BookingPage 同一修法。 */}
            {mode === 'home' && (
              <section key="home" className="animate-soft-enter space-y-4">
                <ActionGrid setMode={setMode} booking={booking} settings={settings} />
                <EditHistory booking={booking} />
              </section>
            )}
            {mode === 'schedule' && (
              <section key="schedule" className="animate-soft-enter surface space-y-5 p-5">
                <SectionHead icon={CalendarDays} title="修改日期、時間與人數" hint="像重新訂位一樣選擇新時段，送出前會再次確認。" />
                <div className="grid gap-3 sm:grid-cols-2">
                  <Input label="用餐日期" type="date" min={todayStr()} max={maxDate} value={form.date} onChange={e => set('date', e.target.value)} />
                  <Input label="用餐人數" type="number" min="1" max="12" value={form.guests} onChange={e => set('guests', e.target.value)} />
                </div>
                <SlotGrid groupedSlots={groupedSlots} value={form.timeSlot} loading={slotsLoading} error={slotsError} onChange={(time) => set('timeSlot', time)} />
                <BeforeAfter before={booking} after={form} />
                <FooterActions busy={busy} changed={changed} error={error} onBack={resetForm} onSubmit={submit} />
              </section>
            )}
            {mode === 'details' && (
              <section key="details" className="animate-soft-enter surface space-y-5 p-5">
                <SectionHead icon={Edit3} title="修改聯絡資訊與備註" hint="若只調整姓名、電話或特殊需求，不會解除桌位指派。" />
                <div className="grid gap-3 sm:grid-cols-2">
                  <Input label="姓名" value={form.name} onChange={e => set('name', e.target.value)} />
                  <Input label="電話" type="tel" inputMode="numeric" value={form.phone} onChange={e => set('phone', e.target.value)} />
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
                          form.notes[option.key] ? 'border-chicken-red bg-chicken-red text-white' : 'border-chicken-brown/15 bg-white text-chicken-brown'
                        }`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>
                <Textarea label="備註" value={form.notes.text} onChange={e => set('notes', { ...form.notes, text: e.target.value })} />
                <BeforeAfter before={booking} after={form} compact />
                <FooterActions busy={busy} changed={changed} error={error} onBack={resetForm} onSubmit={submit} />
              </section>
            )}
            {mode === 'cancel' && (
              <section key="cancel" className="animate-soft-enter surface space-y-5 p-5">
                <SectionHead icon={Trash2} title="取消訂位" hint="取消後座位會釋出，原因會提供給現場同仁判斷營運狀況。" danger />
                <div className="grid gap-2 sm:grid-cols-2">
                  {CANCEL_REASONS.map(reason => (
                    <button
                      key={reason}
                      type="button"
                      onClick={() => setCancelReason(reason)}
                      className={`rounded-xl border-2 px-4 py-3 text-left text-sm font-black transition-all ${
                        cancelReason === reason ? 'border-chicken-red bg-chicken-red text-white' : 'border-chicken-brown/15 bg-white text-chicken-brown'
                      }`}
                    >
                      {reason}
                    </button>
                  ))}
                </div>
                {cancelReason === '其他' && (
                  <Textarea label="其他原因" value={cancelOther} onChange={e => setCancelOther(e.target.value)} placeholder="請簡短說明取消原因" />
                )}
                {error && <ErrorText>{error}</ErrorText>}
                <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                  <button type="button" onClick={resetForm} className="btn-secondary">返回</button>
                  <button type="button" disabled={busy} onClick={cancelBooking} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-chicken-red px-5 py-3 text-sm font-black text-white shadow-sm disabled:opacity-50">
                    <Trash2 size={16} />
                    {busy ? '取消中...' : '確認取消訂位'}
                  </button>
                </div>
              </section>
            )}
            {mode === 'success' && <SuccessPanel key="success" booking={booking} settings={settings} onBack={() => setMode('home')} />}
            {mode === 'cancelled' && <CancelledPanel key="cancelled" booking={booking} />}
          </>
        )}
      </div>
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
            <div className="text-base font-black text-chicken-brown">訂位管理中心</div>
            <div className="text-xs font-bold text-chicken-brown/55">修改、取消與確認訂位狀態</div>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-5">{children}</main>
    </div>
  )
}

function BookingHero({ booking, editable }) {
  return (
    <section className="surface overflow-hidden">
      <div className="bg-chicken-red px-5 py-4 text-white">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-xs font-bold opacity-85">雞王涮涮鍋</div>
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
      <div className="border-t border-chicken-brown/10 px-5 py-3 text-xs font-bold text-chicken-brown/55">
        {editable.ok ? '用餐前 2 小時以前可自行修改或取消。' : editable.reason}
      </div>
    </section>
  )
}

function VerifyPanel({ tail, setTail, verify, error }) {
  return (
    <section className="surface p-5">
      <SectionHead icon={LockKeyhole} title="驗證電話末碼" hint="為保護訂位資料，請輸入訂位電話末 3 或 4 碼。" />
      <div className="mt-4 space-y-3">
        <Input label="電話末碼" inputMode="numeric" value={tail} maxLength={4} onChange={e => setTail(e.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="例如 678" />
        {error && <ErrorText>{error}</ErrorText>}
        <Button className="w-full" onClick={verify}>進入訂位管理</Button>
      </div>
    </section>
  )
}

function LockedPanel({ reason, booking }) {
  return (
    <section className="surface p-5 text-center">
      <AlertTriangle className="mx-auto mb-3 text-chicken-yellow" size={38} />
      <h2 className="text-xl font-black text-chicken-brown">此訂位目前無法線上修改</h2>
      <p className="mt-2 text-sm leading-6 text-chicken-brown/60">{reason || '請改以電話聯絡店家協助處理。'}</p>
      {booking.status === 'cancelled' && (
        <Link to="/book" className="mt-4 inline-flex text-sm font-bold text-chicken-red underline">重新訂位</Link>
      )}
    </section>
  )
}

function ActionGrid({ setMode, booking, settings }) {
  return (
    <section className="grid gap-3 sm:grid-cols-3">
      <ActionCard icon={CalendarDays} title="修改日期 / 時間 / 人數" hint="重新挑選可訂時段" onClick={() => setMode('schedule')} />
      <ActionCard icon={Edit3} title="修改聯絡資訊 / 備註" hint="調整姓名、電話、特殊需求" onClick={() => setMode('details')} />
      <ActionCard icon={Trash2} title="取消訂位" hint="提供原因並釋出座位" danger onClick={() => setMode('cancel')} />
      <a href={lineBindUrl(settings, booking)} target="_blank" rel="noreferrer" className="surface flex min-h-[118px] flex-col justify-between p-4 transition hover:-translate-y-0.5 hover:shadow-md">
        <MessageCircle className="text-[#06C755]" size={24} />
        <div>
          <div className="font-black text-chicken-brown">綁定 LINE 訂位通知</div>
          <div className="mt-1 text-xs font-bold leading-5 text-chicken-brown/55">加好友 → 一鍵綁定，訂位卡片與異動自動傳到 LINE</div>
        </div>
      </a>
      {settings.storePhone ? (
        <a href={`tel:${settings.storePhone}`} className="surface flex min-h-[118px] flex-col justify-between p-4 transition hover:-translate-y-0.5 hover:shadow-md">
          <Phone className="text-chicken-red" size={24} />
          <div>
            <div className="font-black text-chicken-brown">撥電話給店家</div>
            <div className="mt-1 text-xs font-bold leading-5 text-chicken-brown/55">{settings.storePhone}</div>
          </div>
        </a>
      ) : null}
    </section>
  )
}

function ActionCard({ icon: Icon, title, hint, onClick, danger = false }) {
  return (
    <button type="button" onClick={onClick} className={`surface min-h-[118px] p-4 text-left transition hover:-translate-y-0.5 hover:shadow-md ${danger ? 'border-chicken-red/25' : ''}`}>
      <Icon className={danger ? 'text-chicken-red' : 'text-chicken-brown'} size={24} />
      <div className="mt-5 font-black text-chicken-brown">{title}</div>
      <div className="mt-1 text-xs font-bold leading-5 text-chicken-brown/55">{hint}</div>
    </button>
  )
}

function SlotGrid({ groupedSlots, value, loading, error, onChange }) {
  const total = groupedSlots.午餐.length + groupedSlots.晚餐.length
  if (loading) {
    return (
      <div>
        <label className="label">可訂時段</label>
        <SlotSkeleton />
      </div>
    )
  }
  if (error) {
    return (
      <div className="empty-panel" role="alert">
        <p className="font-bold text-chicken-brown">{error}</p>
        <p className="mt-1 text-sm text-chicken-brown/60">請稍後再試，或來電由專人為您改期。</p>
      </div>
    )
  }
  if (total === 0) {
    return <div className="empty-panel"><p className="font-bold text-chicken-brown">此日期沒有符合人數的可訂時段</p><p className="mt-1 text-sm text-chicken-brown/60">請改選其他日期，或來電詢問。</p></div>
  }
  return (
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
                    onClick={() => onChange(slot.time)}
                    className={`relative min-h-[58px] rounded-xl border-2 px-3 py-2 text-left transition-all ${
                      value === slot.time ? 'border-chicken-red bg-chicken-red text-white shadow-sm' : 'border-chicken-brown/15 bg-white text-chicken-brown hover:border-chicken-red/40'
                    }`}
                  >
                    <div className="font-black tabular-nums">{slot.time}</div>
                    <div className={`mt-1 text-[11px] font-black ${value === slot.time ? 'text-white/80' : 'text-chicken-green'}`}>可訂位</div>
                    {value === slot.time && <Check className="absolute right-2 top-2" size={16} />}
                  </button>
                ))}
              </div>
            </div>
          )
        ))}
      </div>
    </div>
  )
}

function BeforeAfter({ before, after, compact = false }) {
  return (
    <div className="rounded-2xl border border-chicken-brown/10 bg-chicken-cream/50 p-4">
      <div className="mb-3 text-sm font-black text-chicken-brown">修改前後確認</div>
      <div className="grid gap-3 sm:grid-cols-2">
        <CompareBox title="目前訂位" data={before} muted />
        <CompareBox title="修改後" data={after} />
      </div>
      {!compact && (
        <p className="mt-3 text-xs font-bold leading-5 text-chicken-brown/55">
          若日期、時間或人數有變更，原桌位指派會解除，現場同仁會重新安排。
        </p>
      )}
    </div>
  )
}

function CompareBox({ title, data, muted }) {
  return (
    <div className={`rounded-xl bg-white p-3 ${muted ? 'opacity-75' : 'ring-2 ring-chicken-red/20'}`}>
      <div className="mb-2 text-xs font-black text-chicken-brown/45">{title}</div>
      <div className="space-y-1 text-sm font-bold text-chicken-brown">
        <div>{dayLabel(data.date)} · {data.timeSlot}</div>
        <div>{data.guests} 位 · {data.name}</div>
        <div className="font-mono text-xs text-chicken-brown/60">{data.phone}</div>
      </div>
    </div>
  )
}

function FooterActions({ busy, changed, error, onBack, onSubmit }) {
  return (
    <div className="space-y-3">
      {error && <ErrorText>{error}</ErrorText>}
      <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
        <button type="button" onClick={onBack} className="btn-secondary">返回</button>
        <Button disabled={busy || !changed} onClick={onSubmit}>{busy ? '儲存中...' : '確認修改'}</Button>
      </div>
    </div>
  )
}

function SuccessPanel({ booking, settings, onBack }) {
  return (
    <section className="animate-soft-enter surface p-6 text-center">
      <CheckCircle2 className="mx-auto text-chicken-green" size={44} />
      <h2 className="mt-3 text-xl font-black text-chicken-brown">訂位已更新</h2>
      <p className="mt-2 text-sm leading-6 text-chicken-brown/60">同仁端已同步收到新的訂位內容。</p>
      <div className="mt-5 grid gap-2">
        <a href={lineBindUrl(settings, booking)} target="_blank" rel="noreferrer" className="btn-primary text-center">綁定 LINE 訂位通知</a>
        <p className="text-xs font-bold leading-5 text-chicken-brown/55">
          已綁定的訂位異動會自動推播到 LINE；尚未綁定可點上方按鈕（先加好友再綁定）。
        </p>
        <button onClick={onBack} className="text-sm font-bold text-chicken-brown/60 underline">回訂位管理中心</button>
      </div>
    </section>
  )
}

function CancelledPanel({ booking }) {
  return (
    <section className="animate-soft-enter surface p-6 text-center">
      <CheckCircle2 className="mx-auto text-chicken-green" size={44} />
      <h2 className="mt-3 text-xl font-black text-chicken-brown">訂位已取消</h2>
      <p className="mt-2 text-sm leading-6 text-chicken-brown/60">取消原因：{booking.cancellationReason?.reason || '未提供'}</p>
      <Link to="/book" className="btn-primary mt-5 block text-center">重新訂位</Link>
    </section>
  )
}

function EditHistory({ booking }) {
  const history = Array.isArray(booking.guestEditHistory) ? booking.guestEditHistory.slice(-3).reverse() : []
  if (history.length === 0) return null
  return (
    <section className="surface p-5">
      <div className="text-sm font-black text-chicken-brown">最近修改紀錄</div>
      <div className="mt-3 space-y-2">
        {history.map(item => (
          <div key={item.id} className="rounded-xl bg-chicken-brown/5 px-3 py-2 text-xs leading-5 text-chicken-brown/65">
            <span className="font-black text-chicken-brown">{item.type === 'guest_cancel' ? '客人取消' : '客人修改'}</span>
            <span className="mx-1">·</span>
            {new Date(item.at).toLocaleString('zh-TW')}
            {item.reason && <span> · {item.reason}</span>}
          </div>
        ))}
      </div>
    </section>
  )
}

function SectionHead({ icon: Icon, title, hint, danger = false }) {
  return (
    <div className="flex items-start gap-3">
      <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${danger ? 'bg-chicken-red/10 text-chicken-red' : 'bg-chicken-red/10 text-chicken-red'}`}>
        <Icon size={20} />
      </div>
      <div>
        <h2 className="text-lg font-black text-chicken-brown">{title}</h2>
        {hint && <p className="mt-1 text-sm leading-6 text-chicken-brown/60">{hint}</p>}
      </div>
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

function ErrorText({ children }) {
  return <p className="rounded-xl bg-chicken-red/10 px-3 py-2 text-sm font-bold text-chicken-red">{children}</p>
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
  if (!isValidTwPhone(form.phone)) return '電話格式不正確，請輸入正確的台灣電話號碼'
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
