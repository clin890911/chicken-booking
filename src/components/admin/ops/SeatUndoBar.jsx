import { useLayoutEffect, useRef, useState } from 'react'
import { Undo2 } from 'lucide-react'
import { useSeatUndo } from '../../ui/seatUndoContext'

// 現場頁「復原欄」（2026-11-27 驗收 P1 第三輪）：入座類動作的「復原」只出現在這裡——
// 版面內固定保留的位置（in-flow），一直佔著同樣的高度（44px）：
//   有可復原的最近一筆 → 「↩ 復原：王先生 3 位 → 101」按鈕（讀屏名沿用「復原帶位 101／復原入座 林先生」）
//   時效已過 → 淡色「最近：王先生 3 位 → 101」（不可按）；從沒入座過 → 淡色「最近動作」
// 出現與消失都不改版面（外框尺寸固定、文字 truncate），浮動提示（toast）只告知、不可互動。
// 同時只保留最近一筆：新的入座取代舊的，舊的就不能再復原（刻意的取捨，見 Toast.jsx 的 seatUndo）。
//
// toolbar（2026-11-27 C 包，verify P2-1）：放在地圖工具列裡時，和「放大視圖／轉向」至少隔 16px、分成兩組：
//   同一行（iPad 橫向）→ 左側細分隔線＋8px 內距（間距＝工具列 gap 8＋線 1＋內距 8＝17px）
//   換到第二行（iPad 直向）→ 整欄 relative 下移 8px（行距 8＋8＝16px）
// 兩種都不改版面：內距在 min-w 之內（border-box）不影響換行判定，relative 位移不佔空間——工具列高度與地圖位置不變。
// 手機條件不下移（下方緊接桌況圖，下移會貼到最上排的桌）。是否換行用量的（ResizeObserver），不靠斷點猜。
export default function SeatUndoBar({ className = '', toolbar = false }) {
  const ctx = useSeatUndo()
  const e = ctx?.entry
  const live = !!e?.live
  const ref = useRef(null)
  const [wrapped, setWrapped] = useState(false)
  useLayoutEffect(() => {
    if (!toolbar) return undefined
    const el = ref.current
    const parent = el?.parentElement
    if (!el || !parent) return undefined
    const check = () => {
      const first = parent.firstElementChild
      setWrapped(!!first && first !== el && el.offsetTop > first.offsetTop + first.offsetHeight / 2)
    }
    check()
    if (typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver(check)
    ro.observe(parent)
    return () => ro.disconnect()
  }, [toolbar])
  const group = !toolbar ? '' : wrapped ? 'relative top-2 phone:top-0' : 'pl-2 border-l border-chicken-brown/15'
  return (
    <div ref={ref} data-testid="seat-undo-bar" data-state={live ? 'live' : e ? 'recent' : 'empty'} data-wrapped={toolbar ? String(wrapped) : undefined}
      className={`h-11 min-w-0 flex items-center ${group} ${className}`}>
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
