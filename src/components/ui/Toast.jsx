import { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X } from 'lucide-react'
import Icon from './Icon'
import GlyphText from './GlyphText'
import { SPRING_UI } from './springs'
import { seatUndoTextOf } from '../../utils/seatFeedback'
// 入座「復原欄」（2026-11-27 驗收 P1 第三輪）：現場頁把入座類的復原從浮動 toast 移到版面內固定保留的位置。
import { SeatUndoContext } from './seatUndoContext'

// 輕量 Toast 系統：取代 alert/confirm，支援 Undo
// 使用：
//   const toast = useToast()
//   toast.success('已建立訂位')
//   toast.error('指派失敗')
//   toast.info('資訊')
//   toast.action('已標記 no-show', { label: '復原', onClick: () => undo() })

const ToastContext = createContext(null)

// 現場頁入座提示：只告知、不可互動（pointer-events:none、不帶任何按鈕），約 4 秒消失。
export const SEAT_TOAST_MS = 4000

// Liquid Glass：toast 是浮在內容上的控制層 → 淺色厚玻璃＋深棕字；類型靠左側實色圖示膠囊區分
// （過去整塊綠底白字只有 2.2:1，iPad 在餐廳燈光下看不清）。膠囊底色白字皆 ≥4.5:1。
const TYPE_CHIP = {
  success: 'bg-emerald-700',
  error:   'bg-[#c2000f]',
  info:    'bg-chicken-brown',
  warning: 'bg-amber-700',
}
const TYPE_ICONS = {
  success: 'checkCircle',
  error:   'warning',
  info:    'info',
  warning: 'warning',
}

let _id = 0

// 畫面上最多同時顯示幾則：超過就擠掉最舊的。
// 這是最後一道防線——不管哪個來源一次推了幾則（例如同步回來一批新訂位），
// toast 都不該疊到蓋住底下的桌況圖。
const MAX_VISIBLE = 3

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  // 復原欄：同時只保留「最近一筆」。{ id, text, ariaLabel, onClick, live }——live=false 是時效已過（淡色「最近」）。
  const [seatUndo, setSeatUndo] = useState(null)
  const seatUndoRef = useRef(null)
  const seatUndoTimer = useRef(null)
  // 有幾個畫面掛著復原欄（現場頁掛 1 個）。0 時入座提示照舊（帶「復原」的 toast），非現場頁不受影響。
  const slotCount = useRef(0)
  const setSeatUndoBoth = useCallback((v) => { seatUndoRef.current = v; setSeatUndo(v) }, [])

  const dismiss = useCallback((id) => {
    setToasts(list => list.filter(t => t.id !== id))
  }, [])

  const show = useCallback((message, opts = {}) => {
    const id = ++_id
    const type = opts.type || 'info'
    let duration = opts.duration ?? 4000
    let action = opts.action
    let passive = false
    // 現場頁（有復原欄）的入座類提示：toast 只告知、不可互動；「復原」改進復原欄（新的取代舊的）。
    // 其他動作（例：候位入座的「查看」）不放進浮動提示——浮在內容上的東西一律點不到。
    if (opts.placement === 'seat' && slotCount.current > 0) {
      if (action && (action.undo || action.label === '復原')) {
        clearTimeout(seatUndoTimer.current)
        const entry = { id, text: action.slotText || seatUndoTextOf(message), ariaLabel: action.ariaLabel || '復原', onClick: action.onClick, live: true }
        setSeatUndoBoth(entry)
        const ttl = opts.duration ?? 6000
        seatUndoTimer.current = setTimeout(() => {
          if (seatUndoRef.current?.id === id) setSeatUndoBoth({ ...seatUndoRef.current, live: false })
        }, ttl)
        if (action.toast === false) return id
      }
      action = undefined
      passive = true
      duration = SEAT_TOAST_MS
    }
    const t = { id, message, type, action, passive, placement: opts.placement || 'top' }
    // 擠掉最舊的：帶「復原」動作的那則例外——它是使用者唯一的反悔入口，
    // 被別的通知擠掉等於動作做不回來。真的滿了就讓新的那則排在後面自然輪替。
    setToasts(list => {
      const next = [...list, t]
      if (next.length <= MAX_VISIBLE) return next
      const evictable = next.findIndex(x => !x.action)
      return evictable === -1 ? next : next.filter((_, i) => i !== evictable)
    })
    if (duration > 0) {
      setTimeout(() => dismiss(id), duration)
    }
    return id
  }, [dismiss, setSeatUndoBoth])

  useEffect(() => () => clearTimeout(seatUndoTimer.current), [])

  const registerSeatUndoSlot = useCallback(() => {
    slotCount.current += 1
    return () => {
      slotCount.current = Math.max(0, slotCount.current - 1)
      // 離開現場頁：復原欄的那一筆跟著作廢（它的 onClick 綁著已卸載畫面的狀態，回來再按不安全）
      if (slotCount.current === 0) { clearTimeout(seatUndoTimer.current); setSeatUndoBoth(null) }
    }
  }, [setSeatUndoBoth])
  // 按復原欄：只執行仍在時效內的那一筆；執行後清空（不留「已無法復原」的舊文字誤導）
  const runSeatUndo = useCallback(() => {
    const e = seatUndoRef.current
    if (!e?.live) return
    clearTimeout(seatUndoTimer.current)
    setSeatUndoBoth(null)
    e.onClick?.()
  }, [setSeatUndoBoth])

  const api = {
    success: (msg, opts) => show(msg, { ...opts, type: 'success' }),
    error:   (msg, opts) => show(msg, { ...opts, type: 'error', duration: 6000 }),
    info:    (msg, opts) => show(msg, { ...opts, type: 'info' }),
    warning: (msg, opts) => show(msg, { ...opts, type: 'warning' }),
    action:  (msg, action, opts) => show(msg, { ...opts, type: opts?.type || 'success', action, duration: opts?.duration ?? 6000 }),
    show,
    dismiss,
  }

  return (
    <ToastContext.Provider value={api}>
      <SeatUndoContext.Provider value={{ entry: seatUndo, run: runSeatUndo, register: registerSeatUndoSlot }}>
        {children}
      </SeatUndoContext.Provider>
      <ToastContainer toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  )
}

