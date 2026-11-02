import { useMemo } from 'react'
import { useBooking } from '../../../contexts/BookingContext'
import { useAuth } from '../../../contexts/AuthContext'
import { seatingPerms } from '../../../utils/seatingPerms'
import { useToast, useConfirm } from '../../ui/Toast'
import { Badge } from '../../ui'
import { batchLiveState, sortedBatches } from '../../../utils/groupLive'
import Icon from '../../ui/Icon'
import PhoneLink from './PhoneLink'
import GlyphText from '../../ui/GlyphText'

const STATUS_LABEL = {
  planned: { label: '已預排', color: 'gray' },
  confirmed: { label: '已確認', color: 'yellow' },
  arrived: { label: '已到店', color: 'green' },
  completed: { label: '已完成', color: 'brown' },
  cancelled: { label: '已取消', color: 'red' },
}

// 團體梯次的現場動作（入座／離席＋復原／整梯清桌釋出／整團完成）：GroupTodayCard 與
// 「今日」時間清單的團體梯次列（GroupBatchRow）共用同一套 handler，不各寫一份。
// 入座/離席/完成一次翻動多桌，誤觸成本高 → 一律 confirm（不走地圖二步確認，桌已預圈無選桌步驟）。
export function useGroupBatchActions(g, { onReseatBatch } = {}) {
  const { tables, seatGroupBatch, checkoutGroupBatch, undoGroupCheckout, releaseGroupBatch, finalizeGroup, setGroupStatus } = useBooking()
  const toast = useToast()
  const confirm = useConfirm()
  // 權限門（見 utils/seatingPerms.js）：梯次入座／整梯釋出／整團完成／標記已確認會寫 groupReservations（group.update），
  // 梯次離席只寫 tables。過去整張卡完全沒有權限檢查，唯讀角色（kitchen）也按得下去。
  const perms = seatingPerms(useAuth()?.can)

  const tableByNumber = useMemo(() => {
    const m = {}
    ;(tables || []).forEach(t => { m[t.number] = t })
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
    toast.success(`${g.agencyName} ${b.label} 已入座（${tablesTxt}）`)
  }

  const onCheckout = async (b) => {
    const ok = await confirm(
      `${g.agencyName || '團體'} ${b.label} 整梯離席？桌位將進入等待清桌。`,
      { title: '梯次離席', confirmLabel: '確認離席' },
    )
    if (!ok) return
    const r = checkoutGroupBatch(g.id, b.id)
    if (!r.ok) return toast.error('離席失敗：' + r.error)
    // 8 秒復原（與桌況抽屜「整梯離席」同一支 undoGroupCheckout）：只倒回仍待清、仍指向本梯的桌
    toast.action(`${g.agencyName} ${b.label} 已離席，桌位待清`,
      { label: '↩ 復原', onClick: () => {
        const u = undoGroupCheckout(r.snapshot)
        if (!u?.ok) return toast.error('復原失敗：' + (u?.error || '未知錯誤'))
        if (u.failed?.length) toast.info(`已復原 ${u.restored.join('、')} 為用餐中；${u.failed.join('、')} 已清桌或被使用，未復原`)
        else toast.success(`已復原 ${u.restored.join('、')} 為用餐中`)
      } },
      { duration: 8000 })
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
    toast.success(`${g.agencyName} ${b.label} 已清桌釋出（${(r.cleared || []).length} 桌）`)
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

  return { perms, tableByNumber, onSeat, onCheckout, onRelease, onFinalize, setGroupStatus }
}

// 梯次動作鈕：依 batchLiveState 給「梯次離席／整梯清桌釋出／梯次入座」其中一顆（權限不足不渲染）。
// sizeClass：卡片窄版 36px；時間清單列用 44px 觸控高度。
export function BatchActionButton({ batch: b, state, actions, sizeClass = 'px-2.5 py-1.5 min-h-[36px] text-[11px]' }) {
  const { perms, onSeat, onCheckout, onRelease } = actions
  if (state === 'seated') {
    return perms.table ? <button type="button" onClick={() => onCheckout(b)} className={`${sizeClass} rounded-lg font-bold bg-amber-500 text-white`}>梯次離席</button> : null
  }
  if (state === 'cleaning') {
    return perms.group ? <button type="button" onClick={() => onRelease(b)} className={`${sizeClass} rounded-lg font-bold bg-sky-700 text-white`}>整梯清桌釋出</button> : null
  }
  if (state === 'waiting') {
    return perms.group ? <button type="button" onClick={() => onSeat(b)} disabled={!(b.tableNumbers || []).length}
      className={`${sizeClass} rounded-lg font-bold bg-chicken-green text-white disabled:opacity-40`}>梯次入座</button> : null
  }
  return null
}

// 團體需求摘要 chips（總人數／素／兒童／行動／輪椅／過敏）
export function GroupNeedsChips({ group: g, showTotal = true }) {
  const c = g.counts || {}
  return (
    <div className="flex flex-wrap gap-1 text-[10px] font-bold">
      {showTotal && <span className="px-1.5 py-0.5 rounded-full bg-chicken-red/10 text-chicken-red">總 {c.total || 0}</span>}
      {c.vegetarian > 0 && <span className="px-1.5 py-0.5 rounded-full bg-chicken-green/15 text-chicken-green">素 {c.vegetarian}</span>}
      {c.child > 0 && <span className="px-1.5 py-0.5 rounded-full bg-sky-100 text-sky-700">兒童 {c.child}</span>}
      {c.mobility > 0 && <span className="px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">行動 {c.mobility}</span>}
      {c.wheelchair > 0 && <span className="px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-700">輪椅 {c.wheelchair}</span>}
      {g.allergyText && <span className="px-1.5 py-0.5 rounded-full bg-chicken-red text-white">過敏：{g.allergyText}</span>}
    </div>
  )
}

// 今日團體單張卡（窄版）：梯次入座 / 離席、整團完成、回傳單。
// 現場左欄進行中的團改用「今日」時間清單的梯次列（GroupBatchRow），動作 handler 兩邊共用；本卡目前用在底部「已完成」區。
// 已完成（status=completed）的卡片轉唯讀：灰階、無操作按鈕，僅保留回傳單列印。
export default function GroupTodayCard({ group: g, onOpenSheet, onFocusTable, onReseatBatch }) {
  const actions = useGroupBatchActions(g, { onReseatBatch })
  const { perms, tableByNumber, onFinalize, setGroupStatus } = actions
  const isDone = g.status === 'completed'

  const st = STATUS_LABEL[g.status] || STATUS_LABEL.planned

  return (
    <div className={`rounded-xl border p-3 ${isDone ? 'bg-gray-50 border-chicken-brown/10 opacity-80' : 'bg-white border-chicken-brown/10'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className={`font-bold text-sm ${isDone ? 'text-chicken-brown/60' : 'text-chicken-brown'}`}>
            <Icon name={isDone ? 'checkCircle' : 'bus'} size={15} className={`inline-block align-[-2px] mr-1 ${isDone ? 'text-chicken-green' : 'text-chicken-red'}`} />{g.agencyName || '（未填旅行社）'}
            <Badge color={st.color} className="ml-1.5">{st.label}</Badge>
          </div>
          {/* 導遊電話：格式化、放大、可點撥（過去是括號小字，忙時看不清） */}
          <div className="flex items-baseline gap-2 flex-wrap mt-0.5">
            <span className="text-xs text-chicken-brown/60">導遊 {g.guideName || '—'}</span>
            <PhoneLink phone={g.guidePhone} className="text-sm" testId="guide-phone" />
          </div>
        </div>
        <button onClick={() => onOpenSheet?.(g)} className="flex-shrink-0 min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded-lg text-[11px] font-bold bg-white border border-chicken-brown/15 text-chicken-brown" title="回傳單" aria-label="回傳單"><Icon name="print" size={14} /></button>
      </div>

      <div className="mt-1.5"><GroupNeedsChips group={g} /></div>

      <div className="mt-2 space-y-1.5">
        {sortedBatches(g).map(b => {
          // 已清桌釋出的梯：桌位痕跡已清空，releasedAt 是唯一判定來源——
          // 顯示「此梯完成」，不再提供任何操作（防止整輪流程重跑）。見 groupLive.batchLiveState。
          const state = batchLiveState(g, b, tableByNumber)
          return (
            <div key={b.id} className={`rounded-lg px-2.5 py-2 ${b.isEscort ? 'bg-indigo-50 border border-indigo-200' : 'bg-chicken-cream/60'}`}>
              <div className="flex items-center gap-1.5 flex-wrap text-[11px]">
                <span className="text-sm font-bold text-chicken-brown tabular-nums">{b.timeSlot}</span>
                <span className={`font-bold ${b.isEscort ? 'text-indigo-700' : 'text-chicken-brown'}`}>{b.isEscort ? '司領桌' : b.label}</span>
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
                ) : state === 'released' ? (
                  <span className="text-[10px] font-bold text-chicken-green"><GlyphText size={11} className="!gap-0.5">✓ 此梯完成</GlyphText></span>
                ) : (
                  <BatchActionButton batch={b} state={state} actions={actions} />
                )}
              </div>
            </div>
          )
        })}
      </div>

      {!isDone && perms.group && (
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
