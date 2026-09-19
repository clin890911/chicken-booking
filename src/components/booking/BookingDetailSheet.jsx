import { useEffect, useMemo, useState } from 'react'
import { Modal } from '../ui'
import { useBooking } from '../../contexts/BookingContext'
import { useToast } from '../ui/Toast'
import { useBookingActions } from './useBookingActions'
import EditBookingModal from './EditBookingModal'
import { STATUS_MAP, SOURCE_MAP, fmtTime, fmtDateTime } from './bookingLabels'
import { normalize } from '../../services/customerService'
import { customerBookings } from '../../utils/customerHistory'
import { dayLabel, seatingForSlot } from '../../utils/timeSlots'
import { copyText } from '../../utils/clipboard'
import Icon from '../ui/Icon'

// 散客訂位詳情（bottom sheet）。
// 店主回饋：規劃頁的散客列只看得到「姓名 · 人數 · 時間 · 狀態 · 桌號」，點下去沒反應——
// 想知道電話、備註、來源、顧客歷史得跳到訂位頁翻卡片。這裡把一筆訂位的全部資訊 + 對應
// 的動作集中在一張表，訂位卡 / 規劃當日總覽散客列 / 排位地圖側欄都用同一個入口開啟。
//
// 吃 bookingId 做 live 查找（不吃 booking 物件快照）：動作執行後（入座/取消/編輯）內容
// 立即反映最新狀態；訂位被別台裝置刪除或同步移除時自動關閉。
//   onAssign(booking)：「指派桌位」跨頁導向（今天→現場、未來→規劃排位地圖），由容器決定。
//   onFocusTable(booking)：（規劃頁）在排位地圖上標示這筆訂位的桌位；未傳則不顯示該鈕。
//   onMove(booking)：今日待到、已有桌的「改桌」跨頁導向（→ 現場頁 move 模式）；未傳則不顯示改桌。
const VIP_LABEL = { none: '', bronze: '銅卡', silver: '銀卡', gold: '金卡' }

export default function BookingDetailSheet({ bookingId, onClose, onAssign, onFocusTable, onMove }) {
  const { bookings } = useBooking()
  const booking = useMemo(
    () => (bookingId ? (bookings || []).find(b => b.id === bookingId) || null : null),
    [bookings, bookingId],
  )
  // 訂位消失（刪除/同步移除）→ 自動關閉，避免留一張空表
  useEffect(() => {
    if (bookingId && !booking) onClose?.()
  }, [bookingId, booking, onClose])

  return (
    <Modal open={!!booking} onClose={onClose} size="lg" title={null}>
      {booking && (
        <SheetBody booking={booking} onClose={onClose} onAssign={onAssign} onFocusTable={onFocusTable} onMove={onMove} />
      )}
    </Modal>
  )
}

function Fact({ icon, label, children, tone = '' }) {
  return (
    <div className={`rounded-xl px-3 py-2 ${tone || 'bg-chicken-cream/70'}`}>
      <div className="flex items-center gap-1 text-[10px] font-bold text-chicken-brown/50">{icon && <Icon name={icon} size={11} />}{label}</div>
      <div className="text-sm font-bold text-chicken-brown mt-0.5 break-words">{children}</div>
    </div>
  )
}

function ActionButton({ onClick, tone = 'neutral', children, className = '', disabled = false, title }) {
  const cls = {
    primary: 'bg-chicken-red text-white shadow-sm',
    green: 'bg-chicken-green text-white shadow-sm',
    orange: 'bg-orange-500 text-white shadow-sm',
    neutral: 'bg-white border border-chicken-brown/10 text-chicken-brown',
    danger: 'bg-white border-2 border-chicken-red/40 text-chicken-red',
    indigo: 'bg-white border-2 border-indigo-300 text-indigo-700',
  }[tone] || 'bg-white border border-chicken-brown/10 text-chicken-brown'
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={title}
      className={`tap min-h-[48px] px-3 rounded-xl text-sm font-bold inline-flex items-center justify-center gap-1 disabled:opacity-45 disabled:cursor-not-allowed ${cls} ${className}`}>
      {children}
    </button>
  )
}

