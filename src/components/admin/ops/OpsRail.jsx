import { useMemo, useState, useEffect } from 'react'
import { useBooking } from '../../../contexts/BookingContext'
import { todayStr } from '../../../utils/timeSlots'
import { todayGroupsByState } from '../../../utils/groupLive'
import { classifyTodayPulse } from '../../../utils/bookingPulse'
import UpcomingPanel from '../floormap/UpcomingPanel'
import WaitlistPanel from './WaitlistPanel'
import GroupTodayPanel from './GroupTodayPanel'
import FastWalkInPanel from './FastWalkInPanel'

// 現場右側欄：籤切換（即將到達 / 候位 / 今日團體），每籤獨佔全高、badge 顯示待辦數。
// 今日沒有團體時不渲染「今日團體」籤（一天 0~5 團的稀疏性，無團體日不佔空間）。
// 選中桌時整欄被 TableDrawer 取代（由 OperationsView 控制），籤狀態保留在外層不重設。
export default function OpsRail({ activeTab, onTabChange, onClickBooking, onAssignTable, onSeatWaitlist, onFocusTable, onReseatBatch, onStartWalkin }) {
  const { bookings, waitlist, groupReservations } = useBooking()
  const today = todayStr()

  // 30 秒 tick：badge 跟著時間推移更新（將到 → 過時未到）
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000)
    return () => clearInterval(id)
  }, [])

  // badge＝過時未到全部（就算已指派也要人處理）+ 90 分內將到且未指派（與 UpcomingPanel 同口徑）
  const upcomingCount = useMemo(() => {
    const { overdue, soon } = classifyTodayPulse(bookings, today, now)
    return overdue.length + soon.filter(b => !b.assignedTableId).length
  }, [bookings, today, now])
  const waitingCount = useMemo(
    () => waitlist.filter(w => w.status === 'waiting' || w.status === 'called').length,
    [waitlist],
  )
  const { active: activeGroups, completed: completedGroups } = useMemo(
    () => todayGroupsByState(groupReservations, today),
    [groupReservations, today],
  )

  const tabs = [
    { key: 'walkin', label: '帶位', badge: 0 },
    { key: 'upcoming', label: '脈動', badge: upcomingCount },
    { key: 'waitlist', label: '候位', badge: waitingCount },
    // 全完成的日子籤仍在（badge 0），才能回去印回傳單
    ...(activeGroups.length + completedGroups.length > 0
      ? [{ key: 'groups', label: '團體', badge: activeGroups.length }] : []),
  ]
  const effective = tabs.some(t => t.key === activeTab) ? activeTab : tabs[0].key

  return (
    <div className="bg-white rounded-xl border border-chicken-brown/10 overflow-hidden">
      <div className="flex border-b border-chicken-brown/10">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => onTabChange(t.key)}
            className={`flex-1 min-h-[44px] px-2 py-2.5 text-sm font-bold transition-colors relative ${
              effective === t.key
                ? 'text-chicken-red bg-chicken-red/5 border-b-2 border-chicken-red -mb-px'
                : 'text-chicken-brown/55 hover:text-chicken-brown'
            }`}
          >
            {t.label}
            {t.badge > 0 && (
              <span className="ml-1.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-chicken-red text-white text-[10px] font-black align-middle">
                {t.badge > 99 ? '99+' : t.badge}
              </span>
            )}
          </button>
        ))}
      </div>
      <div className="p-4">
        {effective === 'walkin' && (
          <FastWalkInPanel onStart={onStartWalkin} />
        )}
        {effective === 'upcoming' && (
          <UpcomingPanel onClickBooking={onClickBooking} onAssignTable={onAssignTable} />
        )}
        {effective === 'waitlist' && (
          <WaitlistPanel onSeatWaitlist={onSeatWaitlist} />
        )}
        {effective === 'groups' && (
          <GroupTodayPanel onFocusTable={onFocusTable} onReseatBatch={onReseatBatch} />
        )}
      </div>
    </div>
  )
}
