// 大數字觸控鍵盤：iPad 現場帶位快速輸入電話。驅動受控字串 value，onChange 收新字串。
// maxLen 限長（電話預設 10 碼）；只吃數字，另有「清除」與退格。
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '清除', '0', '⌫']

export default function NumericKeypad({ value = '', onChange, maxLen = 10 }) {
  const press = (k) => {
    if (k === '⌫') return onChange(value.slice(0, -1))
    if (k === '清除') return onChange('')
    if (/^\d$/.test(k) && value.length < maxLen) onChange(value + k)
  }
  return (
    <div className="grid grid-cols-3 gap-1.5">
      {KEYS.map(k => (
        <button
          key={k}
          type="button"
          onClick={() => press(k)}
          aria-label={k === '⌫' ? '退格' : k}
          className={`h-12 rounded-xl border-2 border-chicken-brown/15 bg-white font-bold text-chicken-brown active:scale-95 transition-transform ${
            k === '清除' ? 'text-sm text-chicken-brown/60' : 'text-lg'}`}
        >
          {k}
        </button>
      ))}
    </div>
  )
}
