import { useId } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

// 預設 type="button"：避免包進 <form> 時被當成隱式 submit 誤觸送出；呼叫端仍可傳 type="submit" 覆寫。
export function Button({ variant = 'primary', type = 'button', className = '', children, ...rest }) {
  const cls = variant === 'secondary' ? 'btn-secondary' : variant === 'yellow' ? 'btn-yellow' : 'btn-primary'
  return <button type={type} className={`${cls} ${className}`} {...rest}>{children}</button>
}

export function Card({ className = '', children, ...rest }) {
  return <div className={`card ${className}`} {...rest}>{children}</div>
}

// label 用 htmlFor 綁到 input（id 未傳則以 useId 自動產生）：改善鍵盤/螢幕閱讀器與 getByLabel 測試。
export function Input({ label, error, id, className = '', ...rest }) {
  const auto = useId()
  const inputId = id || auto
  return (
    <div>
      {label && <label htmlFor={inputId} className="label">{label}</label>}
      <input id={inputId} className={`input ${error ? 'border-chicken-red ring-2 ring-chicken-red/30' : ''} ${className}`} {...rest} />
      {error && <p className="text-xs text-chicken-red mt-1">{error}</p>}
    </div>
  )
}

export function Select({ label, options = [], id, className = '', ...rest }) {
  const auto = useId()
  const selectId = id || auto
  return (
    <div>
      {label && <label htmlFor={selectId} className="label">{label}</label>}
      <select id={selectId} className={`input ${className}`} {...rest}>
        {options.map(o => (
          typeof o === 'object'
            ? <option key={o.value} value={o.value}>{o.label}</option>
            : <option key={o} value={o}>{o}</option>
        ))}
      </select>
    </div>
  )
}

export function Textarea({ label, id, className = '', ...rest }) {
  const auto = useId()
  const textareaId = id || auto
  return (
    <div>
      {label && <label htmlFor={textareaId} className="label">{label}</label>}
      <textarea id={textareaId} className={`input min-h-[80px] resize-none ${className}`} {...rest} />
    </div>
  )
}

export function Badge({ color = 'red', children, className = '' }) {
  const map = {
    red: 'bg-chicken-red/10 text-chicken-red',
    yellow: 'bg-chicken-yellow/15 text-chicken-yellow',
    green: 'bg-chicken-green/15 text-chicken-green',
    gray: 'bg-chicken-brown/10 text-chicken-brown',
    brown: 'bg-chicken-brown text-white'
  }
  return <span className={`badge ${map[color] || map.gray} ${className}`}>{children}</span>
}

export function Modal({ open, onClose, title, children, footer }) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 30, opacity: 0 }}
            className="bg-white w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl shadow-xl max-h-[90vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            {title && <div className="px-5 pt-5 pb-2 text-lg font-bold text-chicken-brown">{title}</div>}
            <div className="px-5 py-4">{children}</div>
            {footer && <div className="px-5 pb-5 pt-2 flex gap-2 justify-end">{footer}</div>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export function LoadingScreen({ label = '載入中...' }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-chicken-cream">
      <div className="text-6xl animate-bounce">🐔</div>
      <p className="mt-4 text-chicken-brown/60 font-bold">{label}</p>
    </div>
  )
}

// 查詢可訂時段時的載入骨架（比 emoji 轉圈更穩定、不跳版）
export function SlotSkeleton({ rows = 2, cols = 3 }) {
  return (
    <div className="mt-4 space-y-4" role="status" aria-live="polite" aria-label="正在查詢可訂時段">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r}>
          <div className="mb-2 h-3 w-12 rounded bg-chicken-brown/10" />
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {Array.from({ length: cols }).map((_, c) => (
              <div key={c} className="min-h-[58px] animate-pulse rounded-xl border-2 border-chicken-brown/10 bg-chicken-brown/[0.06]" />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

export function EmptyState({ icon = '🍽️', title, hint, action }) {
  return (
    <div className="empty-panel">
      <div className="text-4xl mb-3">{icon}</div>
      <p className="text-chicken-brown font-bold">{title}</p>
      {hint && <p className="text-sm text-chicken-brown/60 mt-1">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
