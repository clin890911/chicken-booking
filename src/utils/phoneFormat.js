// 電話顯示格式化：現場店員要「看得清、照著撥」，不是只看末 3 碼。
// 只處理顯示，不改存檔內容；無法辨識的長度原樣回傳（不硬切，避免切錯更難讀）。
//   手機 09xxxxxxxx         → 0912-345-678
//   02／04 市話（10 碼）     → 02-2345-6789
//   3 碼區碼市話（049 等）   → 049-277-5678／037-123-456
//   2 碼區碼市話（9 碼）     → 03-123-4567
const THREE_DIGIT_AREA = /^0(49|37|89|82)/
const digitsOf = (v) => String(v || '').replace(/\D/g, '')

export function formatPhone(phone) {
  const raw = String(phone || '').trim()
  if (!raw) return ''
  if (raw.startsWith('+')) return raw            // 國際號碼：原樣
  const d = digitsOf(raw)
  if (d.length === 10 && d.startsWith('09')) return `${d.slice(0, 4)}-${d.slice(4, 7)}-${d.slice(7)}`
  // 3 碼區碼（南投 049、苗栗 037、台東 089、金門 082）要先判，否則 049 會被當成 04 切錯
  if (THREE_DIGIT_AREA.test(d) && (d.length === 9 || d.length === 10)) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`
  if (d.length === 10 && d.startsWith('0')) return `${d.slice(0, 2)}-${d.slice(2, 6)}-${d.slice(6)}`
  if (d.length === 9 && d.startsWith('0')) return `${d.slice(0, 2)}-${d.slice(2, 5)}-${d.slice(5)}`
  return raw
}

// tel: 連結用：只留數字與開頭 +
export function telHref(phone) {
  const s = String(phone || '').replace(/[^+\d]/g, '')
  return s ? `tel:${s}` : ''
}
