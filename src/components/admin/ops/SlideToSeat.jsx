import { useEffect, useRef, useState } from 'react'

// 滑動帶位：取代二次確認的手勢元件。領檯用手指把 knob 拖到 ≥60% 行程放手才觸發 onConfirm，
// 比「點擊→彈窗確認→再點擊」防誤觸（誤觸一下不會整桌帶位），也省一次點擊。
// 全程用原生 Pointer Events（不吃外部套件），knob 用 setPointerCapture（若瀏覽器支援）鎖定手指軌跡。
const KNOB_WIDTH = 74 // px，需與下方 style 對應
const CONFIRM_RATIO = 0.6 // 拖滿行程 60% 放手才算數

export default function SlideToSeat({ onConfirm, disabled = false, label = '滑動帶位 →', disabledLabel }) {
  const trackRef = useRef(null)
  const firedRef = useRef(false) // 已成功觸發過 onConfirm，鎖住直到 props 變更/重新掛載
  const draggingRef = useRef(false)
  const startClientXRef = useRef(0)
  const startDragXRef = useRef(0)
  const maxTravelRef = useRef(0)

  const [dragX, setDragX] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [locked, setLocked] = useState(false)

  // props 變更（換一張桌/換一顆按鈕的語意）視同重新掛載：解鎖、歸位。
  // ⚠️ 依賴刻意**不放 onConfirm**：父層每次 render 都會產生新的 onConfirm 函式identity，
  // 而 OpsRail 有 30 秒 tick、BookingContext 也會定期同步 → 父層重繪會在**拖到一半時**
  // 把 dragX 歸零，手勢直接斷掉。只依真正代表語意變更的值（disabled / 文案）。
  useEffect(() => {
    firedRef.current = false
    draggingRef.current = false
    setLocked(false)
    setDragging(false)
    setDragX(0)
  }, [disabled, label, disabledLabel])

  const measureTravel = () => {
    const el = trackRef.current
    if (!el) return 0
    const width = el.getBoundingClientRect?.().width || el.clientWidth || 0
    return Math.max(width - KNOB_WIDTH, 0)
  }

  const fireConfirm = () => {
    if (firedRef.current) return
    firedRef.current = true
    setLocked(true)
    // onConfirm 回報 false＝入座失敗（桌被佔走/席數不足…）。此時面板狀態可能完全沒變，
    // 若不主動解鎖，滑桿會一直卡在 locked，店員得亂改人數才解得開 → 失敗即歸位重試。
    const r = onConfirm && onConfirm()
    if (r === false) {
      firedRef.current = false
      setLocked(false)
      setDragX(0)
    }
  }

  const canInteract = () => !disabled && !locked && !firedRef.current

  const handlePointerDown = (e) => {
    if (!canInteract()) return
    maxTravelRef.current = measureTravel()
    startClientXRef.current = e.clientX
    startDragXRef.current = dragX
    draggingRef.current = true
    setDragging(true)
    try { e.currentTarget.setPointerCapture?.(e.pointerId) } catch { /* 部分瀏覽器/測試環境無此 API，忽略 */ }
  }

  const handlePointerMove = (e) => {
    if (!draggingRef.current) return
    const delta = e.clientX - startClientXRef.current
    const travel = maxTravelRef.current
    const next = Math.min(Math.max(startDragXRef.current + delta, 0), travel)
    setDragX(next)
  }

  const endDrag = (shouldEvaluate) => {
    if (!draggingRef.current) return
    draggingRef.current = false
    setDragging(false)
    const travel = maxTravelRef.current
    const ratio = travel > 0 ? dragX / travel : 0
    if (shouldEvaluate && ratio >= CONFIRM_RATIO) {
      setDragX(travel)
      fireConfirm()
    } else {
      setDragX(0) // 未達門檻：彈回原位（過渡動畫交給 CSS class，尊重 reduced-motion）
    }
  }

  const handlePointerUp = () => endDrag(true)
  const handlePointerCancel = () => endDrag(false)

  // 鍵盤替代路徑（可及性）：**只收 Enter，刻意不收空白鍵**。
  // 空白鍵在瀏覽器是「往下捲一頁」，焦點若剛好落在滑桿上想捲畫面就會直接把客人帶位，
  // 等於繞過整個防誤觸設計。Enter 是明確的啟動意圖，保留它才不會把鍵盤族擋在門外。
  const handleKeyDown = (e) => {
    if (!canInteract()) return
    if (e.key === 'Enter') {
      e.preventDefault()
      setDragX(measureTravel())
      fireConfirm()
    }
  }

  const disabledText = disabledLabel || label
  const transitionClass = dragging ? '' : 'transition-[transform,width] duration-200 ease-out motion-reduce:transition-none'

  return (
    <div
      ref={trackRef}
      role="button"
      tabIndex={0}
      aria-label={label}
      aria-disabled={disabled ? 'true' : undefined}
      onKeyDown={handleKeyDown}
      className={`relative w-full h-[58px] rounded-xl overflow-hidden select-none border-2 border-chicken-brown/15 bg-white ${
        disabled ? 'opacity-40 pointer-events-none' : ''}`}
    >
      <div
        aria-hidden="true"
        className={`absolute inset-y-0 left-0 bg-gradient-to-r from-chicken-red to-chicken-red/70 ${transitionClass}`}
        style={{ width: `${dragX + KNOB_WIDTH}px` }}
      />
      <div className="absolute inset-0 flex items-center justify-center px-4 font-bold text-chicken-brown/80 pointer-events-none">
        {disabled ? disabledText : label}
      </div>
      <div
        data-slide-knob=""
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        style={{ width: `${KNOB_WIDTH}px`, transform: `translateX(${dragX}px)` }}
        className={`absolute left-0 top-1.5 h-[46px] rounded-lg bg-white shadow-md flex items-center justify-center text-xl touch-none cursor-grab active:cursor-grabbing ${transitionClass}`}
      >
        🪑
      </div>
    </div>
  )
}
