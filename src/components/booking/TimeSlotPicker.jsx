import { useMemo } from 'react'
import { generateTimeSlots } from '../../utils/timeSlots'
import { calcSlotCapacity } from '../../utils/capacity'

export default function TimeSlotPicker({ date, value, onChange, settings, tables, bookings, guests = 1, hideFull = true }) {
  const slots = useMemo(() => {
    const list = generateTimeSlots(settings.openTime, settings.closeTime, settings.slotInterval)
    return list.map(t => {
      const remaining = calcSlotCapacity(tables, bookings, date, t, settings)
      return { time: t, remaining, full: remaining < guests }
    })
  }, [date, settings, tables, bookings, guests])

  const visible = hideFull ? slots.filter(s => !s.full) : slots

  if (visible.length === 0) {
    return (
      <div className="empty-panel">
        <div className="text-3xl mb-2">⏳</div>
        <p className="font-bold text-chicken-brown">該日所有時段已滿</p>
        <p className="text-sm text-chicken-brown/60 mt-1">請返回選擇其他日期，或來電詢問現場座位。</p>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {visible.map(s => {
        const active = value === s.time
        const tone = s.full ? '已滿' : s.remaining <= Math.max(guests * 2, 12) ? '少量名額' : '可訂位'
        return (
          <button
            key={s.time}
            disabled={s.full}
            onClick={() => onChange(s.time)}
            className={`min-h-[72px] rounded-xl border-2 px-3 py-3 text-left transition-all ${
              active
                ? 'border-chicken-red bg-chicken-red text-white'
                : s.full
                  ? 'border-chicken-brown/10 bg-chicken-brown/5 text-chicken-brown/30 cursor-not-allowed'
                  : 'border-chicken-brown/15 bg-white text-chicken-brown hover:border-chicken-red/50'
            }`}
          >
            <div className="text-base font-bold leading-tight">{s.time}</div>
            <div className={`mt-1 text-[11px] font-bold ${active ? 'text-white/90' : s.remaining <= Math.max(guests * 2, 12) ? 'text-chicken-yellow' : 'text-chicken-green'}`}>
              {tone}
            </div>
            <div className={`mt-0.5 text-[10px] ${active ? 'text-white/70' : 'text-chicken-brown/45'}`}>
              {s.full ? '請改選其他時段' : `符合 ${guests} 位用餐`}
            </div>
          </button>
        )
      })}
    </div>
  )
}
