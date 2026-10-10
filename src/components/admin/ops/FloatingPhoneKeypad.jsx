import { useState, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import NumericKeypad from './NumericKeypad'

const KEYPAD_WIDTH = 392
const KEYPAD_GAP = 12
const KEYPAD_MIN_WIDTH = 300

// 電話欄的漂浮數字鍵盤（現場帶位面板、候位取號共用）。
// 電話欄本身用 inputMode="none"：不叫出 iPad 系統鍵盤（系統鍵盤一跳，會把左欄推走、或蓋住「取號」鈕）。
//
// 定位：錨在電話欄（anchorRef）右側、底部貼齊 boundsRef（帶位欄／取號表單）的底。
// 用 portal + position:fixed 到 body，刻意**不靠**祖先當定位脈絡——現場頁是
// h-[100dvh] 串接的一面式版面，在祖先加 transform/relative 會把高度鏈打斷。
// 遮罩刻意只用 bg-black/20：桌況圖必須全程看得見（領檯是「一邊看桌一邊問電話」）。
// 注意：React 事件會沿元件樹（不是 DOM 樹）冒泡——放在 Modal 內使用時，點鍵盤／遮罩
// 會冒泡到 Modal 面板的 stopPropagation，不會誤關 Modal。
//
// status：號碼下方的一行說明（常客比對結果等）；不給就不顯示。
export default function FloatingPhoneKeypad({ open, onClose, value, onChange, anchorRef, boundsRef, status = null }) {
  const [pos, setPos] = useState(null)

  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const f = anchorRef?.current?.getBoundingClientRect()
      const r = (boundsRef?.current || anchorRef?.current)?.getBoundingClientRect()
      if (!f || !r) return
      // 欄位右側放得下（≥ MIN）就整個擺在右側、不壓到欄位（取號 Modal 右側較窄 → 鍵盤略縮）；
      // 放不下（直向窄螢幕）才退回「貼右緣、可能蓋到一點欄位」。
      const roomRight = window.innerWidth - f.right - KEYPAD_GAP * 2
      const width = roomRight >= KEYPAD_MIN_WIDTH
        ? Math.min(KEYPAD_WIDTH, roomRight)
        : Math.min(KEYPAD_WIDTH, window.innerWidth - KEYPAD_GAP * 2)
      const left = Math.max(KEYPAD_GAP, Math.min(f.right + KEYPAD_GAP, window.innerWidth - width - KEYPAD_GAP))
      const bottom = Math.max(KEYPAD_GAP, window.innerHeight - r.bottom)
      setPos({ left, bottom, width })
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [open, anchorRef, boundsRef])

  if (!open || typeof document === 'undefined') return null
  return createPortal(
    <>
      <div
        className="fixed inset-0 z-[70] bg-black/20"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-label="電話數字鍵盤"
        className="fixed z-[71] rounded-xl bg-[#2b2320] p-3 shadow-2xl"
        style={pos
          ? { left: pos.left, bottom: pos.bottom, width: pos.width }
          : { left: KEYPAD_GAP, bottom: KEYPAD_GAP, width: KEYPAD_WIDTH, visibility: 'hidden' }}
      >
        <div className="flex items-start gap-2.5 px-1.5 pb-3 pt-1">
          <div className="min-w-0">
            <div className="text-3xl font-bold tracking-widest tabular-nums text-white">
              {value || <span className="text-white/30">輸入電話</span>}
            </div>
            {status && <div className="mt-1 text-[11px] font-bold text-white/60">{status}</div>}
          </div>
          <button
            type="button"
            aria-label="收起鍵盤"
            onClick={onClose}
            className="ml-auto flex-none h-8 w-8 rounded-full bg-white/15 text-sm font-bold text-white"
          >
            ✕
          </button>
        </div>
        <NumericKeypad value={value} onChange={onChange} tone="dark" onDone={onClose} />
      </div>
    </>,
    document.body,
  )
}
