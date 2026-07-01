import { useState, useEffect, useMemo, useRef } from 'react'
import MonthCalendar from '../booking/MonthCalendar'
import TimeSlotPicker from '../booking/TimeSlotPicker'
import { Card, Input, Textarea, Button } from '../ui'
import { useToast } from '../ui/Toast'
import { useBooking } from '../../contexts/BookingContext'
import { useAuth } from '../../contexts/AuthContext'
import * as customerService from '../../services/customerService'
import { getNoshowCount } from '../../services/bookingService'
import * as seatingService from '../../services/seatingService'
import { todayStr, dayLabel, formatDate, addDays } from '../../utils/timeSlots'

// 後台新增訂位 — 電話為先導鍵，自動帶顧客檔
// 設計：緊湊單頁、由上而下一路填完；缺漏欄位即時列在底部黏性操作列（點 pill 捲到該欄）；
// 日期用「今天/明天/後天」chips 快選、月曆預設收合（解決日期區佔版面、難以定位缺漏的問題）。
// 註：旅行社團體請走「規劃」分頁的預排流程（整桌容量把關 + 回傳單），不再用單筆 group 訂位，
// 避免與團體預排的容量重複計算。
const SOURCE_OPTIONS = [
  { value: 'phone',  label: '📞 電話' },
  { value: 'line',   label: '💚 LINE' },
  { value: 'walkin', label: '🚶 現場' },
  { value: 'online', label: '🌐 線上代訂' },
]

const NOTE_OPTIONS = [
  { key: 'pet',      label: '🐾 寵物' },
  { key: 'child',    label: '👶 兒童' },
  { key: 'mobility', label: '♿ 行動不便' },
]

const QUICK_GUESTS = [1, 2, 3, 4, 5, 6, 7, 8]

