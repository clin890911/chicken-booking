import { useMemo } from 'react'
import { useBooking } from '../../../contexts/BookingContext'
import { listUpcoming } from '../../../services/bookingService'
import { todayStr } from '../../../utils/timeSlots'
import UpcomingPanel from '../floormap/UpcomingPanel'
import WaitlistPanel from './WaitlistPanel'

// 現場右側欄：籤切換（即將到達 / 候位），每籤獨佔全高、badge 顯示待辦數。
// 選中桌時整欄被 TableDrawer 取代（由 OperationsView 控制），籤狀態保留在外層不重設。
export default function OpsRail({ activeTab, onTabChange, onClickBooking, onAssignTable, onSeatWaitlist }) {
  const { bookings, waitlist } = useBooking()
  const today = todayStr()

  // 即將到達且未指派桌（90 分鐘窗，與 UpcomingPanel 同口徑）
  const upcomingCount = useMemo(
    () => listUpcoming(today, 90).filter(b => !b.assignedTableId).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bookings, today],
  )
  const waitingCount = useMemo(
    () => waitlist.filter(w => w.status === 'waiting' || w.status === 'called').length,
    [waitlist],
  )

  const tabs = [
    { key: 'upcoming', label: '即將到達', badge: upcomingCount },
    { key: 'waitlist', label: '候位', badge: waitingCount },
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
        {effective === 'upcoming' && (
          <UpcomingPanel onClickBooking={onClickBooking} onAssignTable={onAssignTable} />
        )}
        {effective === 'waitlist' && (
          <WaitlistPanel onSeatWaitlist={onSeatWaitlist} />
        )}
      </div>
    </div>
  )
}
