import { useState, useMemo } from 'react'
import { Modal, Card, EmptyState } from '../../ui'
import { useBooking } from '../../../contexts/BookingContext'

// 候位歷史與統計（低頻查閱）：今日四格統計 + 活躍/全部列表（唯讀）。
// 活躍候位的操作（入座/叫號/棄號）都在現場右側欄的候位籤，這裡只看不動。
const STATUS_LABELS = {
  waiting: '等待中',
  called: '已叫號',
  seated: '已入座',
  left: '已離開',
}
const STATUS_COLOR = {
  waiting: 'bg-amber-100 text-amber-800',
  called: 'bg-amber-100 text-amber-800',
  seated: 'bg-emerald-100 text-emerald-800',
  left: 'bg-chicken-brown/5 text-chicken-brown/40',
}

function fmtTime(d) {
  const t = new Date(d)
  return `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`
}

export default function WaitlistHistorySheet({ open, onClose }) {
  const { waitlist } = useBooking()
  const [filter, setFilter] = useState('all')   // all | active

  const sorted = useMemo(() => {
    return [...waitlist].sort((a, b) => (b.takenAt || '').localeCompare(a.takenAt || ''))
  }, [waitlist])

  const list = useMemo(() => {
    if (filter === 'active') return sorted.filter(w => w.status === 'waiting' || w.status === 'called')
    return sorted
  }, [sorted, filter])

  const stats = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10)
    const todayItems = sorted.filter(w => (w.takenAt || '').slice(0, 10) === today)
    return {
      waiting: todayItems.filter(w => w.status === 'waiting').length,
      called: todayItems.filter(w => w.status === 'called').length,
      seated: todayItems.filter(w => w.status === 'seated').length,
      left: todayItems.filter(w => w.status === 'left').length,
    }
  }, [sorted])

  return (
    <Modal open={open} onClose={onClose} title="🚦 候位歷史與統計">
      <div className="space-y-3">
        {/* 今日統計（順序：等待中→已叫號→已入座→已離開） */}
        <div className="grid grid-cols-4 gap-2">
          <Card className="!p-3 text-center"><div className="text-2xl font-black text-amber-700">{stats.waiting}</div><div className="text-[11px] text-chicken-brown/60">等待中</div></Card>
          <Card className={`!p-3 text-center ${stats.called > 0 ? 'border-amber-400 !border-2 bg-amber-50' : ''}`}><div className="text-2xl font-black text-amber-700">{stats.called}</div><div className="text-[11px] text-chicken-brown/60">已叫號</div></Card>
          <Card className="!p-3 text-center"><div className="text-2xl font-black text-emerald-600">{stats.seated}</div><div className="text-[11px] text-chicken-brown/60">已入座</div></Card>
          <Card className="!p-3 text-center"><div className="text-2xl font-black text-chicken-brown/40">{stats.left}</div><div className="text-[11px] text-chicken-brown/60">已離開</div></Card>
        </div>

        <div className="flex gap-1.5">
          <button
            onClick={() => setFilter('all')}
            className={`px-3 py-1.5 rounded-lg text-sm font-bold ${
              filter === 'all' ? 'bg-chicken-red text-white' : 'bg-white border border-chicken-brown/15 text-chicken-brown'
            }`}
          >全部</button>
          <button
            onClick={() => setFilter('active')}
            className={`px-3 py-1.5 rounded-lg text-sm font-bold ${
              filter === 'active' ? 'bg-chicken-red text-white' : 'bg-white border border-chicken-brown/15 text-chicken-brown'
            }`}
          >活躍中</button>
        </div>

        {list.length === 0 ? (
          <EmptyState icon="🚦" title={filter === 'active' ? '目前無人候位' : '尚無候位記錄'} />
        ) : (
          <div className="space-y-2 max-h-[50vh] overflow-y-auto pr-1">
            {list.map(w => (
              <div key={w.id} className="rounded-xl border border-chicken-brown/10 bg-white px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-baseline gap-2 min-w-0 flex-1 flex-wrap">
                    <span className="text-base font-black text-chicken-red">#{w.queueNumber}</span>
                    <span className="text-sm font-bold truncate">{w.name}</span>
                    <span className="text-xs text-chicken-brown/60">{w.partySize} 位</span>
                  </div>
                  <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full flex-shrink-0 ${STATUS_COLOR[w.status]}`}>
                    {STATUS_LABELS[w.status] || w.status}
                  </span>
                </div>
                <div className="text-xs text-chicken-brown/60 mt-0.5">
                  {w.phone || '—'} · 取號 {fmtTime(w.takenAt)}
                  {w.assignedTableNumber && <span className="ml-1 text-chicken-green font-bold">· 入座 {w.assignedTableNumber}</span>}
                  {w.notes && <span className="italic"> · 「{w.notes}」</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  )
}
