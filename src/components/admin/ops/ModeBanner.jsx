// 現場營運的「模式 banner」：指派 / 候位入座 / 立即帶位 / 換桌 / 團體改派桌位
// 依模式不同底色 + emoji 避免誤判；指派類模式帶二步確認列與預配衝突警告
const BANNER_STYLE = {
  assign:         { bg: 'bg-sky-600',    btn: 'text-sky-700',     emoji: '📋' },
  'seat-waitlist':{ bg: 'bg-emerald-600',btn: 'text-emerald-700', emoji: '🚦' },
  walkin:         { bg: 'bg-amber-600',  btn: 'text-amber-700',   emoji: '🪑' },
  move:           { bg: 'bg-indigo-600', btn: 'text-indigo-700',  emoji: '↔' },
  'group-reseat': { bg: 'bg-violet-600', btn: 'text-violet-700',  emoji: '🚌' },
}

const CONFIRMABLE = ['assign', 'seat-waitlist', 'walkin', 'move', 'group-reseat']

export default function ModeBanner({ mode, pendingConfirm, pendingConflict, pendingGroupHold, multiSeats = 0, onCancel, onConfirm, onConfirmMulti, onClearPending }) {
  if (!mode) return null

  // 多桌帶位／指派（大組併桌）：累加式選桌，不走二步確認；席數夠才能確認
  if (mode.type === 'walkin-multi' || mode.type === 'assign-multi') {
    const isAssign = mode.type === 'assign-multi'
    const need = mode.need || 0
    const selected = mode.selected || []
    const enough = multiSeats >= need
    const name = isAssign ? (mode.booking?.name || '訂位') : (mode.guestData?.name || '散客')
    const bg = isAssign ? 'bg-sky-600' : 'bg-amber-600'
    const cancelBtn = isAssign ? 'text-sky-700' : 'text-amber-700'
    return (
      <div className={`${bg} text-white px-4 py-2.5 rounded-xl shadow-md space-y-2`}>
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm font-bold flex-1 flex items-center gap-2 flex-wrap">
            <span className="text-base leading-none">{isAssign ? '📋' : '🪑'}</span>
            <span>{isAssign ? '指派桌位' : '立即帶位'}（併桌）：{name} {need} 位</span>
            <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg font-black text-sm shadow-sm ${enough ? 'bg-white text-emerald-700' : 'bg-white/95 text-chicken-brown'}`}>
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
            className={`text-xs px-4 py-2 min-h-[44px] rounded-lg font-black whitespace-nowrap shadow-sm ${
              enough ? 'bg-white text-emerald-700' : 'bg-white/40 text-white/70 cursor-not-allowed'}`}
          >✓ {isAssign ? '確認併桌指派' : '確認併桌入座'}</button>
        </div>
      </div>
    )
  }

  const style = BANNER_STYLE[mode.type]
  if (!style) return null

  const bannerText = (() => {
    if (mode.type === 'assign') return `指派桌位：${mode.booking.name} ${mode.booking.guests} 位`
    if (mode.type === 'seat-waitlist') return `候位入座：${mode.wait.name} #${mode.wait.queueNumber}（${mode.wait.partySize} 位）`
    if (mode.type === 'walkin') return `立即帶位：${mode.guestData?.name || '散客'} ${mode.guestData?.guests || 0} 位 — 請點選空桌`
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
    : mode.type === 'walkin' ? (mode.guestData?.name || '散客')
    : mode.type === 'move' ? mode.booking?.name
    : mode.type === 'group-reseat' ? (mode.group?.agencyName || '團體')
    : ''

  const confirmText = mode.type === 'group-reseat'
    ? `把 ${mode.current} 改派為 ${pendingConfirm} 並整梯入座？（將更新該梯圈桌）`
    : mode.type === 'walkin'
      ? `確認帶 ${pendingTargetName} 入座桌 ${pendingConfirm}？`
      : `確認指派 ${pendingTargetName} 至桌 ${pendingConfirm}？`

  return (
    <div className={`${style.bg} text-white px-4 py-2.5 rounded-xl shadow-md space-y-2`}>
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-bold flex-1 flex items-center gap-2 flex-wrap">
          <span className="text-base leading-none">{style.emoji}</span>
          <span>{bannerText}</span>
          {/* C5：建議桌以底色塊 + 💡 突出 */}
          {CONFIRMABLE.includes(mode.type) && (
            mode.suggestion ? (
              <span className="inline-flex items-center gap-1 bg-white/95 text-chicken-brown px-2.5 py-1 rounded-lg font-black text-sm shadow-sm">
                💡 建議 {mode.suggestion}
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
          {/* 防呆：此桌已被別筆 booking 預先配走 → 紅底示警，確認鈕改為「仍要覆蓋」 */}
          {pendingConflict && (
            <div className="bg-rose-600 text-white rounded-lg px-3 py-2 text-xs font-bold flex items-start gap-1.5">
              <span className="text-sm leading-none">⚠️</span>
              <span>
                此桌已於排位規劃預留給 <span className="underline">{pendingConflict.name}</span>
                （{pendingConflict.guests} 位{pendingConflict.timeSlot ? ` · ${pendingConflict.timeSlot}` : ''}）。
                確認後將覆蓋其預配，{pendingConflict.name} 將變回未配桌。
              </span>
            </div>
          )}
          {/* 防呆：此桌為今日團體圈桌未入座 → 紅底示警（桌況雖空，散客坐下去團體就沒桌了） */}
          {pendingGroupHold && (
            <div className="bg-rose-600 text-white rounded-lg px-3 py-2 text-xs font-bold flex items-start gap-1.5">
              <span className="text-sm leading-none">🚌</span>
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
                className={`text-xs px-4 py-2 min-h-[44px] rounded-lg font-black whitespace-nowrap shadow-sm ${
                  (pendingConflict || pendingGroupHold) ? 'bg-rose-600 text-white' : 'bg-white text-emerald-700'}`}
              >{(pendingConflict || pendingGroupHold) ? '⚠️ 仍要覆蓋指派' : mode.type === 'group-reseat' ? '✓ 確認改派' : mode.type === 'walkin' ? '✓ 確認帶位' : '✓ 確認指派'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
