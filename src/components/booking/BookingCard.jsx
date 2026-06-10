import { useEffect, useState } from 'react'
import { Badge } from '../ui'
import { getNoshowCount } from '../../services/bookingService'
import { useToast, useConfirm } from '../ui/Toast'
import { useBooking } from '../../contexts/BookingContext'
import { copyText } from '../../utils/clipboard'

// 狀態色採品牌語義：待確認=琥珀(需處理) / 待到=綠(已就緒) / 用餐中=橙(進行中)
// 文字皆採深色確保可讀（不用低對比的純品牌色當文字）
const STATUS_MAP = {
  pending:   { label: '待確認', color: 'bg-amber-100 text-amber-800' },
  confirmed: { label: '待到',  color: 'bg-emerald-50 text-emerald-700' },
  arrived:   { label: '用餐中', color: 'bg-orange-100 text-orange-700' },
  completed: { label: '已離', color: 'bg-chicken-brown/10 text-chicken-brown/50' },
  noshow:    { label: 'No-show', color: 'bg-chicken-red text-white' },
  cancelled: { label: '已取消', color: 'bg-chicken-brown/5 text-chicken-brown/40' },
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
function diningStage(minutes, settings = {}) {
  const diningDuration = Number(settings.diningDurationMin) || 90
  const buffer = Number(settings.cleanupBufferMin) || 10
  if (minutes >= diningDuration + buffer) return 'buffer-overtime'
  if (minutes >= diningDuration) return 'overtime'
  if (minutes >= Math.max(0, diningDuration - 30)) return 'late'
  return 'normal'
}

export default function BookingCard({ booking, onAssign, onClick }) {
  const { tables, settings, seatBooking, checkoutBooking, finalizeBooking, cancelBooking, setStatus, clearTable, suggestTable } = useBooking()
  const toast = useToast()
  const confirm = useConfirm()

  const status = STATUS_MAP[booking.status] || STATUS_MAP.pending
  const noshowCount = getNoshowCount(booking.phone)

  // B12：手機上低頻操作收進「⋯ 更多」展開選單
  const [showMore, setShowMore] = useState(false)

  // 對應桌位（如有指派）
  const table = booking.assignedTableId ? tables.find(t => t.number === booking.assignedTableId) : null
  const seatedAt = booking.actualArrivalTime || table?.seatedAt
  const minutes = useDiningMinutes(booking.status === 'arrived' ? seatedAt : null)
  const stage = diningStage(minutes, settings)
  const suggestion = booking.status === 'confirmed' && !booking.assignedTableId ? suggestTable(booking.guests) : null

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
    ? stage === 'buffer-overtime' ? 'border-chicken-red border-2 ring-2 ring-chicken-red/30'
    : stage === 'overtime' ? 'border-chicken-red border-2 ring-2 ring-chicken-red/20'
    : stage === 'late' ? 'border-chicken-yellow border-2'
    : 'border-orange-200 border-2'
    : booking.status === 'noshow' ? 'border-chicken-red/40 border'
    : 'border-chicken-brown/10 border'

  // === B11：超時卡片背景 tint（僅 arrived 狀態，依 stage）===
  const cardBg = booking.status === 'arrived'
    ? stage === 'buffer-overtime' ? 'bg-chicken-red/10'
    : stage === 'overtime' ? 'bg-orange-500/10'
    : 'bg-white'
    : 'bg-white'

  return (
    <div className={`rounded-xl shadow-sm hover:shadow-md transition-all p-3.5 ${cardBg} ${cardBorder}`}>
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
                ${stage === 'buffer-overtime'
                  ? 'bg-chicken-red text-white animate-pulse'
                  : stage === 'overtime'
                  ? 'bg-chicken-red/90 text-white'
                  : stage === 'late'
                  ? 'bg-chicken-yellow text-white'
                  : 'bg-chicken-brown/10 text-chicken-brown'}`}>
                ⏱ {minutes} 分{stage === 'buffer-overtime' ? ' · 超緩衝' : stage === 'overtime' ? ' · 時間到' : stage === 'late' ? ' · 即將結束' : ''}
              </span>
            )}
          </div>

          {/* 副資訊 — B16：依優先級分層（警示紅 → 操作線索綠/黃 → 基礎灰）*/}
          <div className="text-xs text-chicken-brown/70 mt-1 flex items-center gap-2 flex-wrap">
            {/* 1. 警示（紅）優先 */}
            {noshowCount > 0 && (
              <span className="text-chicken-red font-bold">⚠️ no-show ×{noshowCount}</span>
            )}
            {booking.cancellationReason?.reason && (
              <span className="rounded-full bg-chicken-red/10 px-2 py-0.5 font-black text-chicken-red">
                取消原因：{booking.cancellationReason.reason}
              </span>
            )}
            {/* LINE 綁定/送達狀態：被拒（封鎖/非好友）紅、已綁定綠（附最近通知結果）*/}
            {booking.linePushBlocked || booking.lineLastNotify?.status === 'failed' ? (
              <span className="rounded-full bg-chicken-red/10 px-2 py-0.5 font-black text-chicken-red" title="LINE 推播被拒或重試用盡，客人需重新加入官方帳號好友">
                LINE 無法送達
              </span>
            ) : booking.lineUserId ? (
              <span className="rounded-full bg-[#06C755]/10 px-2 py-0.5 font-black text-[#06A848]" title={booking.lineDisplayName ? `LINE：${booking.lineDisplayName}` : 'LINE 已綁定'}>
                LINE ✓{booking.lineLastNotify?.status === 'sent'
                  ? ` 已送達 ${fmtTime(booking.lineLastNotify.at)}`
                  : booking.lineLastNotify?.status === 'pending'
                  ? ' 通知重試中'
                  : ''}
              </span>
            ) : null}
            {/* 2. 操作線索（綠/黃）居中 */}
            {suggestion && (
              <span className="rounded-full border border-chicken-green/40 bg-chicken-green/10 px-2 py-0.5 font-black text-chicken-green">
                建議桌 {suggestion.number}
              </span>
            )}
            {booking.lastGuestEditAt && (
              <span className="rounded-full bg-[#06C755]/10 px-2 py-0.5 font-black text-[#06A848]">
                客人自行修改 {fmtTime(booking.lastGuestEditAt)}
              </span>
            )}
            {/* 3. 基礎資訊（灰）在後 */}
            <span>{booking.phone || '—'}</span>
            {SOURCE_MAP[booking.source] && (
              <span className="text-chicken-brown/50">{SOURCE_MAP[booking.source]}</span>
            )}
            {booking.actualArrivalTime && (
              <span className="text-chicken-brown/50">到 {fmtTime(booking.actualArrivalTime)}</span>
            )}
          </div>

          {booking.lastGuestEditAt && !booking.assignedTableId && booking.status === 'confirmed' && (
            <div className="mt-2 rounded-lg border border-chicken-yellow/30 bg-chicken-yellow/10 px-3 py-2 text-xs font-bold text-chicken-brown">
              客人曾修改日期/時間/人數，原桌位已解除，請重新確認桌位指派。
            </div>
          )}

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
                className="text-sm px-3.5 min-h-[44px] bg-chicken-red text-white rounded-lg font-bold hover:opacity-90"
              >指派桌位</button>
            )}
            {booking.status === 'confirmed' && booking.assignedTableId && (
              <button
                onClick={(e) => { e.stopPropagation(); handleSeat() }}
                className="text-sm px-3.5 min-h-[44px] bg-chicken-green text-white rounded-lg font-bold hover:opacity-90"
              >客人到了</button>
            )}
            {/* A5：主操作「客人已離席」顯眼、次操作「直接釋出」降權較小，避免誤點 */}
            {booking.status === 'arrived' && (
              <>
                <button
                  onClick={(e) => { e.stopPropagation(); handleCheckout() }}
                  className="text-sm px-4 min-h-[44px] bg-orange-500 text-white rounded-lg font-bold hover:opacity-90"
                >🚪 客人已離席</button>
                <button
                  onClick={(e) => { e.stopPropagation(); handleFinalize() }}
                  className="text-xs px-3 min-h-[44px] bg-white border border-chicken-green/40 text-chicken-green rounded-lg font-bold hover:bg-chicken-green/5"
                >直接釋出（已清桌）</button>
              </>
            )}
            {/* B12：低頻操作（標No-show/取消訂位）手機收進「⋯ 更多」，桌面(sm:)直接全列 */}
            {(booking.status === 'confirmed' || booking.status === 'pending') && (
              <>
                <button
                  onClick={(e) => { e.stopPropagation(); setShowMore(s => !s) }}
                  className="sm:hidden text-sm px-3 min-h-[44px] bg-white border border-chicken-brown/15 text-chicken-brown/70 rounded-lg font-bold hover:border-chicken-brown/30"
                  aria-expanded={showMore}
                >⋯ 更多</button>
                <button
                  onClick={(e) => { e.stopPropagation(); handleNoshow() }}
                  className={`${showMore ? 'flex' : 'hidden'} sm:inline-flex items-center text-sm px-3 min-h-[44px] bg-white border border-chicken-red/40 text-chicken-red rounded-lg font-bold hover:bg-chicken-red/5`}
                >標 No-show</button>
                <button
                  onClick={(e) => { e.stopPropagation(); handleCancel() }}
                  className={`${showMore ? 'flex' : 'hidden'} sm:inline-flex items-center text-sm px-3 min-h-[44px] bg-white border border-chicken-red/40 text-chicken-red rounded-lg font-bold hover:bg-chicken-red/5`}
                >✕ 取消訂位</button>
              </>
            )}
            {booking.status === 'noshow' && (
              <button
                onClick={(e) => { e.stopPropagation(); handleRestore() }}
                className="text-sm px-3 min-h-[44px] bg-white border border-chicken-brown/15 text-chicken-brown rounded-lg font-bold hover:border-chicken-green hover:text-chicken-green"
              >↩ 恢復為待到</button>
            )}
          </div>
        </div>

        {/* 右側狀態 pill（純顯示，不可點）+ 訂位編號（點擊複製，方便店員核對報號）*/}
        <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
          <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full whitespace-nowrap ${status.color}`}>
            {status.label}
          </span>
          {booking.id && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                copyText(booking.id).then(ok => { if (ok) toast.success(`已複製編號 ${booking.id}`) })
              }}
              className="font-mono text-[10px] text-chicken-brown/40 hover:text-chicken-red tabular-nums"
              title="點擊複製訂位編號"
            >
              #{booking.id}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
