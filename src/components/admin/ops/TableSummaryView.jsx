import { useMemo } from 'react'
import { History } from 'lucide-react'
import { diffMin, stageOf } from '../../../utils/diningStage'
import { buildOpsTablePresentation } from '../../../utils/opsTablePresentation'

// 桌況「摘要」視圖：以「可坐存量 + 依可操作狀態分組」快速回答『現在能坐多少、哪些要處理』。
// 共同桌況字典補下組與用餐＋清桌估占；tables 已由父層依樓層過濾。
// 「全店」管理數字（Barry 2026-10-30：原頂端六格統計列移到這裡給店長看；前台頂端只留可入座／用餐中＋有事才出現的提示）。
// 大字主數字、小字單位與人數，比照訂位頁「12 組 · 48 人」。
function StoreCard({ store, onOpenLog }) {
  const cell = (label, value, unit, people, cls = 'text-chicken-brown') => (
    <div className="bg-chicken-cream rounded-xl px-3 py-2">
      <div className="text-[11px] font-bold text-chicken-brown/60">{label}</div>
      <div className={`whitespace-nowrap ${cls}`}>
        <span className="text-2xl font-bold tabular-nums">{value}</span>
        <span className="text-sm font-semibold text-chicken-brown/60"> {unit}{people != null ? ` · ${people} 人` : ''}</span>
      </div>
    </div>
  )
  return (
    <section aria-label="全店" className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-xs font-bold text-chicken-brown">全店</h3>
        {store.phase && <span className="text-[11px] font-semibold text-chicken-brown/60 truncate">{store.phase}</span>}
      </div>
      <div data-store-stats className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {cell('用餐中', store.dining, '桌', store.occSeats, 'text-orange-800')}
        {cell('在席人數', store.occSeats, '人', null)}
        {cell('可入座', store.vacant, '桌', store.vacantSeats, 'text-emerald-800')}
        {cell('90 分內將到', store.soon, '組', null, 'text-sky-800')}
        {cell('待清桌', store.cleaning, '桌', null, 'text-amber-800')}
        {cell('候位需處理', store.waitlist, '組', store.waitlistPeople, 'text-violet-800')}
      </div>
      {(store.overdue > 0 || store.later > 0) && (
        <p className="text-[11px] font-semibold text-chicken-brown/60">
          {store.overdue > 0 && <span className="text-chicken-red">過時未到 {store.overdue} 組　</span>}
          {store.later > 0 && `更晚 ${store.later} 組`}
        </p>
      )}
      {store.autoCount > 0 && onOpenLog && (
        <button type="button" onClick={onOpenLog}
          className="tap w-full min-h-[44px] px-3 rounded-xl border border-sky-200 bg-sky-50 text-sky-800 text-sm font-bold inline-flex items-center gap-2">
          <History size={16} aria-hidden /> 系統今日自動處理 {store.autoCount} 筆 · 查看紀錄
        </button>
      )}
      <div className="text-xs font-bold text-chicken-brown/60 pt-1 border-t border-chicken-brown/10">本樓層</div>
    </section>
  )
}

