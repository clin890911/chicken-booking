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

  return (
    <div className="overflow-x-auto no-scrollbar -mx-4 px-4">
      <div className="flex gap-2 pb-1">
        {days.map(d => {
          const active = value === d.value
          return (
            <button
              key={d.value}
              onClick={() => onChange(d.value)}
              className={`flex-shrink-0 px-3 py-3 rounded-2xl border-2 transition-all min-w-[78px] ${
                active
                  ? 'border-chicken-red bg-chicken-red text-white shadow-md'
                  : `border-chicken-brown/15 bg-white ${d.isWeekend ? 'text-chicken-red' : 'text-chicken-brown'}`
              }`}
            >
              {d.isToday && <div className={`text-[10px] font-bold mb-0.5 ${active ? 'text-white' : 'text-chicken-yellow'}`}>今天</div>}
              <div className="text-xs font-bold leading-tight">{d.label}</div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
