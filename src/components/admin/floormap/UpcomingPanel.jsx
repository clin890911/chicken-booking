// 今日訂位「脈動」：過時未到（最優先處理）/ 90 分內將到 / 之後（收合）。
// 之前只看未來 90 分窗：晚上時早上的 no-show 完全消失、無人處理 → 改為全日三段。
import { useMemo, useState, useEffect } from 'react'
import { useBooking } from '../../../contexts/BookingContext'
import { useToast } from '../../ui/Toast'
import { todayStr } from '../../../utils/timeSlots'
import { classifyTodayPulse, overdueMinOf, fmtOverdueMin } from '../../../utils/bookingPulse'

function BookingCard({ b, now, onClickBooking, onAssignTable, onSeat, onNoshow }) {
  const overdueMin = overdueMinOf(b.timeSlot, now)
  const overdue = overdueMin > 15 // 與 classifyTodayPulse graceMin 同口徑
  const assigned = !!b.assignedTableId
  return (
    <div
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
              {fmtOverdueMin(overdueMin)}
            </span>
          ) : (
            <span className="text-[10px] font-bold text-amber-700">
              {overdueMin > 0 ? '到店時間' : `${-overdueMin} 分後`}
            </span>
          )}
        </div>
      </div>

      <div className="mt-2 flex items-center gap-2 flex-wrap">
        {assigned ? (
          <>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-chicken-green/15 text-chicken-green rounded-md text-[11px] font-bold">
              ✓ 已指派 {b.assignedTableId}
            </span>
            {/* 客人到了（含遲到後才到）：直接入座，免再點桌位 → 抽屜 */}
            <button
              onClick={(e) => { e.stopPropagation(); onSeat?.(b) }}
              className="px-3 min-h-[44px] bg-chicken-green text-white rounded-md text-[11px] font-bold hover:opacity-90"
            >
              ✅ 客人到了
            </button>
          </>
        ) : (
          <button
            onClick={(e) => { e.stopPropagation(); onAssignTable?.(b) }}
            className="px-3 min-h-[44px] bg-chicken-red text-white rounded-md text-[11px] font-bold hover:opacity-90"
          >
            指派桌位
          </button>
        )}
        {overdue && (
          <button
            onClick={(e) => { e.stopPropagation(); onNoshow?.(b) }}
            className="px-3 min-h-[44px] bg-white border border-chicken-red/40 text-chicken-red rounded-md text-[11px] font-bold hover:bg-chicken-red/5"
          >
            標 No-show
          </button>
        )}
      </div>

      {(b.notes?.pet || b.notes?.child || b.notes?.mobility) && (
        <div className="flex gap-1 mt-1.5">
          {b.notes.pet && <span className="text-[10px] bg-chicken-yellow/15 text-chicken-yellow px-1.5 py-0.5 rounded-full">🐾</span>}
          {b.notes.child && <span className="text-[10px] bg-chicken-green/15 text-chicken-green px-1.5 py-0.5 rounded-full">👶</span>}
          {b.notes.mobility && <span className="text-[10px] bg-chicken-brown/15 text-chicken-brown px-1.5 py-0.5 rounded-full">♿</span>}
        </div>
      )}
    </div>
  )
}

export default function UpcomingPanel({ onClickBooking, onAssignTable }) {
  const { bookings, setStatus, seatBooking } = useBooking()
  const toast = useToast()
  const today = todayStr()
  const [showLater, setShowLater] = useState(false)

  // 30 秒 tick：時間推移會讓卡片從「將到」掉進「過時未到」
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000)
    return () => clearInterval(id)
  }, [])

  const { overdue, soon, later } = useMemo(
    () => classifyTodayPulse(bookings, today, now),
    [bookings, today, now],
  )

  const handleNoshow = (b) => {
    setStatus(b.id, 'noshow')
    toast.action(`${b.name}（${b.timeSlot}）已標記 No-show`,
      { label: '↩ 復原', onClick: () => { setStatus(b.id, 'confirmed'); toast.success(`已復原 ${b.name} 為待到`) } },
      { duration: 8000 })
  }

  // 客人到了（含遲到後才到）：對已指派的訂位直接入座（status→arrived、桌→用餐中）
  const handleSeat = (b) => {
    const r = seatBooking(b.id)
    if (!r?.ok) return toast.error('入座失敗：' + (r?.error || '未知錯誤'))
    toast.success(`✅ ${b.name} 已入座 ${b.assignedTableId}`)
  }

  if (overdue.length + soon.length + later.length === 0) {
    return (
      <div className="text-center py-6 text-xs text-chicken-brown/40">
        ✅ 今日已無待到訂位
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {overdue.length > 0 && (
        <div className="space-y-2">
          <div className="text-[11px] font-black text-chicken-red">⚠ 過時未到（{overdue.length} 組）— 請聯絡或標記</div>
          {overdue.map(b => (
            <BookingCard key={b.id} b={b} now={now}
              onClickBooking={onClickBooking} onAssignTable={onAssignTable} onSeat={handleSeat} onNoshow={handleNoshow} />
          ))}
        </div>
      )}

      {soon.length > 0 && (
        <div className="space-y-2">
          <div className="text-[11px] font-black text-chicken-brown/65">🔜 90 分內將到（{soon.length} 組）</div>
          {soon.map(b => (
            <BookingCard key={b.id} b={b} now={now}
              onClickBooking={onClickBooking} onAssignTable={onAssignTable} onSeat={handleSeat} onNoshow={handleNoshow} />
          ))}
        </div>
      )}

      {later.length > 0 && (
        <div>
          <button
            onClick={() => setShowLater(v => !v)}
            className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-chicken-brown/5 text-xs font-bold text-chicken-brown/65 hover:bg-chicken-brown/10"
          >
            <span>之後（{later.length} 組）</span>
            <span className="text-[10px]">{showLater ? '收合 ▲' : '展開 ▼'}</span>
          </button>
          {showLater && (
            <div className="mt-2 space-y-2">
              {later.map(b => (
                <BookingCard key={b.id} b={b} now={now}
                  onClickBooking={onClickBooking} onAssignTable={onAssignTable} onSeat={handleSeat} onNoshow={handleNoshow} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