// 全尺寸統一頂部置中。入座回饋（placement:'seat'）在現場頁是「不可互動」的提示（data-passive）：
// 2026-11-27 驗收兩輪都失敗——疊在地圖底部會蓋桌、移到頂部會蓋「待清／1F／候位／同步燈」，
// 只要浮動提示上有「復原」，手指在入座後幾秒內就可能誤觸。第三輪換方法：浮動提示整個 pointer-events:none、
// 不帶任何按鈕（點下去穿透到底下的元素），「復原」只出現在版面內固定保留的復原欄（SeatUndoBar）。
// role=status＋aria-live=polite 放在常駐容器上：讀屏念出入座成功（live region 要先存在、內容後插入才會念）。
function ToastContainer({ toasts, onDismiss }) {
  return (
    <div data-testid="toast-container" role="status" aria-live="polite"
      className="fixed top-4 left-4 right-4 z-[60] flex flex-col gap-2 pointer-events-none items-center">
      <ToastStack toasts={toasts} onDismiss={onDismiss} />
    </div>
  )
}

function ToastStack({ toasts, onDismiss }) {
  return (
      <AnimatePresence>
        {toasts.map(t => (
          // 進場 spring、只動 transform：不從 opacity:0 出發——動畫時鐘凍結時內容仍可見，
          // 也避免宿主 opacity<1 讓 ::before 的 backdrop-filter 在動畫中失效；退場才淡出。
          <motion.div
            key={t.id}
            initial={{ y: -24, scale: 0.92 }}
            animate={{ y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -16, scale: 0.96, transition: { duration: 0.16 } }}
            transition={SPRING_UI}
            data-type={t.type}
            data-placement={t.placement}
            data-passive={t.passive ? '' : undefined}
            className={`lg-float lg-toast ${t.passive ? 'pointer-events-none select-none' : 'pointer-events-auto'} rounded-[22px] text-chicken-brown pl-2.5 pr-4 py-3 flex items-center gap-3 max-w-md min-w-[260px]`}
          >
            <span className={`inline-flex items-center justify-center w-8 h-8 rounded-full text-white flex-shrink-0 ${TYPE_CHIP[t.type] || TYPE_CHIP.info}`}>
              <Icon name={TYPE_ICONS[t.type]} size={18} />
            </span>
            <span className="flex-1 text-sm font-bold leading-snug">{t.message}</span>
            {t.action && (
              <button
                type="button"
                onClick={() => { t.action.onClick?.(); onDismiss(t.id) }}
                data-testid="toast-action"
                aria-label={t.action.ariaLabel || undefined}
                className="min-h-[44px] min-w-[44px] px-4 rounded-full bg-chicken-brown text-white text-sm font-bold hover:bg-chicken-brown/90 active:scale-95 flex-shrink-0"
              >
                <GlyphText size={16}>{t.action.label || '復原'}</GlyphText>
              </button>
            )}
            {!t.passive && <button
              onClick={() => onDismiss(t.id)}
              className="inline-flex items-center justify-center text-chicken-brown/80 hover:text-chicken-brown flex-shrink-0 min-h-[44px] min-w-[44px] -mr-2"
              aria-label="關閉"
            ><X size={20} strokeWidth={2.2} aria-hidden="true" /></button>}
          </motion.div>
        ))}
      </AnimatePresence>
  )
}

