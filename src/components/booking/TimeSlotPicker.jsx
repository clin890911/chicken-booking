import { useMemo } from 'react'
import { generateTimeSlots } from '../../utils/timeSlots'
import { calcSlotCapacity } from '../../utils/capacity'

export default function TimeSlotPicker({ date, value, onChange, settings, tables, bookings, guests = 1, hideFull = true }) {
  const slots = useMemo(() => {
    const list = generateTimeSlots(settings.openTime, settings.closeTime, settings.slotInterval)
    return list.map(t => {
      const remaining = calcSlotCapacity(tables, bookings, date, t)
      return { time: t, remaining, full: remaining < guests }
    })
  }, [date, settings, tables, bookings, guests])

  const visible = hideFull ? slots.filter(s => !s.full) : slots

  if (visible.length === 0) {
    return <p className="text-sm text-chicken-brown/60 py-4 text-center">該日所有時段已滿，請選擇其他日期</p>
  }

  return (
    <div className="grid grid-cols-3 gap-2">
      {visible.map(s => {
        const active = value === s.time
        return (
          <button
            key={s.time}
            disabled={s.full}
            onClick={() => onChange(s.time)}
            className={`px-3 py-2.5 rounded-xl border-2 transition-all ${
              active
                ? 'border-chicken-red bg-chicken-red text-white'
                : s.full
                  ? 'border-chicken-brown/10 bg-chicken-brown/5 text-chicken-brown/30 cursor-not-allowed'
                  : 'border-chicken-brown/15 bg-white text-chicken-brown hover:border-chicken-red/50'
            }`}
          >
            <div className="text-base font-bold leading-tight">{s.time}</div>
            <div className={`text-[10px] mt-0.5 ${active ? 'text-white/90' : 'text-chicken-brown/50'}`}>
              {s.full ? '已滿' : `剩 ${s.remaining} 位`}
            </div>
          </button>
        )
      })}
    </div>
  )
}
