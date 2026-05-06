import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import DatePicker from '../components/booking/DatePicker'
import TimeSlotPicker from '../components/booking/TimeSlotPicker'
import { Input, Textarea } from '../components/ui'
import { useBooking } from '../contexts/BookingContext'
import { dayLabel } from '../utils/timeSlots'

// 步驟式訂位頁：人數 → 日期 → 時段 → 個資
// 設計重點：
// 1. 手機優先、單欄、大按鈕
// 2. 每步只問一件事；上方顯示已選資訊（可點擊回去改）
// 3. 進度點顯示流程進度
// 4. 流暢動畫減少切換不適感

const STEPS = [
  { key: 'guests', label: '幾位用餐' },
  { key: 'date', label: '哪一天' },
  { key: 'time', label: '幾點到' },
  { key: 'info', label: '聯絡資訊' },
]

const NOTE_OPTIONS = [
  { key: 'pet', label: '🐾 攜帶寵物' },
  { key: 'child', label: '👶 有兒童' },
  { key: 'mobility', label: '♿ 行動不便' },
]

export default function BookingPage() {
  const navigate = useNavigate()
  const { bookings, tables, settings, addBooking } = useBooking()

  const [step, setStep] = useState(0)
  const [data, setData] = useState({
    guests: 0,
    date: '',
    timeSlot: '',
    name: '',
    phone: '',
    notes: { pet: false, child: false, mobility: false, text: '' },
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState({})

  const guestOptions = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]

  const set = (k, v) => setData(d => ({ ...d, [k]: v }))
  const toggleNote = (k) => setData(d => ({ ...d, notes: { ...d.notes, [k]: !d.notes[k] } }))

  const canNext = useMemo(() => {
    if (step === 0) return data.guests > 0
    if (step === 1) return !!data.date
    if (step === 2) return !!data.timeSlot
    if (step === 3) return data.name.trim() && /^[\d\-+\s]{7,}$/.test(data.phone.trim())
    return false
  }, [step, data])

  const next = () => {
    if (!canNext) return
    if (step < STEPS.length - 1) setStep(step + 1)
    else submit()
  }
  const back = () => setStep(s => Math.max(0, s - 1))
  const goTo = (i) => { if (i <= step) setStep(i) }

  const submit = async () => {
    const errs = {}
    if (!data.name.trim()) errs.name = '請填姓名'
    if (!data.phone.trim()) errs.phone = '請填電話'
    else if (!/^[\d\-+\s]{7,}$/.test(data.phone.trim())) errs.phone = '電話格式不正確'
    setError(errs)
    if (Object.keys(errs).length > 0) return
    setBusy(true)
    try {
      const b = addBooking({
        ...data,
        source: 'online',
        status: 'confirmed',
        createdBy: 'guest',
      })
      navigate(`/confirm/${b.id}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-chicken-cream via-chicken-cream to-white pb-36">
      {/* Compact Header */}
      <header className="bg-chicken-red text-white px-4 py-3 sticky top-0 z-30 shadow-md">
        <div className="max-w-md mx-auto flex items-center gap-3">
          <button onClick={() => step > 0 ? back() : navigate('/')}
                  className="text-white/80 hover:text-white text-xl">←</button>
          <div className="flex-1">
            <div className="text-base font-black leading-tight">線上訂位</div>
            <div className="text-[11px] opacity-80 leading-tight">{STEPS[step].label}</div>
          </div>
          <div className="text-[11px] font-bold opacity-90">{step + 1} / {STEPS.length}</div>
        </div>
      </header>

      {/* Progress dots */}
      <div className="max-w-md mx-auto px-4 pt-4">
        <div className="flex items-center gap-1.5">
          {STEPS.map((s, i) => (
            <div
              key={s.key}
              onClick={() => goTo(i)}
              className={`flex-1 h-1.5 rounded-full cursor-pointer transition-all ${
                i <= step ? 'bg-chicken-red' : 'bg-chicken-brown/15'
              }`}
            />
          ))}
        </div>
      </div>

      {/* Summary card (顯示已選資訊，點擊可返回該步) */}
      {step > 0 && (
        <div className="max-w-md mx-auto px-4 pt-4">
          <div className="surface p-3 space-y-1.5 text-xs">
            {data.guests > 0 && (
              <button onClick={() => goTo(0)}
                      className="w-full flex items-center justify-between text-left hover:bg-chicken-cream/50 -mx-1 px-1 py-0.5 rounded">
                <span className="text-chicken-brown/60">用餐人數</span>
                <span className="font-bold text-chicken-brown">{data.guests} 位 · 點擊修改</span>
              </button>
            )}
            {data.date && step > 1 && (
              <button onClick={() => goTo(1)}
                      className="w-full flex items-center justify-between text-left hover:bg-chicken-cream/50 -mx-1 px-1 py-0.5 rounded">
                <span className="text-chicken-brown/60">用餐日期</span>
                <span className="font-bold text-chicken-brown">{dayLabel(data.date)}</span>
              </button>
            )}
            {data.timeSlot && step > 2 && (
              <button onClick={() => goTo(2)}
                      className="w-full flex items-center justify-between text-left hover:bg-chicken-cream/50 -mx-1 px-1 py-0.5 rounded">
                <span className="text-chicken-brown/60">用餐時段</span>
                <span className="font-bold text-chicken-brown">{data.timeSlot}</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Step content */}
      <main className="max-w-md mx-auto px-4 pt-6">
        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.2 }}
          >
            {step === 0 && (
              <div>
                <h2 className="text-xl font-black text-chicken-brown mb-4">幾位用餐？</h2>
                <div className="grid grid-cols-4 gap-2">
                  {guestOptions.map(g => (
                    <button
                      key={g}
                      onClick={() => set('guests', g)}
                      className={`aspect-square rounded-2xl border-2 flex flex-col items-center justify-center text-2xl font-black transition-all ${
                        data.guests === g
                          ? 'border-chicken-red bg-chicken-red text-white shadow-md scale-105'
                          : 'border-chicken-brown/15 bg-white text-chicken-brown hover:border-chicken-red/40'
                      }`}
                    >
                      {g}
                      <span className="text-[10px] font-normal opacity-70 mt-0.5">位</span>
                    </button>
                  ))}
                </div>
                <p className="text-xs text-chicken-brown/50 mt-4 text-center">
                  超過 12 位請選 12 後在備註說明，或來電 04-XXXX-XXXX
                </p>
              </div>
            )}

            {step === 1 && (
              <div>
                <h2 className="text-xl font-black text-chicken-brown mb-4">哪一天用餐？</h2>
                <DatePicker value={data.date} onChange={(d) => set('date', d)} maxDaysAhead={settings.maxDaysAhead} />
                {data.date && (
                  <div className="mt-4 px-3 py-2 bg-chicken-green/10 rounded-xl text-xs text-chicken-green text-center">
                    已選：{dayLabel(data.date)}
                  </div>
                )}
              </div>
            )}

            {step === 2 && (
              <div>
                <h2 className="text-xl font-black text-chicken-brown mb-4">幾點到雞王？</h2>
                <TimeSlotPicker
                  date={data.date}
                  value={data.timeSlot}
                  onChange={(t) => set('timeSlot', t)}
                  settings={settings}
                  tables={tables}
                  bookings={bookings}
                  guests={data.guests}
                  hideFull
                />
                <p className="text-xs text-chicken-brown/50 mt-4 text-center">
                  ⏱ 用餐時段 90 分鐘 · 逾時 15 分恕不保留
                </p>
              </div>
            )}

            {step === 3 && (
              <div className="space-y-4">
                <h2 className="text-xl font-black text-chicken-brown">您的聯絡資訊</h2>
                <div className="rounded-xl border border-chicken-red/15 bg-white p-4">
                  <div className="mb-2 text-xs font-black text-chicken-red">訂位摘要</div>
                  <div className="grid gap-2 text-sm">
                    <SummaryLine label="人數" value={`${data.guests} 位`} />
                    <SummaryLine label="日期" value={dayLabel(data.date)} />
                    <SummaryLine label="時段" value={data.timeSlot} />
                    <SummaryLine label="規則" value="用餐 90 分鐘，逾時 15 分鐘釋出" />
                  </div>
                </div>
                <Input
                  label="姓名"
                  value={data.name}
                  onChange={e => set('name', e.target.value)}
                  placeholder="王小姐"
                  error={error.name}
                />
                <Input
                  label="電話"
                  type="tel"
                  inputMode="numeric"
                  value={data.phone}
                  onChange={e => set('phone', e.target.value)}
                  placeholder="0912345678"
                  error={error.phone}
                />
                <div>
                  <label className="label">特殊需求（可複選）</label>
                  <div className="grid grid-cols-3 gap-2">
                    {NOTE_OPTIONS.map(n => {
                      const active = data.notes[n.key]
                      return (
                        <button
                          type="button"
                          key={n.key}
                          onClick={() => toggleNote(n.key)}
                          className={`px-3 py-3 rounded-xl border-2 transition-all text-sm font-bold ${
                            active
                              ? 'border-chicken-red bg-chicken-red/10 text-chicken-red'
                              : 'border-chicken-brown/15 bg-white text-chicken-brown'
                          }`}
                        >
                          {n.label}
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
                <p className="rounded-xl bg-chicken-brown/5 px-3 py-2 text-xs leading-5 text-chicken-brown/65">
                  送出後會立即建立訂位紀錄。若需取消或更改，請來電通知同仁。
                </p>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Bottom action bar */}
      <div className="fixed bottom-0 inset-x-0 bg-white/95 backdrop-blur border-t border-chicken-brown/10 safe-bottom z-30">
        <div className="max-w-md mx-auto px-4 py-3 flex gap-2">
          {step > 0 && (
            <button onClick={back} className="btn-secondary px-6">← 上一步</button>
          )}
          <button
            onClick={next}
            disabled={!canNext || busy}
            className="btn-primary flex-1 text-base"
          >
            {busy ? '送出中...' : step === STEPS.length - 1 ? '✅ 完成訂位' : '下一步 →'}
          </button>
        </div>
      </div>
    </div>
  )
}

function SummaryLine({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-chicken-brown/55">{label}</span>
      <span className="text-right font-black text-chicken-brown">{value}</span>
    </div>
  )
}
