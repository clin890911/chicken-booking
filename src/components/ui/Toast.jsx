import { createContext, useContext, useState, useCallback, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

// 輕量 Toast 系統：取代 alert/confirm，支援 Undo
// 使用：
//   const toast = useToast()
//   toast.success('已建立訂位')
//   toast.error('指派失敗')
//   toast.info('資訊')
//   toast.action('已標記 no-show', { label: '復原', onClick: () => undo() })

const ToastContext = createContext(null)

const TYPE_STYLES = {
  success: 'bg-chicken-green text-white',
  error:   'bg-chicken-red text-white',
  info:    'bg-chicken-brown text-white',
  warning: 'bg-chicken-yellow text-white',
}
const TYPE_ICONS = {
  success: '✅',
  error:   '⚠️',
  info:    'ℹ️',
  warning: '⚠️',
}

let _id = 0

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
    setToasts(list => [...list, t])
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
    <div className="fixed top-4 sm:top-auto sm:bottom-4 right-4 left-4 sm:left-auto z-[60] flex flex-col gap-2 pointer-events-none items-end">
      <AnimatePresence>
        {toasts.map(t => (
          <motion.div
            key={t.id}
            initial={{ opacity: 0, x: 20, scale: 0.95 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 20, scale: 0.95 }}
            transition={{ duration: 0.18 }}
            className={`pointer-events-auto rounded-2xl shadow-lg px-4 py-3 flex items-center gap-3 max-w-md min-w-[260px] ${TYPE_STYLES[t.type]}`}
          >
            <span className="text-lg leading-none flex-shrink-0">{TYPE_ICONS[t.type]}</span>
            <span className="flex-1 text-sm font-bold leading-snug">{t.message}</span>
            {t.action && (
              <button
                onClick={() => { t.action.onClick?.(); onDismiss(t.id) }}
                className="text-xs font-black underline opacity-90 hover:opacity-100 flex-shrink-0"
              >
                {t.action.label || '復原'}
              </button>
            )}
            <button
              onClick={() => onDismiss(t.id)}
              className="opacity-60 hover:opacity-100 text-lg leading-none flex-shrink-0"
              aria-label="關閉"
            >×</button>
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
      <AnimatePresence>
        {state.open && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[70] bg-black/40 flex items-center justify-center p-4"
            onClick={() => handle(false)}
          >
            <motion.div
              initial={{ scale: 0.95, y: 10 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95 }}
              className={`bg-white rounded-3xl shadow-xl w-full max-w-sm p-6
                ${state.options.danger ? 'border-l-4 border-chicken-red' : ''}`}
              onClick={e => e.stopPropagation()}
            >
              {state.options.title && (
                <h3 className={`text-lg font-black mb-2 ${state.options.danger ? 'text-chicken-red' : 'text-chicken-brown'}`}>
                  {state.options.danger && '⚠️ '}{state.options.title}
                </h3>
              )}
              <p className="text-sm text-chicken-brown leading-relaxed">{state.message}</p>
              <div className="flex gap-2 mt-5 justify-end">
                <button onClick={() => handle(false)} className="btn-secondary px-5 py-2 text-sm">
                  {state.options.cancelLabel || '取消'}
                </button>
                <button onClick={() => handle(true)}
                        className={`px-5 py-2 text-sm rounded-2xl font-bold text-white shadow-md
                          ${state.options.danger ? 'bg-chicken-red' : 'bg-chicken-brown'}`}>
                  {state.options.confirmLabel || '確認'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </ConfirmContext.Provider>
  )
}

export const useConfirm = () => {
  const ctx = useContext(ConfirmContext)
  if (!ctx) throw new Error('useConfirm must be used within <ConfirmProvider>')
  return ctx
}
