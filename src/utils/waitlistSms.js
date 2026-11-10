// 候位叫號簡訊的前端純函式：手機判斷（與後端 functions/lib/smsPhone.js 的 normalizeTwMobile 同口徑）
// 與卡片徽章。只負責顯示；送不送由後端決定（總開關、上限都在後端）。

export function normalizeTwMobile(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  let d = String(value).replace(/\D/g, '')
  if (d.startsWith('886')) d = d.slice(3).replace(/^0?/, '0')
  return /^09\d{8}$/.test(d) ? d : null
}

// 取號表單的提示：非 09 開頭（市話等）提醒不會收到簡訊，但仍允許取號。還在輸入中的 09… 不打擾。
export function waitlistPhoneHint(phone) {
  const d = String(phone || '').replace(/\D/g, '')
  if (!d) return null
  if (normalizeTwMobile(d)) return null
  if ('09'.startsWith(d) || (d.startsWith('09') && d.length < 10)) return null
  return '這不是 09 開頭的 10 碼手機，叫號時不會發簡訊（仍可取號，請記得喊號或打電話）'
}

// 「簡訊有在運作」的證據：今天有任何候位出現過非關閉類的簡訊狀態。
// 前端讀不到總開關（只有店長端點能讀），沒有證據時「無手機／發送中」一律不顯示，避免開關關著還滿版提示。
const ACTIVE_STATES = new Set(['pending', 'retrying', 'sent', 'dry-run', 'failed', 'unknown', 'limited', 'skipped-unconfigured'])
export function smsLooksActive(waitlist = []) {
  return waitlist.some(w => ACTIVE_STATES.has(w?.smsStatus?.state))
}

// 回傳 { label, tone: 'ok'|'bad'|'neutral' } 或 null（不顯示）。只在「已叫號」的卡片上顯示。
export function waitlistSmsBadge(w, { smsActive = false } = {}) {
  if (!w || w.status !== 'called') return null
  const s = w.smsStatus
  // 上一次叫號（回來了之後又重叫）留下的舊狀態不算數
  const current = s && (!s.calledAt || !w.calledAt || s.calledAt === w.calledAt) ? s.state : null
  switch (current) {
    case 'sent': return { label: '簡訊已送出', tone: 'ok' }
    case 'dry-run': return { label: '簡訊乾跑（未實送）', tone: 'neutral' }
    case 'pending':
    case 'retrying': return { label: '簡訊發送中', tone: 'neutral' }
    case 'failed':
    case 'skipped-unconfigured': return { label: '簡訊失敗・請打電話', tone: 'bad' }
    case 'limited': return { label: '簡訊未送（已達上限）・請打電話', tone: 'bad' }
    case 'unknown': return { label: '簡訊狀態不明・請打電話', tone: 'bad' }
    case 'skipped-disabled':
    case 'superseded': return null
    default: break
  }
  if (!smsActive) return null
  if (!normalizeTwMobile(w.phone)) return { label: '無手機・請喊號', tone: 'neutral' }
  return { label: '簡訊發送中', tone: 'neutral' }
}
