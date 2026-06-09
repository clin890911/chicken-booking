import { useMemo, useState } from 'react'
import BookingCard from '../booking/BookingCard'
import { EmptyState } from '../ui'
import { useBooking } from '../../contexts/BookingContext'
import { searchBookings } from '../../utils/bookingId'
import { dayLabel } from '../../utils/timeSlots'

// 後台「🔍 查詢」分頁：用訂位編號 / 姓名 / 電話查詢，跨所有日期、含已取消。
// 員工端 bookings 已是全量同步（BookingContext），故純前端比對即可，不需後端。
export default function SearchBookingsView({ onAssignTable }) {
  const { bookings, pullCloud } = useBooking()
  const [query, setQuery] = useState('')
  const [hideCancelled, setHideCancelled] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  const results = useMemo(
    () => searchBookings(bookings, query, { includeCancelled: !hideCancelled }),
    [bookings, query, hideCancelled],
  )

  // 依日期分組（searchBookings 已排序：日期新到舊、同日時段早到晚）
  const grouped = useMemo(() => {
    const map = new Map()
    results.forEach(b => {
      const key = b.date || '—'
      if (!map.has(key)) map.set(key, [])
      map.get(key).push(b)
    })
    return Array.from(map.entries())
  }, [results])

  const trimmed = query.trim()
  // 看起來像訂位編號（B 開頭、夠長）時，提供「重新整理再查」突破本機同步空窗
  const looksLikeCode = /^b/i.test(trimmed) && trimmed.replace(/\s/g, '').length > 8

  const handleRefresh = async () => {
    if (!pullCloud) return
    setRefreshing(true)
    try { await pullCloud() } finally { setRefreshing(false) }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <input
          type="search"
          autoFocus
          placeholder="輸入訂位編號 / 姓名 / 電話"
          value={query}
          onChange={e => setQuery(e.target.value)}
          className="input w-full"
        />
        <label className="flex items-center gap-1.5 text-xs text-chicken-brown/70">
          <input type="checkbox" checked={hideCancelled} onChange={e => setHideCancelled(e.target.checked)} />
          <span>隱藏已取消</span>
        </label>
      </div>

      {!trimmed ? (
        <EmptyState
          icon="🔍"
          title="用訂位編號查詢"
          hint="輸入客人的訂位編號（例 BMQ60M3900491），或姓名 / 電話。跨所有日期、含已取消都查得到。"
        />
      ) : results.length === 0 ? (
        <div className="space-y-3">
          <EmptyState icon="🔍" title="查無此訂位" hint="請確認編號是否正確；若是剛建立的訂位，可重新整理後再查一次。" />
          {looksLikeCode && (
            <div className="text-center">
              <button
                onClick={handleRefresh}
                disabled={refreshing}
                className="text-sm px-4 min-h-[44px] bg-white border border-chicken-brown/15 text-chicken-brown rounded-lg font-bold hover:border-chicken-red/40 disabled:opacity-50"
              >
                {refreshing ? '重新整理中…' : '🔄 重新整理並再查'}
              </button>
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="px-1 text-sm font-black text-chicken-brown">找到 {results.length} 筆訂位</div>
          {grouped.map(([date, list]) => (
            <div key={date}>
              <div className="flex items-center gap-2 mb-2 px-1">
                <span className="text-base font-black text-chicken-red">
                  {date === '—' ? '未排日期' : dayLabel(date)}
                </span>
                <div className="flex-1 h-px bg-chicken-brown/10" />
                <span className="text-sm font-bold px-2.5 py-1 rounded-full tabular-nums whitespace-nowrap bg-chicken-brown/10 text-chicken-brown/80">
                  {list.length} 筆
                </span>
              </div>
              <div className="space-y-2">
                {list.map(b => (
                  <BookingCard key={b.id} booking={b} onAssign={onAssignTable} />
                ))}
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  )
}
