import { useMemo } from 'react'
import { Modal } from '../../ui'
import { useBooking } from '../../../contexts/BookingContext'
import { normalize } from '../../../services/customerService'
import { getNoshowCount } from '../../../services/bookingService'
import { STATUS_MAP, SOURCE_MAP } from '../../booking/BookingCard'

const VIP_LABEL = { none: '一般', bronze: '銅卡', silver: '銀卡', gold: '金卡' }

function fmtDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit' })
}
// booking.notes 可能是字串或 { text, pet, child, mobility }
function noteText(n) { return typeof n === 'string' ? n : (n?.text || '') }

// 顧客詳情：指標彙總 + 完整來訪記錄時間軸（點名冊顧客卡開啟）。
// 歷史直接由 bookings 依 normalized phone 過濾，無需後端。
export default function CustomerDetailModal({ customer, onClose, onAddBooking, onEdit }) {
  const { bookings } = useBooking()
  const c = customer

  const history = useMemo(() => {
    if (!c) return []
    const key = normalize(c.phone)
    return bookings
      .filter(b => normalize(b.phone) === key)
      .sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.timeSlot || '').localeCompare(a.timeSlot || ''))
  }, [bookings, c])

  if (!c) return null
  const noshow = getNoshowCount(c.phone)
  const avg = c.visits > 0 ? (c.totalGuests / c.visits).toFixed(1) : '0'
  const metrics = [
    { v: c.visits || 0, l: '來訪次數' },
    { v: c.totalGuests || 0, l: '累計人數' },
    { v: avg, l: '平均/次' },
    { v: noshow, l: 'no-show', danger: noshow > 0 },
  ]

  return (
    <Modal
      open={!!c}
      onClose={onClose}
      title={`${c.name || '未填姓名'} · 顧客檔`}
      footer={<button onClick={onClose} className="btn-secondary px-4 py-2">關閉</button>}
    >
      <div className="space-y-3">
        <div className="text-sm text-chicken-brown/70">📱 {c.phone}</div>
        <div className="flex flex-wrap gap-1.5">
          <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-chicken-yellow/20 text-chicken-yellow">{VIP_LABEL[c.vipTier || 'none']}</span>
          {c.allergies && <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-chicken-red/10 text-chicken-red">⚠️ {c.allergies}</span>}
          {c.blacklisted && <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-chicken-red text-white">黑名單</span>}
        </div>
        {c.notes && <p className="text-xs text-chicken-brown/70 italic">「{c.notes}」</p>}

        <div className="grid grid-cols-4 gap-2">
          {metrics.map(m => (
            <div key={m.l} className="bg-chicken-cream rounded-xl p-2 text-center">
              <div className={`text-xl font-black ${m.danger ? 'text-chicken-red' : 'text-chicken-brown'}`}>{m.v}</div>
              <div className="text-[10px] text-chicken-brown/60">{m.l}</div>
            </div>
          ))}
        </div>

        <div className="flex gap-2">
          <button onClick={() => onAddBooking?.(c)} className="btn-primary flex-1 !py-2 text-sm">➕ 新增訂位</button>
          <button onClick={() => onEdit?.(c)} className="btn-secondary flex-1 !py-2 text-sm">✏️ 編輯備註</button>
        </div>

        <div>
          <div className="text-sm font-bold text-chicken-brown mb-1.5">
            來訪記錄 <span className="text-chicken-brown/50 font-normal">{history.length} 筆</span>
          </div>
          {history.length === 0 ? (
            <p className="text-xs text-chicken-brown/50 py-3 text-center">尚無訂位紀錄</p>
          ) : (
            <div className="space-y-1.5">
              {history.map(b => {
                const st = STATUS_MAP[b.status] || STATUS_MAP.pending
                const nt = noteText(b.notes)
                return (
                  <div key={b.id} className="border-b border-chicken-brown/10 pb-1.5">
                    <div className="flex items-center gap-2 text-xs">
                      <span className="font-bold tabular-nums w-[92px] shrink-0">{fmtDate(b.date)}</span>
                      <span className="text-chicken-brown/60 w-10 shrink-0">{b.timeSlot || '—'}</span>
                      <span className="font-bold shrink-0">{b.guests} 位</span>
                      {b.assignedTableId && <span className="text-chicken-brown/60 shrink-0">桌 {b.assignedTableId}</span>}
                      <span className="text-chicken-brown/45 shrink-0">{SOURCE_MAP[b.source] || b.source || ''}</span>
                      <span className={`ml-auto shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full ${st.color}`}>{st.label}</span>
                    </div>
                    {nt && <p className="text-[11px] text-chicken-brown/60 mt-0.5 pl-[92px]">「{nt}」</p>}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}
