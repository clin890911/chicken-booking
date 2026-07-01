import { useMemo } from 'react'
import { diffMin, stageOf } from '../../../utils/diningStage'

// 桌況「摘要」視圖：以「可坐存量 + 依可操作狀態分組」快速回答『現在能坐多少、哪些要處理』。
// 不估剩餘時間；用餐中僅顯示已用餐分鐘（超時轉紅）。tables 已由父層依樓層過濾。
export default function TableSummaryView({ tables, groupHoldTables = {}, settings = {}, onSelectTable }) {
  const data = useMemo(() => {
    const active = tables.filter(t => t.isActive !== false && !t.outage && !t.outNote)
    const vacant = [], dining = [], cleaning = [], held = []
    active.forEach(t => {
      if (groupHoldTables[t.number] && t.status === 'vacant') { held.push(t); return }
      if (t.status === 'vacant') vacant.push(t)
      else if (t.status === 'dining') dining.push(t)
      else if (t.status === 'cleaning') cleaning.push(t)
    })
    const tier = (c) => (c <= 2 ? '2' : c <= 4 ? '4' : c <= 6 ? '6' : '大')
    const stock = { 2: 0, 4: 0, 6: 0, 大: 0 }
    vacant.forEach(t => { stock[tier(t.capacity)]++ })
    const totalCap = active.reduce((s, t) => s + (t.capacity || 0), 0)
    const usedCap = dining.reduce((s, t) => s + (t.capacity || 0), 0)
    const pct = totalCap ? Math.round((usedCap / totalCap) * 100) : 0
    const openSeats = vacant.reduce((s, t) => s + (t.capacity || 0), 0)
    return { vacant, dining, cleaning, held, stock, pct, openSeats }
  }, [tables, groupHoldTables, settings])

  const Chip = ({ t, cls, sub, subCls }) => (
    <button onClick={() => onSelectTable?.(t.number)}
      className={`inline-flex flex-col items-center justify-center min-w-[56px] px-2 py-1.5 rounded-xl border-2 ${cls}`}>
      <span className="text-sm font-black leading-none">{t.number}</span>
      <span className={`text-[10px] font-bold mt-0.5 ${subCls || ''}`}>{sub}</span>
    </button>
  )

  const stockCards = [['2', '2 人桌'], ['4', '4 人桌'], ['6', '6 人桌'], ['大', '大桌']]

  return (
    <div className="h-full min-h-0 overflow-y-auto pr-1 space-y-3">
      {/* 可坐存量 */}
      <div className="grid grid-cols-4 gap-2">
        {stockCards.map(([k, label]) => (
          <div key={k} className="bg-chicken-cream rounded-xl p-2 text-center">
            <div className={`text-2xl font-black ${data.stock[k] > 0 ? 'text-chicken-green' : 'text-chicken-brown/30'}`}>{data.stock[k]}</div>
            <div className="text-[10px] text-chicken-brown/60">{label}可坐</div>
          </div>
        ))}
      </div>

      {/* 使用率 */}
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-chicken-brown/60 whitespace-nowrap">座位使用率</span>
        <div className="flex-1 h-2 rounded-full bg-chicken-brown/10 overflow-hidden">
          <div className="h-full bg-chicken-yellow" style={{ width: `${data.pct}%` }} />
        </div>
        <span className="text-[11px] font-bold tabular-nums">{data.pct}%</span>
      </div>

      {/* 可坐 */}
      <Section title={`可坐（${data.vacant.length} 桌 · ${data.openSeats} 席）`} color="text-chicken-green" empty={data.vacant.length === 0}>
        {data.vacant.map(t => (
          <Chip key={t.number} t={t} sub={`${t.capacity} 人`} subCls="text-chicken-green"
            cls="border-chicken-green bg-chicken-green/10 text-chicken-brown" />
        ))}
      </Section>

      {/* 用餐中（超時轉紅） */}
      <Section title={`用餐中（${data.dining.length}）`} color="text-chicken-brown/60" empty={data.dining.length === 0}>
        {data.dining.map(t => {
          const m = t.seatedAt ? diffMin(t.seatedAt) : 0
          const stage = stageOf(m, settings)
          const over = stage === 'overtime' || stage === 'buffer-overtime'
          return (
            <Chip key={t.number} t={t} sub={`${over ? '⚠ ' : ''}${m} 分`} subCls={over ? 'text-chicken-red' : 'text-chicken-brown/50'}
              cls={over ? 'border-chicken-red/50 bg-chicken-red/8 text-chicken-red' : 'border-chicken-brown/15 bg-chicken-cream text-chicken-brown/70'} />
          )
        })}
      </Section>

      {/* 待清 */}
      <Section title={`待清（${data.cleaning.length}）`} color="text-amber-700" empty={data.cleaning.length === 0}>
        {data.cleaning.map(t => (
          <Chip key={t.number} t={t} sub="待清" subCls="text-amber-700"
            cls="border-amber-500/50 bg-amber-200/50 text-amber-800" />
        ))}
      </Section>

      {/* 團體保留 */}
      {data.held.length > 0 && (
        <Section title={`團體保留（${data.held.length}）`} color="text-indigo-700" empty={false}>
          {data.held.map(t => (
            <Chip key={t.number} t={t} sub="團保" subCls="text-indigo-700"
              cls="border-indigo-300 bg-indigo-100 text-indigo-800" />
          ))}
        </Section>
      )}
    </div>
  )
}

function Section({ title, color, empty, children }) {
  return (
    <div>
      <div className={`text-xs font-bold mb-1.5 ${color}`}>{title}</div>
      {empty ? (
        <p className="text-[11px] text-chicken-brown/35">—</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">{children}</div>
      )}
    </div>
  )
}
