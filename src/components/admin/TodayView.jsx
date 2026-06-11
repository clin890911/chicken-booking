import { useMemo, useState } from 'react'
import BookingCard from '../booking/BookingCard'
import GroupBatchCard from '../booking/GroupBatchCard'
import StatsCard from './StatsCard'
import { EmptyState } from '../ui'
import { useBooking } from '../../contexts/BookingContext'
import { todayStr } from '../../utils/timeSlots'
import { mergeDayEntries, summarizeDayGroups } from '../../utils/slotEntries'

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

export default function TodayView({ onAssignTable, onOpenGroup }) {
  const { bookings, groupReservations } = useBooking()
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
        (b.assignedTableId || '').toLowerCase().includes(q) ||
        (b.id || '').toLowerCase().includes(q)
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
    // LINE 綁定率：LINE-first 重構的成效指標（rich menu 上線前後對比用）
    const lineBound = todayAll.filter(b => b.lineUserId && !b.linePushBlocked).length
    return { totalGroups, totalGuests, arrivedGroups, dining, unassigned, lineBound }
  }, [bookings, today])

  // 團體梯次同框（判斷時段用餐狀況）：source filter 只在「全部/團體」時顯示團體卡；
  // 「隱藏已離」同步隱藏已完成的團。
  const visibleGroups = useMemo(() => {
    if (source !== 'all' && source !== 'group') return []
    let list = groupReservations || []
    if (hideCompleted) list = list.filter(g => g.status !== 'completed')
    return list
  }, [groupReservations, source, hideCompleted])

  const entries = useMemo(
    () => mergeDayEntries(filtered, visibleGroups, today),
    [filtered, visibleGroups, today],
  )

  const groupSummary = useMemo(
    () => summarizeDayGroups(groupReservations, today),
    [groupReservations, today],
  )

  // B10：時段「接近滿」門檻——取各時段最高人數（散客+團體），且需達合理絕對量（避免冷門日誤報）
  const slotPeakGuests = useMemo(() => {
    let peak = 0
    entries.forEach(e => {
      const g = e.bookings.reduce((s, b) => s + Number(b.guests || 0), 0)
        + e.groupBatches.reduce((s, x) => s + (Number(x.batch?.guests) || 0), 0)
      if (g > peak) peak = g
    })
    return peak
  }, [entries])

  return (
    <div className="space-y-4">
      {/* 統計（散客口徑） */}
      <div className="grid grid-cols-2 sm:grid-cols-6 gap-2">
        <StatsCard label="今日訂位" value={`${stats.totalGroups}`} color="red" />
        <StatsCard label="總人數" value={`${stats.totalGuests}`} color="yellow" />
        <StatsCard label="未指派" value={`${stats.unassigned}`} color="red" />
        <StatsCard label="用餐中" value={`${stats.dining}`} color="brown" />
        <StatsCard label="已到/離" value={`${stats.arrivedGroups}`} color="green" />
        <StatsCard label="LINE 已綁" value={`${stats.lineBound}/${stats.totalGroups}`} color="green" />
      </div>

      {/* 今日團體一覽（與散客分開計，避免口徑混淆） */}
      {groupSummary.groupCount > 0 && (
        <div className="rounded-xl border-2 border-indigo-200 bg-indigo-50/60 px-3 py-2 text-xs font-bold text-indigo-700">
          🚌 今日團體 {groupSummary.groupCount} 團 · {groupSummary.guests} 位 — 梯次卡列在各時段，點卡開團單
        </div>
      )}

      {/* 搜尋 + Filter */}
      <div className="space-y-2">
        <div className="flex gap-2 items-center">
          <input
            type="search"
            placeholder="搜尋姓名 / 電話 / 桌號 / 編號"
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

      {/* 列表（散客卡 + 團體梯次卡同時段同框） */}
      {entries.length === 0 ? (
        filtered.length === 0 && (query || source !== 'all') ? (
          <EmptyState icon="🔍" title="找不到符合的訂位" hint="試試其他關鍵字或清除過濾條件" />
        ) : (
          <EmptyState icon="🍽️" title="今日尚無訂位" hint="客人線上訂位後會出現在這裡" />
        )
      ) : (
        entries.map(({ slot, bookings: list, groupBatches }) => {
          const walkinGuests = list.reduce((s, b) => s + Number(b.guests || 0), 0)
          const groupGuests = groupBatches.reduce((s, x) => s + (Number(x.batch?.guests) || 0), 0)
          // 接近滿：達當日尖峰且絕對人數 ≥ 8（合理門檻，避免冷門日誤報）
          const nearFull = slotPeakGuests >= 8 && (walkinGuests + groupGuests) >= slotPeakGuests
          return (
          <div key={slot || 'unscheduled'}>
            <div className="flex items-center gap-2 mb-2 px-1">
              <span className="text-base font-black text-chicken-red tabular-nums">{slot || '未排時段'}</span>
              <div className="flex-1 h-px bg-chicken-brown/10" />
              {nearFull && (
                <span className="text-xs font-bold px-2 py-1 rounded-full bg-chicken-red/10 text-chicken-red whitespace-nowrap">
                  🔴 接近滿
                </span>
              )}
              {groupBatches.length > 0 && (
                <span className="text-xs font-bold px-2 py-1 rounded-full bg-indigo-100 text-indigo-700 tabular-nums whitespace-nowrap">
                  🚌 {groupBatches.length} 梯 / {groupGuests} 位
                </span>
              )}
              {list.length > 0 && (
                <span className={`text-sm font-bold px-2.5 py-1 rounded-full tabular-nums whitespace-nowrap
                  ${nearFull ? 'bg-chicken-red/10 text-chicken-red' : 'bg-chicken-brown/10 text-chicken-brown/80'}`}>
                  {list.length} 組 / {walkinGuests} 位
                </span>
              )}
            </div>
            <div className="space-y-2">
              {list.map(b => (
                <BookingCard key={b.id} booking={b} onAssign={onAssignTable} />
              ))}
              {groupBatches.map(({ group, batch }) => (
                <GroupBatchCard key={`${group.id}:${batch.id || batch.timeSlot}`} group={group} batch={batch} onOpen={onOpenGroup} />
              ))}
            </div>
          </div>
          )
        })
      )}
    </div>
  )
}
