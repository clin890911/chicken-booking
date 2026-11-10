import { useMemo, useState, useEffect } from 'react'
import { useBooking } from '../../../contexts/BookingContext'
import { todayStr } from '../../../utils/timeSlots'
import { classifyTodayPulse } from '../../../utils/bookingPulse'
import { groupBatchEntries } from '../../../utils/todayTimeline'
import UpcomingPanel from '../floormap/UpcomingPanel'
import WaitlistPanel from './WaitlistPanel'
import FastWalkInPanel from './FastWalkInPanel'
import QuickReservePanel from './QuickReservePanel'

// 現場左側欄：籤切換（帶位 / 今日 / 候位），每籤獨佔全高、badge 顯示待辦數。
// 方案 A（2026-11 demo）：原「今日訂位」「團體」兩籤併成「今日」一條時間清單——團體每一梯是一列，
//   跟散客排在一起（UpcomingPanel＋GroupBatchRow）。「團體」籤移除；舊的 'groups' 籤 key（例如
//   選桌模式記下的來源籤）一律導到「今日」。
// 選中桌時整欄被 TableDrawer 取代（由 OperationsView 控制），籤狀態保留在外層不重設。
// reserve（非 null）＝「新增今日訂位」內嵌面板開著：整欄（含籤列）換成 QuickReservePanel，
//   props 原樣轉發；籤列不顯示，填到一半不會被誤切籤丟資料（返回鈕在面板頂端）。
// flashBookingId：剛新增的那筆，今日籤捲到可見並閃一下。
export default function OpsRail({
  suspended = false,
  activeTab, onTabChange, onClickBooking, onOpenDetail, onAssignTable, quickAssignFor = null, onQuickAssign = null, onArriveSeat, onMoveTable, onSeatWaitlist, onConvertWaitlist, onFocusTable, onReseatBatch,
  onAddBooking, reserve = null, flashBookingId = null,
  // 帶位籤（v3）：桌與人數的真相在 OperationsView，這裡純轉發給 FastWalkInPanel
  // canWalkIn：無散客入座權限（唯讀角色 kitchen）時整個帶位籤不渲染——面板底部的「確認入座」會寫 bookings＋tables
  canWalkIn = true,
  walkinGuests, onWalkinGuestsChange, walkinTables, onRemoveWalkinTable, onClearWalkinTables,
  walkinWarning, onWalkinSeat, lastParty, onLocateSuggestion, onApplySuggestion, showNextWaitlist, onNextWaitlist,
}) {
  const { bookings, waitlist, groupReservations, tables } = useBooking()
  const today = todayStr()

  // 30 秒 tick：badge 跟著時間推移更新（將到 → 過時未到）
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000)
    return () => clearInterval(id)
  }, [])

  // badge＝散客待到：過時未到全部（就算已指派也要人處理）+ 90 分內將到且未指派（與 UpcomingPanel 同口徑）
  //       ＋團體未入座梯次（未釋出、沒有任何桌指向它；原「團體」籤的待辦併進來）
  const upcomingCount = useMemo(() => {
    const { overdue, soon } = classifyTodayPulse(bookings, today, now)
    const pendingBatches = groupBatchEntries(groupReservations, tables, today).filter(e => !e.inProgress).length
    return overdue.length + soon.filter(b => !b.assignedTableId).length + pendingBatches
  }, [bookings, groupReservations, tables, today, now])
  const waitingCount = useMemo(
    () => waitlist.filter(w => w.status === 'waiting' || w.status === 'called').length,
    [waitlist],
  )
  const tabs = [
    ...(canWalkIn ? [{ key: 'walkin', label: '帶位', badge: 0 }] : []),
    { key: 'upcoming', label: '今日', badge: upcomingCount },
    { key: 'waitlist', label: '候位', badge: waitingCount },
  ]
  const requested = activeTab === 'groups' ? 'upcoming' : activeTab // 舊「團體」籤 → 今日
  const effective = tabs.some(t => t.key === requested) ? requested : tabs[0].key

  if (reserve) {
    return (
      <div className="bg-white rounded-xl border border-chicken-brown/10 overflow-hidden h-full min-h-0 phone:h-auto flex flex-col">
        <QuickReservePanel {...reserve} />
      </div>
    )
  }

  return (
    // h-full min-h-0 flex-col：帶位面板要能把「滑動帶位」釘在欄位底部（捲動發生在面板內部）
    // 手機條件（phone:）：整頁捲，高度跟內容走，面板裡不再有自己的捲動區
    <div className="bg-white rounded-xl border border-chicken-brown/10 overflow-hidden h-full min-h-0 phone:h-auto flex flex-col">
      {/* 籤列＝膠囊分段（Liquid Glass 控制樣式）：選中鏡片畫在按鈕 ::after（styles/glass.css .lg-tabs），
          按鈕本身維持 44px 觸控高度、0 垂直外距——左欄常態要一面式不捲，裝飾不能吃高度 */}
      <div className="lg-tabs flex-none flex gap-0.5 px-1 bg-chicken-brown/[0.045]">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => onTabChange(t.key)}
            data-active={effective === t.key ? 'true' : undefined}
            className={`flex-1 min-h-[44px] px-2 py-2.5 text-sm font-bold relative ${
              effective === t.key
                ? 'text-chicken-red'
                : 'text-chicken-brown/55 hover:text-chicken-brown'
            }`}
          >
            {t.label}
            {t.badge > 0 && (
              <span className="ml-1.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-chicken-red text-white text-[10px] font-bold align-middle">
                {t.badge > 99 ? '99+' : t.badge}
              </span>
            )}
          </button>
        ))}
      </div>
      {/* 帶位籤：面板自己管捲動與釘底動作列（直接吃滿剩餘高度）
          其他籤：維持原本內距與整區捲動 */}
      {effective === 'walkin' ? (
        <FastWalkInPanel
          suspended={suspended}
          onLocateSuggestion={onLocateSuggestion}
          onApplySuggestion={onApplySuggestion}
          showNextWaitlist={showNextWaitlist}
          onNextWaitlist={onNextWaitlist}
          guests={walkinGuests}
          onGuestsChange={onWalkinGuestsChange}
          tables={walkinTables}
          onRemoveTable={onRemoveWalkinTable}
          onClearTables={onClearWalkinTables}
          warning={walkinWarning}
          onSeat={onWalkinSeat}
          lastParty={lastParty}
          onOpenTable={onFocusTable}
        />
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto p-4 phone:flex-none phone:overflow-visible">
          {effective === 'upcoming' && (
            <>
              {/* 現場接到電話要加今天的訂位：左欄原地換成內嵌新增面板（不跳頁、桌況圖一直看得到）。
                  無 booking.create 權限（廚房唯讀）不渲染，與卡片動作鈕同慣例。 */}
              {onAddBooking && (
                <button
                  onClick={onAddBooking}
                  className="w-full mb-3 min-h-[44px] rounded-lg border-2 border-dashed border-chicken-red/40 text-chicken-red text-sm font-bold hover:bg-chicken-red/5"
                >
                  ＋ 新增今日訂位
                </button>
              )}
              <UpcomingPanel onClickBooking={onClickBooking} onOpenDetail={onOpenDetail} onAssignTable={onAssignTable} quickAssignFor={quickAssignFor} onQuickAssign={onQuickAssign} onArriveSeat={onArriveSeat} onMoveTable={onMoveTable}
                flashBookingId={flashBookingId} onFocusTable={onFocusTable} onReseatBatch={onReseatBatch} />
            </>
          )}
          {effective === 'waitlist' && (
            <WaitlistPanel onSeatWaitlist={onSeatWaitlist} onConvert={onConvertWaitlist} />
          )}
        </div>
      )}
    </div>
  )
}
