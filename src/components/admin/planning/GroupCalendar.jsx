import { useMemo } from 'react'
import { todayStr, formatDate } from '../../../utils/timeSlots'

// Pane A：團體預排月曆。仿 CalendarView 月格，吃 monthSummary（團體彙總）視覺化整月忙閒。
// 受控元件：value(選中日) / cursor(年月) 由容器持有；點日 onSelect、換月 onCursorChange。
// 每格：🚌N團 · N位 + 依「保留席/全店座位」的忙碌條；公休 🚫、今天標記、純團爆量 ⚠。
export default function GroupCalendar({ value, onSelect, cursor, onCursorChange, monthSummary, settings, totalSeats = 0 }) {
  const byDate = monthSummary?.byDate || {}
  const month = monthSummary?.month || { groupCount: 0, guests: 0 }
  const closedDates = settings?.closures?.closedDates || []
  const today = todayStr()

  const days = useMemo(() => {
    const first = new Date(cursor.year, cursor.month, 1)
    const last = new Date(cursor.year, cursor.month + 1, 0)
    const startWeekday = first.getDay()
    const cells = []
    for (let i = 0; i < startWeekday; i++) cells.push(null)
    for (let d = 1; d <= last.getDate(); d++) cells.push(formatDate(new Date(cursor.year, cursor.month, d)))
    return cells
  }, [cursor])

  const goPrev = () => onCursorChange(cursor.month === 0 ? { year: cursor.year - 1, month: 11 } : { year: cursor.year, month: cursor.month - 1 })
  const goNext = () => onCursorChange(cursor.month === 11 ? { year: cursor.year + 1, month: 0 } : { year: cursor.year, month: cursor.month + 1 })

  return (
    <div className="bg-white rounded-2xl border border-chicken-brown/10 p-3 sm:p-4">
      <div className="flex items-center justify-between mb-3">
        <button onClick={goPrev} aria-label="上個月" className="px-3 py-1 rounded-lg hover:bg-chicken-brown/5 text-chicken-brown text-lg">‹</button>
        <h3 className="font-black text-lg text-chicken-brown">{cursor.year}年 {cursor.month + 1}月</h3>
        <button onClick={goNext} aria-label="下個月" className="px-3 py-1 rounded-lg hover:bg-chicken-brown/5 text-chicken-brown text-lg">›</button>
      </div>

      {/* 當月摘要 */}
      <div className="flex flex-wrap items-center gap-2 mb-3 text-xs">
        <span className="rounded-full bg-chicken-red/10 px-2.5 py-1 font-bold text-chicken-red tabular-nums">🚌 本月 {month.groupCount} 團</span>
        <span className="rounded-full bg-chicken-brown/10 px-2.5 py-1 font-bold text-chicken-brown tabular-nums">👥 {month.guests} 位</span>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center text-xs font-bold text-chicken-brown/50 mb-1">
        {['日', '一', '二', '三', '四', '五', '六'].map(w => <div key={w} className="py-1">{w}</div>)}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {days.map((dateStr, i) => {
          if (!dateStr) return <div key={`e${i}`} />

          const dayNum = Number(dateStr.split('-')[2])
          const isSelected = dateStr === value
          const isToday = dateStr === today
          const isPast = dateStr < today
          const isClosed = closedDates.includes(dateStr)
          const s = byDate[dateStr]
          const hasGroups = !!s && s.groupCount > 0
          const ratio = totalSeats > 0 && s ? Math.min(1, s.heldSeats / totalSeats) : 0
          const barColor = s?.overCapacityGroupOnly || ratio >= 0.75 ? '#e60012' : ratio >= 0.4 ? '#f29100' : '#9eb63a'

          const bg = isSelected ? 'bg-chicken-red'
            : isClosed ? 'bg-chicken-brown/[0.04]'
            : isToday ? 'bg-chicken-yellow/15'
            : hasGroups ? 'bg-white' : 'bg-transparent'
          const border = isSelected ? 'border-chicken-red'
            : isToday ? 'border-chicken-yellow'
            : hasGroups ? 'border-chicken-brown/10' : 'border-transparent'
          const txt = isSelected ? 'text-white' : isPast && !hasGroups ? 'text-chicken-brown/30' : 'text-chicken-brown'

          return (
            <button
              key={dateStr}
              onClick={() => onSelect(dateStr)}
              aria-pressed={isSelected}
              className={`relative rounded-xl border-2 transition-all hover:shadow-sm overflow-hidden
                aspect-square sm:aspect-auto sm:min-h-[92px] p-1 sm:p-1.5 flex flex-col items-stretch ${bg} ${border} ${txt}`}
            >
              <div className="flex items-center justify-between leading-none">
                <span className="text-sm font-black">{dayNum}</span>
                {isClosed ? <span className="text-[10px]" title="公休">🚫</span>
                  : isToday && !isSelected ? <span className="w-1.5 h-1.5 rounded-full bg-chicken-yellow" /> : null}
              </div>

              {hasGroups ? (
                <div className="flex-1 flex flex-col justify-end gap-1 mt-1 min-w-0">
                  <div className={`text-[10px] sm:text-[11px] font-black tabular-nums leading-tight ${isSelected ? 'text-white' : 'text-chicken-brown/85'}`}>
                    <span className="sm:hidden">🚌{s.groupCount}·{s.guests}</span>
                    <span className="hidden sm:inline">🚌 {s.groupCount} 團 · {s.guests} 位</span>
                  </div>
                  {/* 忙碌條：保留席 / 全店座位 */}
                  <div className={`h-1.5 rounded-full overflow-hidden ${isSelected ? 'bg-white/30' : 'bg-chicken-brown/10'}`}>
                    <div className="h-full rounded-full" style={{ width: `${Math.max(8, ratio * 100)}%`, backgroundColor: isSelected ? '#ffffff' : barColor }} />
                  </div>
                  {s.overCapacityGroupOnly && (
                    <div className={`text-[9px] font-black rounded px-1 py-0.5 leading-tight w-fit ${isSelected ? 'bg-white/25 text-white' : 'bg-chicken-red text-white'}`}>⚠ 超量</div>
                  )}
                </div>
              ) : (
                <div className="flex-1" />
              )}
            </button>
          )
        })}
      </div>

      <div className="mt-3 text-center text-[11px] text-chicken-brown/45">點任一天 → 右側顯示當日團體總覽</div>
    </div>
  )
}