export default function TableSummaryView({ store = null, onOpenLog, tables = [], bookings = [], groupHoldTables = {}, settings = {}, date, now = Date.now(), tablePresentation, onSelectTable }) {
  const presentation = useMemo(() => tablePresentation || buildOpsTablePresentation({ tables, bookings, groupHoldTables, settings, date, now }), [tablePresentation, tables, bookings, groupHoldTables, settings, date, now])
  const data = useMemo(() => {
    const vacant = [], dining = [], cleaning = [], held = [], conflicts = [], unavailable = []
    tables.forEach(t => {
      const state = presentation[t.number]
      if (state?.unavailableReason) { unavailable.push(t); return }
      if (t.status === 'vacant') (state?.canSeatNow ? vacant : conflicts).push(t)
      else if (t.status === 'dining') dining.push(t)
      else if (t.status === 'cleaning') cleaning.push(t)
      else if (t.status === 'reserved') held.push(t)
    })
    const tier = c => c <= 2 ? '2' : c <= 4 ? '4' : c <= 6 ? '6' : '大'
    const stock = { 2: 0, 4: 0, 6: 0, 大: 0 }
    vacant.forEach(t => { stock[tier(t.capacity)]++ })
    const totalCap = tables.filter(t => !presentation[t.number]?.unavailableReason).reduce((sum, t) => sum + (Number(t.capacity) || 0), 0)
    const usedCap = dining.reduce((sum, t) => sum + (Number(t.capacity) || 0), 0)
    const pct = totalCap ? Math.round(usedCap / totalCap * 100) : 0
    const openSeats = vacant.reduce((sum, t) => sum + (Number(t.capacity) || 0), 0)
    return { vacant, dining, cleaning, held, conflicts, unavailable, stock, pct, openSeats }
  }, [tables, presentation])

  const Chip = ({ t, cls, sub, subCls }) => {
    const state = presentation[t.number]
    return (
      <button onClick={() => onSelectTable?.(t.number)}
        className={`inline-flex flex-col items-center justify-center min-w-[110px] min-h-[44px] px-2 py-2 rounded-xl border-2 ${cls}`}>
        <span className="text-sm font-bold leading-none">{t.number}</span>
        <span className={`text-[10px] font-bold mt-0.5 ${subCls || ''}`}>{sub}</span>
        {state?.reservationLabel && <span className="text-[10px] mt-1 font-bold">{state.reservationLabel}</span>}
        {state?.availabilityLabel && <span className="text-[10px] mt-0.5 max-w-[190px]">{state.availabilityLabel}</span>}
      </button>
    )
  }

  const stockCards = [['2', '2 人桌'], ['4', '4 人桌'], ['6', '6 人桌'], ['大', '大桌']]

  return (
    <div className="h-full min-h-0 overflow-y-auto pr-1 space-y-3">
      {store && <StoreCard store={store} onOpenLog={onOpenLog} />}
      {/* 可坐存量 */}
      <div className="grid grid-cols-4 gap-2">
        {stockCards.map(([k, label]) => (
          <div key={k} className="bg-chicken-cream rounded-xl p-2 text-center">
            <div className={`text-2xl font-bold ${data.stock[k] > 0 ? 'text-chicken-green' : 'text-chicken-brown/30'}`}>{data.stock[k]}</div>
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
      <Section title={`可入座（${data.vacant.length} 桌 · ${data.openSeats} 席）`} color="text-chicken-green" empty={data.vacant.length === 0}>
        {data.vacant.map(t => (
          <Chip key={t.number} t={t} sub={`${t.capacity} 人`} subCls="text-chicken-green"
            cls="border-chicken-green bg-chicken-green/10 text-chicken-brown" />
        ))}
      </Section>

      {/* 用餐中（超時轉紅） */}
      <Section title={`用餐中（${data.dining.length}）`} color="text-chicken-brown/60" empty={data.dining.length === 0}>
        {data.dining.map(t => {
          const m = t.seatedAt ? diffMin(t.seatedAt, now) : 0
          const stage = stageOf(m, settings)
          const over = stage === 'overtime' || stage === 'buffer-overtime'
          return (
            <Chip key={t.number} t={t} sub={`${over ? '' : ''}${m} 分`} subCls={over ? 'text-chicken-red' : 'text-chicken-brown/50'}
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

      {data.conflicts.length > 0 && (
        <Section title={`空桌 · 時段衝突（${data.conflicts.length}）`} color="text-orange-700" empty={false}>
          {data.conflicts.map(t => <Chip key={t.number} t={t} sub={`${t.capacity} 人`} cls="border-orange-300 bg-orange-50 text-orange-800" />)}
        </Section>
      )}
      {data.held.length > 0 && (
        <Section title={`已鎖桌（${data.held.length}）`} color="text-sky-700" empty={false}>
          {data.held.map(t => <Chip key={t.number} t={t} sub="已預訂" cls="border-sky-300 bg-sky-50 text-sky-800" />)}
        </Section>
      )}
      {data.unavailable.length > 0 && (
        <Section title={`不可用（${data.unavailable.length}）`} color="text-slate-600" empty={false}>
          {data.unavailable.map(t => <Chip key={t.number} t={t} sub={presentation[t.number]?.statusLabel} cls="border-slate-300 bg-slate-100 text-slate-600" />)}
          <p className="text-[10px] text-slate-500 mt-1">點桌查看原因與恢復操作</p>
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
