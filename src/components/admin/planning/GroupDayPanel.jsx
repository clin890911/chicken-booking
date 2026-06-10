import { EmptyState } from '../../ui'
import { dayLabel } from '../../../utils/timeSlots'
import GroupArrivalTimeline from './GroupArrivalTimeline'
import GroupPrepDigest from './GroupPrepDigest'

// Pane B：當日團體總覽（取代 GroupDayStage）。
// Hero（團數/人數/保留 + 特殊需求速覽 + 新增/列印）→ 警示橫幅 → 抵達時間軸 → 備餐重點 → 依場次分組團卡。
const STATUS_LABEL = {
  planned: { label: '已預排', cls: 'bg-chicken-brown/10 text-chicken-brown' },
  confirmed: { label: '已確認', cls: 'bg-chicken-yellow/15 text-chicken-yellow' },
  arrived: { label: '已到店', cls: 'bg-chicken-green/15 text-chicken-green' },
  completed: { label: '已完成', cls: 'bg-chicken-brown text-white' },
  cancelled: { label: '已取消', cls: 'bg-chicken-red/10 text-chicken-red' },
}

const QUICK_NEEDS = [
  { key: 'vegetarian', label: '素', cls: 'bg-chicken-green/15 text-chicken-green' },
  { key: 'child', label: '童', cls: 'bg-sky-100 text-sky-700' },
  { key: 'mobility', label: '行動', cls: 'bg-amber-100 text-amber-700' },
  { key: 'wheelchair', label: '輪椅', cls: 'bg-violet-100 text-violet-700' },
]

// 場次剩餘色調（summary 來自 resolveSlotOccupancy：remaining=席、remainingTables=桌）
function seatingTone(summary) {
  if (!summary || summary.closed) return 'closed'
  if ((summary.remaining ?? 0) <= 0) return 'full'
  if ((summary.remainingTables ?? 0) <= 2 || (summary.totalSeats > 0 && summary.remaining < summary.totalSeats * 0.15)) return 'tight'
  return 'ok'
}
const TONE_PILL = {
  ok: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  tight: 'bg-amber-50 text-amber-700 border-amber-200',
  full: 'bg-rose-50 text-rose-600 border-rose-200',
  closed: 'bg-chicken-brown/5 text-chicken-brown/40 border-chicken-brown/15',
}

function WarningBanner({ w }) {
  if (w.type === 'overcapacity') {
    return (
      <div className="bg-rose-50 border-2 border-rose-200 rounded-xl px-3 py-2 text-xs font-bold text-rose-700">
        ⚠ {w.seatingName} 恐爆量：已用 {w.used} 席 / 全店 {w.totalSeats} 席（超出 {w.over} 席）— 請調整圈桌或梯次
      </div>
    )
  }
  if (w.type === 'collision') {
    return (
      <div className="bg-amber-50 border-2 border-amber-200 rounded-xl px-3 py-2 text-xs font-bold text-amber-700">
        ⚠ {w.seatingName} {w.timeSlot} 同時段 {w.count} 團 / {w.guests} 位同時抵達 — 建議錯開帶位、預留接車人力
      </div>
    )
  }
  if (w.type === 'unscheduled') {
    return (
      <div className="bg-amber-50 border-2 border-amber-200 rounded-xl px-3 py-2 text-xs font-bold text-amber-700">
        ⚠ 有 {w.count} 個梯次的時間未對應任何場次（{w.rows.map(r => r.timeSlot).join('、')}）— 請確認帶位時間
      </div>
    )
  }
  return null
}

// 單張「團×梯次」卡（同團跨兩場次會在兩場次各出現一張，標第一梯/第二梯）
function GroupBatchCard({ row, onSelect, onDuplicate }) {
  const g = row.group
  const st = STATUS_LABEL[g.status] || STATUS_LABEL.planned
  const tableCount = (row.tableNumbers || []).length
  return (
    <div className="rounded-xl border-2 border-chicken-brown/10 bg-white hover:border-indigo-400 transition-all">
      <button onClick={() => onSelect(g.id)} className="block w-full text-left p-3 pb-1.5">
        <div className="flex items-start justify-between gap-2">
          <div className="font-bold text-chicken-brown text-sm truncate">🚌 {g.agencyName || '（未填旅行社）'}</div>
          <span className={`shrink-0 text-[10px] font-black px-2 py-0.5 rounded-full ${st.cls}`}>{st.label}</span>
        </div>
        {g.guideName && <div className="text-xs text-chicken-brown/50 truncate mt-0.5">導遊 {g.guideName}</div>}
        <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] font-bold">
          <span className="px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700">{row.batch?.label || '梯次'}</span>
          <span className="px-2 py-0.5 rounded-full bg-chicken-cream text-chicken-brown tabular-nums">🕐 {row.timeSlot || '未排'}</span>
          <span className="px-2 py-0.5 rounded-full bg-chicken-cream text-chicken-brown tabular-nums">👥 {row.guests || 0} 位</span>
          <span className="px-2 py-0.5 rounded-full bg-chicken-cream text-chicken-brown tabular-nums">🪑 {tableCount} 桌</span>
        </div>
      </button>
      <div className="px-3 pb-2 flex justify-end">
        <button onClick={() => onDuplicate(g.id)} title="複製這團為新草稿"
          className="text-[11px] font-bold text-chicken-brown/50 hover:text-chicken-red">⧉ 複製</button>
      </div>
    </div>
  )
}

