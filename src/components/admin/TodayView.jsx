import { useMemo, useRef, useState } from 'react'
import { Filter } from 'lucide-react'
import BookingCard from '../booking/BookingCard'
import GroupBatchCard from '../booking/GroupBatchCard'
import StatsCard from './StatsCard'
import { EmptyState } from '../ui'
import { useBooking } from '../../contexts/BookingContext'
import { todayStr } from '../../utils/timeSlots'
import { mergeDayEntries, summarizeDayGroups } from '../../utils/slotEntries'
import { computeStoreStats } from '../../utils/opsAlerts'
import {
  SOURCE_OPTIONS, defaultTodayFilter, isAllSources, isDefaultTodayFilter, toggleSource, selectAllSources, onlySource,
  isArrivedFilter, toggleArrivedFilter, filterTodayBookings, filterTodayGroups, summarizeTodayFilter,
} from '../../utils/todayFilter'

const STATUS_PRIORITY = {
  confirmed: 0,
  reserved: 1,
  arrived: 2,
  completed: 3,
  noshow: 4,
}

// onOpenSeating：統計卡「未指派」→ 今天的「當日排位」（BookingsView 的日曆子分頁＋DaySeatingPanel，預設選最早一筆未配桌）
// onGoOps：統計卡「用餐中」→ 現場頁（用餐中的桌在現場管理）
export default function TodayView({ onAssignTable, onOpenGroup, onMoveTable, onOpenSeating, onGoOps }) {
  const { bookings, groupReservations, tables } = useBooking()
  const today = todayStr()
  const [query, setQuery] = useState('')
  // 篩選（來源多選＋隱藏已離＋只看已到/離）：一顆「篩選」鈕收起來，見 utils/todayFilter。
  // 不持久化（原本「隱藏已離」就只是元件 state，重新整理回預設）。
  const [filter, setFilter] = useState(defaultTodayFilter)
  const listRef = useRef(null)
  const allSources = isAllSources(filter.sources)
  const summary = summarizeTodayFilter(filter)

  const filtered = useMemo(() => {
    const list = filterTodayBookings(bookings, today, filter, query)
    return [...list].sort((a, b) => {
      const byTime = (a.timeSlot || '').localeCompare(b.timeSlot || '')
      if (byTime) return byTime
      const aUnassigned = a.status === 'confirmed' && !a.assignedTableId ? 0 : 1
      const bUnassigned = b.status === 'confirmed' && !b.assignedTableId ? 0 : 1
      if (aUnassigned !== bUnassigned) return aUnassigned - bUnassigned
      return (STATUS_PRIORITY[a.status] ?? 9) - (STATUS_PRIORITY[b.status] ?? 9)
    })
  }, [bookings, today, filter, query])

  // 統計不受篩選影響（一律今日全部散客）。用餐中改用現場頂列同一支 computeStoreStats（桌數＋在席人數，含團體桌），
  // 跟現場頁「用餐中 N 桌 · M 人」同口徑——點了就是去現場頁看那些桌。
  const stats = useMemo(() => {
    const todayAll = bookings.filter(b => b.date === today && b.status !== 'cancelled')
    const sum = (list) => list.reduce((s, b) => s + Number(b.guests || 0), 0)
    const arrived = todayAll.filter(b => b.status === 'arrived' || b.status === 'completed')
    const unassigned = todayAll.filter(b => b.status === 'confirmed' && !b.assignedTableId)
    const store = computeStoreStats({ tables: tables || [], bookings, today })
    return {
      totalGroups: todayAll.length, totalGuests: sum(todayAll),
      arrivedGroups: arrived.length, arrivedGuests: sum(arrived),
      unassigned: unassigned.length, unassignedGuests: sum(unassigned),
      diningTables: store.dining, diningGuests: store.occSeats,
    }
  }, [bookings, tables, today])

  // 團體梯次同框（判斷時段用餐狀況）：有勾「團體」才顯示團體卡；「隱藏已離」同步隱藏已完成的團。
  const visibleGroups = useMemo(() => filterTodayGroups(groupReservations, filter), [groupReservations, filter])

  const scrollListTop = () => { if (listRef.current) listRef.current.scrollTop = 0 }
  const showAll = () => { setFilter(defaultTodayFilter()); setQuery(''); scrollListTop() }
  const toggleArrived = () => { setFilter(f => toggleArrivedFilter(f)); scrollListTop() }
  const arrivedActive = isArrivedFilter(filter)
  const menuKeyDown = (e) => {
    if (e.key !== 'Escape') return
    const el = e.currentTarget.closest('details'); el.open = false; el.querySelector('summary').focus()
  }

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

  // 版面（頁面捲動第 2 批・A，2026-10-31）：iPad（md 以上）頁首（統計、團體一覽、搜尋＋來源篩選）固定，
  // 只有下方清單自己捲（data-testid=today-list）；lg 以上清單改 2 欄格狀（每個時段一組，時段標題橫跨兩欄）。
  // 高度鏈由 BookingsView／index.css 的 [data-fill-page] 串起來，這裡只接 flex-1＋min-h-0，不加固定高。
  // 手機（< md）維持原本整頁捲動。
  return (
    <div className="space-y-4 md:flex md:flex-col md:flex-1 md:min-h-0">
      <div data-testid="today-header" className="space-y-3 md:flex-shrink-0">
      {/* 統計（散客口徑；用餐中＝現場口徑）：每格都可以點（Barry 2026-10-31）。
          漏斗＝在本頁篩選（今日訂位→看全部、已到/離→只看已到）；箭頭＝跳去別頁（未指派→當日排位、用餐中→現場）。 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <StatsCard
          testId="stat-total" label="今日訂位" color="red" kind="filter" hint="看全部"
          value={<Pair a={stats.totalGroups} unitA="組" b={stats.totalGuests} />}
          onClick={showAll} active={false}
          ariaLabel={`今日訂位 ${stats.totalGroups} 組 ${stats.totalGuests} 人，顯示全部`}
        />
        <StatsCard
          testId="stat-unassigned" label="未指派" color="red" kind="nav" hint="去排位" disabledHint="都排好了"
          value={<Pair a={stats.unassigned} unitA="組" b={stats.unassignedGuests} />}
          onClick={onOpenSeating ? () => onOpenSeating(today) : undefined} disabled={stats.unassigned === 0}
          ariaLabel={`未指派 ${stats.unassigned} 組 ${stats.unassignedGuests} 人，前往排位`}
        />
        <StatsCard
          testId="stat-dining" label="用餐中" color="brown" kind="nav" hint="去現場"
          value={<Pair a={stats.diningTables} unitA="桌" b={stats.diningGuests} />}
          onClick={onGoOps}
          ariaLabel={`用餐中 ${stats.diningTables} 桌 ${stats.diningGuests} 人，前往現場`}
        />
        <StatsCard
          testId="stat-arrived" label="已到/離" color="green" kind="filter" hint={arrivedActive ? '取消' : '看已到'}
          value={<Pair a={stats.arrivedGroups} unitA="組" b={stats.arrivedGuests} />}
          onClick={toggleArrived} active={arrivedActive}
          ariaLabel={`已到/離 ${stats.arrivedGroups} 組 ${stats.arrivedGuests} 人，${arrivedActive ? '取消只看已到' : '只看已到和已離'}`}
        />
      </div>

      {/* 今日團體一覽（與散客分開計，避免口徑混淆） */}
      {groupSummary.groupCount > 0 && (
        <div className="rounded-xl border border-indigo-200 bg-indigo-50/60 px-3 py-2 text-xs font-semibold text-indigo-700">
          今日團體 {groupSummary.groupCount} 團 · {groupSummary.guests} 位 — 梯次卡列在各時段，點卡開團單
        </div>
      )}

      {/* 搜尋＋「篩選」鈕同一列（2026-10-31：來源分段鈕＋「隱藏已離」併成一顆可勾選的選單，省掉一整列）。
          選單沿用 details[data-popover]（utils/popoverDismiss：點外面／Esc／按下選單裡的按鈕會收）；
          勾選框不是按鈕 → 勾來勾去選單不會收，多選才方便；「只看」「重設」「完成」是按鈕 → 按了就收。 */}
      <div className="flex gap-2 items-center">
        <input
          type="search"
          placeholder="搜尋姓名 / 電話 / 桌號 / 編號"
          value={query}
          onChange={e => setQuery(e.target.value)}
          className="input flex-1 min-w-0"
        />
        <details data-popover data-testid="today-filter" className="relative flex-shrink-0">
          <summary
            aria-label={summary.aria}
            className={`tap cursor-pointer list-none [&::-webkit-details-marker]:hidden min-h-[44px] px-3 flex items-center gap-1.5 rounded-[10px] border text-sm font-bold whitespace-nowrap
              focus:outline-none focus-visible:ring-2 focus-visible:ring-chicken-red/50
              ${summary.isDefault ? 'bg-white border-chicken-brown/15 text-chicken-brown' : 'bg-chicken-brown text-white border-chicken-brown'}`}
          >
            <Filter size={16} strokeWidth={2.2} aria-hidden="true" />
            <span className="max-w-[12rem] truncate">{summary.label}</span>
            {!summary.isDefault && (
              <span aria-hidden="true" className="min-w-[20px] h-5 px-1 rounded-full bg-white text-chicken-brown text-xs font-black tabular-nums flex items-center justify-center">{summary.count}</span>
            )}
          </summary>
          <div
            role="group"
            aria-label="訂位篩選選項"
            onKeyDown={menuKeyDown}
            className="absolute right-0 z-30 mt-1 w-[17rem] max-w-[calc(100vw-2rem)] bg-white border border-chicken-brown/15 rounded-xl shadow-lg p-1.5 flex flex-col text-chicken-brown"
          >
            <p className="px-2 pt-1 pb-0.5 text-xs font-bold text-chicken-brown/70">來源</p>
            <label className="min-h-[44px] px-2 flex items-center gap-2.5 rounded-lg hover:bg-chicken-brown/5 cursor-pointer text-sm font-bold">
              <input
                type="checkbox"
                className="w-5 h-5 accent-chicken-red"
                checked={allSources}
                ref={el => { if (el) el.indeterminate = !allSources }}
                onChange={() => setFilter(f => ({ ...f, sources: selectAllSources() }))}
              />
              <span>全部來源</span>
            </label>
            {SOURCE_OPTIONS.map(o => {
              const checked = filter.sources.has(o.key)
              const last = checked && filter.sources.size === 1
              return (
                <div key={o.key} className="flex items-center rounded-lg hover:bg-chicken-brown/5">
                  <label className="flex-1 min-h-[44px] pl-6 pr-2 flex items-center gap-2.5 cursor-pointer text-sm">
                    <input
                      type="checkbox"
                      className="w-5 h-5 accent-chicken-red"
                      checked={checked}
                      disabled={last}
                      onChange={() => setFilter(f => ({ ...f, sources: toggleSource(f.sources, o.key) }))}
                    />
                    <span>{o.label}</span>
                    {last && <span className="text-xs text-chicken-brown/70">至少留一個</span>}
                  </label>
                  <button
                    type="button"
                    aria-label={`只看${o.label}`}
                    onClick={() => setFilter(f => ({ ...f, sources: onlySource(o.key) }))}
                    className="min-h-[44px] min-w-[44px] px-2.5 text-xs font-bold text-chicken-brown/70 rounded-lg hover:bg-chicken-brown/10"
                  >只看</button>
                </div>
              )
            })}
            <div className="my-1 border-t border-chicken-brown/10" />
            <p className="px-2 pt-1 pb-0.5 text-xs font-bold text-chicken-brown/70">狀態</p>
            <label className="min-h-[44px] px-2 flex items-center gap-2.5 rounded-lg hover:bg-chicken-brown/5 cursor-pointer text-sm">
              <input
                type="checkbox"
                className="w-5 h-5 accent-chicken-red"
                checked={filter.hideCompleted}
                onChange={e => { const v = e.target.checked; setFilter(f => ({ ...f, hideCompleted: v })) }}
              />
              <span>隱藏已離</span>
            </label>
            <label className="min-h-[44px] px-2 flex items-center gap-2.5 rounded-lg hover:bg-chicken-brown/5 cursor-pointer text-sm">
              <input
                type="checkbox"
                className="w-5 h-5 accent-chicken-red"
                checked={filter.arrivedOnly}
                onChange={e => { const v = e.target.checked; setFilter(f => ({ ...f, arrivedOnly: v })) }}
              />
              <span>只看已到／已離</span>
            </label>
            <div className="mt-1 pt-1 border-t border-chicken-brown/10 flex gap-1">
              <button
                type="button"
                onClick={() => setFilter(defaultTodayFilter())}
                disabled={isDefaultTodayFilter(filter)}
                className="flex-1 min-h-[44px] rounded-lg text-sm font-bold text-chicken-brown/80 hover:bg-chicken-brown/5 disabled:text-chicken-brown/55 disabled:cursor-default"
              >重設</button>
              <button
                type="button"
                className="flex-1 min-h-[44px] rounded-lg text-sm font-bold bg-chicken-brown text-white"
              >完成</button>
            </div>
          </div>
        </details>
      </div>
      </div>

      {/* 列表（散客卡 + 團體梯次卡同時段同框）：iPad 上自己捲動；lg 以上卡片 2 欄 */}
      <div ref={listRef} data-testid="today-list" className="space-y-4 md:flex-1 md:min-h-0 md:overflow-y-auto md:overscroll-y-contain md:-mx-1 md:px-1 md:pb-2">
      {entries.length === 0 ? (
        filtered.length === 0 && (query || !allSources || filter.arrivedOnly) ? (
          <EmptyState icon="search" title="找不到符合的訂位" hint="試試其他關鍵字或清除過濾條件" />
        ) : (
          <EmptyState icon="utensils" title="今日尚無訂位" hint="客人線上訂位後會出現在這裡" />
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
              <span className="text-base font-bold text-chicken-red tabular-nums">{slot || '未排時段'}</span>
              <div className="flex-1 h-px bg-chicken-brown/10" />
              {nearFull && (
                <span className="text-xs font-bold px-2 py-1 rounded-full bg-chicken-red/10 text-chicken-red whitespace-nowrap">
                  接近滿
                </span>
              )}
              {groupBatches.length > 0 && (
                <span className="text-xs font-bold px-2 py-1 rounded-full bg-indigo-100 text-indigo-700 tabular-nums whitespace-nowrap">
                  {groupBatches.length} 梯 / {groupGuests} 位
                </span>
              )}
              {list.length > 0 && (
                <span className={`text-sm font-bold px-2.5 py-1 rounded-full tabular-nums whitespace-nowrap
                  ${nearFull ? 'bg-chicken-red/10 text-chicken-red' : 'bg-chicken-brown/10 text-chicken-brown/80'}`}>
                  {list.length} 組 / {walkinGuests} 位
                </span>
              )}
            </div>
            <div className="grid grid-cols-1 gap-2 lg:grid-cols-2 lg:items-start">
              {list.map(b => (
                <BookingCard key={b.id} booking={b} onAssign={onAssignTable} onMove={onMoveTable} />
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
    </div>
  )
}

// 「12 組 · 48 人」：主數字大字、單位與人數小字（同現場頂列）
function Pair({ a, unitA, b }) {
  return <>{a}<span className="text-sm font-semibold text-chicken-brown/60"> {unitA} · </span>{b}<span className="text-sm font-semibold text-chicken-brown/60"> 人</span></>
}
