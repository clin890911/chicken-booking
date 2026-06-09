// 即將到達訂位（未來 60 分鐘內 confirmed 的訂位）
import { useMemo } from 'react'
import { useBooking } from '../../../contexts/BookingContext'
import { listUpcoming } from '../../../services/bookingService'
import { todayStr } from '../../../utils/timeSlots'

export default function UpcomingPanel({ onClickBooking, onAssignTable }) {
  const { bookings } = useBooking()
  const today = todayStr()

  // 依時間排序、過濾出今天且未到場、且時間在前後 60 分鐘範圍內
  const upcomingRaw = useMemo(() => listUpcoming(today, 90), [bookings, today])

  // B3：把「已到場時間已過、仍未入座」（時段已過的 confirmed）置頂，
  // 過時越久越前面；其餘維持依時段先後。
  const upcoming = useMemo(() => {
    const now = Date.now()
    const overdueMin = (b) => {
      const [hh, mm] = (b.timeSlot || '00:00').split(':').map(Number)
      const slot = new Date()
      slot.setHours(hh, mm, 0, 0)
      return Math.round((now - slot.getTime()) / 60000) // 正值＝已過 N 分
    }
    return [...upcomingRaw].sort((a, b) => {
      const oa = overdueMin(a) > 0
      const ob = overdueMin(b) > 0
      if (oa !== ob) return oa ? -1 : 1               // 已到未入座置頂
      if (oa && ob) return overdueMin(b) - overdueMin(a) // 過越久越前
      return (a.timeSlot || '').localeCompare(b.timeSlot || '')
    })
  }, [upcomingRaw])

  if (upcoming.length === 0) {
    return (
      <div className="text-center py-6 text-xs text-chicken-brown/40">
        🕒 接下來 90 分鐘無訂位
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {upcoming.map(b => {
        const assigned = !!b.assignedTableId
        const [hh, mm] = (b.timeSlot || '00:00').split(':').map(Number)
        const slot = new Date()
        slot.setHours(hh, mm, 0, 0)
        const diffMin = Math.round((slot - Date.now()) / 60000)
        const overdue = diffMin < 0
        return (
          <div
            key={b.id}
            className={`p-3 rounded-xl border-2 cursor-pointer transition-all
                       ${overdue ? 'border-chicken-red bg-chicken-red/5' : 'border-chicken-brown/10 bg-white hover:border-chicken-yellow/40'}`}
            onClick={() => onClickBooking?.(b)}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-1.5">
                  <span className="text-base font-black text-chicken-brown tabular-nums">{b.timeSlot}</span>
                  <span className="text-sm font-bold truncate">{b.name}</span>
                </div>
                <div className="text-xs text-chicken-brown/60 mt-0.5 truncate">
                  {b.guests} 位 · {b.phone}
                </div>
              </div>
              <div className="text-right flex-shrink-0">
                {overdue ? (
                  <span className="text-[10px] font-bold text-white bg-chicken-red px-2 py-0.5 rounded-full">
                    已到場 {Math.abs(diffMin)} 分
                  </span>
                ) : (
                  <span className="text-[10px] font-bold text-amber-700">{diffMin} 分後</span>
                )}
              </div>
            </div>

            {assigned ? (
              <div className="mt-2 inline-flex items-center gap-1 px-2 py-0.5 bg-chicken-green/15 text-chicken-green rounded-md text-[11px] font-bold">
                ✓ 已指派 {b.assignedTableId}
              </div>
            ) : (
              <button
                onClick={(e) => { e.stopPropagation(); onAssignTable?.(b) }}
                className="mt-2 px-3 min-h-[44px] bg-chicken-red text-white rounded-md text-[11px] font-bold hover:opacity-90"
              >
                指派桌位
              </button>
            )}

            {(b.notes?.pet || b.notes?.child || b.notes?.mobility) && (
              <div className="flex gap-1 mt-1.5">
                {b.notes.pet && <span className="text-[10px] bg-chicken-yellow/15 text-chicken-yellow px-1.5 py-0.5 rounded-full">🐾</span>}
                {b.notes.child && <span className="text-[10px] bg-chicken-green/15 text-chicken-green px-1.5 py-0.5 rounded-full">👶</span>}
                {b.notes.mobility && <span className="text-[10px] bg-chicken-brown/15 text-chicken-brown px-1.5 py-0.5 rounded-full">♿</span>}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
