import { useState, useEffect } from 'react'
import { Modal, Input, Select } from '../../ui'
import { useToast, useConfirm } from '../../ui/Toast'
import { useBooking } from '../../../contexts/BookingContext'
import { useAuth } from '../../../contexts/AuthContext'
import TableCandidatePanel from './TableCandidatePanel'

// 點桌位後彈出的詳情 + 操作面板
// 設計重點：操作不超過 2 下 tap，按鈕語意明確、避免誤觸
const STATUS_LABELS = {
  vacant: '空桌',
  reserved: '已預訂',
  dining: '用餐中',
  cleaning: '等待清桌',
  blocked: '不可用',
}
const STATUS_PILL_BG = {
  vacant: 'bg-emerald-500',
  reserved: 'bg-yellow-500',
  dining: 'bg-red-500',
  cleaning: 'bg-orange-500',
  blocked: 'bg-slate-400',
}

function fmtTime(d) {
  const t = new Date(d)
  return `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`
}
function diffMin(d) {
  return Math.floor((Date.now() - new Date(d).getTime()) / 60000)
}

export default function TableDrawer({ table, booking, onClose, onStartMerge, onStartMove, mode }) {
  const { can } = useAuth()
  const toast = useToast()
  const confirmDialog = useConfirm()
  const {
    setTableStatus, blockTable, unblockTable, walkInSeat,
    seatBooking, checkoutBooking, finalizeBooking, clearTable, cancelBooking, setStatus,
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
    const r = finalizeBooking(booking.id)
    if (!r.ok) return toast.error(r.error)
    toast.success(`✨ ${booking.name} 已離席且 ${table.number} 已釋出（用餐 ${min} 分）`)
    onClose?.()
  }

  const handleClear = () => {
    clearTable(table.number)
    toast.success(`${table.number} 已清桌完成`)
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
              {table.fuel === 'tank' && <span className="ml-1 text-chicken-yellow">· 瓦斯桶</span>}
              {table.fuel === 'natural-gas' && <span className="ml-1 text-chicken-brown/40">· 天然氣</span>}
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
              const stage = m >= 90 ? 'overtime' : m >= 60 ? 'late' : 'normal'
              return (
                <>
                  <div className="flex justify-between">
                    <span className="text-chicken-brown/60">入座</span>
                    <span>{fmtTime(table.seatedAt)}</span>
                  </div>
                  <div className={`flex items-center justify-between rounded-xl px-3 py-2 mt-2
                    ${stage === 'overtime' ? 'bg-chicken-red text-white animate-pulse'
                      : stage === 'late' ? 'bg-chicken-yellow/20 text-chicken-yellow'
                      : 'bg-chicken-cream text-chicken-brown'}`}>
                    <span className="text-xs font-bold">已用餐</span>
                    <span className="text-2xl font-black tabular-nums">
                      {m} <span className="text-sm">分</span>
                    </span>
                  </div>
                  {stage === 'overtime' && (
                    <div className="text-[11px] text-chicken-red font-bold mt-1 text-center">
                      ⚠️ 已超過 90 分鐘，可禮貌詢問是否需要結帳
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

        {table.status === 'cleaning' && (
          <p className="text-chicken-brown/60 text-center py-4">外場清桌中</p>
        )}
        {table.status === 'blocked' && (
          <div className="text-chicken-brown/60 text-sm">
            <span className="font-bold">原因：</span>{table.blockReason || '—'}
          </div>
        )}
        {table.status === 'vacant' && !mode?.assigning && (
          <>
            <p className="text-chicken-brown/40 text-center py-2 text-xs">此桌目前可使用</p>
            <TableCandidatePanel table={table} onPicked={onClose} />
          </>
        )}

        {/* 併桌資訊 */}
        {table.mergedWith && (
          <div className="px-3 py-2 bg-chicken-yellow/10 border border-chicken-yellow/30 rounded-lg text-xs">
            <span className="font-bold text-chicken-yellow">⇆ 併桌中：</span>
            與 {table.mergedWith} 合併（合計 {table.capacity + 4} 人座位）
          </div>
        )}
      </div>

      {/* Action 按鈕 */}
      {canEdit && (
        <div className="px-5 pb-5 border-t border-chicken-brown/10 pt-3 space-y-2">
          {table.status === 'vacant' && (
            <>
              <button onClick={() => setShowWalkIn(true)} className="btn-primary w-full">✅ 散客直接入座</button>
              <div className="grid grid-cols-2 gap-2">
                <button onClick={onStartMerge} className="btn-secondary text-sm">⇆ 併桌</button>
                {canBlock && <button onClick={() => setShowBlock(true)} className="btn-secondary text-sm">🚫 設不可用</button>}
              </div>
            </>
          )}

          {table.status === 'reserved' && booking && (
            <>
              <button onClick={handleSeat} className="btn-primary w-full">✅ 客人到了 — 入座</button>
              <div className="grid grid-cols-2 gap-2">
                <button onClick={handleCancel} className="btn-secondary text-sm">取消訂位</button>
                <button onClick={onStartMerge} className="btn-secondary text-sm">⇆ 併桌</button>
              </div>
            </>
          )}

          {table.status === 'dining' && booking && (
            <>
              <button onClick={handleCheckout} className="bg-orange-500 hover:opacity-90 text-white font-bold py-3 rounded-2xl w-full">
                🚪 已離席（待清桌）
              </button>
              <button onClick={handleFinalize} className="bg-chicken-green hover:opacity-90 text-white font-bold py-3 rounded-2xl w-full">
                ✨ 已離席 + 清桌完成（一鍵釋出）
              </button>
              <div className="grid grid-cols-2 gap-2">
                <button onClick={onStartMove} className="btn-secondary text-sm">↔ 換桌</button>
                <button onClick={() => toast.info('（v1 預留）訂單明細整合中')} className="btn-secondary text-sm">📝 訂單明細</button>
              </div>
            </>
          )}

          {table.status === 'cleaning' && (
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
