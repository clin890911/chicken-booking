import { useState, useEffect, useRef } from 'react'
import DaySeatingPanel from './planning/DaySeatingPanel'
import { addDays, formatDate } from '../../utils/timeSlots'
import { useScrollToTopOn } from '../../hooks/useScrollToTopOn'
import TodayView from './TodayView'
import CalendarView from './CalendarView'
import AddBookingView from './AddBookingView'
import SearchBookingsView from './SearchBookingsView'
import SegmentedControl from '../ui/SegmentedControl'
import { useAuth } from '../../contexts/AuthContext'

const SUB_TABS = [
  { key: 'today', label: '今日', icon: 'today' },
  { key: 'calendar', label: '日曆', icon: 'calendar' },
  { key: 'search', label: '查詢', icon: 'search' },
  { key: 'add', label: '新增', icon: 'plus' },
]

// 訂位總頁：合併 今日 / 日曆 / 新增 為 sub-tabs
// 「指派桌」按鈕呼叫 onAssignTable（今天→現場、未來日→規劃排位地圖，由 AdminPage 分流）；
// 「改桌」呼叫 onMoveTable（今日待到、已有桌 → 現場頁 move 模式，由 AdminPage 跨頁）；
// 團體卡點擊呼叫 onOpenGroup → 規劃頁團單詳情
// 所有新增入口（直接點「新增」、日曆選日、名冊帶預填）都是連續新增：存檔後留在新增畫面、
// 保留日期＋時段，只清客人欄位——電話一通接一通，不必每存一筆就被帶回「今日」再點回來。
// 日曆點日期 → 直接進「當日排位」（與規劃頁同一個 DaySeatingPanel）；「月曆」返回回到這裡的日曆（停在該日清單）。
// 訂位卡的動作（聯絡／編輯／取消訂位／更多／交班事項）在排位畫面選中訂位時都有（同一份 useBookingActions）。
export default function BookingsView({ onAssignTable, onMoveTable, onOpenGroup, onCreated, openAdd }) {
  // 新增訂位要 booking.create；唯讀角色（kitchen）沒有「新增」子分頁、日曆也不出現「＋ 新增訂位」，
  // 名冊預填（openAdd）更不會把他送進新增表單。fail-closed：useAuth() 無 Provider 時視為無權。
  const canCreate = !!useAuth()?.can?.('booking.create')
  const [sub, setSubRaw] = useState(openAdd && canCreate ? 'add' : 'today')
  // 當日排位（日曆子分頁內）：null＝看日曆；有日期＝排位畫面。日曆元件保持掛載（隱藏），返回時月份／收合狀態都還在。
  const [seatDate, setSeatDate] = useState(null)
  const [calFocus, setCalFocus] = useState(null) // 從排位返回時，日曆停在排位最後看的那天
  const setSub = (k) => { setSeatDate(null); setSubRaw(k === 'add' && !canCreate ? 'today' : k) }
  const closeSeating = () => { setCalFocus({ date: seatDate, seq: Date.now() }); setSeatDate(null) }
  // 新增表單的預填：可能來自名冊（openAdd prop）或日曆選日期後按「＋ 新增訂位」（本地觸發）。
  // 兩條路共用同一個 state，誰後觸發就以誰為準（都帶 seq，AddBookingView 依 seq 變更才重灌欄位）。
  const [addPrefill, setAddPrefill] = useState(openAdd || null)
  // 名冊帶入預填時跳到「新增」子分頁（seq 變更才觸發，避免重複跳）
  const lastSeq = useRef(openAdd?.seq)
  useEffect(() => {
    if (openAdd && canCreate && openAdd.seq !== lastSeq.current) {
      lastSeq.current = openAdd.seq
      setAddPrefill(openAdd)
      setSub('add')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openAdd, canCreate])

  // 日曆選定日期後按「＋ 新增訂位」：只帶日期（不含 phone/name/source），
  // AddBookingView 端會依欄位是否存在守門，不會洗掉使用者已填的姓名電話。
  const handleAddBookingFromCalendar = (dateStr) => {
    if (!canCreate) return
    setAddPrefill({ date: dateStr, seq: Date.now() })
    setSub('add')
  }

  // 子分頁切換捲回頂端（今日清單捲到很下面再切「新增」，表單不該停在半路）
  const rootRef = useScrollToTopOn(seatDate ? `seat:${sub}` : sub)

  // 一面式子頁（頁面捲動第 2 批・A）：今日／新增在 iPad（md 以上）不整頁捲動——頁首固定、清單／表單自己捲。
  // 高度鏈：AdminPage 內容區（index.css 的 [data-fill-page] 規則）→ 這層 → 子頁根元素，一路 flex column＋min-h-0，不加固定高。
  // 日曆／查詢維持整頁捲動（日曆收合區、查詢結果長度不定，另案處理）。
  const fill = sub === 'today' || (sub === 'add' && canCreate)
  const fillCls = fill ? ' md:flex md:flex-col md:flex-1 md:min-h-0' : ''

  return (
    <div ref={rootRef} data-fill-page={fill ? '' : undefined} className={`space-y-3${fillCls}`}>
      <div className="sticky top-0 z-20 py-1 bg-chicken-cream md:flex-shrink-0">
      <SegmentedControl options={canCreate ? SUB_TABS : SUB_TABS.filter(t => t.key !== 'add')} value={sub} onChange={setSub} ariaLabel="訂位子分頁" />
      </div>

      {/* 子頁切換不用 AnimatePresence mode="wait"（v11 exit 回呼遺失 bug，詳見 BookingPage） */}
      <div key={sub} className={`animate-soft-enter${fillCls}`}>
          {sub === 'today' && <TodayView onAssignTable={onAssignTable} onMoveTable={onMoveTable} onOpenGroup={onOpenGroup} />}
          {sub === 'calendar' && (
            <>
              <div hidden={!!seatDate} style={seatDate ? { display: 'none' } : undefined}>
                <CalendarView onAssignTable={onAssignTable} onMoveTable={onMoveTable} onOpenGroup={onOpenGroup}
                  onOpenDay={setSeatDate} onPlanDay={setSeatDate} focusDate={calFocus}
                  onAddBooking={canCreate ? handleAddBookingFromCalendar : undefined} />
              </div>
              {seatDate && (
                <DaySeatingPanel
                  date={seatDate}
                  onShiftDay={(d) => setSeatDate(prev => formatDate(addDays(new Date(prev + 'T00:00:00'), d)))}
                  onBackToCalendar={closeSeating}
                  onOpenGroup={onOpenGroup ? (groupId) => onOpenGroup({ id: groupId, date: seatDate }) : undefined}
                  onMoveTable={onMoveTable}
                  onAddBooking={canCreate ? handleAddBookingFromCalendar : undefined}
                />
              )}
            </>
          )}
          {sub === 'search' && <SearchBookingsView onAssignTable={onAssignTable} onMoveTable={onMoveTable} />}
          {sub === 'add' && canCreate && <AddBookingView initial={addPrefill} continuous onCreated={(b) => onCreated?.(b)} onAssignTable={onAssignTable} onMoveTable={onMoveTable} />}
      </div>
    </div>
  )
}
