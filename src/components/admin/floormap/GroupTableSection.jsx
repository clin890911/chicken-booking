import { useMemo } from 'react'
import { useBooking } from '../../../contexts/BookingContext'
import { useToast, useConfirm } from '../../ui/Toast'
import { nextBatchForTable } from '../../../utils/groupLive'

// TableDrawer 內的「團體桌」資訊與操作區，三種情境：
// 1. vacant 但被今日團體 hold（groupHold）→ 顯示團資訊＋「梯次入座」；散客入座降為次按鈕＋confirm
// 2. dining 且 currentRef 指向團（groupRef）→ 「此梯離席」「整團完成」
// 3. cleaning 且 currentRef 指向團 → 有下一梯圈此桌時「清桌完成＋接下一梯」，否則「清桌完成」
export default function GroupTableSection({ table, groupRef, groupBatch, groupHold, canEdit, onWalkInOverride, onReseatBatch, onClose }) {
  const { tables, seatGroupBatch, checkoutGroupBatch, finalizeGroup, seatNextBatchOnTable, clearTable } = useBooking()
  const toast = useToast()
  const confirm = useConfirm()

  const tableByNumber = useMemo(() => {
    const m = {}
    tables.forEach(t => { m[t.number] = t })
    return m
  }, [tables])

  // hold 情境取最近的未入座梯次；dining/cleaning 情境用 currentRef 指向的團與梯
  const hold = !groupRef && groupHold?.holds?.length ? groupHold.holds[0] : null
  const g = groupRef || hold?.group || null
  const batch = groupBatch || hold?.batch || null
  if (!g) return null

  // cleaning 團體桌：找「下一個圈此桌、未入座」的梯次（從剛用完的那一梯之後）
  const nextBatch = table.status === 'cleaning' && groupRef
    ? nextBatchForTable(groupRef, table.number, tableByNumber, table.currentRef?.batchId)
    : null

  const handleSeatHold = async () => {
    const tablesTxt = (batch.tableNumbers || []).join('、')
    const ok = await confirm(
      `確認 ${g.agencyName || '團體'} ${batch.label}（${batch.guests} 人）入座？整梯 ${(batch.tableNumbers || []).length} 桌：${tablesTxt}`,
      { title: '梯次入座', confirmLabel: '確認入座' },
    )
    if (!ok) return
    const r = seatGroupBatch(g.id, batch.id)
    if (!r.ok) {
      toast.error('入座失敗：' + r.error)
      // 桌被佔 → 進「改派桌位」模式（關閉抽屜讓地圖選桌）
      if (r.blocked?.length && onReseatBatch) {
        onClose?.()
        onReseatBatch(g, batch, r.blocked)
      }
      return
    }
    toast.success(`✅ ${g.agencyName} ${batch.label} 已入座（${tablesTxt}）`)
  }

  const handleCheckout = async () => {
    const ok = await confirm(
      `${g.agencyName || '團體'} ${batch?.label || '此梯'} 整梯離席？桌位將進入等待清桌。`,
      { title: '梯次離席', confirmLabel: '確認離席' },
    )
    if (!ok) return
    const r = checkoutGroupBatch(g.id, batch.id)
    if (!r.ok) return toast.error('離席失敗：' + r.error)
    toast.success(`${g.agencyName} ${batch?.label || ''} 已離席，桌位待清`)
  }

  const handleFinalize = async () => {
    const ok = await confirm(
      `整團完成？將釋出 ${g.agencyName || '此團'} 佔用的所有桌位。`,
      { title: '整團完成', confirmLabel: '完成釋桌' },
    )
    if (!ok) return
    const r = finalizeGroup(g.id)
    if (!r.ok) return toast.error('完成失敗：' + r.error)
    toast.success(`${g.agencyName} 整團已完成、桌位釋出`)
    onClose?.()
  }

  const handleClearAndNext = async () => {
    const ok = await confirm(
      `清桌完成，並讓 ${nextBatch.label}（${nextBatch.guests} 人）接續入座 ${table.number}？`,
      { title: '清桌＋接下一梯', confirmLabel: '清桌＋入座' },
    )
    if (!ok) return
    const r = seatNextBatchOnTable(table.number, g.id, nextBatch.id)
    if (!r.ok) return toast.error('接梯失敗：' + r.error)
    toast.success(`✨ ${table.number} 已清桌，${g.agencyName} ${nextBatch.label} 入座`)
  }

  const handleClearOnly = () => {
    clearTable(table.number)
    toast.success(`${table.number} 已清桌完成`)
    onClose?.()
  }

  const handleWalkInOverride = async () => {
    const ok = await confirm(
      `此桌已預留給 ${g.agencyName || '今日團體'}（${batch?.label || ''} ${batch?.timeSlot || ''}）。確定改讓散客入座？`,
      { title: '覆蓋團體預留', danger: true, confirmLabel: '改散客入座' },
    )
    if (!ok) return
    onWalkInOverride?.()
  }

  return (
    <div className="space-y-2">
      <div className="px-3 py-2 bg-indigo-50 border border-indigo-200 rounded-lg">
        <div className="font-bold text-indigo-700">🚌 {g.agencyName || '旅行社團體'}</div>
        <div className="text-xs text-indigo-700/80 mt-0.5">
          {batch ? `${batch.label} ${batch.timeSlot}${batch.guests ? ` · ${batch.guests} 人` : ''}` : ''} · 導遊 {g.guideName || '—'}
        </div>
        {hold && (
          <div className="text-[11px] text-indigo-700/70 mt-0.5">
            此桌為今日團體預留{(batch?.tableNumbers || []).length > 1 ? `（整梯共 ${batch.tableNumbers.length} 桌：${batch.tableNumbers.join('、')}）` : ''}
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5 text-[11px] font-bold">
        <span className="px-2 py-0.5 rounded-full bg-chicken-red/10 text-chicken-red">總 {g.counts?.total || 0}</span>
        {g.counts?.vegetarian > 0 && <span className="px-2 py-0.5 rounded-full bg-chicken-green/15 text-chicken-green">素 {g.counts.vegetarian}</span>}
        {g.counts?.mobility > 0 && <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">♿ {g.counts.mobility}</span>}
        {g.counts?.wheelchair > 0 && <span className="px-2 py-0.5 rounded-full bg-violet-100 text-violet-700">輪椅 {g.counts.wheelchair}</span>}
      </div>
      {g.allergyText && <div className="text-[11px] text-chicken-red font-bold">過敏：{g.allergyText}</div>}

      {canEdit && (
        <div className="space-y-2 pt-1">
          {/* 情境 1：vacant + hold → 整梯入座為主、散客覆蓋為次 */}
          {hold && table.status === 'vacant' && (
            <>
              <button onClick={handleSeatHold} className="btn-primary w-full">
                ✅ {batch.label} 入座（整梯 {(batch.tableNumbers || []).length} 桌）
              </button>
              <button
                onClick={handleWalkInOverride}
                className="w-full text-xs text-chicken-brown/55 hover:text-chicken-brown font-bold underline underline-offset-2 py-2 min-h-[44px]"
              >
                散客入座（覆蓋團體預留）
              </button>
            </>
          )}

          {/* 情境 2：dining 團體桌 */}
          {groupRef && table.status === 'dining' && (
            <>
              <button onClick={handleCheckout} className="bg-orange-500 hover:opacity-90 text-white font-bold py-3 min-h-[44px] rounded-2xl w-full">
                🚪 此梯離席（整梯）
              </button>
              <button
                onClick={handleFinalize}
                className="w-full text-xs text-chicken-brown/55 hover:text-chicken-brown font-bold underline underline-offset-2 py-2 min-h-[44px]"
              >
                整團完成（釋出全部桌位）
              </button>
            </>
          )}

          {/* 情境 3：cleaning 團體桌 */}
          {groupRef && table.status === 'cleaning' && (
            nextBatch ? (
              <>
                <button onClick={handleClearAndNext} className="btn-primary w-full">
                  ✨ 清桌完成＋{nextBatch.label} 入座
                </button>
                <button
                  onClick={handleClearOnly}
                  className="w-full text-xs text-chicken-brown/55 hover:text-chicken-brown font-bold underline underline-offset-2 py-2 min-h-[44px]"
                >
                  只清桌（不接下一梯）
                </button>
              </>
            ) : (
              <button onClick={handleClearOnly} className="btn-primary w-full">✨ 清桌完成</button>
            )
          )}
        </div>
      )}
    </div>
  )
}
