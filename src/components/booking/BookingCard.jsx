import { memo, useState } from 'react'
import { Badge } from '../ui'
import EditBookingModal from './EditBookingModal'
import BookingDetailSheet from './BookingDetailSheet'
import { useToast } from '../ui/Toast'
import { useBookingActions } from './useBookingActions'
import { STATUS_MAP, SOURCE_MAP, fmtTime } from './bookingLabels'
import { copyText } from '../../utils/clipboard'
import { assignmentKind } from '../../utils/tableStatus'
import { PREASSIGN_COLOR } from '../admin/floormap/statusColors'

// 顯示字典與純函式動作已抽到 ./bookingLabels 與 utils/bookingActions；
// 這裡 re-export 讓既有 import（CustomerDetailModal / TableDrawer / 測試）不必改。
export { STATUS_MAP, SOURCE_MAP } from './bookingLabels'
export { markNoshow, restoreFromNoshow, cancelWithUndo } from '../../utils/bookingActions'

// 訂位卡：主資訊區可點 → 開「訂位詳情」bottom sheet（電話/備註/來源/顧客歷史/全部動作）。
// 動作按鈕仍留在卡上（外場最常按的那幾顆不必多點一層）；顯示條件與詳情表共用 useBookingActions。
// React.memo：清單搜尋框每打一個字整張清單都會重繪，卡片 props（booking 物件參考 / onAssign）
// 沒變就跳過——BookingContext 已保證資料沒變時沿用同一個物件。
function BookingCard({ booking, onAssign, onMove }) {
  const toast = useToast()
  const act = useBookingActions(booking, { onAssign, onMove })
  const { dayKind, minutes, stage, noshowCount, suggestion, show } = act
  // 桌號徽章分辨兩種「有桌」（口徑同現場頁 UpcomingPanel／桌況圖，見 utils/tableStatus.assignmentKind）：
  // held＝現場指派已鎖桌（綠「桌 105」）；preassign＝只記在訂位上、桌況仍空（藍「預配 105」，別人坐得進去）。
  // 過去一律綠色，店員看不出 11:00 余先生的 105 其實沒鎖，11:30 陳小姐就被建議同一張桌。
  const tableKind = booking.status === 'arrived' ? 'dining' : assignmentKind(booking, act.table)

  const status = STATUS_MAP[booking.status] || STATUS_MAP.pending

  // B12：手機上低頻操作收進「⋯ 更多」展開選單
  const [showMore, setShowMore] = useState(false)
  const [editing, setEditing] = useState(false)
  const [detail, setDetail] = useState(false)

  // === 卡片邊框依時長階段變色（僅 arrived 狀態）===
  const cardBorder = booking.status === 'arrived'
    ? stage === 'buffer-overtime' ? 'border-chicken-red border-2 ring-2 ring-chicken-red/30'
    : stage === 'overtime' ? 'border-chicken-red border-2 ring-2 ring-chicken-red/20'
    : stage === 'late' ? 'border-chicken-yellow border-2'
    : 'border-orange-200 border-2'
    : booking.status === 'noshow' ? 'border-chicken-red/40 border'
    : 'border-chicken-brown/10 border'

  // === B11：超時卡片背景 tint（僅 arrived 狀態，依 stage）===
  const cardBg = booking.status === 'arrived'
    ? stage === 'buffer-overtime' ? 'bg-chicken-red/10'
    : stage === 'overtime' ? 'bg-orange-500/10'
    : 'bg-white'
    : 'bg-white'

  return (
    <div className={`rounded-xl shadow-sm transition-shadow p-3.5 ${cardBg} ${cardBorder}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          {/* 主資訊 + 副資訊 + 標籤：整塊可點 → 訂位詳情 */}
          <button type="button" onClick={() => setDetail(true)} title="點擊看完整詳情"
            className="tap block w-full text-left rounded-lg -m-1 p-1">
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className="text-lg font-bold text-chicken-brown tabular-nums">{booking.timeSlot}</span>
              <span className="text-base font-bold text-chicken-brown">{booking.name}</span>
              <span className="text-sm text-chicken-brown/60">{booking.guests} 位</span>
              {booking.assignedTableId && (
                tableKind === 'preassign' ? (
                  <span data-kind="preassign"
                    title="只記在訂位上、桌況還沒鎖：別人仍坐得進去（桌況圖上是藍色虛線）"
                    className="text-xs font-bold px-2.5 py-0.5 rounded-full text-white border border-dashed border-white/70"
                    style={{ background: PREASSIGN_COLOR.badge }}>
                    預配 {booking.assignedTableId}
                  </span>
                ) : (
                  <span data-kind={tableKind}
                    className={`text-xs font-bold px-2.5 py-0.5 rounded-full
                    ${booking.status === 'arrived'
                      ? 'bg-orange-600 text-white'
                      : 'bg-emerald-600 text-white'}`}>
                    桌 {booking.assignedTableId}
                  </span>
                )
              )}
              {booking.status === 'arrived' && (
                <span className={`text-xs font-bold px-2 py-0.5 rounded-full tabular-nums
                  ${stage === 'buffer-overtime'
                    ? 'bg-chicken-red text-white animate-pulse'
                    : stage === 'overtime'
                    ? 'bg-chicken-red/90 text-white'
                    : stage === 'late'
                    ? 'bg-chicken-yellow text-white'
                    : 'bg-chicken-brown/10 text-chicken-brown'}`}>
                  {minutes} 分{stage === 'buffer-overtime' ? ' · 超緩衝' : stage === 'overtime' ? ' · 時間到' : stage === 'late' ? ' · 即將結束' : ''}
                </span>
              )}
            </div>

            {/* 副資訊 — B16：依優先級分層（警示紅 → 操作線索綠/黃 → 基礎灰）*/}
            <div className="text-xs text-chicken-brown/70 mt-1 flex items-center gap-2 flex-wrap">
              {/* 1. 警示（紅）優先 */}
              {noshowCount > 0 && (
                <span className="text-chicken-red font-bold">no-show ×{noshowCount}</span>
              )}
              {booking.cancellationReason?.reason && (
                <span className="rounded-full bg-chicken-red/10 px-2 py-0.5 font-bold text-chicken-red">
                  取消原因：{booking.cancellationReason.reason}
                </span>
              )}
              {/* LINE 綁定/送達狀態：被拒（封鎖/非好友）紅、已綁定綠（附最近通知結果）*/}
              {booking.linePushBlocked || booking.lineLastNotify?.status === 'failed' ? (
                <span className="rounded-full bg-chicken-red/10 px-2 py-0.5 font-bold text-chicken-red" title="LINE 推播被拒或重試用盡，客人需重新加入官方帳號好友">
                  LINE 無法送達
                </span>
              ) : booking.lineUserId ? (
                <span className="rounded-full bg-[#06C755]/10 px-2 py-0.5 font-bold text-[#06A848]" title={booking.lineDisplayName ? `LINE：${booking.lineDisplayName}` : 'LINE 已綁定'}>
                  LINE ✓{booking.lineLastNotify?.status === 'sent'
                    ? ` 已送達 ${fmtTime(booking.lineLastNotify.at)}`
                    : booking.lineLastNotify?.status === 'pending'
                    ? ' 通知重試中'
                    : ''}
                </span>
              ) : null}
              {/* 2. 操作線索（綠/黃）居中 */}
              {suggestion && (
                <span className="rounded-full border border-chicken-green/40 bg-chicken-green/10 px-2 py-0.5 font-bold text-chicken-green">
                  建議桌 {suggestion.number}
                </span>
              )}
              {booking.lastGuestEditAt && (
                <span className="rounded-full bg-[#06C755]/10 px-2 py-0.5 font-bold text-[#06A848]">
                  客人自行修改 {fmtTime(booking.lastGuestEditAt)}
                </span>
              )}
              {/* 3. 基礎資訊（灰）在後 */}
              <span>{booking.phone || '—'}</span>
              {SOURCE_MAP[booking.source] && (
                <span className="text-chicken-brown/50">{SOURCE_MAP[booking.source]}</span>
              )}
              {booking.actualArrivalTime && (
                <span className="text-chicken-brown/50">到 {fmtTime(booking.actualArrivalTime)}</span>
              )}
            </div>

            {booking.lastGuestEditAt && !booking.assignedTableId && booking.status === 'confirmed' && (
              <div className="mt-2 rounded-lg border border-chicken-yellow/30 bg-chicken-yellow/10 px-3 py-2 text-xs font-bold text-chicken-brown">
                客人曾修改日期/時間/人數，原桌位已解除，請重新確認桌位指派。
              </div>
            )}

            {/* 標籤 + 備註 */}
            {(booking.notes?.pet || booking.notes?.child || booking.notes?.mobility || booking.notes?.text) && (
              <div className="mt-1.5 flex items-center gap-1 flex-wrap">
                {booking.notes?.pet && <Badge color="yellow">寵物</Badge>}
                {booking.notes?.child && <Badge color="green">兒童</Badge>}
                {booking.notes?.mobility && <Badge color="brown">行動不便</Badge>}
                {booking.notes?.text && (
                  <span className="text-[11px] text-chicken-brown/60 italic truncate max-w-[200px]">
                    「{booking.notes.text}」
                  </span>
                )}
              </div>
            )}
          </button>

          {/* 動作按鈕（依狀態 × 日期三態顯示；條件由 useBookingActions.show 統一）：
              future = 預配/取消（報到類操作當天才開放）；past = 補登（離席/No-show/取消） */}
          <div className="mt-3 flex gap-2 flex-wrap items-center">
            {show.assign && (
              <button
                onClick={(e) => { e.stopPropagation(); act.assign() }}
                className="tap text-sm px-3.5 min-h-[44px] bg-chicken-red text-white rounded-lg font-bold hover:opacity-90"
              >{dayKind === 'future' ? '指派桌位（預配）' : '指派桌位'}</button>
            )}
            {show.seat && (
              <button
                onClick={(e) => { e.stopPropagation(); act.seat() }}
                className="tap text-sm px-3.5 min-h-[44px] bg-chicken-green text-white rounded-lg font-bold hover:opacity-90"
              >客人到了</button>
            )}
            {/* 改桌：今日待到且已有桌 → 現場頁 move 模式（地圖選桌＋二步確認＋預配/團保警示）。
                併桌訂位呈停用樣式（move 只換主桌，會留下孤兒額外桌）；iPad 沒有 hover 看不到 title，
                所以仍可點，點了用 toast 說明原因（act.move 內處理），不做任何變更。 */}
            {show.move && (
              <button
                onClick={(e) => { e.stopPropagation(); act.move() }}
                aria-disabled={act.moveDisabledReason ? 'true' : undefined}
                title={act.moveDisabledReason || `把 ${booking.name} 從 ${booking.assignedTableId} 改到別桌`}
                className={`tap text-sm px-3.5 min-h-[44px] rounded-lg font-bold border ${act.moveDisabledReason
                  ? 'bg-chicken-brown/5 border-chicken-brown/15 text-chicken-brown/40'
                  : 'bg-white border-indigo-300 text-indigo-700 hover:bg-indigo-50'}`}
              >↔ 改桌</button>
            )}
            {show.futureAssignedNote && (
              <span className="text-xs font-bold text-chicken-brown/50 py-2">未來訂位 · 當天才可報到</span>
            )}
            {/* A5：主操作「客人已離席」顯眼、次操作「直接釋出」降權較小，避免誤點 */}
            {show.checkout && (
              <>
                <button
                  onClick={(e) => { e.stopPropagation(); act.checkout() }}
                  className="tap text-sm px-4 min-h-[44px] bg-orange-500 text-white rounded-lg font-bold hover:opacity-90"
                >客人已離席</button>
                <button
                  onClick={(e) => { e.stopPropagation(); act.finalize() }}
                  className="tap text-xs px-3 min-h-[44px] bg-white border border-chicken-green/40 text-chicken-green rounded-lg font-bold hover:bg-chicken-green/5"
                >直接釋出（已清桌）</button>
              </>
            )}
            {/* B12：低頻操作（標No-show/取消訂位）手機收進「⋯ 更多」，桌面(sm:)直接全列；
                標 No-show 只在今天/過去日（未來不可能 no-show） */}
            {show.edit && (
              <>
                <button
                  onClick={(e) => { e.stopPropagation(); setEditing(true) }}
                  className="tap inline-flex items-center text-sm px-3 min-h-[44px] bg-white border border-chicken-brown/20 text-chicken-brown rounded-lg font-bold hover:border-chicken-brown/40"
                >編輯</button>
                <button
                  onClick={(e) => { e.stopPropagation(); setShowMore(s => !s) }}
                  className="tap sm:hidden text-sm px-3 min-h-[44px] bg-white border border-chicken-brown/15 text-chicken-brown/70 rounded-lg font-bold hover:border-chicken-brown/30"
                  aria-expanded={showMore}
                >⋯ 更多</button>
                {show.noshow && (
                  <button
                    onClick={(e) => { e.stopPropagation(); act.noshow() }}
                    className={`${showMore ? 'flex' : 'hidden'} tap sm:inline-flex items-center text-sm px-3 min-h-[44px] bg-white border border-chicken-red/40 text-chicken-red rounded-lg font-bold hover:bg-chicken-red/5`}
                  >標 No-show</button>
                )}
                {show.cancel && (
                  <button
                    onClick={(e) => { e.stopPropagation(); act.cancel() }}
                    className={`${showMore ? 'flex' : 'hidden'} tap sm:inline-flex items-center text-sm px-3 min-h-[44px] bg-white border border-chicken-red/40 text-chicken-red rounded-lg font-bold hover:bg-chicken-red/5`}
                  >✕ 取消訂位</button>
                )}
              </>
            )}
            {show.restore && (
              <button
                onClick={(e) => { e.stopPropagation(); act.restore() }}
                className="tap text-sm px-3 min-h-[44px] bg-white border border-chicken-brown/15 text-chicken-brown rounded-lg font-bold hover:border-chicken-green hover:text-chicken-green"
              >↩ 恢復為待到</button>
            )}
            {show.pastNote && (
              <span className="text-[11px] font-bold text-chicken-brown/45">過去日期 · 僅可補登</span>
            )}
          </div>
        </div>

        {/* 右側狀態 pill（純顯示，不可點）+ 訂位編號（點擊複製，方便店員核對報號）+ 詳情入口提示 */}
        <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
          <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full whitespace-nowrap ${status.color}`}>
            {status.label}
          </span>
          {booking.id && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                copyText(booking.id).then(ok => { if (ok) toast.success(`已複製編號 ${booking.id}`) })
              }}
              className="font-mono text-[10px] text-chicken-brown/40 hover:text-chicken-red tabular-nums"
              title="點擊複製訂位編號"
            >
              #{booking.id}
            </button>
          )}
          <button type="button" onClick={() => setDetail(true)}
            className="tap text-[11px] font-bold text-chicken-brown/45 hover:text-chicken-red whitespace-nowrap">
            詳情 ›
          </button>
        </div>
      </div>

      {editing && <EditBookingModal booking={booking} onClose={() => setEditing(false)} />}
      {detail && (
        <BookingDetailSheet bookingId={booking.id} onClose={() => setDetail(false)} onAssign={onAssign} onMove={onMove} />
      )}
    </div>
  )
}

export default memo(BookingCard)
