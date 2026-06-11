import { useState } from 'react'
import { turnInPeriod } from '../../../utils/tableTurns'

// 現場頁「排程視圖」：仿 inline 桌圖——每張桌卡堆疊顯示當天每一批用餐（turns）。
// 與 SVG 桌況圖（FloorMap）並存切換；本視圖是「總覽／規劃」用途，不參與帶位模式。
// 色彩語義沿用現場圖：藍=待到店/保留、橘=用餐中、灰=已離席、靛=團體，與店員既有認知一致。

const PERIODS = [
  { key: 'all', label: '全天' },
  { key: 'lunch', label: '午餐 11–16' },
  { key: 'dinner', label: '晚餐 17–23' },
]

const TURN_STYLE = {
  seated:   { box: 'bg-orange-50 border-orange-400', text: 'text-orange-700', dot: 'bg-orange-500' },
  upcoming: { box: 'bg-sky-50 border-sky-300', text: 'text-sky-700', dot: 'bg-sky-500' },
  done:     { box: 'bg-chicken-brown/5 border-transparent', text: 'text-chicken-brown/45', dot: 'bg-chicken-brown/30' },
}
const GROUP_STYLE = { box: 'bg-indigo-50 border-indigo-300', text: 'text-indigo-700', dot: 'bg-indigo-500' }

const STATUS_DOT = {
  vacant: 'bg-emerald-500', reserved: 'bg-sky-500', dining: 'bg-orange-500',
  cleaning: 'bg-amber-500', blocked: 'bg-slate-400',
}

function TurnRow({ turn }) {
  const isGroup = turn.kind === 'group'
  const s = isGroup ? GROUP_STYLE : TURN_STYLE[turn.status] || TURN_STYLE.upcoming
  return (
    <div className={`flex items-center gap-1.5 rounded-md border-l-4 px-2 py-1 ${s.box}`}>
      <i className={`h-1.5 w-1.5 shrink-0 rounded-full ${s.dot}`} />
      <span className={`text-xs font-bold tabular-nums ${s.text}`}>{turn.time || '—'}</span>
      <span className={`min-w-0 truncate text-[11px] font-bold ${s.text}`}>
        {isGroup ? `團·${turn.label}` : turn.label}
      </span>
      <span className={`ml-auto shrink-0 text-[11px] font-bold ${s.text}`}>
        {isGroup ? (turn.batchLabel || `${turn.guests} 位`) : `${turn.guests} 位`}
      </span>
    </div>
  )
}

export default function TableScheduleView({ tables, turnsByTable, selectedTableNumber, onSelectTable }) {
  const [period, setPeriod] = useState('all')
  const floorTables = [...(tables || [])].sort((a, b) => String(a.number).localeCompare(String(b.number)))

  const totalTurns = floorTables.reduce(
    (sum, t) => sum + (turnsByTable[t.number] || []).filter(x => turnInPeriod(x, period)).length, 0)
  const seatedNow = floorTables.filter(t => t.status === 'dining').length

  return (
    <div className="space-y-3">
      {/* 篩選 + 圖例 */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex gap-1.5">
          {PERIODS.map(p => (
            <button
              key={p.key}
              onClick={() => setPeriod(p.key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold border-2 transition-all ${
                period === p.key
                  ? 'bg-chicken-red border-chicken-red text-white'
                  : 'bg-white border-chicken-brown/15 text-chicken-brown'
              }`}
            >{p.label}</button>
          ))}
        </div>
        <span className="text-[11px] font-bold text-chicken-brown/55">顯示 {totalTurns} 桌次 · 用餐中 {seatedNow} 桌</span>
        <div className="flex-1" />
        <div className="flex flex-wrap items-center gap-2.5 text-[11px] font-bold text-chicken-brown/55">
          <span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-sm bg-orange-500" />用餐中</span>
          <span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-sm bg-sky-500" />待到店</span>
          <span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-sm bg-chicken-brown/30" />已離席</span>
          <span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-sm bg-indigo-500" />團體</span>
        </div>
      </div>

      {/* 桌卡格 */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5">
        {floorTables.map(t => {
          const all = turnsByTable[t.number] || []
          const turns = all.filter(x => turnInPeriod(x, period))
          const isSel = selectedTableNumber === t.number
          const blocked = !t.isActive || t.outage
          return (
            <button
              key={t.number}
              onClick={() => onSelectTable?.(t.number)}
              className={`flex flex-col text-left bg-white rounded-xl border-2 overflow-hidden transition-all ${
                isSel ? 'border-chicken-red shadow' : 'border-chicken-brown/10 hover:border-chicken-brown/25'
              }`}
            >
              <div className="flex items-center gap-1.5 px-2.5 py-2 border-b border-chicken-brown/10">
                <i className={`h-2 w-2 rounded-full ${STATUS_DOT[t.status] || 'bg-emerald-500'}`} />
                <span className="text-sm font-black text-chicken-brown">{t.number}</span>
                <span className="ml-auto text-[10px] font-bold text-chicken-brown/50">{t.capacity} 位 · 今日 {all.length} 轉</span>
              </div>
              <div className="p-1.5 space-y-1">
                {blocked ? (
                  <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 py-2.5 text-center text-[11px] font-bold text-slate-400">🛠 停用／維修中</div>
                ) : turns.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-emerald-300 bg-emerald-50/40 py-2.5 text-center text-[11px] font-bold text-emerald-600">本時段可排</div>
                ) : (
                  <>
                    {turns.map((x, i) => <TurnRow key={x.bookingId || `${x.groupId}-${x.batchId}` || i} turn={x} />)}
                    <div className="rounded-md border border-dashed border-chicken-brown/20 py-1 text-center text-[10px] font-bold text-chicken-brown/35">＋ 可再排</div>
                  </>
                )}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
