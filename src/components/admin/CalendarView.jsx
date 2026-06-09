import { useMemo, useState } from 'react'
import BookingCard from '../booking/BookingCard'
import { Card, EmptyState } from '../ui'
import { useBooking } from '../../contexts/BookingContext'
import { todayStr, formatDate } from '../../utils/timeSlots'

export default function CalendarView({ onAssignTable }) {
  const { bookings } = useBooking()
  const [cursor, setCursor] = useState(() => {
    const d = new Date()
    return { year: d.getFullYear(), month: d.getMonth() }
  })
  const [selected, setSelected] = useState(todayStr())

  const days = useMemo(() => {
    const first = new Date(cursor.year, cursor.month, 1)
    const last = new Date(cursor.year, cursor.month + 1, 0)
    const startWeekday = first.getDay()
    const daysInMonth = last.getDate()
    const cells = []
    for (let i = 0; i < startWeekday; i++) cells.push(null)
    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(cursor.year, cursor.month, d)
      cells.push(formatDate(date))
    }
    return cells
  }, [cursor])

  // 一次算好每天統計：組數、人數、未指派、no-show、各時段人數分布
  const stats = useMemo(() => {
    const map = {}
    bookings.forEach(b => {
      if (b.status === 'cancelled') return
      const d = b.date
      if (!d) return
      if (!map[d]) map[d] = { groups: 0, guests: 0, unassigned: 0, noshow: 0, slots: {} }
      const s = map[d]
      s.groups += 1
      s.guests += Number(b.guests || 0)
      if (b.status === 'confirmed' && !b.assignedTableId) s.unassigned += 1
      if (b.status === 'noshow') s.noshow += 1
      if (b.timeSlot) s.slots[b.timeSlot] = (s.slots[b.timeSlot] || 0) + Number(b.guests || 0)
    })
    return map
  }, [bookings])

  // 當月摘要（只計入本月日期）
  const monthSummary = useMemo(() => {
    const prefix = `${cursor.year}-${String(cursor.month + 1).padStart(2, '0')}-`
    let groups = 0, guests = 0, unassigned = 0
    Object.entries(stats).forEach(([date, s]) => {
      if (!date.startsWith(prefix)) return
      groups += s.groups
      guests += s.guests
      unassigned += s.unassigned
    })
    return { groups, guests, unassigned }
  }, [stats, cursor])

  const dayBookings = useMemo(() => {
    return bookings
      .filter(b => b.date === selected && b.status !== 'cancelled')
      .sort((a, b) => (a.timeSlot || '').localeCompare(b.timeSlot || ''))
  }, [bookings, selected])

  const goPrev = () => setCursor(c => c.month === 0 ? { year: c.year - 1, month: 11 } : { year: c.year, month: c.month - 1 })
  const goNext = () => setCursor(c => c.month === 11 ? { year: c.year + 1, month: 0 } : { year: c.year, month: c.month + 1 })

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-center justify-between mb-3">
          <button onClick={goPrev} className="px-3 py-1 rounded-lg hover:bg-chicken-brown/5 text-chicken-brown">‹</button>
          <h3 className="font-black text-lg text-chicken-brown">{cursor.year}年 {cursor.month + 1}月</h3>
          <button onClick={goNext} className="px-3 py-1 rounded-lg hover:bg-chicken-brown/5 text-chicken-brown">›</button>
        </div>

        {/* 當月摘要列 */}
        <div className="flex flex-wrap items-center gap-2 mb-3 text-xs">
          <span className="rounded-full bg-chicken-red/10 px-2.5 py-1 font-bold text-chicken-red tabular-nums">
            本月 {monthSummary.groups} 組
          </span>
          <span className="rounded-full bg-chicken-brown/10 px-2.5 py-1 font-bold text-chicken-brown tabular-nums">
            {monthSummary.guests} 位
          </span>
          {monthSummary.unassigned > 0 && (
            <span className="rounded-full bg-chicken-red px-2.5 py-1 font-bold text-white tabular-nums">
              ⚠ 待指派 {monthSummary.unassigned}
            </span>
          )}
        </div>

        <div className="grid grid-cols-7 gap-1 text-center text-xs font-bold text-chicken-brown/50 mb-1">
          {['日', '一', '二', '三', '四', '五', '六'].map(w => <div key={w} className="py-1">{w}</div>)}
        </div>

        <div className="grid grid-cols-7 gap-1">
          {days.map((dateStr, i) => {
            if (!dateStr) return <div key={i} />

            const dayNum = Number(dateStr.split('-')[2])
            const isSelected = dateStr === selected
            const isToday = dateStr === todayStr()
            const isPast = dateStr < todayStr()

            const s = stats[dateStr] || { groups: 0, guests: 0, unassigned: 0, noshow: 0, slots: {} }
            const hasRisk = s.unassigned > 0 || s.noshow > 0

            // 時段熱力柱（取人數最多的前 4 個時段，依時間排序）
            const slotKeys = Object.keys(s.slots).sort()
            const maxSlot = Math.max(...Object.values(s.slots), 1)

            // 背景/邊框優先序：選中 > 今天 > 風險 > 有訂位 > 空
            const bg = isSelected ? 'bg-chicken-red'
              : isToday ? 'bg-chicken-yellow/15'
              : hasRisk ? 'bg-chicken-red/5'
              : s.groups > 0 ? 'bg-white' : 'bg-transparent'
            const border = isSelected ? 'border-chicken-red'
              : isToday ? 'border-chicken-yellow'
              : hasRisk ? 'border-chicken-red/60'
              : s.groups > 0 ? 'border-chicken-brown/10' : 'border-transparent'
            const txt = isSelected ? 'text-white' : isPast && s.groups === 0 ? 'text-chicken-brown/30' : 'text-chicken-brown'

            return (
              <button
                key={dateStr}
                onClick={() => setSelected(dateStr)}
                className={`relative rounded-xl border-2 transition-all hover:shadow-sm overflow-hidden
                  aspect-square sm:aspect-auto sm:min-h-[112px] p-1 sm:p-1.5 flex flex-col items-stretch
                  ${bg} ${border} ${txt}`}
              >
                <div className="flex items-center justify-between leading-none">
                  <span className="text-sm font-black">{dayNum}</span>
                  {isToday && !isSelected && (
                    <span className="w-1.5 h-1.5 rounded-full bg-chicken-yellow" />
                  )}
                </div>

                {s.groups > 0 ? (
                  <div className="flex-1 flex flex-col justify-end gap-1 mt-1 min-w-0">
                    {/* 寬螢幕：時段熱力柱 */}
                    <div className="hidden sm:flex gap-0.5 items-end h-5">
                      {slotKeys.slice(0, 5).map(slot => (
                        <div
                          key={slot}
                          className="flex-1 rounded-t-sm min-h-[3px]"
                          style={{
                            height: `${Math.max(3, (s.slots[slot] / maxSlot) * 20)}px`,
                            backgroundColor: isSelected
                              ? 'rgba(255,255,255,0.85)'
                              : s.slots[slot] >= maxSlot * 0.7 ? '#e60012' : '#f29100',
                          }}
                          title={`${slot}：${s.slots[slot]} 位`}
                        />
                      ))}
                    </div>

                    {/* 組數 + 人數 */}
                    <div className={`text-[10px] sm:text-[11px] font-bold tabular-nums leading-tight
                      ${isSelected ? 'text-white' : 'text-chicken-brown/80'}`}>
                      <span className="sm:hidden">{s.groups}組{s.guests}位</span>
                      <span className="hidden sm:inline">{s.groups} 組 · {s.guests} 位</span>
                    </div>

                    {/* 風險標籤（符號 + 文字，不只靠顏色） */}
                    {hasRisk && (
                      <div className={`text-[9px] font-black rounded px-1 py-0.5 leading-tight w-fit max-w-full truncate
                        ${isSelected ? 'bg-white/25 text-white' : 'bg-chicken-red text-white'}`}>
                        {s.unassigned > 0 ? `⚠待指派${s.unassigned}` : `⏭No-show${s.noshow}`}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex-1" />
                )}
              </button>
            )
          })}
        </div>
      </Card>

      <div>
        <h3 className="font-bold text-chicken-brown mb-2 px-1">📋 {selected} 訂位</h3>
        {dayBookings.length === 0 ? (
          <EmptyState icon="📭" title="這天沒有訂位" />
        ) : (
          <div className="space-y-2">
            {dayBookings.map(b => (
              <BookingCard
                key={b.id}
                booking={b}
                onAssign={onAssignTable}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
