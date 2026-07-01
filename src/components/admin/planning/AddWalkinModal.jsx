import { useState, useMemo, useEffect } from 'react'
import { Modal, Input } from '../../ui'
import { useToast } from '../../ui/Toast'
import TimeSlotPicker from '../../booking/TimeSlotPicker'
import { useBooking } from '../../../contexts/BookingContext'
import { useAuth } from '../../../contexts/AuthContext'
import * as customerService from '../../../services/customerService'
import { getNoshowCount } from '../../../services/bookingService'
import { dayLabel } from '../../../utils/timeSlots'

// 規劃頁「快速新增散客」：與「新增團單」並列，留在規劃頁、日期鎖定當日。
// 建立 confirmed 散客 booking（與訂位分頁同 addBooking 口徑），存檔後立即出現在右側當日散客名單。
const QUICK_GUESTS = [1, 2, 3, 4, 5, 6, 7, 8]

export default function AddWalkinModal({ open, onClose, date, onCreated }) {
  const { settings, tables, bookings, groupReservations, addBooking } = useBooking()
  const { user } = useAuth()
  const toast = useToast()

  const [guests, setGuests] = useState(2)
  const [moreGuests, setMoreGuests] = useState(false)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [timeSlot, setTimeSlot] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [attempted, setAttempted] = useState(false)

  // 顧客自動帶入（電話為先導鍵，與訂位新增同邏輯）
  const matchedCustomer = useMemo(() => {
    if (phone.length < 4) return null
    const c = customerService.getByPhone(phone)
    if (c) return c
    const matches = customerService.search(phone)
    return matches.length === 1 ? matches[0] : null
  }, [phone])
  const noshowCount = phone ? getNoshowCount(phone) : 0

  useEffect(() => {
    if (matchedCustomer && !name) setName(matchedCustomer.name || '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchedCustomer?.phone])

  // 切換日期時清掉已選時段（避免帶到別日的時段）
  useEffect(() => { setTimeSlot('') }, [date])

  const reset = () => {
    setGuests(2); setMoreGuests(false); setName(''); setPhone(''); setTimeSlot(''); setNotes('')
    setAttempted(false)
  }
  const handleClose = () => { reset(); onClose?.() }

  const valid = name.trim() && timeSlot && guests > 0

  const handleSubmit = async () => {
    if (!valid) {
      setAttempted(true)
      if (!name.trim()) return toast.error('請填姓名')
      return toast.error('請選時段')
    }
    setBusy(true)
    try {
      const b = addBooking({
        name: name.trim(), phone: phone.trim(), guests, date, timeSlot,
        notes: { text: notes.trim() },
        source: 'phone',
        status: 'confirmed',
        createdBy: user?.email || 'staff',
      })
      toast.success(`✅ ${name.trim()} ${guests} 位 · ${dayLabel(date)} ${timeSlot} 已新增`)
      onCreated?.(b)
      reset()
      onClose?.()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={handleClose} title={`➕ 新增散客 · ${dayLabel(date)}`} footer={
      <>
        <button onClick={handleClose} className="btn-secondary px-4 py-2">取消</button>
        <button onClick={handleSubmit} disabled={!valid || busy} className="btn-primary px-4 py-2 disabled:opacity-50">
          {busy ? '建立中…' : valid ? '✅ 確認新增' : '請填姓名與時段'}
        </button>
      </>
    }>
      <div className="space-y-4">
        {/* 人數 */}
        <div>
          <label className="label">人數</label>
          <div className="flex gap-1.5 flex-wrap items-center">
            {QUICK_GUESTS.map(n => (
              <button key={n} type="button" onClick={() => { setGuests(n); setMoreGuests(false) }}
                className={`w-11 h-11 rounded-xl border-2 text-base font-black tabular-nums transition-all ${
                  guests === n && !moreGuests
                    ? 'border-chicken-red bg-chicken-red text-white'
                    : 'border-chicken-brown/15 bg-white text-chicken-brown'}`}>
                {n}
              </button>
            ))}
            {moreGuests || guests > 8 ? (
              <select value={guests} onChange={e => setGuests(Number(e.target.value))} className="input w-24 !py-2.5 font-bold">
                {Array.from({ length: 22 }, (_, i) => i + 9).map(n => <option key={n} value={n}>{n} 位</option>)}
              </select>
            ) : (
              <button type="button" onClick={() => { setMoreGuests(true); setGuests(9) }}
                className="px-3 h-11 rounded-xl border-2 border-chicken-brown/15 bg-white text-sm font-bold text-chicken-brown/70">9+ ▾</button>
            )}
          </div>
        </div>

        {/* 聯絡 */}
        <Input label="姓名" value={name} onChange={e => setName(e.target.value)} placeholder="王小姐"
          error={attempted && !name.trim() ? '必填' : ''} />
        <div>
          <Input label="電話（選填，輸入自動帶顧客檔）" type="tel" inputMode="numeric" value={phone}
            onChange={e => setPhone(e.target.value)} placeholder="0912345678" />
          {(matchedCustomer || noshowCount > 0) && (
            <div className="mt-2 flex flex-wrap gap-2 text-xs">
              {matchedCustomer && (
                <span className="px-2.5 py-1 bg-chicken-green/15 text-chicken-green rounded-full font-bold">
                  🔄 第 {(matchedCustomer.visits || 0) + 1} 次
                </span>
              )}
              {matchedCustomer?.vipTier && matchedCustomer.vipTier !== 'none' && (
                <span className="px-2.5 py-1 bg-chicken-yellow/20 text-chicken-yellow rounded-full font-bold">⭐ {matchedCustomer.vipTier.toUpperCase()}</span>
              )}
              {matchedCustomer?.allergies && (
                <span className="px-2.5 py-1 bg-chicken-red/10 text-chicken-red rounded-full font-bold">⚠️ 過敏：{matchedCustomer.allergies}</span>
              )}
              {noshowCount > 0 && (
                <span className="px-2.5 py-1 bg-chicken-red text-white rounded-full font-bold">⚠️ no-show ×{noshowCount}</span>
              )}
            </div>
          )}
        </div>

        {/* 時段（依當日容量） */}
        <div className={attempted && !timeSlot ? 'rounded-xl ring-2 ring-chicken-red/40 p-2 -m-2' : ''}>
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

        <Input label="備註（選填）" value={notes} onChange={e => setNotes(e.target.value)} placeholder="例：靠窗、慶生、過敏" />
      </div>
    </Modal>
  )
}
