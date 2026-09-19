import { useMemo, useState } from 'react'
import BookingCard from '../booking/BookingCard'
import GroupBatchCard from '../booking/GroupBatchCard'
import { Card, EmptyState, Button } from '../ui'
import { useBooking } from '../../contexts/BookingContext'
import { totalActiveSeats } from '../../utils/capacity'
import Icon from '../ui/Icon'
import { todayStr, formatDate, addDays, dayLabel } from '../../utils/timeSlots'
import { mergeDayEntries, summarizeDayGroups } from '../../utils/slotEntries'

// 日曆分頁雙態：
//   month（預設）＝整月月曆總覽，點日期 → 自動收合成週條
//   week＝週條（7 日快切 + 前後週）+ 當日訂位清單為主體（散客卡 + 團體梯次卡同框）
// 解決「點日期後清單在月曆下方、使用者以為沒反應」：收合後清單直接在視口內。
// 視圖切換用純條件渲染 + animate-soft-enter（動畫不變量：內容可見性不依賴 JS 回呼）。
export default function CalendarView({ onAssignTable, onOpenGroup, onAddBooking, onMoveTable }) {
  const { bookings, groupReservations, tables } = useBooking()
  const totalSeats = useMemo(() => totalActiveSeats(tables || []), [tables]) // 熱圖分母；測試的 mock context 可能不帶 tables
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
    let groups = 0, guests = 0, unassigned = 0, groupCount = 0, groupGuests = 0
    Object.entries(stats).forEach(([date, s]) => {
      if (!date.startsWith(prefix)) return
      groups += s.groups
      guests += s.guests
      unassigned += s.unassigned
    })
    Object.entries(groupStats).forEach(([date, s]) => {
      if (!date.startsWith(prefix)) return
      groupCount += s.count
      groupGuests += s.guests
    })
    return { groups, guests, unassigned, groupCount, groupGuests }
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

  // 過去的日期不該新增訂位（字串比較：日期格式皆為 'YYYY-MM-DD'）
  const isPastSelected = selected < todayStr()

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
            <div className="flex items-center gap-2.5 mb-3 flex-wrap">
              <h3 className="font-semibold text-lg sm:text-xl text-chicken-brown tracking-tight">{cursor.year}年 {cursor.month + 1}月</h3>
              <div className="text-xs text-chicken-brown/60 tabular-nums">
                {monthSummary.groups} 組 · {monthSummary.guests} 位{monthSummary.groupCount > 0 ? ` · ${monthSummary.groupCount} 團 · ${monthSummary.groupGuests} 位` : ''}
              </div>
              {monthSummary.unassigned > 0 && (
                <span className="rounded-full bg-chicken-red/10 px-2 py-0.5 text-[11px] font-semibold text-chicken-red tabular-nums">待指派 {monthSummary.unassigned}</span>
              )}
              <div className="flex-1" />
              <span className="hidden sm:inline text-[11px] text-chicken-brown/45">點日期看當天訂位</span>
              <button type="button" onClick={goPrev} aria-label="上個月" className="tap w-8 h-8 rounded-lg border border-chicken-brown/15 text-chicken-brown flex items-center justify-center hover:bg-chicken-brown/[0.04]"><Icon name="chevronLeft" size={14} strokeWidth={2.2} /></button>
              <button type="button" onClick={goNext} aria-label="下個月" className="tap w-8 h-8 rounded-lg border border-chicken-brown/15 text-chicken-brown flex items-center justify-center hover:bg-chicken-brown/[0.04]"><Icon name="chevronRight" size={14} strokeWidth={2.2} /></button>
            </div>

            <div className="grid grid-cols-7 gap-1 sm:gap-1.5 text-center text-[11px] font-semibold text-chicken-brown/50 mb-1">
              {['日', '一', '二', '三', '四', '五', '六'].map(w => <div key={w} className="py-1">{w}</div>)}
            </div>

            <div className="grid grid-cols-7 gap-1 sm:gap-1.5">
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

                // 熱圖格（與規劃頁月曆同款）：底色 = 當日總人數 / 全店可用席，大數字 = 總人數，小字 = 幾組 · 幾團。
                const total = (s.guests || 0) + (gs?.guests || 0)
                const ratio = totalSeats > 0 ? Math.min(1, total / totalSeats) : 0
                const level = ratio <= 0 ? 0 : ratio < 0.1 ? 1 : ratio < 0.25 ? 2 : ratio < 0.4 ? 3 : ratio < 0.7 ? 4 : 5
                const HEAT = ['#ffffff', '#fff3e2', '#fde7c9', '#fbd6a6', '#f39a5e', '#e6552e']
                const caption = [s.groups > 0 && `${s.groups} 組`, gs && `${gs.count} 團`].filter(Boolean).join(' · ')
                const ring = isSelected ? 'ring-2 ring-chicken-red ring-offset-2 ring-offset-white'
                  : isToday ? 'ring-[1.5px] ring-inset ring-chicken-red'
                  : level === 0 ? 'ring-1 ring-inset ring-chicken-brown/[0.08]' : ''
                const numColor = isPast ? 'text-chicken-brown/40' : level >= 4 ? 'text-white' : 'text-chicken-brown'
                const dayColor = isToday ? 'text-chicken-red' : level >= 4 ? 'text-white/85' : isPast ? 'text-chicken-brown/35' : 'text-chicken-brown/60'
                const capColor = level >= 4 ? 'text-white/85' : 'text-chicken-brown/55'

                return (
                  <button
                    key={dateStr}
                    type="button"
                    onClick={() => pickDate(dateStr)}
                    aria-pressed={isSelected}
                    style={{ backgroundColor: HEAT[level] }}
                    className={`tap relative rounded-[10px] transition-shadow overflow-hidden
                      aspect-square sm:aspect-auto sm:min-h-[76px] flex flex-col items-center justify-center gap-px ${ring}`}
                  >
                    <span className={`absolute top-1.5 left-2 text-[11px] font-bold leading-none ${dayColor}`}>{dayNum}</span>
                    {/* 風險（待指派 / no-show）：右上紅點 + 展開時的小標，不只靠顏色 */}
                    {hasRisk && (
                      <span className={`absolute top-1.5 right-1.5 hidden sm:inline-flex items-center h-4 px-1.5 rounded-full text-[9px] font-bold leading-none ${isSelected || level >= 4 ? 'bg-white text-chicken-red' : 'bg-chicken-red text-white'}`}>
                        {s.unassigned > 0 ? `待指派 ${s.unassigned}` : `No-show ${s.noshow}`}
                      </span>
                    )}
                    {hasRisk && <span className="absolute top-1.5 right-1.5 sm:hidden w-2 h-2 rounded-full bg-chicken-red ring-2 ring-white" />}
                    {hasAny ? (
                      <>
                        <span className={`text-lg sm:text-[22px] font-bold leading-tight tracking-tight tabular-nums ${numColor}`}>{total}</span>
                        {caption && <span className={`hidden sm:block text-[10px] leading-3 whitespace-nowrap tabular-nums ${capColor}`}>{caption}</span>}
                      </>
                    ) : null}
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
              <button type="button" onClick={() => shiftWeek(-1)} aria-label="上一週" className="tap w-8 h-8 rounded-lg border border-chicken-brown/15 text-chicken-brown flex items-center justify-center"><Icon name="chevronLeft" size={14} strokeWidth={2.2} /></button>
              <h3 className="font-semibold text-chicken-brown text-sm">{weekTitle}</h3>
              <div className="flex items-center gap-1">
                <button type="button" onClick={() => shiftWeek(1)} aria-label="下一週" className="tap w-8 h-8 rounded-lg border border-chicken-brown/15 text-chicken-brown flex items-center justify-center"><Icon name="chevronRight" size={14} strokeWidth={2.2} /></button>
                <button onClick={expandMonth}
                  className="px-3 py-1.5 rounded-lg text-xs font-bold bg-white border border-chicken-brown/10 text-chicken-brown whitespace-nowrap">
                  展開月曆
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
                    type="button"
                    aria-pressed={isSelected}
                    className={`tap rounded-[10px] px-0.5 py-1.5 min-h-[56px] flex flex-col items-center justify-start gap-0.5 transition-shadow bg-white
                      ${isSelected ? 'ring-2 ring-chicken-red text-chicken-red'
                        : isToday ? 'ring-[1.5px] ring-inset ring-chicken-red text-chicken-brown'
                        : 'ring-1 ring-inset ring-chicken-brown/[0.08] text-chicken-brown'}`}
                  >
                    <span className={`text-[10px] font-semibold leading-none ${isSelected ? 'text-chicken-red/70' : 'text-chicken-brown/50'}`}>{w}</span>
                    <span className="text-sm font-bold leading-none tabular-nums">{d.getDate()}</span>
                    <span className={`text-[9px] font-semibold leading-none tabular-nums ${isSelected ? 'text-chicken-red/80' : 'text-chicken-brown/55'}`}>
                      {s?.groups ? `${s.groups}` : ''}{gs ? `${s?.groups ? ' ' : ''}${gs.count}` : ''}{!s?.groups && !gs ? '·' : ''}
                    </span>
                  </button>
                )
              })}
            </div>
          </Card>

          {/* 當日清單（主體） */}
          <div>
            <div className="flex items-center gap-2 mb-2 px-1 flex-wrap">
              <h3 className="font-bold text-chicken-brown">{dayLabel(selected)}</h3>
              <span className="rounded-full bg-chicken-brown/10 px-2.5 py-0.5 text-xs font-bold text-chicken-brown tabular-nums">
                {daySummary.groups} 組 · {daySummary.guests} 位
              </span>
              {daySummary.groupCount > 0 && (
                <span className="rounded-full bg-indigo-100 px-2.5 py-0.5 text-xs font-bold text-indigo-700 tabular-nums">
                  {daySummary.groupCount} 團 · {daySummary.groupGuests} 位
                </span>
              )}
              {daySummary.unassigned > 0 && (
                <span className="rounded-full bg-chicken-red px-2.5 py-0.5 text-xs font-bold text-white tabular-nums">
                  待指派 {daySummary.unassigned}
                </span>
              )}
              {/* 過去的日期不該新增訂位；空狀態時另有 EmptyState 內建的入口 */}
              {onAddBooking && !isPastSelected && dayEntries.length > 0 && (
                <button
                  type="button"
                  onClick={() => onAddBooking(selected)}
                  className="ml-auto px-3 py-1.5 rounded-lg text-xs font-bold bg-chicken-red text-white hover:bg-chicken-red/90 active:scale-[.98] transition-all whitespace-nowrap min-h-[32px]"
                >
                  ＋ 新增訂位
                </button>
              )}
            </div>
            {dayEntries.length === 0 ? (
              <EmptyState
                icon="inbox"
                title="這天沒有訂位"
                action={onAddBooking && !isPastSelected ? (
                  <Button onClick={() => onAddBooking(selected)}>＋ 新增訂位</Button>
                ) : null}
              />
            ) : (
              <div className="space-y-2">
                {dayEntries.map(({ slot, bookings: list, groupBatches }) => (
                  <div key={slot || 'unscheduled'} className="space-y-2">
                    {list.map(b => (
                      <BookingCard key={b.id} booking={b} onAssign={onAssignTable} onMove={onMoveTable} />
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
