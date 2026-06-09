// 共用複製到剪貼簿：優先用 navigator.clipboard，不支援/被拒時退回 execCommand。
// 抽自 ConfirmPage 的 copyText，供 BookingCard / ConfirmPage 等處共用。
// 回傳 Promise<boolean>：true 表示複製成功。
export async function copyText(text) {
  const value = String(text ?? '')
  try {
    await navigator.clipboard.writeText(value)
    return true
  } catch {
    try {
      const ta = document.createElement('textarea')
      ta.value = value
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand('copy')
      document.body.removeChild(ta)
      return ok
    } catch {
      return false
    }
  }
}
