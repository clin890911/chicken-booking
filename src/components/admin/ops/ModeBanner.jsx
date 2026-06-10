// 現場營運的「模式 banner」：併桌 / 指派 / 候位入座 / 換桌
// 依模式不同底色 + emoji 避免誤判；指派類模式帶二步確認列與預配衝突警告
const BANNER_STYLE = {
  merge:          { bg: 'bg-amber-500',  btn: 'text-amber-700',   emoji: '⇆' },
  assign:         { bg: 'bg-sky-600',    btn: 'text-sky-700',     emoji: '📋' },
  'seat-waitlist':{ bg: 'bg-emerald-600',btn: 'text-emerald-700', emoji: '🚦' },
  move:           { bg: 'bg-indigo-600', btn: 'text-indigo-700',  emoji: '↔' },
}

const CONFIRMABLE = ['assign', 'seat-waitlist', 'move']

export default function ModeBanner({ mode, pendingConfirm, pendingConflict, onCancel, onConfirm, onClearPending }) {
  if (!mode) return null
  const style = BANNER_STYLE[mode.type]
  if (!style) return null

  const bannerText = (() => {
    if (mode.type === 'merge') return mode.first
      ? `併桌模式：已選 ${mode.first}，請點選另一張相鄰桌`
      : '併桌模式：請點選第一張桌'
    if (mode.type === 'assign') return `指派桌位：${mode.booking.name} ${mode.booking.guests} 位`
    if (mode.type === 'seat-waitlist') return `候位入座：${mode.wait.name} #${mode.wait.queueNumber}（${mode.wait.partySize} 位）`
    if (mode.type === 'move') return `換桌：${mode.booking.name} 從 ${mode.booking.assignedTableId} → 選新桌`
    return null
  })()

  // 待確認的對象名稱（用於確認列文案）
  const pendingTargetName = mode.type === 'assign' ? mode.booking?.name
    : mode.type === 'seat-waitlist' ? mode.wait?.name
    : mode.type === 'move' ? mode.booking?.name
    : ''

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
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="text-sm font-bold">
              確認指派 {pendingTargetName} 至桌 {pendingConfirm}？
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={onClearPending}
                className={`text-xs px-3 py-2 min-h-[44px] bg-white/90 ${style.btn} rounded-lg font-bold whitespace-nowrap`}
              >取消</button>
              <button
                onClick={onConfirm}
                className={`text-xs px-4 py-2 min-h-[44px] rounded-lg font-black whitespace-nowrap shadow-sm ${
                  pendingConflict ? 'bg-rose-600 text-white' : 'bg-white text-emerald-700'}`}
              >{pendingConflict ? '⚠️ 仍要覆蓋指派' : '✓ 確認指派'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
