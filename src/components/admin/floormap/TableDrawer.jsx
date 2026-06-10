import { useState, useEffect } from 'react'
import { Modal, Input, Select } from '../../ui'
import { useToast, useConfirm } from '../../ui/Toast'
import { useBooking } from '../../../contexts/BookingContext'
import { useAuth } from '../../../contexts/AuthContext'
import TableCandidatePanel from './TableCandidatePanel'
import GroupTableSection from './GroupTableSection'
import { STATUS_ZH as STATUS_LABELS } from '../../../utils/tableStatus'

// 點桌位後彈出的詳情 + 操作面板
// 設計重點：操作不超過 2 下 tap，按鈕語意明確、避免誤觸
// 與桌位地圖 (TableShape) 同色語義：綠=可入座 / 藍=已預訂 / 橙=用餐 / 琥珀=清桌 / 灰=不可用
const STATUS_PILL_BG = {
  vacant: 'bg-emerald-600',
  reserved: 'bg-sky-600',
  dining: 'bg-orange-500',
  cleaning: 'bg-amber-600',
  blocked: 'bg-slate-500',
}

function fmtTime(d) {
  const t = new Date(d)
  return `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`
}
function diffMin(d) {
  return Math.floor((Date.now() - new Date(d).getTime()) / 60000)
}

