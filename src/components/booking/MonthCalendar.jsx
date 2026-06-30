import { useMemo, useState } from 'react'
import { todayStr, formatDate, addDays } from '../../utils/timeSlots'

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']

// 月曆式日期選擇（後台新增訂位用）：可往後翻任意月份，解決團體常提前數月訂位、
// 舊版週列表僅能看 ~5 週的問題。過去日期停用；今天/週末/已選日皆有視覺標記。
//   value / onChange — 受控（YYYY-MM-DD）
//   minDate          — 最早可選日（預設今天）
//   maxDate          — 最遠可選日（可選；不傳＝不限，店員可排到任意未來）
//   renderBadge(date)— 可選，回傳要疊在日期格右上角的小標（例如「N 團」）
export default function MonthCalendar({ value, onChange, minDate, maxDate, renderBadge = null }) {
  const today = todayStr()
  const min = minDate || today
  const [cursor, setCursor] = useState(() => {
    const base = new Date((value || today) + 'T00:00:00')
    return { year: base.getFullYear(), month: base.getMonth() }
  })

  const cells = useMemo(() => {
    const first = new Date(cursor.year, cursor.month, 1)
    const start = addDays(first, -first.getDay())
    return Array.from({ length: 42 }, (_, i) => {
      const d = addDays(start, i)
      const date = formatDate(d)
      return {
        date,
        day: d.getDate(),
        inMonth: d.getMonth() === cursor.month,
        isToday: date === today,
        isWeekend: [0, 6].includes(d.getDay()),
        disabled: date < min || (maxDate ? date > maxDate : false),
      }
    })
  }, [cursor, today, min, maxDate])

  const monthKey = `${cursor.year}-${String(cursor.month + 1).padStart(2, '0')}`
  const canPrev = monthKey > min.slice(0, 7)
  const canNext = maxDate ? monthKey < maxDate.slice(0, 7) : true
  const shift = (dir) => setCursor(c => {
    const m = c.month + dir
    return { year: c.year + Math.floor(m / 12), month: ((m % 12) + 12) % 12 }
  })

  return (
    <div className="rounded-xl border-2 border-chicken-brown/15 bg-white p-3">
      <div className="mb-2 flex items-center justify-between">
        <button type="button" onClick={() => shift(-1)} disabled={!canPrev}
          className="flex h-8 w-8 items-center justify-center rounded-full text-lg text-chicken-brown hover:bg-chicken-brown/5 disabled:opacity-25"
          aria-label="上個月">‹</button>
        <div className="font-black text-chicken-brown tabular-nums">{cursor.year} 年 {cursor.month + 1} 月</div>
        <button type="button" onClick={() => shift(1)} disabled={!canNext}
          className="flex h-8 w-8 items-center justify-center rounded-full text-lg text-chicken-brown hover:bg-chicken-brown/5 disabled:opacity-25"
          aria-label="下個月">›</button>
      </div>

      <div className="mb-1 grid grid-cols-7">
        {WEEKDAYS.map(w => (
          <div key={w} className={`py-1 text-center text-[11px] font-black ${w === '日' || w === '六' ? 'text-chicken-red/70' : 'text-chicken-brown/45'}`}>{w}</div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {cells.map(c => {
          const active = value === c.date
          const badge = renderBadge ? renderBadge(c.date) : null
          return (
            <button
              key={c.date}
              type="button"
              disabled={c.disabled}
              onClick={() => onChange(c.date)}
              aria-pressed={active}
              aria-label={c.date}
              className={`relative flex min-h-[42px] items-center justify-center rounded-lg text-sm font-black tabular-nums transition-all ${
                active ? 'bg-chicken-red text-white shadow-sm'
                : c.disabled ? 'cursor-not-allowed text-chicken-brown/20'
                : c.isToday ? 'bg-chicken-yellow/15 text-chicken-brown hover:bg-chicken-red/10'
                : c.isWeekend ? 'text-chicken-red hover:bg-chicken-red/10'
                : 'text-chicken-brown hover:bg-chicken-red/10'
              } ${!c.inMonth && !active ? 'opacity-30' : ''}`}
            >
              {c.day}
              {c.isToday && !active && <span className="absolute bottom-1 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-chicken-yellow" />}
              {badge && <span className="absolute right-1 top-1">{badge}</span>}
            </button>
          )
        })}
      </div>
    </div>
  )
}
