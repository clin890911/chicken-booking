import { useMemo } from 'react'
import { todayStr, formatDate } from '../../../utils/timeSlots'
import Icon from '../../ui/Icon'

// Pane A：規劃月曆（熱圖版）。受控元件：value(選中日) / cursor(年月) 由容器持有；點日 onSelect、換月 onCursorChange。
// 每格三件事，由遠到近一眼可讀：
//   1. 底色 = 當日載客率（團客人數 + 散客人數）/ 全店可用席，0 → 100% 六階暖色；
//   2. 大數字 = 當日總人數（店主要的是「今天幾位」，不是「幾團幾筆」）；
//   3. 小字 = 幾團 · 幾筆（明細）。
// 純團爆量（heldSeats > 可用席）在格右上角以紅點提示；公休格灰底斜線圖示。
// monthSummary 只吃 groups+tables（O(groups)），walkinByDate 由容器另算，兩者在此合併。
const HEAT = ['#ffffff', '#fff3e2', '#fde7c9', '#fbd6a6', '#f39a5e', '#e6552e']
function heatLevel(ratio) {
  if (ratio <= 0) return 0
  if (ratio < 0.1) return 1
  if (ratio < 0.25) return 2
  if (ratio < 0.4) return 3
  if (ratio < 0.7) return 4
  return 5
}

