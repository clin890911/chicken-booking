import { Undo2 } from 'lucide-react'
import { useSeatUndo } from '../../ui/seatUndoContext'

// 現場頁「復原欄」（2026-11-27 驗收 P1 第三輪）：入座類動作的「復原」只出現在這裡——
// 版面內固定保留的位置（in-flow），一直佔著同樣的高度（44px）：
//   有可復原的最近一筆 → 「↩ 復原：王先生 3 位 → 101」按鈕（讀屏名沿用「復原帶位 101／復原入座 林先生」）
//   時效已過 → 淡色「最近：王先生 3 位 → 101」（不可按）；從沒入座過 → 淡色「最近動作」
// 出現與消失都不改版面（外框尺寸固定、文字 truncate），浮動提示（toast）只告知、不可互動。
// 同時只保留最近一筆：新的入座取代舊的，舊的就不能再復原（刻意的取捨，見 Toast.jsx 的 seatUndo）。
export default function SeatUndoBar({ className = '' }) {
  const ctx = useSeatUndo()
  const e = ctx?.entry
  const live = !!e?.live
  return (
    <div data-testid="seat-undo-bar" data-state={live ? 'live' : e ? 'recent' : 'empty'}
      className={`h-11 min-w-0 flex items-center ${className}`}>
      {live ? (
        <button type="button" onClick={ctx.run} aria-label={e.ariaLabel} data-testid="seat-undo-action" title={`復原：${e.text}`}
          className="tap h-11 w-full min-w-0 inline-flex items-center gap-1.5 px-3 rounded-lg border-2 border-chicken-brown bg-white text-chicken-brown text-sm font-bold hover:bg-chicken-brown/[0.05]">
          <Undo2 size={16} strokeWidth={2.4} aria-hidden="true" className="flex-shrink-0" />
          <span className="truncate">復原：{e.text}</span>
        </button>
      ) : (
        <span className="w-full truncate px-2 text-xs font-bold text-chicken-brown/40">{e ? `最近：${e.text}` : '最近動作'}</span>
      )}
    </div>
  )
}