export const useToast = () => {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within <ToastProvider>')
  return ctx
}

// 確認對話框 Hook（取代 window.confirm）
// 用法：const confirm = useConfirm()
//      const ok = await confirm('確定取消訂位？')
//      if (ok) ...
const ConfirmContext = createContext(null)

export function ConfirmProvider({ children }) {
  const [state, setState] = useState({ open: false, message: '', resolve: null, options: {} })
  // 目前開著的那個 confirm 的 resolve：開新的 confirm 前先把舊的 resolve(false)——
  // 否則舊的 Promise 永遠不結束，等它的呼叫端（例：報到列「到了」的處理中旗標）會卡死。
  const pending = useRef(null)

  const confirm = useCallback((message, options = {}) => {
    return new Promise(resolve => {
      const prev = pending.current
      pending.current = resolve
      prev?.(false)
      setState({ open: true, message, resolve, options })
    })
  }, [])

  const handle = (result) => {
    if (pending.current === state.resolve) pending.current = null
    state.resolve?.(result)
    setState({ open: false, message: '', resolve: null, options: {} })
  }

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {/* 背板用條件渲染同步卸載、不走 AnimatePresence exit：framer v11 的 exit 完成回呼
          在動畫時鐘凍結時會遺失，全螢幕 fixed 背板若卸不掉會把整頁鎖死（顧客取消訂位流程會開此框）。 */}
      {state.open && (
        <div
          className="fixed inset-0 z-[70] bg-black/40 flex items-center justify-center p-4"
          onClick={() => handle(false)}
        >
          <div
            className={`lg-float lg-sheet animate-soft-enter rounded-[28px] w-full max-w-sm p-6
              ${state.options.danger ? 'border-l-4 border-chicken-red' : ''}`}
            onClick={e => e.stopPropagation()}
          >
              {state.options.title && (
                <h3 className={`text-lg font-bold mb-2 ${state.options.danger ? 'text-chicken-red' : 'text-chicken-brown'}`}>
                  {state.options.danger && <Icon name="warning" size={18} className="inline-block align-[-3px] mr-1" />}{state.options.title}
                </h3>
              )}
              <p className="text-sm text-chicken-brown leading-relaxed">{state.message}</p>
              <div className="flex gap-2 mt-5 justify-end">
                <button onClick={() => handle(false)} className="btn-secondary px-5 py-2 text-sm">
                  {state.options.cancelLabel || '取消'}
                </button>
                <button onClick={() => handle(true)}
                        className={`px-5 py-2 text-sm rounded-xl font-bold text-white shadow-md
                          ${state.options.danger ? 'bg-chicken-red' : 'bg-chicken-brown'}`}>
                  {state.options.confirmLabel || '確認'}
                </button>
              </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  )
}

export const useConfirm = () => {
  const ctx = useContext(ConfirmContext)
  if (!ctx) throw new Error('useConfirm must be used within <ConfirmProvider>')
  return ctx
}
