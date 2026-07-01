import { useState, useEffect } from 'react'
import { Input } from '../../ui'
import { useToast } from '../../ui/Toast'
import { useBooking } from '../../../contexts/BookingContext'
import GuestCountField from '../GuestCountField'
import NumericKeypad from './NumericKeypad'
import ReturningGuestBadges, { useMatchedCustomer } from '../ReturningGuestBadges'

// 現場常駐「立即帶位」面板（取代 WalkInSeatModal 彈窗）：
// 電話帶顧客檔 → 大數字鍵盤 → 人數 → 即時「可坐判定」→ 選座位帶入。
// onStart(guestData) 回傳 false（無合適空桌）時維持欄位，方便改人數 / 改候位。
export default function FastWalkInPanel({ onStart }) {
  const toast = useToast()
  const { suggestTable, suggestTableCombo } = useBooking()
  const [guests, setGuests] = useState(2)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [notes, setNotes] = useState('')
  const matched = useMatchedCustomer(phone)

  // 電話帶到顧客 → 自動帶姓名（不覆蓋店員已手動輸入的）
  useEffect(() => {
    if (matched && !name) setName(matched.name || '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matched?.phone])

  // 即時可坐判定（不估時間）：有單桌→建議桌；否則同層可併→需併桌；再否則→改候位
  const g = Number(guests) || 0
  const single = g > 0 ? suggestTable(g) : null
  let verdict = null
  if (g > 0) {
    if (single) verdict = { tone: 'ok', icon: '✅', text: `現在可坐 → 建議 ${single.number}` }
    else {
      const combo = suggestTableCombo(g)
      verdict = combo.enough
        ? { tone: 'multi', icon: '🪑', text: `無單桌可容 → 需併桌（約 ${combo.tableNumbers?.length || 2} 桌）` }
        : { tone: 'none', icon: '⏳', text: '目前座位不足 → 建議改候位取號' }
    }
  }
  const V = {
    ok: 'bg-chicken-green/15 text-chicken-green border-chicken-green/40',
    multi: 'bg-amber-500/10 text-amber-700 border-amber-500/40',
    none: 'bg-chicken-red/10 text-chicken-red border-chicken-red/40',
  }

  const start = () => {
    if (!(guests > 0)) return toast.error('請選人數')
    const nm = name.trim() || matched?.name || ''
    const allergyNote = matched?.allergies ? `過敏：${matched.allergies}` : ''
    const noteText = [notes.trim(), allergyNote].filter(Boolean).join('；')
    const ok = onStart?.({ name: nm, phone: phone.trim(), guests, notes: noteText })
    if (ok !== false) { setGuests(2); setName(''); setPhone(''); setNotes('') }
  }

  return (
    <div className="space-y-3">
      <div className="text-sm font-black text-chicken-brown flex items-center gap-1.5">🪑 立即帶位</div>

      <div>
        <label className="label !mb-1">電話（自動帶顧客檔）</label>
        <Input type="tel" inputMode="numeric" value={phone}
          onChange={e => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
          placeholder="0912345678" className="text-lg font-bold tracking-wide" />
        <ReturningGuestBadges phone={phone} matched={matched} />
      </div>

      <NumericKeypad value={phone} onChange={setPhone} />

      <Input label="姓名" value={name} onChange={e => setName(e.target.value)} placeholder="散客" />

      <div>
        <GuestCountField value={guests} onChange={setGuests} accent="amber" />
      </div>

      <Input label="備註（選填）" value={notes} onChange={e => setNotes(e.target.value)} placeholder="例：靠窗、慶生、過敏" />

      {verdict && (
        <div className={`rounded-xl border px-3 py-2 text-sm font-bold ${V[verdict.tone]}`}>
          {verdict.icon} {guests} 位 · {verdict.text}
        </div>
      )}

      <button onClick={start}
        className="w-full min-h-[46px] rounded-xl bg-chicken-red text-white font-black shadow hover:bg-chicken-red/90 active:scale-[.98] transition-all">
        選座位帶入 →
      </button>
    </div>
  )
}
