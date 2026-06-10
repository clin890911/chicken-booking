import { useMemo, useState } from 'react'
import BookingCard from '../booking/BookingCard'
import GroupBatchCard from '../booking/GroupBatchCard'
import { Card, EmptyState } from '../ui'
import { useBooking } from '../../contexts/BookingContext'
import { todayStr, formatDate, addDays, dayLabel } from '../../utils/timeSlots'
import { mergeDayEntries, summarizeDayGroups } from '../../utils/slotEntries'

// 日曆分頁雙態：
//   month（預設）＝整月月曆總覽，點日期 → 自動收合成週條
//   week＝週條（7 日快切 + 前後週）+ 當日訂位清單為主體（散客卡 + 團體梯次卡同框）
// 解決「點日期後清單在月曆下方、使用者以為沒反應」：收合後清單直接在視口內。
// 視圖切換用純條件渲染 + animate-soft-enter（動畫不變量：內容可見性不依賴 JS 回呼）。
export default function CalendarView({ onAssignTable, onOpenGroup }) {
  const { bookings, groupReservations } = useBooking()
  const [cursor, setCursor] = useState(() => {
    const d = new Date()
    return { year: d.getFullYear(), month: d.getMonth() }
  })
  const [selected, setSelected] = useState(todayStr())
  const [view, setView] = useState('month') // month=整月總覽 | week=週條+當日清單

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

  // 各日團體統計（月曆格 🚌 標記 + 當日摘要 chips）
  const groupStats = useMemo(() => {
    const map = {}
    ;(groupReservations || []).forEach(g => {
      if (!g.date || g.status === 'cancelled') return
      if (!map[g.date]) map[g.date] = { count: 0, guests: 0 }
      map[g.date].count += 1
      map[g.date].guests += Number(g.counts?.total) || 0
    })
    return map
  }, [groupReservations])

  // 當月摘要（只計入本月日期）
  const monthSummary = useMemo(() => {
    const prefix = `${cursor.year}-${String(cursor.month + 1).padStart(2, '0')}-`
    let groups = 0, guests = 0, unassigned = 0, groupCount = 0
    Object.entries(stats).forEach(([date, s]) => {
      if (!date.startsWith(prefix)) return
      groups += s.groups
      guests += s.guests
      unassigned += s.unassigned
    })
    Object.entries(groupStats).forEach(([date, s]) => {
      if (!date.startsWith(prefix)) return
      groupCount += s.count
    })
    return { groups, guests, unassigned, groupCount }
  }, [stats, groupStats, cursor])

  // 當日清單：散客（排除取消）+ 團體梯次，依時段排序同框
  const dayEntries = useMemo(() => {
    const dayBookings = bookings.filter(b => b.date === selected && b.status !== 'cancelled')
    return mergeDayEntries(dayBookings, groupReservations, selected)
  }, [bookings, groupReservations, selected])

  const daySummary = useMemo(() => {
    const s = stats[selected] || { groups: 0, guests: 0, unassigned: 0 }
    const g = summarizeDayGroups(groupReservations, selected)
    return { ...s, groupCount: g.groupCount, groupGuests: g.guests }
  }, [stats, groupReservations, selected])

  // 週條的 7 天：從 selected 推導（週日起，與月曆一致；跨月自然正確）
  const weekDays = useMemo(() => {
    const d = new Date(selected + 'T00:00:00')
    const start = addDays(d, -d.getDay())
    return Array.from({ length: 7 }, (_, i) => formatDate(addDays(start, i)))
  }, [selected])

  const goPrev = () => setCursor(c => c.month === 0 ? { year: c.year - 1, month: 11 } : { year: c.year, month: c.month - 1 })
  const goNext = () => setCursor(c => c.month === 11 ? { year: c.year + 1, month: 0 } : { year: c.year, month: c.month + 1 })

  // 點月曆日期 → 收合成週條、清單成為主體
  const pickDate = (dateStr) => {
    setSelected(dateStr)
    setView('week')
  }
  // 週條前後週：selected 平移 7 天（同星期幾換週）
  const shiftWeek = (delta) => setSelected(formatDate(addDays(new Date(selected + 'T00:00:00'), delta * 7)))
  // 展開月曆：游標同步到 selected 的年月
  const expandMonth = () => {
    const d = new Date(selected + 'T00:00:00')
    setCursor({ year: d.getFullYear(), month: d.getMonth() })
    setView('month')
  }

  const weekTitle = useMemo(() => {
    const d = new Date(selected + 'T00:00:00')
    return `${d.getFullYear()}年 ${d.getMonth() + 1}月`
  }, [selected])

  return (
    <div className="space-y-4">
      {view === 'month' ? (
        <div key="month" className="animate-soft-enter">
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
              {monthSummary.groupCount > 0 && (
                <span className="rounded-full bg-indigo-100 px-2.5 py-1 font-bold text-indigo-700 tabular-nums">
                  🚌 {monthSummary.groupCount} 團
                </span>
              )}
              {monthSummary.unassigned > 0 && (
                <span className="rounded-full bg-chicken-red px-2.5 py-1 font-bold text-white tabular-nums">
                  ⚠ 待指派 {monthSummary.unassigned}
                </span>
              )}
              <span className="text-chicken-brown/45 font-bold ml-auto">點日期看當天訂位 ›</span>
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
                const gs = groupStats[dateStr]
                const hasAny = s.groups > 0 || !!gs
                const hasRisk = s.unassigned > 0 || s.noshow > 0

                // 時段熱力柱（取人數最多的前 4 個時段，依時間排序）
                const slotKeys = Object.keys(s.slots).sort()
                const maxSlot = Math.max(...Object.values(s.slots), 1)

                // 背景/邊框優先序：選中 > 今天 > 風險 > 有訂位 > 空
                const bg = isSelected ? 'bg-chicken-red'
                  : isToday ? 'bg-chicken-yellow/15'
                  : hasRisk ? 'bg-chicken-red/5'
                  : hasAny ? 'bg-white' : 'bg-transparent'
                const border = isSelected ? 'border-chicken-red'
                  : isToday ? 'border-chicken-yellow'
                  : hasRisk ? 'border-chicken-red/60'
                  : hasAny ? 'border-chicken-brown/10' : 'border-transparent'
                const txt = isSelected ? 'text-white' : isPast && !hasAny ? 'text-chicken-brown/30' : 'text-chicken-brown'

                return (
                  <button
                    key={dateStr}
                    onClick={() => pickDate(dateStr)}
                    className={`relative rounded-xl border-2 transition-all hover:shadow-sm overflow-hidden
                      aspect-square sm:aspect-auto sm:min-h-[112px] p-1 sm:p-1.5 flex flex-col items-stretch
                      ${bg} ${border} ${txt}`}
                  >
                    <div className="flex items-center justify-between leading-none">
                      <span className="text-sm font-black">{dayNum}</span>
                      {gs ? (
                        <span className={`text-[9px] font-black rounded px-1 leading-tight tabular-nums
                          ${isSelected ? 'bg-white/25 text-white' : 'bg-indigo-100 text-indigo-700'}`}>🚌{gs.count}</span>
                      ) : isToday && !isSelected ? (
                        <span className="w-1.5 h-1.5 rounded-full bg-chicken-yellow" />
                      ) : null}
                    </div>

                    {hasAny ? (
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

                        {/* 組數 + 人數（散客口徑） */}
                        {s.groups > 0 && (
                          <div className={`text-[10px] sm:text-[11px] font-bold tabular-nums leading-tight
                            ${isSelected ? 'text-white' : 'text-chicken-brown/80'}`}>
                            <span className="sm:hidden">{s.groups}組{s.guests}位</span>
                            <span className="hidden sm:inline">{s.groups} 組 · {s.guests} 位</span>
                          </div>
                        )}

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
        </div>
      ) : (
        <div key="week" className="animate-soft-enter space-y-4">
          {/* 週條（收合後的月曆）：前後週 + 7 日快切 + 展開月曆 */}
          <Card>
            <div className="flex items-center justify-between gap-2 mb-2">
              <button onClick={() => shiftWeek(-1)} className="px-3 py-1 rounded-lg hover:bg-chicken-brown/5 text-chicken-brown font-bold">‹</button>
              <h3 className="font-black text-chicken-brown text-sm">{weekTitle}</h3>
              <div className="flex items-center gap-1">
                <button onClick={() => shiftWeek(1)} className="px-3 py-1 rounded-lg hover:bg-chicken-brown/5 text-chicken-brown font-bold">›</button>
                <button onClick={expandMonth}
                  className="px-3 py-1.5 rounded-lg text-xs font-bold bg-white border-2 border-chicken-brown/15 text-chicken-brown whitespace-nowrap">
                  ⛶ 展開月曆
                </button>
              </div>
            </div>
            <div className="grid grid-cols-7 gap-1">
              {weekDays.map(dateStr => {
                const d = new Date(dateStr + 'T00:00:00')
                const w = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()]
                const isSelected = dateStr === selected
                const isToday = dateStr === todayStr()
                const s = stats[dateStr]
                const gs = groupStats[dateStr]
                return (
                  <button
                    key={dateStr}
                    onClick={() => setSelected(dateStr)}
                    className={`rounded-xl border-2 px-0.5 py-1.5 min-h-[56px] flex flex-col items-center justify-start gap-0.5 transition-all
                      ${isSelected ? 'bg-chicken-red border-chicken-red text-white'
                        : isToday ? 'bg-chicken-yellow/15 border-chicken-yellow text-chicken-brown'
                        : 'bg-white border-chicken-brown/10 text-chicken-brown'}`}
                  >
                    <span className={`text-[10px] font-bold leading-none ${isSelected ? 'text-white/80' : 'text-chicken-brown/50'}`}>{w}</span>
                    <span className="text-sm font-black leading-none tabular-nums">{d.getDate()}</span>
                    <span className={`text-[9px] font-bold leading-none tabular-nums ${isSelected ? 'text-white/85' : 'text-chicken-brown/55'}`}>
                      {s ? `${s.groups}組` : gs ? '' : '·'}{gs ? '🚌' : ''}
                    </span>
                  </button>
                )
              })}
            </div>
          </Card>

          {/* 當日清單（主體） */}
          <div>
            <div className="flex items-center gap-2 mb-2 px-1 flex-wrap">
              <h3 className="font-black text-chicken-brown">📋 {dayLabel(selected)}</h3>
              <span className="rounded-full bg-chicken-brown/10 px-2.5 py-0.5 text-xs font-bold text-chicken-brown tabular-nums">
                {daySummary.groups} 組 · {daySummary.guests} 位
              </span>
              {daySummary.groupCount > 0 && (
                <span className="rounded-full bg-indigo-100 px-2.5 py-0.5 text-xs font-bold text-indigo-700 tabular-nums">
                  🚌 {daySummary.groupCount} 團 · {daySummary.groupGuests} 位
                </span>
              )}
              {daySummary.unassigned > 0 && (
                <span className="rounded-full bg-chicken-red px-2.5 py-0.5 text-xs font-bold text-white tabular-nums">
                  ⚠ 待指派 {daySummary.unassigned}
                </span>
              )}
            </div>
            {dayEntries.length === 0 ? (
              <EmptyState icon="📭" title="這天沒有訂位" />
            ) : (
              <div className="space-y-2">
                {dayEntries.map(({ slot, bookings: list, groupBatches }) => (
                  <div key={slot || 'unscheduled'} className="space-y-2">
                    {list.map(b => (
                      <BookingCard key={b.id} booking={b} onAssign={onAssignTable} />
                    ))}
                    {groupBatches.map(({ group, batch }) => (
                      <GroupBatchCard key={`${group.id}:${batch.id || batch.timeSlot}`} group={group} batch={batch} onOpen={onOpenGroup} />
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
