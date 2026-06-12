import { useMemo } from 'react'
import { useBooking } from '../../../contexts/BookingContext'
import { useToast, useConfirm } from '../../ui/Toast'
import { Badge } from '../../ui'
import { batchSeated, sortedBatches } from '../../../utils/groupLive'

const STATUS_LABEL = {
  planned: { label: '已預排', color: 'gray' },
  confirmed: { label: '已確認', color: 'yellow' },
  arrived: { label: '已到店', color: 'green' },
  completed: { label: '已完成', color: 'brown' },
  cancelled: { label: '已取消', color: 'red' },
}

// 今日團體單張卡（現場右側欄窄版）：梯次入座 / 離席、整團完成、回傳單。
// 入座/離席/完成一次翻動多桌，誤觸成本高 → 一律 confirm（不走地圖二步確認，桌已預圈無選桌步驟）。
// 已完成（status=completed）的卡片轉唯讀：灰階、無操作按鈕，僅保留回傳單列印。
export default function GroupTodayCard({ group: g, onOpenSheet, onFocusTable, onReseatBatch }) {
  const { tables, seatGroupBatch, checkoutGroupBatch, releaseGroupBatch, finalizeGroup, setGroupStatus } = useBooking()
  const toast = useToast()
  const confirm = useConfirm()
  const isDone = g.status === 'completed'

  const tableByNumber = useMemo(() => {
    const m = {}
    tables.forEach(t => { m[t.number] = t })
    return m
  }, [tables])

  const onSeat = async (b) => {
    const tablesTxt = (b.tableNumbers || []).join('、')
    const ok = await confirm(
      `確認 ${g.agencyName || '團體'} ${b.label}（${b.guests} 人）入座？整梯 ${(b.tableNumbers || []).length} 桌：${tablesTxt}`,
      { title: '梯次入座', confirmLabel: '確認入座' },
    )
    if (!ok) return
    const r = seatGroupBatch(g.id, b.id)
    if (!r.ok) {
      toast.error('入座失敗：' + r.error)
      // 桌被佔 → 直接進「改派桌位」模式，讓操作者馬上在地圖上挑替代桌
      if (r.blocked?.length && onReseatBatch) onReseatBatch(g, b, r.blocked)
      return
    }
    toast.success(`✅ ${g.agencyName} ${b.label} 已入座（${tablesTxt}）`)
  }

  const onCheckout = async (b) => {
    const ok = await confirm(
      `${g.agencyName || '團體'} ${b.label} 整梯離席？桌位將進入等待清桌。`,
      { title: '梯次離席', confirmLabel: '確認離席' },
    )
    if (!ok) return
    const r = checkoutGroupBatch(g.id, b.id)
    if (!r.ok) return toast.error('離席失敗：' + r.error)
    toast.success(`${g.agencyName} ${b.label} 已離席，桌位待清`)
  }

  // 整梯清桌釋出：把該梯所有待清桌一次清成空桌、釋放座位（不結束整團）
  const onRelease = async (b) => {
    const ok = await confirm(
      `${g.agencyName || '團體'} ${b.label} 整梯清桌、釋放座位？該梯待清桌將全部清為空桌、可再帶客。`,
      { title: '整梯清桌釋出', confirmLabel: '清桌釋出' },
    )
    if (!ok) return
    const r = releaseGroupBatch(g.id, b.id)
    if (!r.ok) return toast.error('清桌失敗：' + r.error)
    toast.success(`✨ ${g.agencyName} ${b.label} 已清桌釋出（${(r.cleared || []).length} 桌）`)
  }

  const onFinalize = async () => {
    const ok = await confirm(
      `整團完成？將釋出 ${g.agencyName || '此團'} 佔用的所有桌位。`,
      { title: '整團完成', confirmLabel: '完成釋桌' },
    )
    if (!ok) return
    const r = finalizeGroup(g.id)
    if (!r.ok) return toast.error('完成失敗：' + r.error)
    toast.success(`${g.agencyName} 整團已完成、桌位釋出`)
  }

  const st = STATUS_LABEL[g.status] || STATUS_LABEL.planned
  const c = g.counts || {}

  return (
    <div className={`rounded-xl border p-3 ${isDone ? 'bg-gray-50 border-chicken-brown/10 opacity-80' : 'bg-white border-chicken-brown/10'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className={`font-black text-sm ${isDone ? 'text-chicken-brown/60' : 'text-chicken-brown'}`}>
            {isDone ? '✅' : '🚌'} {g.agencyName || '（未填旅行社）'}
            <Badge color={st.color} className="ml-1.5">{st.label}</Badge>
          </div>
          <div className="text-[11px] text-chicken-brown/60 mt-0.5">
            導遊 {g.guideName || '—'}{g.guidePhone ? `（${g.guidePhone}）` : ''}
          </div>
        </div>
        <button onClick={() => onOpenSheet?.(g)} className="flex-shrink-0 px-2 py-1 rounded-lg text-[11px] font-bold bg-white border border-chicken-brown/15 text-chicken-brown" title="回傳單">🖨</button>
      </div>

      <div className="mt-1.5 flex flex-wrap gap-1 text-[10px] font-bold">
        <span className="px-1.5 py-0.5 rounded-full bg-chicken-red/10 text-chicken-red">總 {c.total || 0}</span>
        {c.vegetarian > 0 && <span className="px-1.5 py-0.5 rounded-full bg-chicken-green/15 text-chicken-green">素 {c.vegetarian}</span>}
        {c.child > 0 && <span className="px-1.5 py-0.5 rounded-full bg-sky-100 text-sky-700">兒童 {c.child}</span>}
        {c.mobility > 0 && <span className="px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">♿ {c.mobility}</span>}
        {c.wheelchair > 0 && <span className="px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-700">輪椅 {c.wheelchair}</span>}
        {g.allergyText && <span className="px-1.5 py-0.5 rounded-full bg-chicken-red text-white">過敏：{g.allergyText}</span>}
      </div>

      <div className="mt-2 space-y-1.5">
        {sortedBatches(g).map(b => {
          // 已清桌釋出的梯：桌位痕跡已清空，releasedAt 是唯一判定來源——
          // 顯示「此梯完成」，不再提供任何操作（防止整輪流程重跑）。
          const released = !!b.releasedAt
          const seated = !released && batchSeated(g, b, tableByNumber)
          // 已離席待清：本梯仍有 cleaning 桌（currentRef 指向本梯）→ 提供「整梯清桌釋出」
          const cleaning = !released && !seated && (b.tableNumbers || []).some(n => {
            const t = tableByNumber[n]
            return t && t.status === 'cleaning' && t.currentRef?.groupId === g.id && t.currentRef?.batchId === b.id
          })
          return (
            <div key={b.id} className={`rounded-lg px-2.5 py-2 ${b.isEscort ? 'bg-indigo-50 border border-indigo-200' : 'bg-chicken-cream/60'}`}>
              <div className="flex items-center gap-1.5 flex-wrap text-[11px]">
                <span className="text-sm font-black text-chicken-brown tabular-nums">{b.timeSlot}</span>
                <span className={`font-bold ${b.isEscort ? 'text-indigo-700' : 'text-chicken-brown'}`}>{b.isEscort ? '🚗 司領桌' : b.label}</span>
                <span className="text-chicken-brown/60">{b.guests} 人</span>
              </div>
              <div className="mt-1 flex items-center justify-between gap-1.5 flex-wrap">
                <div className="flex flex-wrap gap-1 text-[10px] font-bold">
                  {(b.tableNumbers || []).length === 0 ? (
                    <span className="text-chicken-brown/45">未圈桌</span>
                  ) : (
                    b.tableNumbers.map(n => (
                      <button
                        key={n}
                        onClick={() => onFocusTable?.(n)}
                        className="px-1.5 py-0.5 rounded bg-white border border-chicken-brown/15 text-chicken-brown hover:border-chicken-red"
                        title={`在地圖上查看 ${n}`}
                      >{n}</button>
                    ))
                  )}
                </div>
                {isDone ? (
                  <span className="text-[10px] font-bold text-chicken-brown/45">已完成</span>
                ) : released ? (
                  <span className="text-[10px] font-bold text-chicken-green">✓ 此梯完成</span>
                ) : seated ? (
                  <button onClick={() => onCheckout(b)} className="px-2.5 py-1.5 min-h-[36px] rounded-lg text-[11px] font-bold bg-amber-500 text-white">梯次離席</button>
                ) : cleaning ? (
                  <button onClick={() => onRelease(b)} className="px-2.5 py-1.5 min-h-[36px] rounded-lg text-[11px] font-bold bg-sky-600 text-white">✨ 整梯清桌釋出</button>
                ) : (
                  <button onClick={() => onSeat(b)} disabled={!(b.tableNumbers || []).length}
                    className="px-2.5 py-1.5 min-h-[36px] rounded-lg text-[11px] font-bold bg-chicken-green text-white disabled:opacity-40">✅ 梯次入座</button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {!isDone && (
        <div className="mt-2 flex items-center justify-between gap-2">
          {g.status === 'planned' ? (
            <button onClick={() => setGroupStatus(g.id, 'confirmed')} className="text-[11px] text-chicken-brown/60 underline">標記為已確認</button>
          ) : <span />}
          <button onClick={onFinalize} className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold bg-chicken-brown text-white">整團完成</button>
        </div>
      )}
    </div>
  )
}
