// 今日訂位「脈動」：過時未到（最優先處理）/ 90 分內將到 / 之後（收合）。
// 之前只看未來 90 分窗：晚上時早上的 no-show 完全消失、無人處理 → 改為全日三段。
import { useMemo, useState, useEffect } from 'react'
import { useBooking } from '../../../contexts/BookingContext'
import { useAuth } from '../../../contexts/AuthContext'
import { useToast, useConfirm } from '../../ui/Toast'
import { todayStr } from '../../../utils/timeSlots'
import { classifyTodayPulse, overdueMinOf, fmtOverdueMin } from '../../../utils/bookingPulse'
import { buildGroupHolds, todayActiveGroups } from '../../../utils/groupLive'
import { findPreassignedBooking } from '../../../utils/capacity'
import { getNoshowCount, revokeNoshow } from '../../../services/bookingService'

function BookingCard({ b, now, onClickBooking, onAssignTable, onSeat, onNoshow, onComplete, canComplete }) {
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
            title="標記後會計入這支電話的爽約次數，影響之後訂位風險提示"
            className="px-3 min-h-[44px] bg-white border border-chicken-red/40 text-chicken-red rounded-md text-[11px] font-bold hover:bg-chicken-red/5"
          >
            標 No-show
          </button>
        )}
        {overdue && canComplete && (
          <button
            onClick={(e) => { e.stopPropagation(); onComplete?.(b) }}
            title="客人其實有來、也吃完了，只是當下沒點系統入座"
            className="px-3 min-h-[44px] bg-white border border-chicken-green/50 text-chicken-green rounded-md text-[11px] font-bold hover:bg-chicken-green/5"
          >
            ✓ 已完成
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
  const { bookings, tables, groupReservations, setStatus, seatBooking, completeWithoutSeating, undoCompleteWithoutSeating } = useBooking()
  const { can } = useAuth() || {}
  const toast = useToast()
  const confirm = useConfirm()
  const today = todayStr()
  const [showLater, setShowLater] = useState(false)

  // 「已完成」需要改 booking，若該筆有指派桌位還要一併釋出桌 → 兩個權限都要有才顯示鈕。
  // 沒指派桌位的訂位只需 booking.update。
  const canCompleteBooking = !!can?.('booking.update')
  const canCompleteWithTable = canCompleteBooking && !!can?.('table.update')

  // 今日團體圈桌（未入座）→ 散客直接入座前用來防呆，避免坐掉團體保留桌
  const groupHoldTables = useMemo(
    () => buildGroupHolds(todayActiveGroups(groupReservations, today), tables),
    [groupReservations, tables, today],
  )

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

  // No-show 會計入該電話的爽約次數（影響之後訂位的風險提示），所以不做二次確認對話框擋流程，
  // 改在 toast 裡把後果講清楚：現在是第幾次。復原時要把 recordNoshow 加上去的那一次扣回，
  // 否則店員按錯再復原，客人身上仍會留著一次爽約紀錄（2026-08 抓到的既有 bug）。
  const handleNoshow = (b) => {
    setStatus(b.id, 'noshow')
    const count = getNoshowCount(b.phone)
    const countMsg = count > 0 ? `這支電話累計第 ${count} 次，之後訂位會提醒` : '已記錄這支電話的爽約次數'
    toast.action(`已標記 ${b.name} No-show — ${countMsg}`,
      { label: '↩ 復原', onClick: () => {
          setStatus(b.id, 'confirmed')
          revokeNoshow(b.phone, b.id)
          toast.success(`已復原 ${b.name} 為待到，爽約次數已扣回`)
      } },
      { duration: 8000 })
  }

  // 過時未到補登「已完成」：客人其實有來、也吃完了，只是當下沒點系統入座（見
  // seatingService.completeWithoutSeating）。無二次確認，改用 5 秒可復原的 toast——
  // 復原要同時倒回 booking 狀態與桌位（若當時有釋出），不能只倒 booking（既有的
  // BookingCard.jsx 一鍵釋出復原只倒 booking、沒倒桌，是已知的不完整實作，這裡不重蹈）。
  const handleComplete = (b) => {
    const r = completeWithoutSeating(b.id)
    if (!r?.ok) return toast.error('標記完成失敗：' + (r?.error || '未知錯誤'))
    const tableMsg = r.releasedTables?.length ? `，${r.releasedTables.join('、')} 已釋出空桌` : ''
    toast.action(`${b.name}（${b.timeSlot}）已標記完成${tableMsg}`,
      { label: '↩ 復原', onClick: () => {
          const u = undoCompleteWithoutSeating(b.id)
          if (!u?.ok) return toast.error('復原失敗：' + (u?.error || '未知錯誤'))
          const failMsg = u.failed?.length ? `（${u.failed.join('、')} 已被占用，桌位未搶回，請重新指派）` : ''
          toast.success(`已復原 ${b.name} 為待到${failMsg}`)
      } },
      { duration: 5000 })
  }

  // 客人到了（含遲到後才到）：對已指派的訂位直接入座（status→arrived、桌→用餐中）。
  // 防呆：指派桌若被今日團體保留、或已預先配給別筆訂位，先跳確認再覆蓋（與指派模式同口徑）。
  const handleSeat = async (b) => {
    const tableNo = b.assignedTableId
    const hold = groupHoldTables[tableNo]
    const conflict = findPreassignedBooking(bookings, tableNo, { date: today, excludeBookingId: b.id })
    if (hold?.holds?.length || conflict) {
      const lines = []
      if (hold?.holds?.length) {
        const h = hold.holds[0]
        lines.push(`此桌為今日團體「${hold.agencyName || '旅行社'}」預留${h?.batch ? `（${h.batch.label} ${h.batch.timeSlot}）` : ''}`)
      }
      if (conflict) lines.push(`此桌已預先配給 ${conflict.name}（${conflict.guests} 位${conflict.timeSlot ? ` · ${conflict.timeSlot}` : ''}）`)
      const ok = await confirm(`${lines.join('；')}。\n仍要讓 ${b.name} 入座 ${tableNo}？`,
        { title: '桌位有預留', confirmLabel: '仍要入座', danger: true })
      if (!ok) return
    }
    const r = seatBooking(b.id)
    if (!r?.ok) return toast.error('入座失敗：' + (r?.error || '未知錯誤'))
    toast.success(`✅ ${b.name} 已入座 ${tableNo}`)
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
              onClickBooking={onClickBooking} onAssignTable={onAssignTable} onSeat={handleSeat} onNoshow={handleNoshow}
              onComplete={handleComplete} canComplete={b.assignedTableId ? canCompleteWithTable : canCompleteBooking} />
          ))}
        </div>
      )}

      {soon.length > 0 && (
        <div className="space-y-2">
          <div className="text-[11px] font-black text-chicken-brown/65">🔜 90 分內將到（{soon.length} 組）</div>
          {soon.map(b => (
            <BookingCard key={b.id} b={b} now={now}
              onClickBooking={onClickBooking} onAssignTable={onAssignTable} onSeat={handleSeat} onNoshow={handleNoshow}
              onComplete={handleComplete} canComplete={b.assignedTableId ? canCompleteWithTable : canCompleteBooking} />
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
                  onClickBooking={onClickBooking} onAssignTable={onAssignTable} onSeat={handleSeat} onNoshow={handleNoshow}
                  onComplete={handleComplete} canComplete={b.assignedTableId ? canCompleteWithTable : canCompleteBooking} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