function SheetBody({ booking, onClose, onAssign, onFocusTable, onMove }) {
  const { settings, customers, bookings } = useBooking()
  const toast = useToast()
  const [editing, setEditing] = useState(false)
  const act = useBookingActions(booking, { onAssign, onMove })

  const st = STATUS_MAP[booking.status] || STATUS_MAP.pending
  const seating = seatingForSlot(settings, booking.timeSlot)
  const tableNums = [booking.assignedTableId, ...(Array.isArray(booking.extraTableIds) ? booking.extraTableIds : [])].filter(Boolean)
  const phoneKey = normalize(booking.phone)
  const customer = useMemo(
    () => (phoneKey ? (customers || []).find(c => normalize(c.phone) === phoneKey) || null : null),
    [customers, phoneKey],
  )
  // 這位客人的其他訂位（排除本筆），最新在前；只顯示前 3 筆當「熟客脈絡」
  const history = useMemo(
    () => (phoneKey ? customerBookings(bookings, booking.phone).filter(b => b.id !== booking.id) : []),
    [bookings, booking.phone, booking.id, phoneKey],
  )
  const notes = booking.notes || {}
  const hasTags = notes.pet || notes.child || notes.mobility
  const lineBlocked = booking.linePushBlocked || booking.lineLastNotify?.status === 'failed'

  // 動作完成後關閉詳情（toast 帶復原鈕的照常出現在畫面上）
  const then = (fn) => async () => { const ok = await fn(); if (ok !== false) onClose?.() }

  return (
    <div className="space-y-3 -mt-1">
      {/* 標頭 */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-2xl font-bold text-chicken-brown tabular-nums leading-none">{booking.timeSlot || '未排'}</span>
            <span className="text-lg font-bold text-chicken-brown truncate">{booking.name || '（未填姓名）'}</span>
          </div>
          <div className="text-xs text-chicken-brown/60 mt-1 flex items-center gap-2 flex-wrap">
            <span>{booking.date ? dayLabel(booking.date) : '未排日期'}</span>
            {seating && <span className="font-bold text-indigo-700/80">{seating.name}</span>}
            {act.dayKind === 'today' && <span className="rounded-full bg-chicken-yellow/15 text-chicken-yellow px-2 py-0.5 font-bold">今天</span>}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full whitespace-nowrap ${st.color}`}>{st.label}</span>
          {booking.id && (
            <button type="button" title="點擊複製訂位編號"
              onClick={() => copyText(booking.id).then(ok => { if (ok) toast.success(`已複製編號 ${booking.id}`) })}
              className="font-mono text-[10px] text-chicken-brown/40 hover:text-chicken-red tabular-nums">
              #{booking.id}
            </button>
          )}
        </div>
      </div>

      {/* 警示列（有才顯示）：no-show / 黑名單 / 取消原因 / LINE 送達 / 客人自行修改 */}
      {(act.noshowCount > 0 || customer?.blacklisted || booking.cancellationReason?.reason || lineBlocked || booking.lastGuestEditAt) && (
        <div className="flex flex-wrap gap-1.5 text-[11px] font-bold">
          {act.noshowCount > 0 && <span className="rounded-full bg-chicken-red text-white px-2 py-0.5">no-show ×{act.noshowCount}</span>}
          {customer?.blacklisted && <span className="rounded-full bg-chicken-red text-white px-2 py-0.5">黑名單{customer.blacklistReason ? `：${customer.blacklistReason}` : ''}</span>}
          {booking.cancellationReason?.reason && <span className="rounded-full bg-chicken-red/10 text-chicken-red px-2 py-0.5">取消原因：{booking.cancellationReason.reason}</span>}
          {lineBlocked && <span className="rounded-full bg-chicken-red/10 text-chicken-red px-2 py-0.5">LINE 無法送達</span>}
          {booking.lastGuestEditAt && <span className="rounded-full bg-[#06C755]/10 text-[#06A848] px-2 py-0.5">客人自行修改 {fmtDateTime(booking.lastGuestEditAt)}</span>}
        </div>
      )}

      {/* 用餐計時（用餐中） */}
      {booking.status === 'arrived' && (
        <div className={`rounded-xl px-3 py-2 text-sm font-bold tabular-nums ${
          act.stage === 'buffer-overtime' || act.stage === 'overtime' ? 'bg-chicken-red text-white'
            : act.stage === 'late' ? 'bg-chicken-yellow/20 text-chicken-yellow' : 'bg-orange-50 text-orange-700'}`}>
          已用餐 {act.minutes} 分{act.stage === 'buffer-overtime' ? ' · 超過清桌緩衝' : act.stage === 'overtime' ? ' · 用餐時間到' : act.stage === 'late' ? ' · 即將結束' : ''}
          {booking.actualArrivalTime && <span className="ml-2 font-bold opacity-80">到店 {fmtTime(booking.actualArrivalTime)}</span>}
        </div>
      )}

      {/* 關鍵資訊 */}
      <div className="grid grid-cols-2 gap-2">
        <Fact icon="users" label="人數">{booking.guests} 位</Fact>
        <Fact icon="chair" label={act.dayKind === 'future' && tableNums.length ? '預配桌位' : '桌位'}
          tone={tableNums.length ? (booking.status === 'arrived' ? 'bg-orange-50' : 'bg-emerald-50') : 'bg-amber-50'}>
          {tableNums.length ? tableNums.join(' + ') : <span className="text-amber-700">未配桌</span>}
          {act.suggestion && !tableNums.length && (
            <span className="ml-2 text-[11px] font-bold text-chicken-green">建議 {act.suggestion.number}</span>
          )}
        </Fact>
        <Fact icon="phone" label="電話">
          {booking.phone
            ? <a href={`tel:${booking.phone}`} className="underline decoration-chicken-brown/30 underline-offset-2">{booking.phone}</a>
            : <span className="text-chicken-brown/40 font-bold">未填</span>}
        </Fact>
        <Fact icon="receipt" label="來源">
          {SOURCE_MAP[booking.source] || booking.source || '—'}
          {booking.lineUserId && !lineBlocked && (
            <span className="ml-1.5 text-[11px] font-bold text-[#06A848]" title={booking.lineDisplayName ? `LINE：${booking.lineDisplayName}` : 'LINE 已綁定'}>
              LINE ✓{booking.lineLastNotify?.status === 'sent' ? ` 已送達 ${fmtTime(booking.lineLastNotify.at)}` : booking.lineLastNotify?.status === 'pending' ? ' 通知重試中' : ''}
            </span>
          )}
        </Fact>
      </div>

      {/* 需求 / 備註 */}
      {(hasTags || notes.text) ? (
        <div className="rounded-xl border border-chicken-brown/10 bg-white px-3 py-2 space-y-1.5">
          <div className="text-[10px] font-bold text-chicken-brown/50">需求 / 備註</div>
          {hasTags && (
            <div className="flex flex-wrap gap-1.5 text-[11px] font-bold">
              {notes.pet && <span className="rounded-full bg-chicken-yellow/15 text-chicken-yellow px-2 py-0.5">寵物</span>}
              {notes.child && <span className="rounded-full bg-chicken-green/15 text-chicken-green px-2 py-0.5">兒童</span>}
              {notes.mobility && <span className="rounded-full bg-chicken-brown text-white px-2 py-0.5">行動不便</span>}
            </div>
          )}
          {notes.text && <p className="text-sm text-chicken-brown leading-relaxed whitespace-pre-wrap">「{notes.text}」</p>}
        </div>
      ) : (
        <div className="text-[11px] text-chicken-brown/40 px-1">無特殊需求或備註</div>
      )}

      {/* 顧客脈絡（有顧客檔才顯示） */}
      {customer && (
        <div className="rounded-xl border border-chicken-brown/10 bg-white px-3 py-2 space-y-1.5">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="text-[10px] font-bold text-chicken-brown/50">顧客檔 · {customer.name || booking.name}</div>
            <div className="flex flex-wrap gap-1.5 text-[11px] font-bold">
              <span className="rounded-full bg-chicken-green/15 text-chicken-green px-2 py-0.5">來訪 {customer.visits || 0} 次</span>
              <span className="rounded-full bg-chicken-brown/10 text-chicken-brown px-2 py-0.5">累計 {customer.totalGuests || 0} 位</span>
              {customer.vipTier && customer.vipTier !== 'none' && (
                <span className="rounded-full bg-chicken-yellow/20 text-chicken-yellow px-2 py-0.5">{VIP_LABEL[customer.vipTier] || customer.vipTier}</span>
              )}
            </div>
          </div>
          {customer.allergies && <div className="text-xs font-bold text-chicken-red">過敏：{customer.allergies}</div>}
          {customer.notes && <div className="text-xs text-chicken-brown/70 italic">「{customer.notes}」</div>}
          {history.length > 0 && (
            <div className="pt-1 border-t border-chicken-brown/5">
              <div className="text-[10px] font-bold text-chicken-brown/45 mb-1">其他訂位（最近 {Math.min(3, history.length)} 筆 / 共 {history.length} 筆）</div>
              <div className="space-y-0.5">
                {history.slice(0, 3).map(h => {
                  const hs = STATUS_MAP[h.status] || STATUS_MAP.pending
                  return (
                    <div key={h.id} className="flex items-center gap-2 text-[11px] text-chicken-brown/70 tabular-nums">
                      <span className="font-bold w-[64px] shrink-0">{h.date ? dayLabel(h.date) : '—'}</span>
                      <span className="w-10 shrink-0">{h.timeSlot || '—'}</span>
                      <span className="shrink-0">{h.guests} 位</span>
                      {h.assignedTableId && <span className="shrink-0">桌 {h.assignedTableId}</span>}
                      <span className={`ml-auto shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-full ${hs.color}`}>{hs.label}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 動作 */}
      <div className="grid grid-cols-2 gap-2 pt-1">
        {act.show.assign && (
          <ActionButton tone="primary" className="col-span-2" onClick={() => { onClose?.(); act.assign() }}>
            {act.dayKind === 'future' ? '指派桌位（預配）' : '指派桌位'}
          </ActionButton>
        )}
        {act.show.seat && (
          <ActionButton tone="green" className="col-span-2" onClick={then(async () => { act.seat(); return true })}>客人到了</ActionButton>
        )}
        {act.show.move && (
          <ActionButton tone="indigo" className="col-span-2" disabled={!!act.moveDisabledReason}
            title={act.moveDisabledReason || undefined}
            onClick={() => { onClose?.(); act.move() }}>↔ 改桌（目前 {booking.assignedTableId}）</ActionButton>
        )}
        {act.show.move && act.moveDisabledReason && (
          <div className="col-span-2 text-[11px] font-bold text-chicken-brown/50 text-center -mt-1">{act.moveDisabledReason}</div>
        )}
        {act.show.checkout && (
          <>
            <ActionButton tone="orange" onClick={then(act.checkout)}>客人已離席</ActionButton>
            <ActionButton tone="neutral" onClick={then(act.finalize)}>直接釋出（已清桌）</ActionButton>
          </>
        )}
        {onFocusTable && tableNums.length > 0 && (
          <ActionButton tone="indigo" onClick={() => { onClose?.(); onFocusTable(booking) }}>在地圖標示</ActionButton>
        )}
        {act.show.edit && (
          <ActionButton tone="neutral" onClick={() => setEditing(true)}>編輯資料</ActionButton>
        )}
        {act.show.unpreassign && (
          <ActionButton tone="neutral" onClick={then(act.unpreassign)}>解除預配</ActionButton>
        )}
        {act.show.restore && (
          <ActionButton tone="neutral" className="col-span-2" onClick={then(async () => { act.restore(); return true })}>↩ 恢復為待到</ActionButton>
        )}
        {act.show.noshow && (
          <ActionButton tone="danger" onClick={then(act.noshow)}>標 No-show</ActionButton>
        )}
        {act.show.cancel && (
          <ActionButton tone="danger" className={act.show.noshow ? '' : 'col-span-2'} onClick={then(act.cancel)}>✕ 取消訂位</ActionButton>
        )}
      </div>
      {act.show.futureAssignedNote && (
        <div className="text-[11px] font-bold text-chicken-brown/50 text-center">未來訂位 · 當天才可報到；到店當天在現場頁點桌入座</div>
      )}
      {act.show.pastNote && (
        <div className="text-[11px] font-bold text-chicken-brown/45 text-center">過去日期 · 僅可補登</div>
      )}

      {/* 時間軸 */}
      <div className="text-[10px] text-chicken-brown/45 flex flex-wrap gap-x-3 gap-y-0.5 px-1 pt-1 border-t border-chicken-brown/5">
        {booking.createdAt && <span>建立 {fmtDateTime(booking.createdAt)}{booking.createdBy && booking.createdBy !== 'guest' ? ` · ${booking.createdBy}` : ''}</span>}
        {booking.actualArrivalTime && <span>到店 {fmtDateTime(booking.actualArrivalTime)}</span>}
        {booking.guestEditCount > 0 && <span>客人修改 {booking.guestEditCount} 次</span>}
        {booking.updatedAt && booking.updatedAt !== booking.createdAt && <span>更新 {fmtDateTime(booking.updatedAt)}</span>}
      </div>

      <div className="flex justify-end pt-1">
        <button type="button" onClick={onClose} className="btn-secondary px-5 py-2 text-sm">關閉</button>
      </div>

      {editing && <EditBookingModal booking={booking} onClose={() => setEditing(false)} />}
    </div>
  )
}
