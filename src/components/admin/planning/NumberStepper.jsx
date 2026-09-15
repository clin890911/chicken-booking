import { useEffect, useRef, useState } from 'react'

// NumberStepper：− / 文字框 / ＋ 的數字步進器。
// 🔴 一律 type="text" + inputMode="numeric"（教訓 L23）：type="number" 在 iPad 上會被滾輪/上下鍵
//    誤觸、清空時瀏覽器回傳空字串讓受控值來回跳。這裡用「本地草稿字串」讓使用者可以暫時清空，
//    但同一刻就把 clamp 後的數字回報給父層（父層永遠拿得到合法數字，不會出現 NaN）。
export default function NumberStepper({
  value,
  onChange,
  min = 0,
  max = 999,
  step = 1,
  ariaLabel = '數量',
  size = 'md',
  id,
  className = '',
}) {
  const clamp = (n) => Math.min(max, Math.max(min, Math.floor(Number(n) || 0)))
  const current = clamp(value)
  const [text, setText] = useState(() => String(current))
  const focusedRef = useRef(false)

  // 外部值變了（快速鍵 chip、單梯同步總人數）就跟上；使用者正在打字時不打斷他
  useEffect(() => {
    if (!focusedRef.current) setText(String(clamp(value)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, min, max])

  const emit = (n) => {
    const v = clamp(n)
    setText(String(v))
    onChange?.(v)
  }

  const onType = (raw) => {
    const digits = String(raw).replace(/\D/g, '').slice(0, 5)
    setText(digits)                       // 允許暫時空白（刪光重打）
    onChange?.(digits === '' ? min : clamp(digits))
  }

  const box = size === 'sm'
    ? { btn: 'w-8 h-8 text-base', input: 'w-11 h-8 text-sm' }
    : { btn: 'w-11 h-11 text-lg', input: 'w-16 h-11 text-base' }

  const btnCls = `tap flex items-center justify-center font-bold text-chicken-brown/70 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-chicken-brown/[0.06] ${box.btn}`

  return (
    <div className={`inline-flex items-stretch overflow-hidden rounded-[10px] border border-chicken-brown/15 bg-white ${className}`}>
      <button type="button" aria-label={`${ariaLabel} 減 ${step}`} disabled={current <= min}
        onClick={() => emit(current - step)} className={btnCls}>−</button>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        aria-label={ariaLabel}
        value={text}
        onFocus={() => { focusedRef.current = true }}
        onBlur={() => { focusedRef.current = false; setText(String(clamp(value))) }}
        onChange={e => onType(e.target.value)}
        className={`border-x border-chicken-brown/10 bg-transparent text-center font-bold tabular-nums text-chicken-brown outline-none focus:bg-chicken-red/[0.04] ${box.input}`}
      />
      <button type="button" aria-label={`${ariaLabel} 加 ${step}`} disabled={current >= max}
        onClick={() => emit(current + step)} className={btnCls}>＋</button>
    </div>
  )
}