export default function AddBookingView({ onCreated, onAssignTable }) {
  const { bookings, tables, groupReservations, settings, addBooking, suggestTable } = useBooking()
  const { user } = useAuth()
  const toast = useToast()

  const [phone, setPhone] = useState('')
  const [source, setSource] = useState('phone')
  const [name, setName] = useState('')
  const [guests, setGuests] = useState(2)
  const [moreGuests, setMoreGuests] = useState(false)
  const [date, setDate] = useState(todayStr())
  const [showCalendar, setShowCalendar] = useState(false)
  const [timeSlot, setTimeSlot] = useState('')
  const [notes, setNotes] = useState({ pet: false, child: false, mobility: false, text: '' })
  const [autoAssign, setAutoAssign] = useState(true)
  const [busy, setBusy] = useState(false)
  const [attempted, setAttempted] = useState(false) // 按過提交才顯示欄位級紅框

  const phoneRef = useRef(null)
  const nameRef = useRef(null)
  const guestsRef = useRef(null)
  const slotRef = useRef(null)

  // 自動帶顧客檔
  const matchedCustomer = useMemo(() => {
    if (phone.length < 4) return null
    const c = customerService.getByPhone(phone)
    if (c) return c
    // 部分模糊：用 search
    const matches = customerService.search(phone)
    return matches.length === 1 ? matches[0] : null
  }, [phone])

  const noshowCount = phone ? getNoshowCount(phone) : 0

  // 偵測 customer 自動填
  useEffect(() => {
    if (matchedCustomer && !name) {
      setName(matchedCustomer.name || '')
      if (matchedCustomer.notes && !notes.text) {
        setNotes(n => ({ ...n, text: matchedCustomer.notes }))
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchedCustomer?.phone])

  // 換日重設時段
  useEffect(() => { setTimeSlot('') }, [date])

  // 缺漏清單：底部黏性列即時顯示「還差哪幾欄」，點 pill 捲到該欄
  const missing = useMemo(() => [
    !phone.trim() && { key: 'phone', label: '電話', ref: phoneRef },
    !name.trim() && { key: 'name', label: '姓名', ref: nameRef },
    !(guests > 0) && { key: 'guests', label: '人數', ref: guestsRef },
    !timeSlot && { key: 'slot', label: '時段', ref: slotRef },
  ].filter(Boolean), [phone, name, guests, timeSlot])
  const valid = missing.length === 0

  const scrollToField = (m) => m.ref.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })

  // 日期快選 chips：今天 / 明天 / 後天 / 其他日期（展開緊湊月曆）
  const quickDates = useMemo(() => {
    const base = new Date()
    return [0, 1, 2].map(i => {
      const d = formatDate(addDays(base, i))
      return { date: d, label: i === 0 ? '今天' : i === 1 ? '明天' : '後天', sub: dayLabel(d) }
    })
  }, [])
  const isQuickDate = quickDates.some(q => q.date === date)

  const handleSubmit = async () => {
    if (!valid) {
      setAttempted(true)
      scrollToField(missing[0])
      return toast.error(`還差：${missing.map(m => m.label).join('、')}`)
    }
    setBusy(true)
    try {
      const b = addBooking({
        name, phone, guests, date, timeSlot, notes,
        source,
        status: 'confirmed',
        createdBy: user?.email || 'staff',
      })
      // 自動指派最佳桌（查今日即時空桌——僅今天的訂位適用；未來日請用規劃頁預配）
      if (autoAssign && date === todayStr()) {
        const best = suggestTable(guests)
        if (best) {
          const r = seatingService.assignBookingToTable(b.id, best.number)
          if (r.ok) toast.success(`✅ ${name} ${guests} 位 · ${date} ${timeSlot} · 已自動指派 ${best.number}`)
          else toast.action(`✅ 已建立訂位（自動指派失敗：${r.error}）`, { label: '手動指派', onClick: () => onAssignTable?.(b) })
        } else {
          toast.action(`✅ 已建立訂位（無可自動指派的桌）`, { label: '手動指派', onClick: () => onAssignTable?.(b) })
        }
      } else {
        toast.action(`✅ ${name} ${guests} 位 · ${date} ${timeSlot} 已建立`,
          { label: date === todayStr() ? '指派桌' : '預配桌位', onClick: () => onAssignTable?.(b) })
      }
      // 重設（保留 source）
      setPhone(''); setName(''); setGuests(2); setMoreGuests(false); setTimeSlot('')
      setNotes({ pet: false, child: false, mobility: false, text: '' })
      setAutoAssign(true); setAttempted(false); setShowCalendar(false)
      onCreated?.(b)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3 max-w-3xl mx-auto">
      {/* === ① 客人 === */}
      <Card>
        <h2 className="font-bold text-chicken-brown mb-3">📱 客人資訊</h2>
        <div className="space-y-3">
          <div ref={phoneRef} className="relative">
            <Input
              label="電話（鍵入時自動帶顧客檔）"
              type="tel"
              inputMode="numeric"
              value={phone}
              onChange={e => setPhone(e.target.value)}
              placeholder="0912345678"
              error={attempted && !phone.trim() ? '必填' : ''}
            />
            {(matchedCustomer || noshowCount > 0) && (
              <div className="mt-2 flex flex-wrap gap-2 text-xs">
                {matchedCustomer && (
                  <span className="px-2.5 py-1 bg-chicken-green/15 text-chicken-green rounded-full font-bold">
                    🔄 第 {(matchedCustomer.visits || 0) + 1} 次 · 上次 {new Date(matchedCustomer.lastVisit).toLocaleDateString('zh-TW')}
                  </span>
                )}
                {matchedCustomer?.vipTier && matchedCustomer.vipTier !== 'none' && (
                  <span className="px-2.5 py-1 bg-chicken-yellow/20 text-chicken-yellow rounded-full font-bold">
                    ⭐ {matchedCustomer.vipTier.toUpperCase()}
                  </span>
                )}
                {matchedCustomer?.allergies && (
                  <span className="px-2.5 py-1 bg-chicken-red/10 text-chicken-red rounded-full font-bold">
                    ⚠️ 過敏：{matchedCustomer.allergies}
                  </span>
                )}
                {noshowCount > 0 && (
                  <span className="px-2.5 py-1 bg-chicken-red text-white rounded-full font-bold">
                    ⚠️ no-show ×{noshowCount}
                  </span>
                )}
                {matchedCustomer?.blacklisted && (
                  <span className="px-2.5 py-1 bg-chicken-red text-white rounded-full font-bold">
                    🚫 黑名單：{matchedCustomer.blacklistReason || ''}
                  </span>
                )}
              </div>
            )}
          </div>
          <div ref={nameRef}>
            <Input label="姓名" value={name} onChange={e => setName(e.target.value)} placeholder="王小姐"
              error={attempted && !name.trim() ? '必填' : ''} />
          </div>
          {/* 來源：chips 取代下拉（少一次點擊、省高度） */}
          <div>
            <label className="label">來源</label>
            <div className="flex gap-1.5 flex-wrap">
              {SOURCE_OPTIONS.map(o => (
                <button key={o.value} type="button" onClick={() => setSource(o.value)}
                  className={`px-3 py-2 rounded-xl border-2 text-sm font-bold transition-all ${
                    source === o.value
                      ? 'border-chicken-red bg-chicken-red/10 text-chicken-red'
                      : 'border-chicken-brown/15 bg-white text-chicken-brown/70'}`}>
                  {o.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </Card>

      {/* === ② 人數 · 日期 · 時段 === */}
      <Card>
        <h2 className="font-bold text-chicken-brown mb-3">🍲 用餐資訊</h2>
        <div className="space-y-4">
          {/* 人數：1–8 快選 + 更多 */}
          <div ref={guestsRef}>
            <label className="label">人數</label>
            <div className="flex gap-1.5 flex-wrap items-center">
              {QUICK_GUESTS.map(n => (
                <button key={n} type="button" onClick={() => { setGuests(n); setMoreGuests(false) }}
                  className={`w-11 h-11 rounded-xl border-2 text-sm font-black tabular-nums transition-all ${
                    guests === n && !moreGuests
                      ? 'border-chicken-red bg-chicken-red text-white'
                      : 'border-chicken-brown/15 bg-white text-chicken-brown'}`}>
                  {n}
                </button>
              ))}
              {moreGuests || guests > 8 ? (
                <select
                  value={guests}
                  onChange={e => setGuests(Number(e.target.value))}
                  className="input w-28 !py-2.5 font-bold"
                >
                  {Array.from({ length: 22 }, (_, i) => i + 9).map(n => (
                    <option key={n} value={n}>{n} 位</option>
                  ))}
                </select>
              ) : (
                <button type="button" onClick={() => { setMoreGuests(true); setGuests(9) }}
                  className="px-3 h-11 rounded-xl border-2 border-chicken-brown/15 bg-white text-sm font-bold text-chicken-brown/70">
                  9+ ▾
                </button>
              )}
            </div>
            <p className="text-xs text-chicken-brown/55 mt-1">已選：{guests} 位{guests >= 9 ? '（大桌建議改走規劃分頁的團體預排）' : ''}</p>
          </div>

          {/* 日期：今天/明天/後天 chips + 其他日期（展開緊湊月曆） */}
          <div>
            <label className="label">日期</label>
            <div className="flex gap-1.5 flex-wrap">
              {quickDates.map(q => (
                <button key={q.date} type="button"
                  onClick={() => { setDate(q.date); setShowCalendar(false) }}
                  className={`px-3 py-2 rounded-xl border-2 text-sm font-bold transition-all ${
                    date === q.date
                      ? 'border-chicken-red bg-chicken-red text-white'
                      : 'border-chicken-brown/15 bg-white text-chicken-brown'}`}>
                  {q.label}
                  <span className={`block text-[10px] font-bold ${date === q.date ? 'text-white/80' : 'text-chicken-brown/50'}`}>{q.sub}</span>
                </button>
              ))}
              <button type="button" onClick={() => setShowCalendar(s => !s)}
                className={`px-3 py-2 rounded-xl border-2 text-sm font-bold transition-all ${
                  !isQuickDate
                    ? 'border-chicken-red bg-chicken-red/10 text-chicken-red'
                    : 'border-chicken-brown/15 bg-white text-chicken-brown/70'}`}>
                📅 選月曆
                <span className="block text-[10px] font-bold opacity-70">
                  {!isQuickDate ? `已選 ${dayLabel(date)}` : showCalendar ? '收合 ▴' : '可排數月後 ▾'}
                </span>
              </button>
            </div>
            {showCalendar && (
              <div className="mt-2 animate-soft-enter">
                <MonthCalendar value={date} onChange={(d) => { setDate(d); setShowCalendar(false) }} />
              </div>
            )}
          </div>

          {/* 時段 */}
          <div ref={slotRef} className={attempted && !timeSlot ? 'rounded-xl ring-2 ring-chicken-red/40 p-2 -m-2' : ''}>
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
            {attempted && !timeSlot && <p className="text-xs text-chicken-red font-bold mt-1">請選時段</p>}
          </div>
        </div>
      </Card>

      {/* === ③ 備註 === */}
      <Card>
        <h2 className="font-bold text-chicken-brown mb-3">📝 特殊需求（選填）</h2>
        <div className="grid grid-cols-3 gap-2 mb-3">
          {NOTE_OPTIONS.map(n => {
            const active = notes[n.key]
            return (
              <button
                type="button"
                key={n.key}
                onClick={() => setNotes(p => ({ ...p, [n.key]: !p[n.key] }))}
                className={`px-3 py-2.5 rounded-xl border-2 transition-all text-sm font-bold ${
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
        <Textarea
          value={notes.text}
          onChange={e => setNotes(p => ({ ...p, text: e.target.value }))}
          placeholder="例：靠窗、慶生、剪雞肉服務、長輩需軟食..."
        />
      </Card>

      {/* === 底部黏性操作列：精簡單列、半透明避免遮擋上方選日期/時段；
             自動指派僅今天才有意義 → 只在今天顯示，未來日（多為團體）直接收起 === */}
      <div className="sticky bottom-20 lg:bottom-3 z-20 pt-2">
        <div className="rounded-2xl border border-chicken-brown/10 bg-white/95 p-2.5 shadow-lg backdrop-blur">
          {date === todayStr() && (
            <label className="mb-2 flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={autoAssign}
                onChange={e => setAutoAssign(e.target.checked)}
                className="h-4 w-4"
              />
              <span className="text-xs font-bold text-chicken-brown/80">建立後立刻自動指派最佳桌（可手動修改）</span>
            </label>
          )}
          {missing.length > 0 && (
            <div className="mb-2 flex flex-wrap items-center gap-1.5 text-xs">
              <span className="font-bold text-chicken-brown/55">還差</span>
              {missing.map(m => (
                <button key={m.key} type="button" onClick={() => scrollToField(m)}
                  className="rounded-full bg-chicken-red/10 px-2 py-0.5 font-black text-chicken-red hover:bg-chicken-red/20">
                  {m.label}
                </button>
              ))}
            </div>
          )}
          <Button onClick={handleSubmit} disabled={!valid || busy} className="w-full min-h-[44px]">
            {busy ? '建立中...'
              : valid ? `✅ 確認新增 · ${dayLabel(date)} ${timeSlot} · ${guests} 位`
              : `還差：${missing.map(m => m.label).join('、')}`}
          </Button>
        </div>
      </div>
    </div>
  )
}
