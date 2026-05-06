import { useEffect, useState } from 'react'
import { Badge } from '../ui'
import { getNoshowCount } from '../../services/bookingService'
import { useToast, useConfirm } from '../ui/Toast'
import { useBooking } from '../../contexts/BookingContext'

const STATUS_MAP = {
  pending:   { label: '待確認', color: 'bg-chicken-brown/10 text-chicken-brown' },
  confirmed: { label: '待到',  color: 'bg-sky-50 text-sky-700' },
  arrived:   { label: '用餐中', color: 'bg-orange-50 text-orange-700' },
  completed: { label: '已離', color: 'bg-chicken-brown/10 text-chicken-brown/60' },
  noshow:    { label: 'No-show', color: 'bg-chicken-red text-white' },
  cancelled: { label: '已取消', color: 'bg-chicken-brown/10 text-chicken-brown/40' },
}

const SOURCE_MAP = {
  online: '🌐 線上',
  phone:  '📞 電話',
  walkin: '🚶 現場',
  group:  '👥 團體',
  line:   '💚 LINE',
}

function fmtTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// 用餐已坐分鐘數（會自動 1 秒 tick）
function useDiningMinutes(seatedAt) {
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!seatedAt) return
    const id = setInterval(() => setTick(t => t + 1), 1000)
    return () => clearInterval(id)
  }, [seatedAt])
  if (!seatedAt) return 0
  return Math.floor((Date.now() - new Date(seatedAt).getTime()) / 60000)
}

// 用餐時長階段：影響顏色警示
function diningStage(minutes) {
  if (minutes >= 90) return 'overtime'      // 超時
  if (minutes >= 60) return 'late'          // 即將結束
  return 'normal'
}

