import { useState } from 'react'
import { Modal, Input, Select } from '../../ui'
import { useToast } from '../../ui/Toast'

// 「立即帶位」客人優先表單：填人數/姓名/電話 → 送出後由父層進入選桌模式（高亮空桌 + 建議桌）。
// 與 TableDrawer 的散客 modal 同風格，但這裡桌位未定，人數範圍 1–12。
const QUICK_GUESTS = [1, 2, 3, 4, 5, 6, 7, 8]

export default function WalkInSeatModal({ open, onClose, onStart }) {
  const toast = useToast()
  const [guests, setGuests] = useState(2)
  const [moreGuests, setMoreGuests] = useState(false)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [notes, setNotes] = useState('')

  const reset = () => { setGuests(2); setMoreGuests(false); setName(''); setPhone(''); setNotes('') }
  const handleClose = () => { reset(); onClose?.() }

  const handleStart = () => {
    if (!(guests > 0)) return toast.error('請選人數')
    // onStart 回傳 false（無合適空桌）時維持開啟，方便改人數
    const ok = onStart?.({ name: name.trim(), phone: phone.trim(), guests, notes: notes.trim() })
    if (ok !== false) reset()
  }

  return (
    <Modal open={open} onClose={handleClose} title="🪑 立即帶位" footer={
      <>
        <button onClick={handleClose} className="btn-secondary px-4 py-2">取消</button>
        <button onClick={handleStart} className="btn-primary px-4 py-2">選座位 →</button>
      </>
    }>
      <div className="space-y-4">
        {/* 人數：大數字 chips，最常用一鍵點 */}
        <div>
          <label className="label">人數</label>
          <div className="flex gap-1.5 flex-wrap items-center">
            {QUICK_GUESTS.map(n => (
              <button key={n} type="button" onClick={() => { setGuests(n); setMoreGuests(false) }}
                className={`w-11 h-11 rounded-xl border-2 text-base font-black tabular-nums transition-all ${
                  guests === n && !moreGuests
                    ? 'border-amber-500 bg-amber-500 text-white'
                    : 'border-chicken-brown/15 bg-white text-chicken-brown'}`}>
                {n}
              </button>
            ))}
            {moreGuests || guests > 8 ? (
              <Select
                value={guests}
                onChange={e => setGuests(Number(e.target.value))}
                options={Array.from({ length: 4 }, (_, i) => ({ value: i + 9, label: `${i + 9} 位` }))}
                className="w-24 !py-2.5 font-bold"
              />
            ) : (
              <button type="button" onClick={() => { setMoreGuests(true); setGuests(9) }}
                className="px-3 h-11 rounded-xl border-2 border-chicken-brown/15 bg-white text-sm font-bold text-chicken-brown/70">
                9+ ▾
              </button>
            )}
          </div>
          <p className="text-xs text-chicken-brown/55 mt-1">已選：{guests} 位</p>
        </div>

        <Input label="姓名" value={name} onChange={e => setName(e.target.value)} placeholder="散客" />
        <Input label="電話（選填）" type="tel" inputMode="numeric" value={phone} onChange={e => setPhone(e.target.value)} placeholder="0912345678" />
        <Input label="備註（選填）" value={notes} onChange={e => setNotes(e.target.value)} placeholder="例：靠窗、慶生、過敏" />
      </div>
    </Modal>
  )
}
