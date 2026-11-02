import { overdueMinOf, fmtOverdueMin } from '../../../utils/bookingPulse'
import { batchLiveState } from '../../../utils/groupLive'
import { groupStripeColor } from '../../../utils/todayTimeline'
import { GROUP_HOLD_COLOR, STATUS_COLOR } from '../floormap/statusColors'
import { useGroupBatchActions, BatchActionButton, GroupNeedsChips } from './GroupTodayCard'
import PhoneLink from './PhoneLink'
import Icon from '../../ui/Icon'

// 「今日」時間清單裡的團體梯次列（方案 A demo，2026-11）：每一梯一列，跟散客卡片排在同一條時間線。
// 收合時一列＝時間＋「團」徽章＋旅行社＋梯次序號＋人數＋桌號＋狀態，列高貼近散客卡片，不用大卡片把散客擠下去；
// 同一團的多列左側同色細邊條（groupStripeColor）。點整列原地展開這一梯能做的事——動作鈕與 handler
// 直接重用 GroupTodayCard（useGroupBatchActions／BatchActionButton），不另寫一套；權限照 seatingPerms。
// 展開狀態由 UpcomingPanel 管（同時只展開一列）。
export default function GroupBatchRow({ entry, now, expanded = false, onToggle, onFocusTable, onReseatBatch, onOpenSheet }) {
  const { group: g, batch: b } = entry
  const actions = useGroupBatchActions(g, { onReseatBatch })
  const { perms, tableByNumber, onFinalize, setGroupStatus } = actions
  const state = batchLiveState(g, b, tableByNumber)
  const stripe = groupStripeColor(entry.groupIndex)
  const overdueMin = entry.inProgress ? 0 : overdueMinOf(b.timeSlot, now)
  const overdue = !entry.inProgress && overdueMin > 15 // 與 classifyTodayPulse graceMin 同口徑
  const tables = entry.tableNumbers || []
  const since = entry.seatedAt ? Math.max(0, Math.floor((now - new Date(entry.seatedAt).getTime()) / 60000)) : null

  // 狀態 chip：待到／用餐中 N 桌／待清 N 桌（逐桌離席後兩種可能同時存在）
  const statusChips = entry.inProgress ? [
    entry.diningTables.length > 0 && { text: `用餐中 ${entry.diningTables.length} 桌`, bg: STATUS_COLOR.dining.badge },
    entry.cleaningTables.length > 0 && { text: `待清 ${entry.cleaningTables.length} 桌`, bg: STATUS_COLOR.cleaning.badge },
  ].filter(Boolean) : [{ text: '待到', bg: GROUP_HOLD_COLOR.badge }]

  return (
    <div
      data-group-batch={entry.key}
      data-group-id={g.id}
      className={`rounded-xl border-2 border-l-[6px] ${overdue ? 'border-chicken-red bg-chicken-red/5' : `bg-white ${expanded ? 'border-violet-300' : 'border-violet-200'}`}`}
      style={{ borderLeftColor: stripe }}
    >
      <button
        type="button"
        onClick={() => onToggle?.(entry.key)}
        aria-expanded={expanded ? 'true' : 'false'}
        className="w-full text-left px-3 py-2.5 min-h-[44px] rounded-xl"
      >
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-base font-bold text-chicken-brown tabular-nums">{b.timeSlot || '—'}</span>
          <span className="shrink-0 rounded px-1.5 py-0.5 text-[11px] font-bold text-white" style={{ background: GROUP_HOLD_COLOR.badge }}>團</span>
          <span className="text-sm font-bold text-chicken-brown truncate min-w-0">{g.agencyName || '（未填旅行社）'}</span>
          <span className="ml-auto shrink-0 flex items-center gap-1">
            {overdue && <span className="text-[10px] font-bold text-white bg-chicken-red px-2 py-0.5 rounded-full whitespace-nowrap">{fmtOverdueMin(overdueMin)}</span>}
            {statusChips.map(c => (
              <span key={c.text} className="text-[11px] font-bold text-white px-2 py-0.5 rounded-full whitespace-nowrap" style={{ background: c.bg }}>{c.text}</span>
            ))}
          </span>
        </div>
        <div className="mt-1 flex items-center gap-1.5 min-w-0 text-xs">
          {entry.isEscort ? (
            <span className="shrink-0 font-bold rounded px-1 border" style={{ color: GROUP_HOLD_COLOR.text, borderColor: GROUP_HOLD_COLOR.stroke }}>司領</span>
          ) : (
            <span className="shrink-0 font-bold text-chicken-brown">{b.label}{entry.seqTotal > 1 ? <span className="ml-1 font-normal text-chicken-brown/60">{entry.seq}/{entry.seqTotal} 梯</span> : null}</span>
          )}
          <span className="shrink-0 text-chicken-brown/60">{b.guests} 人{entry.isEscort ? '（不計旅客）' : ''}</span>
          <span className="flex flex-wrap gap-1 min-w-0">
            {tables.length === 0 ? <span className="text-chicken-brown/45">未圈桌</span> : tables.map(n => (
              <span key={n} className="px-1.5 rounded bg-chicken-brown/10 font-bold text-chicken-brown tabular-nums">{n}</span>
            ))}
          </span>
          {since != null && <span className="ml-auto shrink-0 text-[11px] font-bold text-chicken-brown/60">用餐 {since} 分</span>}
          <span aria-hidden="true" className={`${since != null ? '' : 'ml-auto'} shrink-0 text-[10px] text-chicken-brown/50`}>{expanded ? '▲' : '▼'}</span>
        </div>
      </button>

      {expanded && (
        <div className="px-3 pb-3 space-y-2 border-t border-violet-100 pt-2">
          {/* 導遊電話：格式化、可點撥（同 GroupTodayCard） */}
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-xs text-chicken-brown/60">導遊 {g.guideName || '—'}</span>
            <PhoneLink phone={g.guidePhone} className="text-sm" testId="guide-phone" />
          </div>
          <GroupNeedsChips group={g} />
          {b.note && <p className="text-xs text-chicken-brown/70">梯次備註：{b.note}</p>}
          {tables.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {tables.map(n => (
                <button key={n} type="button" onClick={() => onFocusTable?.(n)} title={`在地圖上查看 ${n}`}
                  className="min-w-[44px] min-h-[44px] px-2 rounded-lg bg-white border border-chicken-brown/20 text-sm font-bold text-chicken-brown tabular-nums hover:border-chicken-red">{n}</button>
              ))}
            </div>
          )}
          <div className="flex items-center gap-2 flex-wrap">
            <BatchActionButton batch={b} state={state} actions={actions} sizeClass="px-3 min-h-[44px] text-xs" />
            {perms.group && <button type="button" onClick={onFinalize} className="px-3 min-h-[44px] rounded-lg text-xs font-bold bg-chicken-brown text-white">整團完成</button>}
            {perms.group && g.status === 'planned' && (
              <button type="button" onClick={() => setGroupStatus(g.id, 'confirmed')} className="px-2 min-h-[44px] text-xs text-chicken-brown/60 underline">標記為已確認</button>
            )}
            <button type="button" onClick={() => onOpenSheet?.(g)} title="回傳單" aria-label="回傳單"
              className="ml-auto min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded-lg bg-white border border-chicken-brown/15 text-chicken-brown"><Icon name="print" size={16} /></button>
          </div>
        </div>
      )}
    </div>
  )
}
