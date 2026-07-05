import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { CalendarDays, Check, ChevronLeft, Clock, Minus, Phone, Plus, Search, ShieldCheck, Sparkles, Users } from 'lucide-react'
import { Input, Textarea, SlotSkeleton } from '../components/ui'
import { useBooking } from '../contexts/BookingContext'
import { useLiffIdentity } from '../hooks/useLiffIdentity'
import { guestGetAvailability, guestCreateBooking } from '../services/cloudDataService'
import { addDays, dayLabel, formatDate, todayStr } from '../utils/timeSlots'
import { bookingOccupancyLabel } from '../utils/capacity'
import { isValidTwPhone } from '../utils/validation'

const NOTE_OPTIONS = [
  { key: 'pet', label: '攜帶寵物' },
  { key: 'child', label: '有兒童' },
  { key: 'mobility', label: '行動不便' },
]

const QUICK_GUESTS = [2, 4, 6, 8]
const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']

export default function BookingPage() {
  const navigate = useNavigate()
  // 客人端不再依賴 useBooking 的全量資料（已不同步），settings 僅作為初始顯示預設。
  const { settings: localSettings } = useBooking()

  const [step, setStep] = useState('availability')
  const [data, setData] = useState({
    guests: 2,
    date: todayStr(),
    timeSlot: '',
    name: '',
    phone: '',
    notes: { pet: false, child: false, mobility: false, text: '' },
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState({})

  // LINE-first：客人從 LINE rich menu（LIFF 內）開本頁時靜默取得身分，
  // 訂位送出即綁定＋立即收到確認卡。外部瀏覽器/未登入 → null，不影響任何流程。
  const lineIdentity = useLiffIdentity(localSettings)

  // 可訂時段與公開店家設定，全部由後端 guestGetAvailability 提供（不含任何顧客個資）。
  const [settings, setSettings] = useState(localSettings)
  const [serverSlots, setServerSlots] = useState([])
  const [slotsLoading, setSlotsLoading] = useState(true)
  const [slotsError, setSlotsError] = useState('')

  const loadAvailability = async (date) => {
    setSlotsLoading(true)
    setSlotsError('')
    try {
      const res = await guestGetAvailability(date)
      setServerSlots(Array.isArray(res.slots) ? res.slots : [])
      if (res.settings) setSettings(s => ({ ...s, ...res.settings }))
    } catch (err) {
      setServerSlots([])
      setSlotsError(err.message || '無法載入可訂時段，請稍後再試')
    } finally {
      setSlotsLoading(false)
    }
  }

  // 切換日期時重新向後端查詢該日可訂時段
  useEffect(() => {
    loadAvailability(data.date)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.date])

  // 「找最近可訂日」：當天沒有符合人數的時段時，往後逐日查詢，找到第一個有空位的日期就跳過去，
  // 避免客人一天一天手動點。最多掃描到可預訂範圍上限為止。
  const [findingNext, setFindingNext] = useState(false)
  const [findNextMsg, setFindNextMsg] = useState('')
  const findNextAvailable = async () => {
    setFindingNext(true)
    setFindNextMsg('')
    try {
      const lastDate = dates[dates.length - 1]?.value
      const start = new Date(data.date + 'T00:00:00')
      const maxAhead = settings.maxDaysAhead || 30
      for (let i = 1; i <= maxAhead; i++) {
        const d = formatDate(addDays(start, i))
        if (lastDate && d > lastDate) break // 超出可預訂範圍
        try {
          const res = await guestGetAvailability(d)
          const hasRoom = (res.slots || []).some(s => Number(s.remaining) >= data.guests)
          if (hasRoom) { setDate(d); window.scrollTo({ top: 0, behavior: 'smooth' }); return }
        } catch { /* 這天查詢失敗就略過，繼續往後找 */ }
      }
      setFindNextMsg('接下來的可預訂日期都沒有符合人數的時段，請來電由專人協助安排。')
    } finally {
      setFindingNext(false)
    }
  }

  const dates = useMemo(() => {
    const today = new Date(todayStr() + 'T00:00:00')
    return Array.from({ length: settings.maxDaysAhead || 30 }, (_, i) => {
      const d = addDays(today, i)
      const value = formatDate(d)
      return {
        value,
        label: dayLabel(value),
        isToday: i === 0,
        isWeekend: [0, 6].includes(d.getDay()),
      }
    })
  }, [settings.maxDaysAhead])

  const slots = useMemo(() => {
    return serverSlots
      // 只接受格式正確的時段，避免後端萬一回傳異常資料時 time.slice 在 render 階段丟例外。
      .filter(s => s && typeof s.time === 'string' && /^\d{2}:\d{2}/.test(s.time))
      .map(({ time, remaining, closed }) => ({
        time,
        remaining,
        closed: !!closed,
        // 已關閉的時段視同不可訂（不顯示給客人）；與「已滿」一併被 groupedSlots 過濾。
        full: !!closed || remaining < data.guests,
        period: Number(time.slice(0, 2)) < 15 ? '午餐' : '晚餐',
      }))
  }, [serverSlots, data.guests])

  const groupedSlots = useMemo(() => {
    const available = slots.filter(s => !s.full)
    return {
      午餐: available.filter(s => s.period === '午餐'),
      晚餐: available.filter(s => s.period === '晚餐'),
    }
  }, [slots])

  const selectedReady = data.guests > 0 && data.date && data.timeSlot
  const canSubmit = data.name.trim() && isValidTwPhone(data.phone)

  const set = (key, value) => setData(d => ({ ...d, [key]: value }))
  const setGuests = (next) => setData(d => ({ ...d, guests: Math.max(1, Math.min(12, next)), timeSlot: '' }))
  const setDate = (date) => setData(d => ({ ...d, date, timeSlot: '' }))
  const toggleNote = (key) => setData(d => ({ ...d, notes: { ...d.notes, [key]: !d.notes[key] } }))

  const continueToInfo = () => {
    if (!selectedReady) return
    setStep('info')
    // 即時捲頂（不用 smooth）：步驟切換時整頁內容同步替換、文件高度大幅塌縮，
    // iOS 上平滑捲動與高度塌縮並行會有捲動位置異常的怪癖。
    window.scrollTo(0, 0)
  }

  const submit = async () => {
    const errs = {}
    if (!data.name.trim()) errs.name = '請填姓名'
    if (!data.phone.trim()) errs.phone = '請填電話'
    else if (!isValidTwPhone(data.phone)) errs.phone = '電話格式不正確，請輸入正確的台灣電話號碼'
    setError(errs)
    if (Object.keys(errs).length > 0) return

    setBusy(true)
    try {
      const res = await guestCreateBooking({
        name: data.name.trim(),
        phone: data.phone.trim(),
        guests: data.guests,
        date: data.date,
        timeSlot: data.timeSlot,
        notes: data.notes,
        // LIFF 內訂位：附帶 LINE 身分（後端驗 idToken 後訂位即綁定＋推播確認卡）
        ...(lineIdentity?.idToken ? {
          line: {
            idToken: lineIdentity.idToken,
            displayName: lineIdentity.displayName,
            pictureUrl: lineIdentity.pictureUrl,
            ...(typeof lineIdentity.friendFlag === 'boolean' ? { friendFlag: lineIdentity.friendFlag } : {}),
          },
        } : {}),
      })
      const booking = res.booking
      // 後端回傳完整訂位（含 manageToken），用 route state 帶到確認頁。
      // 同時把 token 放進網址：重新整理或把連結傳到另一支手機時，確認頁可用 id+token 向後端補抓，
      // 不會再因 route state 消失而「找不到此訂位」。
      const tokenQuery = booking.manageToken ? `?token=${encodeURIComponent(booking.manageToken)}` : ''
      navigate(`/confirm/${booking.id}${tokenQuery}`, { state: { booking, store: res.store || res.settings || null } })
    } catch (err) {
      // 409：時段剛被訂滿或重複下單 → 退回選時段步驟並重新載入可訂時段
      if (err.status === 409) {
        setError({ submit: err.message })
        setStep('availability')
        loadAvailability(data.date)
        window.scrollTo(0, 0)
      } else {
        setError({ submit: err.message || '訂位失敗，請稍後再試' })
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-chicken-red/5 via-chicken-cream to-white pb-36">
      <header className="sticky top-0 z-30 border-b border-chicken-brown/10 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3">
          <button
            onClick={() => step === 'info' ? setStep('availability') : navigate('/')}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-chicken-brown/5 text-chicken-brown transition hover:bg-chicken-brown/10"
            aria-label="返回"
          >
            <ChevronLeft size={22} />
          </button>
          <div className="flex-1">
            <div className="text-base font-black text-chicken-brown">線上訂位</div>
            <div className="text-xs font-bold text-chicken-brown/55">
              {step === 'availability' ? '選擇人數、日期與時段' : '填寫聯絡資訊'}
            </div>
          </div>
          <button
            type="button"
            onClick={() => navigate('/lookup')}
            className="hidden items-center gap-1.5 rounded-full bg-chicken-red/10 px-3 py-1 text-xs font-black text-chicken-red transition hover:bg-chicken-red/15 sm:flex"
          >
            <Search size={13} />
            查詢訂位
          </button>
          <div className="hidden rounded-full bg-chicken-red/10 px-3 py-1 text-xs font-black text-chicken-red sm:block">
            立即確認
          </div>
        </div>
      </header>

      <main className="mx-auto grid w-full max-w-5xl gap-5 px-4 py-5 lg:grid-cols-[1fr_340px]">
        {/* step 切換刻意不用 AnimatePresence mode="wait"：framer-motion 11.x 有多個
            「exit 完成回呼遺失 → 新畫面永不掛載」的已知 bug（12.x 才修），手機上會整片白屏
            且不拋例外、ErrorBoundary 攔不到。改用 key 重掛 + 純 CSS 進場動畫，
            新畫面的顯示不依賴任何 JS 動畫回呼。 */}
        {step === 'availability' ? (
          <section key="availability" className="animate-soft-enter space-y-4">
            <HeroPanel />
            <PartyPanel guests={data.guests} onSetGuests={setGuests} />
            <CalendarPicker dates={dates} value={data.date} onChange={setDate} />
            {error.submit && (
              <div className="surface border border-chicken-red/30 bg-chicken-red/5 p-4 text-sm font-bold text-chicken-red">
                {error.submit}
              </div>
            )}
            <TimeGrid
              groupedSlots={groupedSlots}
              value={data.timeSlot}
              guests={data.guests}
              settings={settings}
              loading={slotsLoading}
              error={slotsError}
              onChange={(time) => set('timeSlot', time)}
              onFindNext={findNextAvailable}
              findingNext={findingNext}
              findNextMsg={findNextMsg}
            />
          </section>
        ) : (
          <section key="info" className="animate-soft-enter space-y-4">
            <div className="surface p-5">
              <div className="mb-1 text-xs font-black text-chicken-red">最後一步</div>
              <h1 className="text-2xl font-black text-chicken-brown">留下聯絡資訊</h1>
              <p className="mt-2 text-sm leading-6 text-chicken-brown/65">
                送出後會立即建立訂位紀錄。到店時出示訂位編號即可。
              </p>
            </div>

            {error.submit && (
              <div className="surface border border-chicken-red/30 bg-chicken-red/5 p-4 text-sm font-bold text-chicken-red">
                {error.submit}
              </div>
            )}

            <div className="surface space-y-4 p-5">
              <Input
                label="姓名"
                value={data.name}
                onChange={e => { set('name', e.target.value); if (error.name) setError(p => ({ ...p, name: undefined })) }}
                placeholder="王小姐"
                error={error.name}
              />
              <Input
                label="電話"
                type="tel"
                inputMode="numeric"
                value={data.phone}
                onChange={e => { set('phone', e.target.value); if (error.phone) setError(p => ({ ...p, phone: undefined })) }}
                onBlur={() => {
                  const v = data.phone.trim()
                  if (v && !isValidTwPhone(v)) setError(p => ({ ...p, phone: '電話格式不正確，請輸入正確的台灣電話號碼' }))
                }}
                placeholder="0912345678"
                error={error.phone}
              />

              <div>
                <label className="label">特殊需求（可複選）</label>
                <div className="grid grid-cols-3 gap-2">
                  {NOTE_OPTIONS.map(option => {
                    const active = data.notes[option.key]
                    return (
                      <button
                        type="button"
                        key={option.key}
                        onClick={() => toggleNote(option.key)}
                        className={`min-h-[48px] rounded-xl border px-2 text-sm font-bold transition-all ${
                          active
                            ? 'border-chicken-red bg-chicken-red text-white shadow-sm'
                            : 'border-chicken-brown/15 bg-white text-chicken-brown hover:border-chicken-red/40'
                        }`}
                      >
                        {option.label}
                      </button>
                    )
                  })}
                </div>
              </div>

              <Textarea
                label="備註（選填）"
                value={data.notes.text}
                onChange={e => set('notes', { ...data.notes, text: e.target.value })}
                placeholder="例：靠窗、慶生、過敏、長輩需剪雞肉..."
              />
            </div>

            {/* LINE-first 信任訊號：LIFF 內已識別身分 → 告知訂位卡片會自動送達 */}
            {lineIdentity && (
              lineIdentity.friendFlag === false ? (
                <div className="rounded-2xl border border-chicken-yellow/40 bg-chicken-yellow/10 px-4 py-3 text-sm font-bold leading-6 text-chicken-brown">
                  完成訂位後加入官方帳號好友，即可在 LINE 收到訂位卡片與異動通知。
                </div>
              ) : (
                <div className="rounded-2xl border border-[#06C755]/30 bg-[#06C755]/10 px-4 py-3 text-sm font-black leading-6 text-[#06A848]">
                  ✓ 訂位卡片將自動傳送到您的 LINE{lineIdentity.displayName ? `（${lineIdentity.displayName}）` : ''}
                </div>
              )
            )}
          </section>
        )}

        <aside className="lg:sticky lg:top-[86px] lg:h-fit">
          <BookingSummary
            data={data}
            settings={settings}
            ready={selectedReady}
            step={step}
            busy={busy}
            canSubmit={canSubmit}
            onEdit={() => setStep('availability')}
            onContinue={continueToInfo}
            onSubmit={submit}
          />
        </aside>
      </main>

      <MobileActionBar
        data={data}
        settings={settings}
        ready={selectedReady}
        step={step}
        busy={busy}
        canSubmit={canSubmit}
        onEdit={() => setStep('availability')}
        onContinue={continueToInfo}
        onSubmit={submit}
      />
    </div>
  )
}

function HeroPanel() {
  return (
    <div className="surface relative overflow-hidden p-5">
      <motion.div
        aria-hidden
        className="absolute right-5 top-5 h-16 w-16 rounded-full bg-chicken-red/10"
        animate={{ scale: [1, 1.08, 1], opacity: [0.55, 0.9, 0.55] }}
        transition={{ duration: 3.2, repeat: Infinity, ease: 'easeInOut' }}
      />
      <div className="relative">
        <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-chicken-red/10 px-3 py-1 text-xs font-black text-chicken-red">
          <Sparkles size={14} />
          即時可訂時段
        </div>
        <h1 className="text-3xl font-black leading-tight text-chicken-brown">找一張適合您的餐桌</h1>
        <p className="mt-3 max-w-xl text-sm leading-6 text-chicken-brown/65">
          48 小時冷藏文昌雞。送出後立即建立訂位紀錄，到店由現場為您安排座位，出示訂位編號即可。
        </p>
        <Link to="/lookup" className="mt-4 inline-flex items-center gap-2 text-sm font-black text-chicken-red underline underline-offset-4 sm:hidden">
          <Search size={16} />
          查詢 / 修改已有訂位
        </Link>
      </div>
    </div>
  )
}

function PartyPanel({ guests, onSetGuests }) {
  return (
    <section className="surface p-5">
      <SectionTitle icon={Users} title="幾位用餐？" hint="最多 12 位，更多人數可於備註說明" />
      <div className="mt-4 flex items-center gap-3">
        <button className="btn-secondary flex h-12 w-12 items-center justify-center !p-0 disabled:opacity-40 disabled:cursor-not-allowed" onClick={() => onSetGuests(guests - 1)} disabled={guests <= 1} aria-label="減少人數">
          <Minus size={18} />
        </button>
        <motion.div
          key={guests}
          initial={{ scale: 0.92 }}
          animate={{ scale: 1 }}
          className="flex-1 rounded-xl border border-chicken-brown/10 bg-white px-4 py-3 text-center"
        >
          <span className="text-3xl font-black tabular-nums text-chicken-brown">{guests}</span>
          <span className="ml-1 text-sm font-bold text-chicken-brown/55">位</span>
        </motion.div>
        <button className="btn-secondary flex h-12 w-12 items-center justify-center !p-0 disabled:opacity-40 disabled:cursor-not-allowed" onClick={() => onSetGuests(guests + 1)} disabled={guests >= 12} aria-label="增加人數">
          <Plus size={18} />
        </button>
      </div>
      <div className="mt-3 grid grid-cols-4 gap-2">
        {QUICK_GUESTS.map(g => (
          <button
            key={g}
            onClick={() => onSetGuests(g)}
            className={`rounded-xl border px-3 py-2 text-sm font-black transition-all ${
              guests === g ? 'border-chicken-red bg-chicken-red text-white' : 'border-chicken-brown/15 bg-white text-chicken-brown/65'
            }`}
          >
            {g} 位
          </button>
        ))}
      </div>
    </section>
  )
}

function CalendarPicker({ dates, value, onChange }) {
  const availableMap = useMemo(() => {
    const map = new Map()
    dates.forEach(date => map.set(date.value, date))
    return map
  }, [dates])
  const [monthCursor, setMonthCursor] = useState(() => {
    const base = new Date((value || todayStr()) + 'T00:00:00')
    return new Date(base.getFullYear(), base.getMonth(), 1)
  })

  const today = todayStr()
  const monthKey = `${monthCursor.getFullYear()}-${String(monthCursor.getMonth() + 1).padStart(2, '0')}`
  const monthLabel = `${monthCursor.getFullYear()} 年 ${monthCursor.getMonth() + 1} 月`
  const firstAvailable = dates[0]?.value
  const lastAvailable = dates[dates.length - 1]?.value
  const canPrev = firstAvailable && monthKey > firstAvailable.slice(0, 7)
  const canNext = lastAvailable && monthKey < lastAvailable.slice(0, 7)

  const cells = useMemo(() => {
    const y = monthCursor.getFullYear()
    const m = monthCursor.getMonth()
    const first = new Date(y, m, 1)
    const start = new Date(y, m, 1 - first.getDay())
    return Array.from({ length: 42 }, (_, i) => {
      const d = addDays(start, i)
      const date = formatDate(d)
      const meta = availableMap.get(date)
      return {
        date,
        day: d.getDate(),
        inMonth: d.getMonth() === m,
        isToday: date === today,
        isWeekend: [0, 6].includes(d.getDay()),
        available: Boolean(meta),
      }
    })
  }, [availableMap, monthCursor, today])

  const shiftMonth = (dir) => {
    setMonthCursor(current => new Date(current.getFullYear(), current.getMonth() + dir, 1))
  }

  return (
    <section className="surface p-5">
      <div className="flex items-start justify-between gap-3">
        <SectionTitle icon={CalendarDays} title="哪一天用餐？" hint="點選日期後，下方會顯示當天可訂時段" />
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => shiftMonth(-1)}
            disabled={!canPrev}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-chicken-brown/10 bg-white text-chicken-brown disabled:opacity-30"
            aria-label="上一個月"
          >
            ‹
          </button>
          <button
            type="button"
            onClick={() => shiftMonth(1)}
            disabled={!canNext}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-chicken-brown/10 bg-white text-chicken-brown disabled:opacity-30"
            aria-label="下一個月"
          >
            ›
          </button>
        </div>
      </div>

      <div
        key={monthKey}
        className="animate-soft-enter mt-4 overflow-hidden rounded-xl border border-chicken-brown/10 bg-white"
      >
        <div className="flex items-center justify-between border-b border-chicken-brown/10 px-4 py-3">
          <div className="text-base font-black text-chicken-brown">{monthLabel}</div>
          <div className="text-xs font-bold text-chicken-brown/50">
            {value ? `已選 ${dayLabel(value)}` : '請選擇日期'}
          </div>
        </div>
        <div className="grid grid-cols-7 border-b border-chicken-brown/10 bg-chicken-cream/60">
          {WEEKDAYS.map(day => (
            <div key={day} className={`py-2 text-center text-xs font-black ${day === '日' || day === '六' ? 'text-chicken-red' : 'text-chicken-brown/55'}`}>
              {day}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {cells.map(cell => {
            const active = value === cell.date
            const disabled = !cell.available
          return (
            <motion.button
              key={cell.date}
              type="button"
              onClick={() => !disabled && onChange(cell.date)}
              disabled={disabled}
              aria-pressed={active}
              aria-label={`${dayLabel(cell.date)}${cell.isToday ? '（今天）' : ''}${disabled ? '，暫不可預訂' : '，可預訂'}`}
              whileTap={!disabled ? { scale: 0.95 } : undefined}
              className={`relative min-h-[58px] border-b border-r border-chicken-brown/10 p-1 text-center transition-all sm:min-h-[72px] ${
                active ? 'bg-chicken-red text-white' :
                disabled ? 'bg-chicken-brown/[0.02] text-chicken-brown/20' :
                cell.isToday ? 'bg-chicken-yellow/10 text-chicken-brown hover:bg-chicken-red/5' :
                cell.isWeekend ? 'bg-white text-chicken-red hover:bg-chicken-red/5' :
                'bg-white text-chicken-brown hover:bg-chicken-red/5'
              } ${!cell.inMonth ? 'opacity-35' : ''}`}
            >
              <div className="flex h-full flex-col items-center justify-center">
                <div className="text-lg font-black tabular-nums sm:text-xl">{cell.day}</div>
                <div className={`mt-0.5 text-[10px] font-black ${active ? 'text-white/80' : disabled ? 'text-chicken-brown/20' : cell.isToday ? 'text-chicken-yellow' : 'text-chicken-brown/45'}`}>
                  {cell.isToday ? '今天' : disabled ? '—' : '可訂'}
                </div>
              </div>
            </motion.button>
          )
        })}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-3 text-xs font-bold text-chicken-brown/50">
        <span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-chicken-red" />已選日期</span>
        <span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-chicken-yellow" />今天</span>
        <span>灰色日期暫不可預訂</span>
      </div>
    </section>
  )
}

function TimeGrid({ groupedSlots, value, guests, settings, loading, error, onChange, onFindNext, findingNext, findNextMsg }) {
  const total = groupedSlots.午餐.length + groupedSlots.晚餐.length

  return (
    <section className="surface p-5">
      <SectionTitle icon={Clock} title="選擇抵達時間" hint={bookingOccupancyLabel(settings)} />
      {loading ? (
        <SlotSkeleton />
      ) : error ? (
        <div className="empty-panel mt-4" role="alert">
          <div className="mb-2 text-3xl">⚠️</div>
          <p className="font-bold text-chicken-brown">{error}</p>
          <p className="mt-1 text-sm text-chicken-brown/60">請稍後再試，或來電由專人為您訂位。</p>
        </div>
      ) : total === 0 ? (
        <div className="empty-panel mt-4">
          <div className="text-3xl mb-2">📅</div>
          <p className="font-bold text-chicken-brown">這天目前沒有可訂時段</p>
          <p className="mt-1 text-sm text-chicken-brown/60">可以讓系統幫你找最近一個還有空位的日期。</p>
          <button
            type="button"
            onClick={onFindNext}
            disabled={findingNext}
            className="btn-primary mx-auto mt-4 inline-flex items-center gap-2 disabled:opacity-60"
          >
            {findingNext ? '搜尋中...' : `幫我找最近可訂日（${guests} 位）`}
          </button>
          {findNextMsg && <p className="mt-3 text-sm font-bold text-chicken-red">{findNextMsg}</p>}
        </div>
      ) : (
        <div className="mt-4 space-y-5">
          {Object.entries(groupedSlots).map(([period, slots]) => (
            slots.length > 0 && (
              <div key={period}>
                <div className="mb-2 flex items-center gap-2">
                  <div className="text-xs font-black text-chicken-brown/55">{period}</div>
                  <div className="h-px flex-1 bg-chicken-brown/10" />
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {slots.map(slot => {
                    const active = value === slot.time
                    const scarce = slot.remaining <= Math.max(guests * 2, 12)
                    return (
                      <motion.button
                        key={slot.time}
                        onClick={() => onChange(slot.time)}
                        aria-pressed={active}
                        aria-label={`${slot.time} 抵達，${scarce ? '少量名額' : '可訂位'}`}
                        whileTap={{ scale: 0.97 }}
                        className={`relative min-h-[74px] rounded-xl border-2 px-3 py-3 text-left transition-all ${
                          active
                            ? 'border-chicken-red bg-chicken-red text-white shadow-md'
                            : 'border-chicken-brown/15 bg-white text-chicken-brown hover:border-chicken-red/45'
                        }`}
                      >
                        <div className="text-lg font-black tabular-nums">{slot.time}</div>
                        <div className={`mt-1 text-[11px] font-black ${active ? 'text-white/85' : scarce ? 'text-chicken-yellow' : 'text-chicken-green'}`}>
                          {scarce ? '少量名額' : '可訂位'}
                        </div>
                        {active && (
                          <span
                            className="animate-check-pop absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-white text-chicken-red"
                          >
                            <Check size={14} strokeWidth={3} />
                          </span>
                        )}
                      </motion.button>
                    )
                  })}
                </div>
              </div>
            )
          ))}
        </div>
      )}
    </section>
  )
}

function BookingSummary({ data, settings, ready, step, busy, canSubmit, onEdit, onContinue, onSubmit }) {
  return (
    <motion.div layout className="hidden rounded-2xl border border-chicken-brown/10 bg-white p-5 shadow-sm lg:block">
      <div className="mb-4 flex items-center gap-2 text-sm font-black text-chicken-brown">
        <ShieldCheck size={18} className="text-chicken-red" />
        訂位摘要
      </div>
      <SummaryRows data={data} settings={settings} />
      <div className="mt-4 rounded-xl bg-chicken-cream px-3 py-2 text-xs leading-5 text-chicken-brown/65">
        {bookingOccupancyLabel(settings)}。若有特殊需求，請於備註說明。
      </div>
      <div className="mt-4 space-y-2">
        {step === 'availability' ? (
          <button disabled={!ready} onClick={onContinue} className="btn-primary w-full">
            {ready ? '填寫聯絡資訊' : '請先選擇時段'}
          </button>
        ) : (
          <>
            <button disabled={!canSubmit || busy} onClick={onSubmit} className="btn-primary w-full">
              {busy ? '送出中...' : '完成訂位'}
            </button>
            <button onClick={onEdit} className="btn-secondary w-full">修改人數 / 日期 / 時間</button>
          </>
        )}
      </div>
    </motion.div>
  )
}

function MobileActionBar({ data, ready, step, busy, canSubmit, onEdit, onContinue, onSubmit }) {
  return (
    <div data-testid="mobile-action-bar" className="fixed inset-x-0 bottom-0 z-30 border-t border-chicken-brown/10 bg-white/95 backdrop-blur lg:hidden safe-bottom">
      <div className="mx-auto max-w-md px-4 py-3">
        <div className="mb-2 flex items-center justify-between text-xs">
          <span className="font-bold text-chicken-brown/55">目前選擇</span>
          <span className="font-black text-chicken-brown">
            {data.guests} 位 · {data.date ? dayLabel(data.date) : '選日期'} · {data.timeSlot || '選時段'}
          </span>
        </div>
        {step === 'availability' ? (
          <button disabled={!ready} onClick={onContinue} className="btn-primary w-full">
            {ready ? '填寫聯絡資訊' : '請先選擇可訂時段'}
          </button>
        ) : (
          <div className="flex gap-2">
            <button onClick={onEdit} className="btn-secondary px-4">修改</button>
            <button disabled={!canSubmit || busy} onClick={onSubmit} className="btn-primary flex-1">
              {busy ? '送出中...' : '完成訂位'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function SectionTitle({ icon: Icon, title, hint }) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-chicken-red/10 text-chicken-red">
        <Icon size={20} />
      </div>
      <div>
        <h2 className="text-lg font-black text-chicken-brown">{title}</h2>
        {hint && <p className="mt-0.5 text-xs font-bold text-chicken-brown/50">{hint}</p>}
      </div>
    </div>
  )
}

function SummaryRows({ data, settings }) {
  return (
    <div className="space-y-2 text-sm">
      <SummaryLine label="人數" value={`${data.guests} 位`} />
      <SummaryLine label="日期" value={data.date ? dayLabel(data.date) : '尚未選擇'} />
      <SummaryLine label="時間" value={data.timeSlot || '尚未選擇'} />
      <SummaryLine label="確認" value="送出即建立訂位" />
      <SummaryLine label="電話" value={settings.storePhone || '049-2753377'} icon={Phone} />
    </div>
  )
}

function SummaryLine({ label, value, icon: Icon }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl bg-chicken-brown/5 px-3 py-2">
      <span className="inline-flex items-center gap-1.5 text-chicken-brown/55">
        {Icon && <Icon size={13} />}
        {label}
      </span>
      <span className="text-right font-black text-chicken-brown">{value}</span>
    </div>
  )
}
