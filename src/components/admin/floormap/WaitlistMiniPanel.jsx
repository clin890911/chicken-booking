import { useState } from 'react'
import { Modal, Input, Select } from '../../ui'
import { useToast, useConfirm } from '../../ui/Toast'
import { useBooking } from '../../../contexts/BookingContext'

// 候位側欄（精簡版，現場營運頁右側顯示）
// 完整候位管理在獨立的 WaitlistView
export default function WaitlistMiniPanel({ onSeatWaitlist }) {
  const { waitlist, addWaitlist, callWaitlist, leaveWaitlist } = useBooking()
  const toast = useToast()
  const confirm = useConfirm()
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({ name: '', phone: '', partySize: 2, notes: '' })

  const active = waitlist.filter(w => w.status === 'waiting' || w.status === 'called')

  const handleAdd = () => {
    if (!form.partySize || form.partySize < 1) return toast.warning('請填人數')
    addWaitlist(form)
    setShowAdd(false)
    setForm({ name: '', phone: '', partySize: 2, notes: '' })
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-bold text-chicken-brown text-sm">🚦 候位</h3>
        <button onClick={() => setShowAdd(true)} className="text-xs px-2.5 py-1 bg-chicken-red text-white rounded-md font-bold">
          + 取號
        </button>
      </div>

      {active.length === 0 ? (
        <div className="text-center py-6 text-xs text-chicken-brown/40">目前無人候位</div>
      ) : (
        <div className="space-y-2">
          {active.map(w => (
            <div
              key={w.id}
              className={`p-2.5 rounded-xl border-2 transition-all
                         ${w.status === 'called'
                           ? 'border-chicken-yellow bg-chicken-yellow/10'
                           : 'border-chicken-brown/10 bg-white'}`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-baseline gap-1.5 min-w-0 flex-1">
                  <span className="text-sm font-black text-chicken-red flex-shrink-0">#{w.queueNumber}</span>
                  <span className="text-sm font-bold truncate">{w.name}</span>
                  <span className="text-[10px] text-chicken-brown/60">{w.partySize} 位</span>
                </div>
                {w.status === 'called' && <span className="text-[10px] bg-chicken-yellow text-white px-1.5 py-0.5 rounded-full font-bold">已叫號</span>}
              </div>
              <div className="text-[10px] text-chicken-brown/50 mt-0.5">
                {w.phone || '—'} · 預估 {w.estimatedMin} 分
              </div>
              <div className="flex gap-1 mt-2">
                <button
                  onClick={() => onSeatWaitlist?.(w)}
                  className="flex-1 text-[11px] py-1 bg-chicken-green text-white rounded-md font-bold"
                >
                  入座
                </button>
                {w.status === 'waiting' && (
                  <button
                    onClick={() => callWaitlist(w.id)}
                    className="flex-1 text-[11px] py-1 bg-chicken-yellow text-white rounded-md font-bold"
                  >
                    叫號
                  </button>
                )}
                <button
                  onClick={async () => { if (await confirm('確定棄號？', { title: '棄號', danger: true, confirmLabel: '棄號' })) leaveWaitlist(w.id) }}
                  className="text-[11px] px-2 py-1 bg-chicken-brown/10 text-chicken-brown/60 rounded-md"
                >
                  ✕
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="現場候位取號" footer={
        <>
          <button onClick={() => setShowAdd(false)} className="btn-secondary px-4 py-2">取消</button>
          <button onClick={handleAdd} className="btn-primary px-4 py-2">取號</button>
        </>
      }>
        <div className="space-y-3">
          <Input label="姓名" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="王小姐" />
          <Input label="電話" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="0912345678" />
          <Select
            label="人數"
            value={form.partySize}
            onChange={e => setForm(f => ({ ...f, partySize: Number(e.target.value) }))}
            options={Array.from({ length: 12 }, (_, i) => ({ value: i + 1, label: `${i + 1} 位` }))}
          />
          <Input label="備註（選填）" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="例：靠窗、過敏" />
        </div>
      </Modal>
    </div>
  )
}
