// 大數字觸控鍵盤：iPad 現場帶位快速輸入電話。驅動受控字串 value，onChange 收新字串。
// maxLen 限長（電話預設 10 碼）；只吃數字，另有「清除」與退格。
//
// tone：
//   'light'（預設）＝白底，內嵌在表單裡（3 欄 4 排：1–9 / 清除 0 ⌫）
//   'dark'         ＝深色漂浮鍵盤用（3 欄 4 排：1–9 / ⌫ 0 OK），OK 呼叫 onDone 收起面板
const KEYS_LIGHT = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '清除', '0', '⌫']
const KEYS_DARK = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0', 'OK']

export default function NumericKeypad({ value = '', onChange, maxLen = 10, tone = 'light', onDone }) {
  const dark = tone === 'dark'
  const keys = dark ? KEYS_DARK : KEYS_LIGHT
  const press = (k) => {
    if (k === 'OK') return onDone?.()
    if (k === '⌫') return onChange(value.slice(0, -1))
    if (k === '清除') return onChange('')
    if (/^\d$/.test(k) && value.length < maxLen) onChange(value + k)
  }
  return (
    <div className={`grid grid-cols-3 ${dark ? 'gap-2' : 'gap-1.5'}`}>
      {keys.map(k => (
        <button
          key={k}
          type="button"
          onClick={() => press(k)}
          aria-label={k === '⌫' ? '退格' : k}
          className={dark
            ? `h-[66px] rounded-xl font-black active:scale-95 transition-transform ${
              k === 'OK'
                ? 'bg-chicken-yellow text-white text-xl'
                : k === '⌫'
                  ? 'bg-white/10 text-white text-xl'
                  : 'bg-white/10 text-white text-[27px]'}`
            : `h-12 rounded-xl border-2 border-chicken-brown/15 bg-white font-bold text-chicken-brown active:scale-95 transition-transform ${
              k === '清除' ? 'text-sm text-chicken-brown/60' : 'text-lg'}`}
        >
          {k}
        </button>
      ))}
    </div>
  )
}
