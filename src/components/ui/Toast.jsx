import { createContext, useContext, useState, useCallback, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X } from 'lucide-react'
import Icon from './Icon'
import GlyphText from './GlyphText'
import { SPRING_UI } from './springs'

// 輕量 Toast 系統：取代 alert/confirm，支援 Undo
// 使用：
//   const toast = useToast()
//   toast.success('已建立訂位')
//   toast.error('指派失敗')
//   toast.info('資訊')
//   toast.action('已標記 no-show', { label: '復原', onClick: () => undo() })

const ToastContext = createContext(null)

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

  const dismiss = useCallback((id) => {
    setToasts(list => list.filter(t => t.id !== id))
  }, [])

  const show = useCallback((message, opts = {}) => {
    const id = ++_id
    const type = opts.type || 'info'
    const duration = opts.duration ?? 4000
    const t = { id, message, type, action: opts.action }
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
  }, [dismiss])

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
      {children}
      <ToastContainer toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  )
}

function ToastContainer({ toasts, onDismiss }) {
  return (
    // 全尺寸統一頂部置中：iPad 現場頁右下是地圖與報到列，原本 sm 以上的右下角 toast 會蓋住「到了」鈕與桌子。
    <div data-testid="toast-container" className="fixed top-4 left-4 right-4 z-[60] flex flex-col gap-2 pointer-events-none items-center">
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
            className="lg-float lg-toast pointer-events-auto rounded-[22px] text-chicken-brown pl-2.5 pr-4 py-3 flex items-center gap-3 max-w-md min-w-[260px]"
          >
            <span className={`inline-flex items-center justify-center w-8 h-8 rounded-full text-white flex-shrink-0 ${TYPE_CHIP[t.type] || TYPE_CHIP.info}`}>
              <Icon name={TYPE_ICONS[t.type]} size={18} />
            </span>
            <span className="flex-1 text-sm font-bold leading-snug">{t.message}</span>
            {t.action && (
              <button
                onClick={() => { t.action.onClick?.(); onDismiss(t.id) }}
                data-testid="toast-action"
                className="min-h-[44px] min-w-[44px] px-4 rounded-full bg-chicken-brown text-white text-sm font-bold hover:bg-chicken-brown/90 active:scale-95 flex-shrink-0"
              >
                <GlyphText size={16}>{t.action.label || '復原'}</GlyphText>
              </button>
            )}
            <button
              onClick={() => onDismiss(t.id)}
              className="inline-flex items-center justify-center text-chicken-brown/80 hover:text-chicken-brown flex-shrink-0 min-h-[44px] min-w-[44px] -mr-2"
              aria-label="關閉"
            ><X size={20} strokeWidth={2.2} aria-hidden="true" /></button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
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

  const confirm = useCallback((message, options = {}) => {
    return new Promise(resolve => {
      setState({ open: true, message, resolve, options })
    })
  }, [])

  const handle = (result) => {
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
