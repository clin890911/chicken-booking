import Icon from '../../ui/Icon'
import { conflictLine } from '../../../utils/preassignOverride'
// 現場營運的「模式 banner」：指派 / 候位入座 / 立即帶位 / 換桌 / 團體改派桌位
// 依模式不同底色 + emoji 避免誤判；指派類模式帶二步確認列與預配衝突警告
const BANNER_STYLE = {
  assign:         { bg: 'bg-sky-600',    btn: 'text-sky-700',     icon: 'bookings' },
  'seat-waitlist':{ bg: 'bg-emerald-600',btn: 'text-emerald-700', icon: 'traffic' },
  move:           { bg: 'bg-indigo-600', btn: 'text-indigo-700',  icon: 'move' },
  'group-reseat': { bg: 'bg-violet-600', btn: 'text-violet-700',  icon: 'bus' },
}

const CONFIRMABLE = ['assign', 'seat-waitlist', 'move', 'group-reseat']

// pendingConflicts：待確認桌上他筆的預配 [{ booking, overlaps, willRelease }]（capacity.preassignConflicts），
//   逐筆據實寫「將解除」或「會保留」——只有與新佔用區間重疊的才會被解除。
export default function ModeBanner({ mode, pendingConfirm, pendingConflicts, pendingGroupHold, multiSeats = 0, onCancel, onConfirm, onConfirmMulti, onClearPending }) {
  if (!mode) return null

  // 多桌指派／候位入座（大組併桌）：累加式選桌，不走二步確認；席數夠才能確認。
  // mode.kind 區分兩條路徑——'waitlist' 是客人已在現場、確認即入座（沿用候位模式的綠）；
  // 其餘為訂位指派，是先把桌佔起來、客人到了再入座（沿用指派模式的藍）。
  if (mode.type === 'assign-multi') {
    const isWaitlist = mode.kind === 'waitlist'
    const need = mode.need || 0
    const selected = mode.selected || []
    const enough = multiSeats >= need
    const name = isWaitlist
      ? `${mode.wait?.name || '候位'}${mode.wait?.queueNumber ? ` #${mode.wait.queueNumber}` : ''}`
      : (mode.booking?.name || '訂位')
    const bg = isWaitlist ? 'bg-emerald-600' : 'bg-sky-600'
    const cancelBtn = isWaitlist ? 'text-emerald-700' : 'text-sky-700'
    return (
      <div className={`${bg} text-white px-4 py-2.5 rounded-xl shadow-md space-y-2`}>
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm font-bold flex-1 flex items-center gap-2 flex-wrap">
            <Icon name={isWaitlist ? 'traffic' : 'bookings'} size={18} />
            <span>{isWaitlist ? '候位入座' : '指派桌位'}（併桌）：{name} {need} 位</span>
            <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg font-bold text-sm shadow-sm ${enough ? 'bg-white text-emerald-700' : 'bg-white/95 text-chicken-brown'}`}>
              已選 {multiSeats}/{need} 席 · {selected.length} 桌
            </span>
            <span className="text-xs opacity-90">點桌加 / 減</span>
          </div>
          <button onClick={onCancel} className={`text-xs px-3 py-2 min-h-[44px] bg-white ${cancelBtn} rounded-lg font-bold whitespace-nowrap`}>取消</button>
        </div>
        <div className="bg-white/15 rounded-lg px-3 py-2 flex items-center justify-between gap-2 flex-wrap">
          <div className="text-sm font-bold">
            {selected.length ? `已選：${selected.join(' + ')}` : '尚未選桌（點空桌加入）'}
            {!enough && need > multiSeats && <span className="ml-2 opacity-90">— 還差 {need - multiSeats} 席</span>}
          </div>
          <button
            onClick={onConfirmMulti}
            disabled={!enough}
            className={`text-xs px-4 py-2 min-h-[44px] rounded-lg font-bold whitespace-nowrap shadow-sm ${
              enough ? 'bg-white text-emerald-700' : 'bg-white/40 text-white/70 cursor-not-allowed'}`}
          >✓ {isWaitlist ? '確認併桌入座' : '確認併桌指派'}</button>
        </div>
      </div>
    )
  }

  const style = BANNER_STYLE[mode.type]
  if (!style) return null

  const bannerText = (() => {
    if (mode.type === 'assign') return `指派桌位：${mode.booking.name} ${mode.booking.guests} 位`
    if (mode.type === 'seat-waitlist') return `候位入座：${mode.wait.name} #${mode.wait.queueNumber}（${mode.wait.partySize} 位）`
    if (mode.type === 'move') return `換桌：${mode.booking.name} 從 ${mode.booking.assignedTableId} → 選新桌`
    if (mode.type === 'group-reseat') {
      const remain = (mode.queue || []).length
      return `改派桌位：${mode.group?.agencyName || '團體'} ${mode.batch?.label || ''} — ${mode.current} 被佔，請點選替代桌${remain > 1 ? `（還有 ${remain - 1} 桌待處理）` : ''}`
    }
    return null
  })()

  // 待確認的對象名稱（用於確認列文案）
  const pendingTargetName = mode.type === 'assign' ? mode.booking?.name
    : mode.type === 'seat-waitlist' ? mode.wait?.name
    : mode.type === 'move' ? mode.booking?.name
    : mode.type === 'group-reseat' ? (mode.group?.agencyName || '團體')
    : ''

  // 單桌指派的寫入語意（mode.lockKind，見 capacity.lockKindFor）：'preassign'＝只預配、桌況不鎖。
  // 舊呼叫點沒帶 lockKind → 視為鎖桌（原行為）。
  const assignPreassign = mode.type === 'assign' && mode.lockKind === 'preassign'

  const hasConflict = !!pendingConflicts?.length
  const willRelease = !!pendingConflicts?.some(c => c.willRelease)

  const confirmText = mode.type === 'group-reseat'
    ? `把 ${mode.current} 改派為 ${pendingConfirm} 並整梯入座？（將更新該梯圈桌）`
    : mode.type === 'move'
      ? `確認把 ${pendingTargetName} 從 ${mode.booking?.assignedTableId} 改到桌 ${pendingConfirm}？`
      : mode.type === 'assign'
        ? (assignPreassign
          ? `確認預配 ${pendingTargetName} 到 ${pendingConfirm}？（桌子現在仍可帶位）`
          : `確認指派 ${pendingTargetName} 至桌 ${pendingConfirm} 並鎖桌？`)
        : `確認指派 ${pendingTargetName} 至桌 ${pendingConfirm}？`

  return (
    <div className={`${style.bg} text-white px-4 py-2.5 rounded-xl shadow-md space-y-2`}>
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-bold flex-1 flex items-center gap-2 flex-wrap">
          <Icon name={style.icon} size={18} />
          <span>{bannerText}</span>
          {/* 單桌指派：講清楚這次是「鎖桌」還是「預配」（離用餐 30 分內才鎖） */}
          {mode.type === 'assign' && (
            <span className="inline-flex items-center bg-white/20 px-2 py-0.5 rounded-lg text-xs font-bold">
              {assignPreassign ? `${mode.booking?.timeSlot || ''} 預配 · 桌子先不鎖`.trim() : '指派即鎖桌'}
            </span>
          )}
          {/* C5：建議桌以底色塊 + 💡 突出 */}
          {CONFIRMABLE.includes(mode.type) && (
            mode.suggestion ? (
              <span className="inline-flex items-center gap-1 bg-white/95 text-chicken-brown px-2.5 py-1 rounded-lg font-bold text-sm shadow-sm">
                建議 {mode.suggestion}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 bg-white/20 px-2 py-0.5 rounded-lg text-xs font-bold">
                無建議桌
              </span>
            )
          )}
        </div>
        <button onClick={onCancel} className={`text-xs px-3 py-2 min-h-[44px] bg-white ${style.btn} rounded-lg font-bold whitespace-nowrap`}>取消</button>
      </div>

      {/* A6：二步確認 — 待確認列 */}
      {pendingConfirm && CONFIRMABLE.includes(mode.type) && (
        <div className="bg-white/15 rounded-lg px-3 py-2 space-y-2">
          {/* 防呆：此桌已被別筆 booking 預先配走 → 紅底示警（逐筆寫明預配將解除或會保留） */}
          {pendingConflicts?.length > 0 && (
            <div className="bg-rose-600 text-white rounded-lg px-3 py-2 text-xs font-bold flex items-start gap-1.5">
              <Icon name="warning" size={16} className="shrink-0 mt-px" />
              <span className="space-y-0.5">
                {pendingConflicts.map(c => (
                  <span key={c.booking.id} className="block">{conflictLine(pendingConfirm, c, '確認')}</span>
                ))}
              </span>
            </div>
          )}
          {/* 防呆：此桌為今日團體圈桌未入座 → 紅底示警（桌況雖空，散客坐下去團體就沒桌了） */}
          {pendingGroupHold && (
            <div className="bg-rose-600 text-white rounded-lg px-3 py-2 text-xs font-bold flex items-start gap-1.5">
              <Icon name="bus" size={16} className="shrink-0 mt-px" />
              <span>
                此桌為今日團體 <span className="underline">{pendingGroupHold.agencyName || '旅行社'}</span> 預留
                {pendingGroupHold.holds?.[0]?.batch ? (
                  `（${pendingGroupHold.holds[0].batch.label} ${pendingGroupHold.holds[0].batch.timeSlot}）`
                ) : ''}。確認後散客將佔用團體桌。
              </span>
            </div>
          )}
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="text-sm font-bold">
              {confirmText}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={onClearPending}
                className={`text-xs px-3 py-2 min-h-[44px] bg-white/90 ${style.btn} rounded-lg font-bold whitespace-nowrap`}
              >取消</button>
              <button
                onClick={onConfirm}
                className={`text-xs px-4 py-2 min-h-[44px] rounded-lg font-bold whitespace-nowrap shadow-sm ${
                  (hasConflict || pendingGroupHold) ? 'bg-rose-600 text-white' : 'bg-white text-emerald-700'}`}
              >{(willRelease || pendingGroupHold) ? (assignPreassign ? '仍要覆蓋預配' : '仍要覆蓋指派')
                : hasConflict ? (assignPreassign ? '仍要預配（他筆預配保留）' : '仍要指派（預配保留）')
                : mode.type === 'group-reseat' ? '✓ 確認改派' : mode.type === 'move' ? '✓ 確認改桌'
                : assignPreassign ? '✓ 確認預配' : '✓ 確認指派'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
