import { useMemo } from 'react'
import { addDays, formatDate, todayStr, dayLabel } from '../../utils/timeSlots'

export default function DatePicker({ value, onChange, maxDaysAhead = 30 }) {
  const days = useMemo(() => {
    const today = new Date(todayStr() + 'T00:00:00')
    const arr = []
    for (let i = 0; i < maxDaysAhead; i++) {
      const d = addDays(today, i)
      arr.push({
        value: formatDate(d),
        label: dayLabel(formatDate(d)),
        isToday: i === 0,
        isWeekend: [0, 6].includes(d.getDay())
      })
    }
    return arr
  }, [maxDaysAhead])

  const groups = useMemo(() => {
    const chunked = []
    for (let i = 0; i < days.length; i += 7) {
      chunked.push({
        label: i === 0 ? '本週' : i === 7 ? '下週' : `${Math.floor(i / 7) + 1} 週後`,
        days: days.slice(i, i + 7),
      })
    }
    return chunked
  }, [days])

  return (
    <div className="space-y-5">
      {groups.map(group => (
        <section key={group.label}>
          <div className="mb-2 flex items-center gap-2">
            <div className="text-xs font-black text-chicken-brown/55">{group.label}</div>
            <div className="h-px flex-1 bg-chicken-brown/10" />
          </div>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {group.days.map(d => {
              const active = value === d.value
              return (
                <button
                  key={d.value}
                  onClick={() => onChange(d.value)}
                  className={`min-h-[68px] rounded-xl border-2 px-2 py-3 text-left transition-all ${
                    active
                      ? 'border-chicken-red bg-chicken-red text-white shadow-sm'
                      : `border-chicken-brown/15 bg-white hover:border-chicken-red/40 ${d.isWeekend ? 'text-chicken-red' : 'text-chicken-brown'}`
                  }`}
                >
                  <div className={`text-[10px] font-black ${active ? 'text-white/85' : d.isToday ? 'text-chicken-yellow' : 'text-chicken-brown/45'}`}>
                    {d.isToday ? '今天' : d.isWeekend ? '週末' : '可訂'}
                  </div>
                  <div className="mt-1 text-sm font-black leading-tight">{d.label}</div>
                </button>
              )
            })}
          </div>
        </section>
      ))}
      </div>
  )
}