export default function GroupCalendar({ value, onSelect, cursor, onCursorChange, monthSummary, settings, totalSeats = 0, walkinByDate }) {
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

  // 本月散客彙總（小字，與團體並列）
  const walkinMonth = useMemo(() => {
    const prefix = `${cursor.year}-${String(cursor.month + 1).padStart(2, '0')}-`
    let count = 0, guests = 0
    Object.entries(walkinByDate || {}).forEach(([d, w]) => {
      if (!d.startsWith(prefix)) return
      count += w.count || 0
      guests += w.guests || 0
    })
    return { count, guests }
  }, [walkinByDate, cursor])

  const goPrev = () => onCursorChange(cursor.month === 0 ? { year: cursor.year - 1, month: 11 } : { year: cursor.year, month: cursor.month - 1 })
  const goNext = () => onCursorChange(cursor.month === 11 ? { year: cursor.year + 1, month: 0 } : { year: cursor.year, month: cursor.month + 1 })
  const goToday = () => {
    const d = new Date(today + 'T00:00:00')
    onCursorChange({ year: d.getFullYear(), month: d.getMonth() })
    onSelect(today)
  }

  return (
    <div className="bg-white rounded-2xl border border-chicken-brown/10 p-3 sm:p-4 shadow-[0_1px_2px_rgba(58,46,38,0.04)]">
      <div className="flex items-center gap-2.5 mb-3 flex-wrap">
        <h3 className="font-semibold text-lg sm:text-xl text-chicken-brown tracking-tight">{cursor.year}年 {cursor.month + 1}月</h3>
        <div className="text-xs text-chicken-brown/60 tabular-nums">
          {month.groupCount} 團 · {month.guests} 位 · 散客 {walkinMonth.count} 筆 · {walkinMonth.guests} 位
        </div>
        <div className="flex-1" />
        <button type="button" onClick={goToday} className="tap h-8 px-2.5 rounded-lg border border-chicken-brown/15 text-xs font-semibold text-chicken-brown hover:bg-chicken-brown/[0.04]">今天</button>
        <button type="button" onClick={goPrev} aria-label="上個月" className="tap w-8 h-8 rounded-lg border border-chicken-brown/15 text-chicken-brown flex items-center justify-center hover:bg-chicken-brown/[0.04]"><Icon name="chevronLeft" size={14} strokeWidth={2.2} /></button>
        <button type="button" onClick={goNext} aria-label="下個月" className="tap w-8 h-8 rounded-lg border border-chicken-brown/15 text-chicken-brown flex items-center justify-center hover:bg-chicken-brown/[0.04]"><Icon name="chevronRight" size={14} strokeWidth={2.2} /></button>
      </div>

      <div className="grid grid-cols-7 gap-1 sm:gap-1.5 text-center text-[11px] font-semibold text-chicken-brown/50 mb-1">
        {['日', '一', '二', '三', '四', '五', '六'].map(w => <div key={w} className="py-1">{w}</div>)}
      </div>

      <div className="grid grid-cols-7 gap-1 sm:gap-1.5">
        {days.map((dateStr, i) => {
          if (!dateStr) return <div key={`e${i}`} />

          const dayNum = Number(dateStr.split('-')[2])
          const isSelected = dateStr === value
          const isToday = dateStr === today
          const isPast = dateStr < today
          const isClosed = closedDates.includes(dateStr)
          const s = byDate[dateStr]
          const w = walkinByDate?.[dateStr]
          const groupCount = s?.groupCount || 0
          const groupGuests = s?.guests || 0
          const walkinCount = w?.count || 0
          const walkinGuests = w?.guests || 0
          const total = groupGuests + walkinGuests
          const denom = s?.totalSeats ?? totalSeats
          const ratio = denom > 0 ? Math.min(1, total / denom) : 0
          const level = heatLevel(ratio)
          const over = !!s?.overCapacityGroupOnly

          const caption = [groupCount > 0 && `${groupCount} 團`, walkinCount > 0 && `${walkinCount} 筆`].filter(Boolean).join(' · ')

          // 選中：紅框雙圈；今天：紅內框；一般：熱圖底色（0 級白底 + 髮絲框）
          const ring = isSelected
            ? 'ring-2 ring-chicken-red ring-offset-2 ring-offset-white'
            : isToday ? 'ring-[1.5px] ring-inset ring-chicken-red'
            : level === 0 && !isClosed ? 'ring-1 ring-inset ring-chicken-brown/[0.08]' : ''
          const bg = isClosed ? '#f3f1ed' : HEAT[level]
          const numColor = isPast ? 'text-chicken-brown/40' : level >= 4 ? 'text-white' : 'text-chicken-brown'
          const dayColor = isToday ? 'text-chicken-red' : level >= 4 ? 'text-white/85' : isPast ? 'text-chicken-brown/35' : 'text-chicken-brown/60'
          const capColor = level >= 4 ? 'text-white/85' : 'text-chicken-brown/55'

          return (
            <button
              key={dateStr}
              type="button"
              onClick={() => onSelect(dateStr)}
              aria-pressed={isSelected}
              aria-label={`${cursor.month + 1}月${dayNum}日${total ? `，${total} 位` : ''}${isClosed ? '，公休' : ''}`}
              style={{ backgroundColor: bg }}
              className={`tap relative rounded-[10px] transition-shadow aspect-square sm:aspect-auto sm:min-h-[76px] flex flex-col items-center justify-center gap-px overflow-hidden ${ring}`}
            >
              <span className={`absolute top-1.5 left-2 text-[11px] font-semibold leading-none ${dayColor}`}>{dayNum}</span>
              {isClosed && <span className="absolute top-1.5 right-1.5 text-chicken-brown/35"><Icon name="ban" size={11} /></span>}
              {over && !isClosed && <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-chicken-red ring-2 ring-white" title="團體保留席已超過全店座位" />}
              {total > 0 ? (
                <>
                  <span className={`text-lg sm:text-[22px] font-semibold leading-tight tracking-tight tabular-nums ${numColor}`}>{total}</span>
                  {caption && <span className={`hidden sm:block text-[10px] leading-3 whitespace-nowrap tabular-nums ${capColor}`}>{caption}</span>}
                </>
              ) : null}
            </button>
          )
        })}
      </div>

      <div className="mt-3 flex items-center gap-2 text-[11px] text-chicken-brown/50 flex-wrap">
        <span>數字 = 當日總人數（團體 + 散客）</span>
        <div className="flex-1" />
        <span>載客率</span>
        <div className="flex gap-0.5">
          {HEAT.map((c, i) => <span key={i} className={`inline-block w-3.5 h-2 rounded-sm ${i === 0 ? 'ring-1 ring-inset ring-chicken-brown/15' : ''}`} style={{ backgroundColor: c }} />)}
        </div>
        <span className="tabular-nums">0 → {totalSeats} 席</span>
      </div>
    </div>
  )
}
