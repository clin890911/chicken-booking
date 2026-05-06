import { useState, useMemo } from 'react'
import { Card, Modal, Input, Select, EmptyState } from '../ui'
import { useBooking } from '../../contexts/BookingContext'

// 完整候位管理頁
// 包含：取號表單、活躍候位列表、歷史候位、入座/叫號/棄號操作
const STATUS_LABELS = {
  waiting: '等待中',
  called: '已叫號',
  seated: '已入座',
  left: '已離開',
}
const STATUS_COLOR = {
  waiting: 'bg-chicken-brown/10 text-chicken-brown',
  called: 'bg-chicken-yellow/15 text-chicken-yellow',
  seated: 'bg-chicken-green/15 text-chicken-green',
  left: 'bg-chicken-brown/5 text-chicken-brown/40',
}

function fmtTime(d) {
  const t = new Date(d)
  return `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`
}
function diffMin(d) {
  return Math.floor((Date.now() - new Date(d).getTime()) / 60000)
}

export default function WaitlistView({ onSeatWaitlist }) {
  const { waitlist, addWaitlist, callWaitlist, leaveWaitlist } = useBooking()
  const [showAdd, setShowAdd] = useState(false)
  const [filter, setFilter] = useState('active')   // active | all
  const [form, setForm] = useState({ name: '', phone: '', partySize: 2, notes: '' })

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

  const handleAdd = () => {
    if (!form.partySize || form.partySize < 1) return alert('請填人數')
    const w = addWaitlist(form)
    setShowAdd(false)
    setForm({ name: '', phone: '', partySize: 2, notes: '' })
    if (w?.queueNumber) {
      // 簡易確認（v1 改為 LINE 通知）
      setTimeout(() => alert(`✅ 已取號 #${w.queueNumber}\n預估等待 ${w.estimatedMin} 分`), 50)
    }
  }

  return (
    <div className="space-y-3">
      {/* 統計 */}
      <div className="grid grid-cols-4 gap-2">
        <Card className="!p-3 text-center"><div className="text-2xl font-black text-chicken-brown">{stats.waiting}</div><div className="text-[11px] text-chicken-brown/60">等待中</div></Card>
        <Card className="!p-3 text-center"><div className="text-2xl font-black text-chicken-yellow">{stats.called}</div><div className="text-[11px] text-chicken-brown/60">已叫號</div></Card>
        <Card className="!p-3 text-center"><div className="text-2xl font-black text-chicken-green">{stats.seated}</div><div className="text-[11px] text-chicken-brown/60">已入座</div></Card>
        <Card className="!p-3 text-center"><div className="text-2xl font-black text-chicken-brown/40">{stats.left}</div><div className="text-[11px] text-chicken-brown/60">已離開</div></Card>
      </div>

      <div className="flex items-center justify-between gap-2">
        <div className="flex gap-1.5">
          <button
            onClick={() => setFilter('active')}
            className={`px-3 py-1.5 rounded-lg text-sm font-bold ${
              filter === 'active' ? 'bg-chicken-red text-white' : 'bg-white border border-chicken-brown/15 text-chicken-brown'
            }`}
          >活躍中</button>
          <button
            onClick={() => setFilter('all')}
            className={`px-3 py-1.5 rounded-lg text-sm font-bold ${
              filter === 'all' ? 'bg-chicken-red text-white' : 'bg-white border border-chicken-brown/15 text-chicken-brown'
            }`}
          >全部</button>
        </div>
        <button onClick={() => setShowAdd(true)} className="btn-primary text-sm">新增取號</button>
      </div>

      {/* 候位列表 */}
      {list.length === 0 ? (
        <EmptyState icon="🚦" title={filter === 'active' ? '目前無人候位' : '尚無候位記錄'} />
      ) : (
        <div className="space-y-2">
          {list.map(w => (
            <Card key={w.id} className={`${w.status === 'called' ? 'border-chicken-yellow !border-2 bg-chicken-yellow/5' : ''}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="text-xl font-black text-chicken-red">#{w.queueNumber}</span>
                    <span className="text-base font-bold">{w.name}</span>
                    <span className="text-sm text-chicken-brown/60">{w.partySize} 位</span>
                    {(w.status === 'waiting' || w.status === 'called') && (
                      <span className="rounded-full bg-chicken-brown/5 px-2 py-0.5 text-[11px] font-bold text-chicken-brown/60">
                        建議 {w.partySize > 4 ? '六人桌' : '四人桌'}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-chicken-brown/60 mt-1">
                    {w.phone || '—'} · 取號 {fmtTime(w.takenAt)}
                    {(w.status === 'waiting' || w.status === 'called') && <span> · 已等 {diffMin(w.takenAt)} 分</span>}
                    {w.assignedTableNumber && <span className="ml-1 text-chicken-green font-bold">· 入座 {w.assignedTableNumber}</span>}
                  </div>
                  {w.notes && <div className="text-xs text-chicken-brown/60 italic mt-0.5">「{w.notes}」</div>}
                </div>
                <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                  <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${STATUS_COLOR[w.status]}`}>
                    {STATUS_LABELS[w.status]}
                  </span>
                </div>
              </div>
              {(w.status === 'waiting' || w.status === 'called') && (
                <div className="flex gap-2 mt-3">
                  <button
                    onClick={() => onSeatWaitlist?.(w)}
                    className="flex-1 bg-chicken-green hover:opacity-90 text-white font-bold py-2 rounded-lg text-sm"
                  >入座</button>
                  {w.status === 'waiting' && (
                    <button
                      onClick={() => callWaitlist(w.id)}
                      className="flex-1 bg-chicken-yellow hover:opacity-90 text-white font-bold py-2 rounded-lg text-sm"
                    >叫號</button>
                  )}
                  <button
                    onClick={() => { if (confirm('棄號？')) leaveWaitlist(w.id) }}
                    className="px-3 bg-chicken-brown/5 text-chicken-brown/60 rounded-lg text-sm"
                  >棄號</button>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      {/* 取號 Modal */}
      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="🚦 候位取號" footer={
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
