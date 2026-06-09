import { useMemo, useState } from 'react'
import BookingCard from '../booking/BookingCard'
import StatsCard from './StatsCard'
import { EmptyState } from '../ui'
import { useBooking } from '../../contexts/BookingContext'
import { todayStr, generateTimeSlots } from '../../utils/timeSlots'

const SOURCE_FILTERS = [
  { key: 'all',    label: '全部' },
  { key: 'online', label: '線上' },
  { key: 'phone',  label: '電話' },
  { key: 'walkin', label: '現場' },
  { key: 'group',  label: '團體' },
  { key: 'line',   label: 'LINE' },
]

const STATUS_PRIORITY = {
  confirmed: 0,
  reserved: 1,
  arrived: 2,
  completed: 3,
  noshow: 4,
}

export default function TodayView({ onAssignTable }) {
  const { bookings, settings } = useBooking()
  const today = todayStr()
  const [query, setQuery] = useState('')
  const [source, setSource] = useState('all')
  const [hideCompleted, setHideCompleted] = useState(true)

  const filtered = useMemo(() => {
    let list = bookings.filter(b => b.date === today && b.status !== 'cancelled')
    if (hideCompleted) list = list.filter(b => b.status !== 'completed')
    if (source !== 'all') list = list.filter(b => b.source === source)
    if (query.trim()) {
      const q = query.trim().toLowerCase()
      list = list.filter(b =>
        (b.name || '').toLowerCase().includes(q) ||
        (b.phone || '').includes(q) ||
        (b.assignedTableId || '').toLowerCase().includes(q)
      )
    }
    return [...list].sort((a, b) => {
      const byTime = (a.timeSlot || '').localeCompare(b.timeSlot || '')
      if (byTime) return byTime
      const aUnassigned = a.status === 'confirmed' && !a.assignedTableId ? 0 : 1
      const bUnassigned = b.status === 'confirmed' && !b.assignedTableId ? 0 : 1
      if (aUnassigned !== bUnassigned) return aUnassigned - bUnassigned
      return (STATUS_PRIORITY[a.status] ?? 9) - (STATUS_PRIORITY[b.status] ?? 9)
    })
  }, [bookings, today, source, query, hideCompleted])

  const stats = useMemo(() => {
    const todayAll = bookings.filter(b => b.date === today && b.status !== 'cancelled')
    const totalGroups = todayAll.length
    const totalGuests = todayAll.reduce((s, b) => s + Number(b.guests || 0), 0)
    const arrivedGroups = todayAll.filter(b => b.status === 'arrived' || b.status === 'completed').length
    const dining = todayAll.filter(b => b.status === 'arrived').length
    const unassigned = todayAll.filter(b => b.status === 'confirmed' && !b.assignedTableId).length
    return { totalGroups, totalGuests, arrivedGroups, dining, unassigned }
  }, [bookings, today])

  const grouped = useMemo(() => {
    const slots = generateTimeSlots(settings.openTime, settings.closeTime, settings.slotInterval)
    const map = {}
    slots.forEach(s => { map[s] = [] })
    filtered.forEach(b => {
      if (!map[b.timeSlot]) map[b.timeSlot] = []
      map[b.timeSlot].push(b)
    })
    return Object.entries(map).filter(([, list]) => list.length > 0)
  }, [filtered, settings])

  // B10：時段「接近滿」門檻——取各時段最高人數，且需達合理絕對量（避免冷門日誤報）
  const slotPeakGuests = useMemo(() => {
    let peak = 0
    grouped.forEach(([, list]) => {
      const g = list.reduce((s, b) => s + Number(b.guests || 0), 0)
      if (g > peak) peak = g
    })
    return peak
  }, [grouped])

  return (
    <div className="space-y-4">
      {/* 統計 */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        <StatsCard label="今日訂位" value={`${stats.totalGroups}`} color="red" />
        <StatsCard label="總人數" value={`${stats.totalGuests}`} color="yellow" />
        <StatsCard label="未指派" value={`${stats.unassigned}`} color="red" />
        <StatsCard label="用餐中" value={`${stats.dining}`} color="brown" />
        <StatsCard label="已到/離" value={`${stats.arrivedGroups}`} color="green" />
      </div>

      {/* 搜尋 + Filter */}
      <div className="space-y-2">
        <div className="flex gap-2 items-center">
          <input
            type="search"
            placeholder="搜尋姓名 / 電話 / 桌號"
            value={query}
            onChange={e => setQuery(e.target.value)}
            className="input flex-1"
          />
          <label className="flex items-center gap-1.5 text-xs text-chicken-brown/70 whitespace-nowrap">
            <input type="checkbox" checked={hideCompleted} onChange={e => setHideCompleted(e.target.checked)} />
            <span>隱藏已離</span>
          </label>
        </div>
        <div className="flex gap-1.5 overflow-x-auto no-scrollbar -mx-1 px-1">
          {SOURCE_FILTERS.map(f => (
            <button
              key={f.key}
              onClick={() => setSource(f.key)}
              className={`px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap transition-all
                ${source === f.key
                  ? 'bg-chicken-red text-white shadow'
                  : 'bg-white border border-chicken-brown/15 text-chicken-brown/70 hover:border-chicken-red/40'}`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* 列表 */}
      {grouped.length === 0 ? (
        filtered.length === 0 && (query || source !== 'all') ? (
          <EmptyState icon="🔍" title="找不到符合的訂位" hint="試試其他關鍵字或清除過濾條件" />
        ) : (
          <EmptyState icon="🍽️" title="今日尚無訂位" hint="客人線上訂位後會出現在這裡" />
        )
      ) : (
        grouped.map(([slot, list]) => {
          const slotGuests = list.reduce((s, b) => s + Number(b.guests || 0), 0)
          // 接近滿：達當日尖峰且絕對人數 ≥ 8（合理門檻，避免冷門日誤報）
          const nearFull = slotPeakGuests >= 8 && slotGuests >= slotPeakGuests
          return (
          <div key={slot}>
            <div className="flex items-center gap-2 mb-2 px-1">
              <span className="text-base font-black text-chicken-red tabular-nums">{slot}</span>
              <div className="flex-1 h-px bg-chicken-brown/10" />
              {nearFull && (
                <span className="text-xs font-bold px-2 py-1 rounded-full bg-chicken-red/10 text-chicken-red whitespace-nowrap">
                  🔴 接近滿
                </span>
              )}
              <span className={`text-sm font-bold px-2.5 py-1 rounded-full tabular-nums whitespace-nowrap
                ${nearFull ? 'bg-chicken-red/10 text-chicken-red' : 'bg-chicken-brown/10 text-chicken-brown/80'}`}>
                {list.length} 組 / {slotGuests} 位
              </span>
            </div>
            <div className="space-y-2">
              {list.map(b => (
                <BookingCard key={b.id} booking={b} onAssign={onAssignTable} />
              ))}
            </div>
          </div>
          )
        })
      )}
    </div>
  )
}