export default function TableDrawer({ table, booking, preassign, groupHold, onClose, onStartMove, onReseatBatch, mode }) {
  const { can } = useAuth()
  const toast = useToast()
  const confirmDialog = useConfirm()
  const {
    setTableStatus, blockTable, unblockTable, walkInSeat,
    seatBooking, checkoutBooking, finalizeBooking, clearTable, cancelBooking, setStatus,
    settings, groupReservations,
  } = useBooking()
  const [showWalkIn, setShowWalkIn] = useState(false)
  const [showBlock, setShowBlock] = useState(false)
  const [walkInForm, setWalkInForm] = useState({ name: '散客', phone: '', guests: 2, notes: '' })
  const [blockReason, setBlockReason] = useState('臨時保留')

  // 用餐計時即時 tick（1 秒）
  const [, setNow] = useState(Date.now())
  useEffect(() => {
    if (!table || table.status !== 'dining') return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [table?.number, table?.status])

  if (!table) return null

  // 團體梯次入座的桌（currentRef 指向 group/batch，無散客 booking）
  const groupRef = table.currentRef?.type === 'group'
    ? (groupReservations || []).find(g => g.id === table.currentRef.groupId)
    : null
  const groupBatch = groupRef?.batches?.find(b => b.id === table.currentRef?.batchId) || null
  // 空桌但被今日團體 hold（圈桌未入座）：接管「可使用／散客入座」的預設引導，防止散客坐掉團體桌
  const activeHold = table.status === 'vacant' && groupHold?.holds?.length ? groupHold : null

  const canEdit = can('table.update')
  const canBlock = can('table.block')

  const handleWalkIn = () => {
    if (!walkInForm.guests || walkInForm.guests < 1) return toast.error('請填人數')
    if (!walkInForm.name.trim()) return toast.error('請填姓名')
    const r = walkInSeat(table.number, walkInForm)
    if (!r.ok) return toast.error('入座失敗：' + r.error)
    toast.success(`${r.booking.name} 已入座 ${table.number}`)
    setShowWalkIn(false)
    onClose?.()
  }

  const handleSeat = () => {
    if (!booking) return
    const r = seatBooking(booking.id)
    if (!r.ok) return toast.error(r.error)
    toast.success(`${booking.name} 已入座 ${table.number}`)
  }

  const minutesSeated = () => table.seatedAt
    ? Math.floor((Date.now() - new Date(table.seatedAt).getTime()) / 60000)
    : 0
  const diningDuration = Number(settings.diningDurationMin) || 90
  const cleanupBuffer = Number(settings.cleanupBufferMin) || 10
  const bufferLimit = diningDuration + cleanupBuffer
  const lateThreshold = Math.max(0, diningDuration - 30)

  const handleCheckout = async () => {
    if (!booking) return
    const ok = await confirmDialog('客人已離席？桌位將進入「等待清桌」狀態',
      { title: '客人已離席', confirmLabel: '已離席' })
    if (!ok) return
    const min = minutesSeated()
    const r = checkoutBooking(booking.id)
    if (!r.ok) return toast.error(r.error)
    toast.action(`${booking.name} 已離席（用餐 ${min} 分）· 桌位待清桌`,
      { label: '一鍵釋出', onClick: () => { clearTable(table.number); toast.success(`${table.number} 已釋出`) } })
  }

  // 一鍵釋出：已離席 + 清桌完成（跳過待清桌）
  const handleFinalize = async () => {
    if (!booking) return
    const ok = await confirmDialog('客人已離席且桌面已清理乾淨？桌位將立即可給下一組使用。',
      { title: '一鍵釋出桌位', confirmLabel: '已離席+清桌' })
    if (!ok) return
    const min = minutesSeated()
    const releasedBooking = booking
    const tableNumber = table.number
    const r = finalizeBooking(releasedBooking.id)
    if (!r.ok) return toast.error(r.error)
    // 復原窗口：把該桌與 booking 還原為釋出前（重新入座 → dining）
    toast.action(`✨ ${releasedBooking.name} 已離席且 ${tableNumber} 已釋出（用餐 ${min} 分）`,
      { label: '↩ 復原', onClick: () => {
        const back = seatBooking(releasedBooking.id)
        if (back.ok) toast.success(`已復原 ${releasedBooking.name} 至 ${tableNumber}`)
        else toast.error('無法復原：' + back.error)
      } },
      { duration: 8000 })
    onClose?.()
  }

  const handleClear = () => {
    const tableNumber = table.number
    const prevBookingId = table.currentBookingId
    clearTable(tableNumber)
    // 復原窗口：把桌位還原回「等待清桌」狀態（重新標 cleaning + 還原 booking 綁定）
    toast.action(`${tableNumber} 已清桌完成`,
      { label: '↩ 復原', onClick: () => {
        setTableStatus(tableNumber, 'cleaning', prevBookingId ? { currentBookingId: prevBookingId } : {})
        toast.success(`已復原 ${tableNumber} 為等待清桌`)
      } },
      { duration: 8000 })
    onClose?.()
  }

  const handleCancel = async () => {
    if (!booking) return
    const ok = await confirmDialog(`確定取消 ${booking.name} 的訂位？`,
      { title: '取消訂位', confirmLabel: '取消訂位', danger: true })
    if (!ok) return
    cancelBooking(booking.id)
    toast.action(`已取消 ${booking.name} 的訂位`,
      { label: '復原', onClick: () => setStatus(booking.id, 'confirmed') })
    onClose?.()
  }

  const handleBlock = () => {
    if (!blockReason.trim()) return toast.error('請填原因')
    blockTable(table.number, blockReason)
    toast.success(`${table.number} 已設為不可用`)
    setShowBlock(false)
  }

  const handleUnblock = () => {
    unblockTable(table.number)
    toast.success(`${table.number} 已恢復可用`)
  }

  return (
    <div className="bg-white rounded-2xl border border-chicken-brown/10 overflow-hidden flex flex-col h-full">
      {/* Header */}
      <div className="px-5 pt-5 pb-3 border-b border-chicken-brown/10 bg-gradient-to-b from-white to-chicken-cream/30">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-3xl font-black text-chicken-red leading-none">{table.number}</div>
            <div className="text-xs text-chicken-brown/60 mt-1.5">
              {table.capacity} 人桌 · {table.capacity === 6 ? '180×100' : '120×100'} cm
            </div>
            <div className="text-xs text-chicken-brown/60">
              {table.floor === '1F' ? '一樓' : '二樓'}
            </div>
          </div>
          <button onClick={onClose} className="text-chicken-brown/40 hover:text-chicken-brown text-2xl leading-none">×</button>
        </div>
        <span className={`inline-block mt-3 px-3 py-1 rounded-full text-xs font-bold text-white ${STATUS_PILL_BG[table.status]}`}>
          {STATUS_LABELS[table.status]}
        </span>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3 text-sm">
        {/* 訂位資訊 */}
        {booking && (table.status === 'reserved' || table.status === 'dining') && (
          <div className="space-y-1.5">
            <div className="flex justify-between"><span className="text-chicken-brown/60">客人</span><span className="font-bold">{booking.name}</span></div>
            <div className="flex justify-between"><span className="text-chicken-brown/60">電話</span><span>{booking.phone}</span></div>
            <div className="flex justify-between"><span className="text-chicken-brown/60">人數</span><span>{booking.guests} 位</span></div>
            {table.status === 'reserved' && (
              <div className="flex justify-between"><span className="text-chicken-brown/60">預訂時間</span><span>{booking.timeSlot}</span></div>
            )}
            {table.status === 'dining' && table.seatedAt && (() => {
              const m = diffMin(table.seatedAt)
              const stage = m >= bufferLimit ? 'buffer-overtime' : m >= diningDuration ? 'overtime' : m >= lateThreshold ? 'late' : 'normal'
              return (
                <>
                  <div className="flex justify-between">
                    <span className="text-chicken-brown/60">入座</span>
                    <span>{fmtTime(table.seatedAt)}</span>
                  </div>
                  <div className={`flex items-center justify-between rounded-xl px-3 py-2 mt-2
                    ${stage === 'buffer-overtime' ? 'bg-chicken-red text-white animate-pulse'
                      : stage === 'overtime' ? 'bg-chicken-red/90 text-white'
                      : stage === 'late' ? 'bg-orange-100 text-orange-700'
                      : 'bg-chicken-cream text-chicken-brown'}`}>
                    <span className="text-xs font-bold">已用餐</span>
                    <span className="text-2xl font-black tabular-nums">
                      {m} <span className="text-sm">分</span>
                    </span>
                  </div>
                  {stage === 'late' && (
                    <div className="text-[11px] text-orange-700 font-bold mt-1 text-center">
                      接近 {diningDuration} 分鐘用餐時間，請留意下一組安排
                    </div>
                  )}
                  {stage === 'overtime' && (
                    <div className="text-[11px] text-chicken-red font-bold mt-1 text-center">
                      ⚠️ 已達 {diningDuration} 分鐘用餐時間，可禮貌提醒
                    </div>
                  )}
                  {stage === 'buffer-overtime' && (
                    <div className="text-[11px] text-chicken-red font-bold mt-1 text-center">
                      ⚠️ 已超過 {bufferLimit} 分鐘（含清桌緩衝），請安排結帳或翻桌
                    </div>
                  )}
                </>
              )
            })()}
            {booking.notes?.text && (
              <div className="mt-2 px-3 py-2 bg-chicken-cream rounded-lg text-xs text-chicken-brown italic">
                「{booking.notes.text}」
              </div>
            )}
            <div className="flex flex-wrap gap-1.5 mt-2">
              {booking.notes?.pet && <span className="text-[11px] bg-chicken-yellow/15 text-chicken-yellow px-2 py-0.5 rounded-full">🐾 寵物</span>}
              {booking.notes?.child && <span className="text-[11px] bg-chicken-green/15 text-chicken-green px-2 py-0.5 rounded-full">👶 兒童</span>}
              {booking.notes?.mobility && <span className="text-[11px] bg-chicken-brown/15 text-chicken-brown px-2 py-0.5 rounded-full">♿ 行動不便</span>}
            </div>
          </div>
        )}

        {/* 團體桌（dining/cleaning 的 currentRef 指向團，或 vacant 但被今日團體 hold）：
            資訊與操作（梯次入座/離席/接下一梯/整團完成）就地完成 */}
        {(groupRef || activeHold) && (
          <GroupTableSection
            table={table}
            groupRef={groupRef}
            groupBatch={groupBatch}
            groupHold={activeHold}
            canEdit={canEdit}
            onWalkInOverride={() => setShowWalkIn(true)}
            onReseatBatch={onReseatBatch}
            onClose={onClose}
          />
        )}

        {table.status === 'cleaning' && !groupRef && (
          <p className="text-chicken-brown/60 text-center py-4">外場清桌中</p>
        )}
        {table.status === 'blocked' && (
          <div className="text-chicken-brown/60 text-sm">
            <span className="font-bold">原因：</span>{table.blockReason || '—'}
          </div>
        )}
        {/* 預配提示：此空桌已於排位規劃預留給某散客（桌況仍空，現場入座／指派前先知會） */}
        {table.status === 'vacant' && preassign && (
          <div className="px-3 py-2 bg-orange-50 border border-orange-200 rounded-lg text-xs">
            <span className="font-bold text-orange-700">🪑 已預留：</span>
            <span className="text-orange-700/90">排位規劃已預先配給 {preassign.name}（{preassign.guests} 位{preassign.timeSlot ? ` · ${preassign.timeSlot}` : ''}）</span>
            <p className="text-[11px] text-orange-700/70 mt-0.5">直接入座或指派他人會覆蓋此預留。</p>
          </div>
        )}
        {table.status === 'vacant' && !activeHold && !mode?.assigning && (
          <>
            <p className="text-chicken-brown/40 text-center py-2 text-xs">此桌目前可使用</p>
            <TableCandidatePanel table={table} onPicked={onClose} />
          </>
        )}

      </div>

      {/* Action 按鈕 */}
      {canEdit && (
        <div className="px-5 pb-5 border-t border-chicken-brown/10 pt-3 space-y-2">
          {table.status === 'vacant' && !activeHold && (
            <>
              <button onClick={() => setShowWalkIn(true)} className="btn-primary w-full">✅ 散客直接入座</button>
              {canBlock && <button onClick={() => setShowBlock(true)} className="btn-secondary text-sm w-full">🚫 設不可用</button>}
            </>
          )}

          {table.status === 'reserved' && booking && (
            <>
              <button onClick={handleSeat} className="btn-primary w-full">✅ 客人到了 — 入座</button>
              <button onClick={handleCancel} className="w-full text-sm rounded-2xl font-bold py-3 bg-white border border-chicken-red/40 text-chicken-red hover:bg-chicken-red/5">✕ 取消訂位</button>
            </>
          )}

          {table.status === 'dining' && booking && (
            <>
              {/* 主要操作：漸進式 — 先進「等待清桌」，避免連點直接釋出髒桌 */}
              <button onClick={handleCheckout} className="bg-orange-500 hover:opacity-90 text-white font-bold py-3 min-h-[44px] rounded-2xl w-full">
                🚪 客人已離席
              </button>
              {/* 次要：直接釋出（已清桌完成），降權重、較小較淡、保留 confirm */}
              <button
                onClick={handleFinalize}
                className="w-full text-xs text-chicken-brown/55 hover:text-chicken-brown font-bold underline underline-offset-2 py-2 min-h-[44px]"
              >
                直接釋出（已清桌完成）
              </button>
              <div className="grid grid-cols-2 gap-2">
                <button onClick={onStartMove} className="btn-secondary text-sm">↔ 換桌</button>
                <button onClick={() => toast.info('（v1 預留）訂單明細整合中')} className="btn-secondary text-sm">📝 訂單明細</button>
              </div>
            </>
          )}

          {/* 團體桌的清桌（含接下一梯）在 GroupTableSection 內處理 */}
          {table.status === 'cleaning' && !groupRef && (
            <button onClick={handleClear} className="btn-primary w-full">✨ 清桌完成</button>
          )}

          {table.status === 'blocked' && canBlock && (
            <button onClick={handleUnblock} className="btn-primary w-full">恢復可用</button>
          )}
        </div>
      )}

      {/* Walk-in Modal */}
      <Modal open={showWalkIn} onClose={() => setShowWalkIn(false)} title={`${table.number} · 散客入座`} footer={
        <>
          <button onClick={() => setShowWalkIn(false)} className="btn-secondary px-4 py-2">取消</button>
          <button onClick={handleWalkIn} className="btn-primary px-4 py-2">確認入座</button>
        </>
      }>
        <div className="space-y-3">
          <Input label="姓名" value={walkInForm.name} onChange={e => setWalkInForm(f => ({ ...f, name: e.target.value }))} placeholder="散客" />
          <Input label="電話（選填）" value={walkInForm.phone} onChange={e => setWalkInForm(f => ({ ...f, phone: e.target.value }))} placeholder="0912345678" />
          <Select
            label="人數"
            value={walkInForm.guests}
            onChange={e => setWalkInForm(f => ({ ...f, guests: Number(e.target.value) }))}
            options={Array.from({ length: table.capacity }, (_, i) => ({ value: i + 1, label: `${i + 1} 位` }))}
          />
          <Input label="備註（選填）" value={walkInForm.notes} onChange={e => setWalkInForm(f => ({ ...f, notes: e.target.value }))} />
        </div>
      </Modal>

      {/* Block Modal */}
      <Modal open={showBlock} onClose={() => setShowBlock(false)} title={`${table.number} · 設為不可用`} footer={
        <>
          <button onClick={() => setShowBlock(false)} className="btn-secondary px-4 py-2">取消</button>
          <button onClick={handleBlock} className="btn-primary px-4 py-2">確認</button>
        </>
      }>
        <Input label="原因" value={blockReason} onChange={e => setBlockReason(e.target.value)} placeholder="例：桌椅維修、瓦斯管線檢查" />
      </Modal>
    </div>
  )
}