export default function BookingCard({ booking, onAssign, onClick }) {
  const { tables, seatBooking, checkoutBooking, finalizeBooking, cancelBooking, setStatus, clearTable } = useBooking()
  const toast = useToast()
  const confirm = useConfirm()

  const status = STATUS_MAP[booking.status] || STATUS_MAP.pending
  const noshowCount = getNoshowCount(booking.phone)

  // 對應桌位（如有指派）
  const table = booking.assignedTableId ? tables.find(t => t.number === booking.assignedTableId) : null
  const seatedAt = booking.actualArrivalTime || table?.seatedAt
  const minutes = useDiningMinutes(booking.status === 'arrived' ? seatedAt : null)
  const stage = diningStage(minutes)

  // === 操作 ===
  const handleSeat = async () => {
    if (!booking.assignedTableId) {
      // 沒指派桌 → 觸發指派流程
      onAssign?.(booking)
      toast.info('請先指派桌位再標記入座')
      return
    }
    const r = seatBooking(booking.id)
    if (!r.ok) return toast.error('入座失敗：' + r.error)
    toast.success(`${booking.name} 已入座 ${booking.assignedTableId}`)
  }

  const handleCheckout = async () => {
    const ok = await confirm(`${booking.name} 已離席？\n桌位將進入「等待清桌」狀態`,
      { title: '客人已離席', confirmLabel: '已離席' })
    if (!ok) return
    const r = checkoutBooking(booking.id)
    if (!r.ok) return toast.error(r.error)
    toast.action(`${booking.name} 已離席（用餐 ${minutes} 分）`,
      { label: '一鍵釋出', onClick: () => {
          if (booking.assignedTableId) {
            clearTable(booking.assignedTableId)
            toast.success(`${booking.assignedTableId} 已釋出`)
          }
      }})
  }

  const handleFinalize = async () => {
    const ok = await confirm(`${booking.name} 已離席且桌面已清理？\n桌位將立即可給下一組使用`,
      { title: '一鍵釋出桌位', confirmLabel: '已離席+清桌' })
    if (!ok) return
    const r = finalizeBooking(booking.id)
    if (!r.ok) return toast.error(r.error)
    toast.success(`✨ ${booking.name} 已離席 · ${booking.assignedTableId || ''} 已釋出（用餐 ${minutes} 分）`)
  }

  const handleCancel = async () => {
    const ok = await confirm(`取消 ${booking.name} ${booking.timeSlot} 的訂位？`,
      { title: '取消訂位', confirmLabel: '取消訂位', danger: true })
    if (!ok) return
    cancelBooking(booking.id)
    toast.action(`已取消 ${booking.name} 的訂位`,
      { label: '復原', onClick: () => setStatus(booking.id, 'confirmed') })
  }

  const handleNoshow = async () => {
    const ok = await confirm(`標記 ${booking.name} 為 No-show？`,
      { title: 'No-show', confirmLabel: '標記', danger: true })
    if (!ok) return
    setStatus(booking.id, 'noshow')
    toast.action(`${booking.name} 已標記 No-show`,
      { label: '復原', onClick: () => setStatus(booking.id, 'confirmed') })
  }

  const handleRestore = () => {
    setStatus(booking.id, 'confirmed')
    toast.success(`${booking.name} 已恢復為待到`)
  }

  // === 卡片邊框依時長階段變色（僅 arrived 狀態）===
  const cardBorder = booking.status === 'arrived'
    ? stage === 'overtime' ? 'border-chicken-red border-2 ring-2 ring-chicken-red/20'
    : stage === 'late' ? 'border-chicken-yellow border-2'
    : 'border-orange-200 border-2'
    : booking.status === 'noshow' ? 'border-chicken-red/40 border'
    : 'border-chicken-brown/10 border'

  return (
    <div className={`bg-white rounded-xl shadow-sm hover:shadow-md transition-all p-3.5 ${cardBorder}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          {/* 主資訊 */}
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-lg font-black text-chicken-brown tabular-nums">{booking.timeSlot}</span>
            <span className="text-base font-bold text-chicken-brown">{booking.name}</span>
            <span className="text-sm text-chicken-brown/60">{booking.guests} 位</span>
            {booking.assignedTableId && (
              <span className={`text-xs font-black px-2.5 py-0.5 rounded-full
                ${booking.status === 'arrived'
                  ? 'bg-orange-600 text-white'
                  : 'bg-emerald-600 text-white'}`}>
                桌 {booking.assignedTableId}
              </span>
            )}
            {booking.status === 'arrived' && (
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full tabular-nums
                ${stage === 'overtime'
                  ? 'bg-chicken-red text-white animate-pulse'
                  : stage === 'late'
                  ? 'bg-chicken-yellow text-white'
                  : 'bg-chicken-brown/10 text-chicken-brown'}`}>
                ⏱ {minutes} 分{stage === 'overtime' ? ' · 超時' : stage === 'late' ? ' · 即將結束' : ''}
              </span>
            )}
          </div>

          {/* 副資訊 */}
          <div className="text-xs text-chicken-brown/70 mt-1 flex items-center gap-2 flex-wrap">
            <span>{booking.phone || '—'}</span>
            {SOURCE_MAP[booking.source] && (
              <span className="text-chicken-brown/50">{SOURCE_MAP[booking.source]}</span>
            )}
            {noshowCount > 0 && (
              <span className="text-chicken-red font-bold">⚠️ no-show ×{noshowCount}</span>
            )}
            {booking.actualArrivalTime && (
              <span className="text-chicken-brown/50">到 {fmtTime(booking.actualArrivalTime)}</span>
            )}
          </div>

          {/* 標籤 + 備註 */}
          {(booking.notes?.pet || booking.notes?.child || booking.notes?.mobility || booking.notes?.text) && (
            <div className="mt-1.5 flex items-center gap-1 flex-wrap">
              {booking.notes?.pet && <Badge color="yellow">🐾 寵物</Badge>}
              {booking.notes?.child && <Badge color="green">👶 兒童</Badge>}
              {booking.notes?.mobility && <Badge color="brown">♿ 行動不便</Badge>}
              {booking.notes?.text && (
                <span className="text-[11px] text-chicken-brown/60 italic truncate max-w-[200px]">
                  「{booking.notes.text}」
                </span>
              )}
            </div>
          )}

          {/* 動作按鈕（依狀態顯示）*/}
          <div className="mt-3 flex gap-2 flex-wrap">
            {booking.status === 'confirmed' && !booking.assignedTableId && (
              <button
                onClick={(e) => { e.stopPropagation(); onAssign?.(booking) }}
                className="text-xs px-3.5 py-1.5 bg-chicken-red text-white rounded-lg font-bold hover:opacity-90"
              >指派桌位</button>
            )}
            {booking.status === 'confirmed' && booking.assignedTableId && (
              <button
                onClick={(e) => { e.stopPropagation(); handleSeat() }}
                className="text-xs px-3.5 py-1.5 bg-chicken-green text-white rounded-lg font-bold hover:opacity-90"
              >客人到了</button>
            )}
            {booking.status === 'arrived' && (
              <>
                <button
                  onClick={(e) => { e.stopPropagation(); handleCheckout() }}
                  className="text-xs px-3.5 py-1.5 bg-orange-500 text-white rounded-lg font-bold hover:opacity-90"
                >已離席（待清桌）</button>
                <button
                  onClick={(e) => { e.stopPropagation(); handleFinalize() }}
                  className="text-xs px-3.5 py-1.5 bg-chicken-green text-white rounded-lg font-bold hover:opacity-90"
                >已離席+清桌</button>
              </>
            )}
            {(booking.status === 'confirmed' || booking.status === 'pending') && (
              <>
                <button
                  onClick={(e) => { e.stopPropagation(); handleNoshow() }}
                  className="text-xs px-3 py-1.5 bg-white border border-chicken-brown/15 text-chicken-brown/60 rounded-lg font-bold hover:border-chicken-red hover:text-chicken-red"
                >標 No-show</button>
                <button
                  onClick={(e) => { e.stopPropagation(); handleCancel() }}
                  className="text-xs px-3 py-1.5 bg-white border border-chicken-brown/15 text-chicken-brown/60 rounded-lg font-bold hover:border-chicken-red hover:text-chicken-red"
                >取消訂位</button>
              </>
            )}
            {booking.status === 'noshow' && (
              <button
                onClick={(e) => { e.stopPropagation(); handleRestore() }}
                className="text-xs px-3 py-1.5 bg-white border border-chicken-brown/15 text-chicken-brown rounded-lg font-bold hover:border-chicken-green hover:text-chicken-green"
              >↩ 恢復為待到</button>
            )}
          </div>
        </div>

        {/* 右側狀態 pill（純顯示，不可點）*/}
        <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
          <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full whitespace-nowrap ${status.color}`}>
            {status.label}
          </span>
        </div>
      </div>
    </div>
  )
}