function SessionSection({ seating, summary, rows, onNewGroup, onSelectGroup, onDuplicate }) {
  const tone = seatingTone(summary)
  const closed = tone === 'closed'
  return (
    <div className="rounded-xl border border-chicken-brown/10 bg-chicken-cream/30 p-2.5">
      <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-black text-chicken-brown">{seating.name}</span>
          <span className="text-xs font-bold text-chicken-brown/50 tabular-nums">{seating.start}–{seating.end}</span>
          <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full border ${TONE_PILL[tone]}`}>
            {closed ? '🚫 已關閉' : tone === 'full' ? '已客滿' : `剩 ${summary.remainingTables} 桌 / ${summary.remaining} 席`}
          </span>
        </div>
        <button onClick={() => onNewGroup(seating.id)} disabled={closed}
          className="text-xs font-bold text-chicken-red disabled:text-chicken-brown/30 disabled:cursor-not-allowed">＋ 新增團單</button>
      </div>
      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-chicken-brown/15 px-3 py-2 text-xs text-chicken-brown/40">本場次尚無團單</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {rows.map(r => (
            <GroupBatchCard key={`${r.group.id}:${r.batch?.id || r.timeSlot}`} row={r} onSelect={onSelectGroup} onDuplicate={onDuplicate} />
          ))}
        </div>
      )}
    </div>
  )
}

export default function GroupDayPanel({ date, daySummary, dayGroups, isToday, onSelectGroup, onNewGroup, onDuplicate, onGoToday, onPrintSheet, onOpenMap }) {
  const s = daySummary || {}
  const counts = s.prep?.counts || {}
  const hasGroups = dayGroups.length > 0
  const noSeatings = (s.seatings || []).length === 0

  // 依場次分組：場次容量（含剩餘）對齊抵達時間軸的同場次梯次列。
  const timeline = s.timeline || []
  const sections = (s.seatings || []).map(({ seating, summary }) => ({
    seating, summary,
    rows: (timeline.find(b => b.seating?.id === seating.id)?.rows) || [],
  }))
  const unscheduled = timeline.find(b => b.seating === null)

  return (
    <div className="space-y-3">
      {/* Hero */}
      <div className="bg-white rounded-2xl border border-chicken-brown/10 p-3 sm:p-4 space-y-3">
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-chicken-cream px-3 py-1.5 text-sm font-black text-chicken-brown">
              📅 {dayLabel(date)}{s.closed ? ' · 公休' : ''}
            </span>
            {isToday && onGoToday && (
              <button onClick={onGoToday} className="text-xs font-bold text-chicken-red underline">→ 現場（今日帶位）</button>
            )}
          </div>
          <div className="flex gap-1.5">
            {onOpenMap && (
              <button onClick={onOpenMap} className="px-3 py-2 rounded-xl text-xs font-bold bg-white border-2 border-chicken-brown/15 text-chicken-brown">🗺️ 排位地圖</button>
            )}
            {hasGroups && (
              <button onClick={onPrintSheet} className="px-3 py-2 rounded-xl text-xs font-bold bg-white border-2 border-chicken-brown/15 text-chicken-brown">🖨 列印備餐單</button>
            )}
            <button onClick={() => onNewGroup()} className="px-3 py-2 rounded-xl text-xs font-bold bg-chicken-red text-white shadow">➕ 新增團單</button>
          </div>
        </div>

        {/* 三大數字 */}
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-xl bg-chicken-red/10 text-chicken-red p-2.5 text-center">
            <div className="text-[11px] font-bold opacity-80">🚌 團數</div>
            <div className="text-2xl font-black tabular-nums leading-tight mt-0.5">{s.groupCount || 0}</div>
          </div>
          <div className="rounded-xl bg-chicken-brown/10 text-chicken-brown p-2.5 text-center">
            <div className="text-[11px] font-bold opacity-80">👥 總人數</div>
            <div className="text-2xl font-black tabular-nums leading-tight mt-0.5">{s.guests || 0}</div>
          </div>
          <div className="rounded-xl bg-chicken-yellow/15 text-chicken-yellow p-2.5 text-center">
            <div className="text-[11px] font-bold opacity-80">🪑 保留</div>
            <div className="text-2xl font-black tabular-nums leading-tight mt-0.5">{s.heldTableCount || 0}<span className="text-sm">桌</span></div>
          </div>
        </div>

        {/* 特殊需求速覽 */}
        {hasGroups && (
          <div className="flex flex-wrap gap-1.5">
            {QUICK_NEEDS.filter(n => (counts[n.key] || 0) > 0).map(n => (
              <span key={n.key} className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${n.cls}`}>{n.label} {counts[n.key]}</span>
            ))}
            {(s.prep?.allergies || []).length > 0 && (
              <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-chicken-red text-white">過敏 {s.prep.allergies.length} 團</span>
            )}
            {QUICK_NEEDS.every(n => (counts[n.key] || 0) === 0) && (s.prep?.allergies || []).length === 0 && (
              <span className="text-[11px] text-chicken-brown/40">無特殊需求</span>
            )}
          </div>
        )}
      </div>

      {/* 警示橫幅 */}
      {s.closed && (
        <div className="bg-rose-50 border-2 border-rose-200 rounded-xl px-3 py-2.5 flex items-center gap-2">
          <span className="text-lg">🚫</span>
          <div className="text-xs font-bold text-rose-700">本日公休 — 停止接收新訂位；既有團單不受影響。</div>
        </div>
      )}
      {(s.warnings || []).map((w, i) => <WarningBanner key={i} w={w} />)}
      {noSeatings && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-xs font-bold text-amber-700">
          尚未設定場次 — 依場次分組、抵達時間軸與爆量提醒需先到「設定 → 場次設定」新增午餐/晚餐場次。
        </div>
      )}

      {/* 內容 */}
      {hasGroups || !noSeatings ? (
        <>
          {hasGroups && <GroupArrivalTimeline timeline={s.timeline || []} />}
          {hasGroups && <GroupPrepDigest prep={s.prep} />}

          {/* 依場次分組團卡 */}
          {!noSeatings && (
            <div className="space-y-2">
              <div className="text-xs font-black text-chicken-brown/55 px-1">依場次分組（點卡編輯）</div>
              {sections.map(sec => (
                <SessionSection key={sec.seating.id} {...sec}
                  onNewGroup={onNewGroup} onSelectGroup={onSelectGroup} onDuplicate={onDuplicate} />
              ))}
              {unscheduled && unscheduled.rows.length > 0 && (
                <div className="rounded-xl border border-amber-200 bg-amber-50/40 p-2.5">
                  <div className="text-sm font-black text-amber-700 mb-2">未排場次 / 其他</div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {unscheduled.rows.map(r => (
                      <GroupBatchCard key={`${r.group.id}:${r.batch?.id || r.timeSlot}`} row={r} onSelect={onSelectGroup} onDuplicate={onDuplicate} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 無場次設定時退回平鋪列表 */}
          {noSeatings && hasGroups && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {dayGroups.map(g => {
                const st = STATUS_LABEL[g.status] || STATUS_LABEL.planned
                const times = (g.batches || []).map(b => b.timeSlot).filter(Boolean).sort()
                return (
                  <button key={g.id} onClick={() => onSelectGroup(g.id)}
                    className="text-left rounded-xl border-2 border-chicken-brown/10 bg-white p-3 hover:border-indigo-400 transition-all">
                    <div className="font-bold text-chicken-brown text-sm truncate">🚌 {g.agencyName || '（未填旅行社）'}</div>
                    <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] font-bold">
                      <span className="px-2 py-0.5 rounded-full bg-chicken-cream text-chicken-brown tabular-nums">🕐 {times[0] || '未排'}{times.length > 1 ? ` +${times.length - 1}` : ''}</span>
                      <span className="px-2 py-0.5 rounded-full bg-chicken-cream text-chicken-brown tabular-nums">👥 {g.counts?.total || 0} 位</span>
                      <span className={`px-2 py-0.5 rounded-full ${st.cls}`}>{st.label}</span>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </>
      ) : (
        <EmptyState icon="🚌" title="這天還沒有團單"
          hint={s.closed ? '本日公休；如需仍可建立團單' : '點右上「新增團單」或各場次的「＋新增團單」開始預排'} />
      )}
    </div>
  )
}
