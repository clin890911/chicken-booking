import { useState, useEffect, useMemo } from 'react'
import DatePicker from '../booking/DatePicker'
import TimeSlotPicker from '../booking/TimeSlotPicker'
import { Card, Input, Select, Textarea, Button } from '../ui'
import { useToast } from '../ui/Toast'
import { useBooking } from '../../contexts/BookingContext'
import { useAuth } from '../../contexts/AuthContext'
import * as customerService from '../../services/customerService'
import { getNoshowCount } from '../../services/bookingService'
import * as seatingService from '../../services/seatingService'
import { todayStr, dayLabel } from '../../utils/timeSlots'

// 後台新增訂位 — 電話為先導鍵，自動帶顧客檔
// 設計：Single page、smart-fill、min taps to create
// 註：旅行社團體請走「團體」分頁的預排流程（整桌容量把關 + 回傳單），不再用單筆 group 訂位，
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

export default function AddBookingView({ onCreated, onAssignTable }) {
  const { bookings, tables, groupReservations, settings, addBooking, suggestTable } = useBooking()
  const { user } = useAuth()
  const toast = useToast()

  const [phone, setPhone] = useState('')
  const [source, setSource] = useState('phone')
  const [name, setName] = useState('')
  const [guests, setGuests] = useState(2)
  const [date, setDate] = useState(todayStr())
  const [timeSlot, setTimeSlot] = useState('')
  const [notes, setNotes] = useState({ pet: false, child: false, mobility: false, text: '' })
  const [autoAssign, setAutoAssign] = useState(true)
  const [busy, setBusy] = useState(false)

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

  const valid = phone.trim() && name.trim() && timeSlot && guests > 0

  const handleSubmit = async () => {
    if (!valid) {
      if (!phone.trim()) return toast.error('請填電話')
      if (!name.trim()) return toast.error('請填姓名')
      if (!timeSlot) return toast.error('請選時段')
      return toast.error('資料不完整')
    }
    setBusy(true)
    try {
      const b = addBooking({
        name, phone, guests, date, timeSlot, notes,
        source,
        status: 'confirmed',
        createdBy: user?.email || 'staff',
      })
      // 自動指派最佳桌
      if (autoAssign) {
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
          { label: '指派桌', onClick: () => onAssignTable?.(b) })
      }
      // 重設（保留 source）
      setPhone(''); setName(''); setGuests(2); setTimeSlot(''); setNotes({ pet: false, child: false, mobility: false, text: '' })
      setAutoAssign(true)
      onCreated?.(b)
    } finally {
      setBusy(false)
    }
  }

  const guestOpts = Array.from({ length: 20 }, (_, i) => ({ value: i + 1, label: `${i + 1} 位` }))

  return (
    <div className="space-y-3 max-w-3xl mx-auto">
      {/* === 客人 === */}
      <Card>
        <h2 className="font-bold text-chicken-brown mb-3">📱 客人資訊</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2 relative">
            <Input
              label="電話（鍵入時自動帶顧客檔）"
              type="tel"
              inputMode="numeric"
              value={phone}
              onChange={e => setPhone(e.target.value)}
              placeholder="0912345678"
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
          <Input label="姓名" value={name} onChange={e => setName(e.target.value)} placeholder="王小姐" />
          <Select label="來源" value={source} onChange={e => setSource(e.target.value)} options={SOURCE_OPTIONS} />
        </div>
      </Card>

      {/* === 訂位 === */}
      <Card>
        <h2 className="font-bold text-chicken-brown mb-3">🍲 用餐資訊</h2>
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Select
              label="人數"
              value={guests}
              onChange={e => setGuests(Number(e.target.value))}
              options={guestOpts}
            />
          </div>
          <div>
            <label className="label">日期</label>
            <DatePicker value={date} onChange={setDate} maxDaysAhead={settings.maxDaysAhead} />
            <p className="text-xs text-chicken-brown/60 mt-1">已選：{dayLabel(date)}</p>
          </div>
          <div>
            <label className="label">時段</label>
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
        </div>
      </Card>

      {/* === 備註 === */}
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

      {/* === 自動指派 + 提交 === */}
      <Card>
        <label className="flex items-center gap-2 mb-3 cursor-pointer min-h-[44px]">
          <input
            type="checkbox"
            checked={autoAssign}
            onChange={e => setAutoAssign(e.target.checked)}
            className="w-5 h-5"
          />
          <span className="text-sm font-bold text-chicken-brown">建立後立刻自動指派最佳桌（可手動修改）</span>
        </label>
        <Button onClick={handleSubmit} disabled={!valid || busy} className="w-full text-base min-h-[44px]">
          {busy ? '建立中...' : timeSlot ? `✅ 確認新增訂位 · ${date} ${timeSlot}` : '請填完必填欄位'}
        </Button>
      </Card>
    </div>
  )
}
