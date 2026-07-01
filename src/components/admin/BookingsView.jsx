import { useState, useEffect, useRef } from 'react'
import TodayView from './TodayView'
import CalendarView from './CalendarView'
import AddBookingView from './AddBookingView'
import SearchBookingsView from './SearchBookingsView'

const SUB_TABS = [
  { key: 'today', label: '今日', icon: '📋' },
  { key: 'calendar', label: '日曆', icon: '📅' },
  { key: 'search', label: '查詢', icon: '🔍' },
  { key: 'add', label: '新增', icon: '➕' },
]

// 訂位總頁：合併 今日 / 日曆 / 新增 為 sub-tabs
// 「指派桌」按鈕呼叫 onAssignTable（今天→現場、未來日→規劃排位地圖，由 AdminPage 分流）；
// 團體卡點擊呼叫 onOpenGroup → 規劃頁團單詳情
export default function BookingsView({ onAssignTable, onOpenGroup, onCreated, openAdd }) {
  const [sub, setSub] = useState(openAdd ? 'add' : 'today')
  // 名冊帶入預填時跳到「新增」子分頁（seq 變更才觸發，避免重複跳）
  const lastSeq = useRef(openAdd?.seq)
  useEffect(() => {
    if (openAdd && openAdd.seq !== lastSeq.current) { lastSeq.current = openAdd.seq; setSub('add') }
  }, [openAdd])

  return (
    <div className="space-y-3">
      <div className="flex gap-1.5 bg-white p-1 rounded-xl border border-chicken-brown/10 max-w-fit">
        {SUB_TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setSub(t.key)}
            className={`px-4 py-2 rounded-lg text-sm font-bold transition-all flex items-center gap-1.5 ${
              sub === t.key
                ? 'bg-chicken-red text-white'
                : 'text-chicken-brown/60 hover:text-chicken-brown'
            }`}
          >
            <span>{t.icon}</span>
            <span>{t.label}</span>
          </button>
        ))}
      </div>

      {/* 子頁切換不用 AnimatePresence mode="wait"（v11 exit 回呼遺失 bug，詳見 BookingPage） */}
      <div key={sub} className="animate-soft-enter">
          {sub === 'today' && <TodayView onAssignTable={onAssignTable} onOpenGroup={onOpenGroup} />}
          {sub === 'calendar' && <CalendarView onAssignTable={onAssignTable} onOpenGroup={onOpenGroup} />}
          {sub === 'search' && <SearchBookingsView onAssignTable={onAssignTable} />}
          {sub === 'add' && <AddBookingView initial={openAdd} onCreated={(b) => { setSub('today'); onCreated?.(b) }} onAssignTable={onAssignTable} />}
      </div>
    </div>
  )
}
