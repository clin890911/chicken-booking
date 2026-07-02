import { useMemo, useState } from 'react'
import { Modal } from '../../ui'

const GSTATUS = {
  planned: '預排', confirmed: '已確認', arrived: '已到', completed: '已完成', cancelled: '已取消',
}
const GSTATUS_COLOR = {
  planned: 'bg-amber-100 text-amber-800',
  confirmed: 'bg-emerald-50 text-emerald-700',
  arrived: 'bg-orange-100 text-orange-700',
  completed: 'bg-chicken-brown/10 text-chicken-brown/50',
}

// 匯出當前篩選後的來訪團體記錄為 CSV（含 BOM，Excel 中文不亂碼）。
function exportCsv(agency, rows) {
  const header = ['日期', '梯次', '人數', '導遊', '業績', '狀態']
  const body = rows.map(h => [
    h.date || '',
    (h.batches || []).map(b => b.timeSlot).filter(Boolean).join('/'),
    h.counts?.total || 0,
    h.guideName || '',
    h.spend || 0,
    GSTATUS[h.status] || h.status || '',
  ])
  const csv = [header, ...body]
    .map(r => r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n')
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${agency.name || '旅行社'}_來訪記錄.csv`
  a.click()
  URL.revokeObjectURL(url)
}

// 旅行社詳情：檔案 + 導遊 + 可篩選/匯出的來訪團體記錄。
// stats / guides 由父層（AgencyDirectoryView）算好傳入，避免重算。
export default function AgencyDetailModal({ agency, rank, stats, guides = [], onClose, onGoPlanning, onEdit }) {
  const [filter, setFilter] = useState('all') // all | completed | active
  const a = agency
  const history = stats?.history || []

  const rows = useMemo(() => {
    if (filter === 'completed') return history.filter(h => h.status === 'completed')
    if (filter === 'active') return history.filter(h => h.status !== 'completed')
    return history
  }, [history, filter])

  if (!a) return null
  const metrics = [
    { v: stats?.visits || 0, l: '來訪團次' },
    { v: stats?.totalGuests || 0, l: '累計人數' },
    { v: `$${(stats?.totalSpend || 0).toLocaleString()}`, l: '累計業績' },
    { v: stats?.lastVisit || '—', l: '最後來訪' },
  ]

  return (
    <Modal
      open={!!a}
      onClose={onClose}
      title={`${rank != null && rank < 3 ? ['🥇', '🥈', '🥉'][rank] + ' ' : ''}${a.name} · 旅行社`}
      footer={<button onClick={onClose} className="btn-secondary px-4 py-2">關閉</button>}
    >
      <div className="space-y-3">
        <div className="text-sm text-chicken-brown/70">
          📞 {a.phone || '—'}{a.contactName ? ` · 窗口 ${a.contactName}` : ''}{a.lineId ? ` · LINE ${a.lineId}` : ''}
        </div>
        {a.note && <p className="text-xs text-chicken-brown/70 italic">「{a.note}」</p>}

        <div className="grid grid-cols-4 gap-2">
          {metrics.map(m => (
            <div key={m.l} className="bg-chicken-cream rounded-xl p-2 text-center">
              <div className="text-base font-black text-chicken-brown tabular-nums">{m.v}</div>
              <div className="text-[10px] text-chicken-brown/60">{m.l}</div>
            </div>
          ))}
        </div>

        <div>
          <div className="text-xs font-bold text-chicken-brown/60 mb-1">導遊</div>
          <div className="flex flex-wrap gap-1.5">
            {guides.length === 0 && <span className="text-xs text-chicken-brown/40">尚無導遊</span>}
            {guides.map(g => (
              <span key={g.id} className="text-xs px-2.5 py-1 rounded-full bg-chicken-cream border border-chicken-brown/10 text-chicken-brown font-bold">
                🧑‍✈️ {g.name}{g.phone ? `（${g.phone}）` : ''}
              </span>
            ))}
          </div>
        </div>

        <div className="flex gap-2">
          <button onClick={() => onGoPlanning?.()} className="btn-primary flex-1 !py-2 text-sm">🗺️ 新增團體預排</button>
          {onEdit && <button onClick={() => onEdit(a)} className="btn-secondary flex-1 !py-2 text-sm">✏️ 編輯旅行社</button>}
        </div>

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <div className="text-sm font-bold text-chicken-brown">
              來訪團體記錄 <span className="text-chicken-brown/50 font-normal">{rows.length} 筆</span>
            </div>
            <button onClick={() => exportCsv(a, rows)} disabled={rows.length === 0}
              className="text-xs font-bold text-chicken-brown border border-chicken-brown/15 rounded-lg px-2.5 py-1 disabled:opacity-40">
              ⬇ 匯出 CSV
            </button>
          </div>
          <div className="flex gap-1.5 mb-2">
            {[{ v: 'all', l: '全部' }, { v: 'completed', l: '已完成' }, { v: 'active', l: '未完成' }].map(f => (
              <button key={f.v} onClick={() => setFilter(f.v)}
                className={`px-3 py-1 rounded-lg text-xs font-bold ${filter === f.v ? 'bg-chicken-red text-white' : 'bg-white border border-chicken-brown/15 text-chicken-brown'}`}>
                {f.l}
              </button>
            ))}
          </div>
          {rows.length === 0 ? (
            <p className="text-xs text-chicken-brown/50 py-3 text-center">無符合條件的記錄</p>
          ) : (
            <div className="space-y-1.5">
              {rows.map(h => {
                const stColor = GSTATUS_COLOR[h.status] || 'bg-chicken-brown/10 text-chicken-brown/50'
                return (
                  <div key={h.id} className="flex items-center gap-2 text-xs border-b border-chicken-brown/10 pb-1.5">
                    <span className="font-bold tabular-nums w-[86px] shrink-0">{h.date}</span>
                    <span className="text-chicken-brown/60 shrink-0">{(h.batches || []).map(b => b.timeSlot).filter(Boolean).join('/') || '—'}</span>
                    <span className="font-bold shrink-0">{h.counts?.total || 0} 人</span>
                    <span className="text-chicken-brown/55 shrink-0 truncate">導 {h.guideName || '—'}</span>
                    {h.spend > 0 && <span className="text-chicken-green font-bold shrink-0">${Number(h.spend).toLocaleString()}</span>}
                    <span className={`ml-auto shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full ${stColor}`}>{GSTATUS[h.status] || h.status}</span>
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
