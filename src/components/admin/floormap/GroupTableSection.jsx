import { useMemo } from 'react'
import { useBooking } from '../../../contexts/BookingContext'
import { useToast, useConfirm } from '../../ui/Toast'
import { nextBatchForTable } from '../../../utils/groupLive'

// TableDrawer 內的「團體桌」資訊與操作區，三種情境：
// 1. vacant 但被今日團體 hold（groupHold）→ 顯示團資訊＋「梯次入座」；散客入座降為次按鈕＋confirm
// 2. dining 且 currentRef 指向團（groupRef）→ 單桌操作優先：「這桌離席」「換桌」「加桌」；
//    整梯／整團次要：「整梯離席（N 桌）」「整團完成」。離席都有 8 秒「↩ 復原」。
//    （2026-11 店主痛點：團體一次佔很多桌，一桌先吃完卻只能整梯或整團處理。）
// 權限（perms 來自 utils/seatingPerms.seatingPerms）：每顆鈕依實際寫入的集合各自判定——
//   梯次入座／整梯釋出／整團完成／接下一梯會寫 groupReservations（需 group.update）；
//   換桌／加桌改梯次圈桌、單桌清桌可能落 releasedAt／結團（group.update）；這桌離席／整梯離席只寫 tables；
//   散客覆蓋入座走 walkInSeat 寫 bookings。
// 3. cleaning 且 currentRef 指向團 → 有下一梯圈此桌時「清桌完成＋接下一梯」，否則「清桌完成」；
//    單桌清桌走 clearGroupTable（清完本梯最後一桌自動落 releasedAt／結團），有「↩ 復原」。
export default function GroupTableSection({ table, groupRef, groupBatch, groupHold, perms, onWalkInOverride, onReseatBatch, onGroupMove, onGroupAdd, onClose }) {
  const {
    tables, seatGroupBatch, checkoutGroupBatch, releaseGroupBatch, finalizeGroup, seatNextBatchOnTable,
    checkoutGroupTable, undoGroupCheckout, clearGroupTable, undoClearGroupTable,
  } = useBooking()
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

  // 本梯目前還有幾張「待清（cleaning）」桌（含本桌）→ 決定要不要提供「整梯一次清」
  const batchCleaningCount = groupRef && batch
    ? (batch.tableNumbers || []).filter(n => {
        const t = tableByNumber[n]
        return t && t.status === 'cleaning' && t.currentRef?.groupId === g.id && t.currentRef?.batchId === batch.id
      }).length
    : 0

  // 本梯目前還有幾張「用餐中（dining）」桌（含本桌）→「整梯離席（N 桌）」的 N
  const batchDiningCount = groupRef && batch
    ? (batch.tableNumbers || []).filter(n => {
        const t = tableByNumber[n]
        return t && t.status === 'dining' && t.currentRef?.groupId === g.id && t.currentRef?.batchId === batch.id
      }).length
    : 0

  // 離席（單桌／整梯共用）的 8 秒復原：只倒回「仍待清、仍指向同團同梯」的桌，被清掉／被佔走的安全失敗
  const offerCheckoutUndo = (msg, snapshot) => {
    toast.action(msg,
      { label: '↩ 復原', onClick: () => {
        const r = undoGroupCheckout(snapshot)
        if (!r?.ok) return toast.error('復原失敗：' + (r?.error || '未知錯誤'))
        if (r.failed?.length) toast.info(`已復原 ${r.restored.join('、')} 為用餐中；${r.failed.join('、')} 已清桌或被使用，未復原`)
        else toast.success(`已復原 ${r.restored.join('、')} 為用餐中`)
      } },
      { duration: 8000 })
  }

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
    toast.success(`${g.agencyName} ${batch.label} 已入座（${tablesTxt}）`)
  }

  // 這桌離席（S1）：只動這一張桌，不跳 confirm（有復原），同梯其他桌照常用餐
  const handleCheckoutTable = () => {
    const r = checkoutGroupTable(table.number)
    if (!r.ok) return toast.error('離席失敗：' + r.error)
    offerCheckoutUndo(`${table.number} 已離席，桌位待清（${g.agencyName || '團體'} ${batch?.label || ''}）`, r.snapshot)
  }

  const handleCheckout = async () => {
    const ok = await confirm(
      `${g.agencyName || '團體'} ${batch?.label || '此梯'} 整梯離席（${batchDiningCount} 桌）？桌位將進入等待清桌。`,
      { title: '梯次離席', confirmLabel: '確認離席' },
    )
    if (!ok) return
    const r = checkoutGroupBatch(g.id, batch.id)
    if (!r.ok) return toast.error('離席失敗：' + r.error)
    offerCheckoutUndo(`${g.agencyName} ${batch?.label || ''} 已離席，桌位待清`, r.snapshot)
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
    toast.success(`${table.number} 已清桌，${g.agencyName} ${nextBatch.label} 入座`)
  }

  // 單桌清桌（S3/S4）：清完本梯最後一桌 → 本梯自動標「此梯完成」；全部梯都完成 → 自動整團完成。
  // 8 秒復原連同自動標記／自動結團一起倒回；桌已被下一組坐走 → 安全失敗（undoClearGroupTable 守門）。
  const handleClearOnly = () => {
    const r = clearGroupTable(table.number)
    if (!r.ok) return toast.error('清桌失敗：' + r.error)
    const tail = r.groupCompleted ? `，${g.agencyName || '此團'} 整團完成`
      : r.batchReleased ? `，${batch?.label || '此梯'} 全部清完` : ''
    toast.action(`${table.number} 已清桌完成${tail}`,
      { label: '↩ 復原', onClick: () => {
        const u = undoClearGroupTable(r.snapshot)
        if (!u?.ok) return toast.error('復原失敗：' + (u?.error || '未知錯誤'))
        toast.success(`已復原 ${table.number} 為等待清桌`)
      } },
      { duration: 8000 })
    onClose?.()
  }

  // 整梯清桌釋出：一次清掉本梯所有待清桌、釋放座位（不結束整團）
  const handleReleaseBatch = async () => {
    const ok = await confirm(
      `整梯清桌釋出？將把 ${g.agencyName || '此團'} ${batch?.label || '此梯'} 的 ${batchCleaningCount} 張待清桌一次清為空桌、釋放座位。`,
      { title: '整梯清桌釋出', confirmLabel: '清桌釋出' },
    )
    if (!ok) return
    const r = releaseGroupBatch(g.id, batch.id)
    if (!r.ok) return toast.error('清桌失敗：' + r.error)
    toast.success(`${g.agencyName} ${batch?.label || ''} 已清桌釋出（${(r.cleared || []).length} 桌）`)
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
        <div className="font-bold text-indigo-700">{g.agencyName || '旅行社團體'}</div>
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
        {g.counts?.mobility > 0 && <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">行動 {g.counts.mobility}</span>}
        {g.counts?.wheelchair > 0 && <span className="px-2 py-0.5 rounded-full bg-violet-100 text-violet-700">輪椅 {g.counts.wheelchair}</span>}
      </div>
      {g.allergyText && <div className="text-[11px] text-chicken-red font-bold">過敏：{g.allergyText}</div>}

      {perms.table && (
        <div className="space-y-2 pt-1">
          {/* 情境 1：vacant + hold → 整梯入座為主、散客覆蓋為次 */}
          {hold && table.status === 'vacant' && (
            <>
              {perms.group && (
                <button onClick={handleSeatHold} className="btn-primary w-full">
                  {batch.label} 入座（整梯 {(batch.tableNumbers || []).length} 桌）
                </button>
              )}
              {perms.walkIn && (
                <button
                  onClick={handleWalkInOverride}
                  className="w-full text-xs text-chicken-brown/55 hover:text-chicken-brown font-bold underline underline-offset-2 py-2 min-h-[44px]"
                >
                  散客入座（覆蓋團體預留）
                </button>
              )}
            </>
          )}

          {/* 情境 2：dining 團體桌——單桌操作在前（店主痛點），整梯／整團次要 */}
          {groupRef && table.status === 'dining' && (
            <>
              <button onClick={handleCheckoutTable} className="bg-orange-500 hover:opacity-90 text-white font-bold py-3 min-h-[44px] rounded-xl w-full">
                這桌離席
              </button>
              {perms.group && (onGroupMove || onGroupAdd) && (
                <div className="grid grid-cols-2 gap-2">
                  {onGroupMove && (
                    <button
                      onClick={() => onGroupMove(g, batch, table.number)}
                      className="bg-white border border-indigo-300 text-indigo-700 font-bold py-2.5 min-h-[44px] rounded-xl"
                    >換桌</button>
                  )}
                  {onGroupAdd && (
                    <button
                      onClick={() => onGroupAdd(g, batch, table.number)}
                      className="bg-white border border-indigo-300 text-indigo-700 font-bold py-2.5 min-h-[44px] rounded-xl"
                    >加桌</button>
                  )}
                </div>
              )}
              <button onClick={handleCheckout} className="bg-white border border-orange-300 text-orange-700 font-bold py-2.5 min-h-[44px] rounded-xl w-full">
                整梯離席（{batchDiningCount} 桌）
              </button>
              {perms.group && (
                <button
                  onClick={handleFinalize}
                  className="w-full text-xs text-chicken-brown/55 hover:text-chicken-brown font-bold underline underline-offset-2 py-2 min-h-[44px]"
                >
                  整團完成（釋出全部桌位）
                </button>
              )}
            </>
          )}

          {/* 情境 3：cleaning 團體桌 */}
          {groupRef && table.status === 'cleaning' && (
            nextBatch && perms.group ? (
              <>
                <button onClick={handleClearAndNext} className="btn-primary w-full">
                  清桌完成＋{nextBatch.label} 入座
                </button>
                <button
                  onClick={handleClearOnly}
                  className="w-full text-xs text-chicken-brown/55 hover:text-chicken-brown font-bold underline underline-offset-2 py-2 min-h-[44px]"
                >
                  只清桌（不接下一梯）
                </button>
                {batchCleaningCount > 1 && (
                  <button
                    onClick={handleReleaseBatch}
                    className="w-full text-xs text-chicken-brown/55 hover:text-chicken-brown font-bold underline underline-offset-2 py-2 min-h-[44px]"
                  >
                    整梯清桌釋出（{batchCleaningCount} 桌）
                  </button>
                )}
              </>
            ) : batchCleaningCount > 1 && perms.group ? (
              <>
                <button onClick={handleReleaseBatch} className="btn-primary w-full">
                  整梯清桌釋出（{batchCleaningCount} 桌）
                </button>
                <button
                  onClick={handleClearOnly}
                  className="w-full text-xs text-chicken-brown/55 hover:text-chicken-brown font-bold underline underline-offset-2 py-2 min-h-[44px]"
                >
                  只清此桌
                </button>
              </>
            ) : perms.group ? (
              <button onClick={handleClearOnly} className="btn-primary w-full">清桌完成</button>
            ) : (
              // 團體單桌清桌會寫團單（清完本梯最後一桌落 releasedAt／自動結團）→ 需 group.update；
              // 只有 table.update 的角色按下去，本機看似成功、雲端團單卻被拒（部分推送）→ 不給按、講清楚找誰
              <p className="text-xs text-chicken-brown/60 font-bold px-1 py-2">團體桌清桌會更新團單，請由店長或外場處理</p>
            )
          )}
        </div>
      )}
    </div>
  )
}
