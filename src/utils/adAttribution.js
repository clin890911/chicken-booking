// FB／廣告追蹤碼：客人從廣告點進 / 或 /book 時，把 utm_* 與 fbclid 記在 sessionStorage，
// 之後從首頁再點「訂位」（<Link to="/book"> 會丟掉 query）也不會掉；送出訂位時另帶 attribution 欄位。
// 不裝 Meta Pixel；這裡只在本機分頁保存，不送給任何第三方。
// 注意：attribution 不可放進 guestDraft 的 payload——那份會算防重複送出的雜湊。
const KEY = 'chicken_ad_attribution_v1'
export const ATTRIBUTION_MAX_LEN = 100
const PARAMS = { utm_source: 'source', utm_campaign: 'campaign', utm_content: 'content', fbclid: 'fbclid' }

// 與後端 functions/lib/attribution.js 同規則：轉字串、去控制字元、trim、限長；空值不寫。
export function cleanAttribution(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const out = {}
  for (const field of Object.values(PARAMS)) {
    const value = raw[field]
    if (value == null || typeof value === 'object') continue
    // eslint-disable-next-line no-control-regex
    const s = String(value).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, ATTRIBUTION_MAX_LEN)
    if (s) out[field] = s
  }
  return Object.keys(out).length ? out : null
}

export function parseAttribution(search = '') {
  let params
  try { params = new URLSearchParams(search) } catch { return null }
  const raw = {}
  for (const [param, field] of Object.entries(PARAMS)) {
    const value = params.get(param)
    if (value != null) raw[field] = value
  }
  return cleanAttribution(raw)
}

// 網址帶有追蹤碼才覆寫（最後一次點擊為準）；沒帶就保留先前記下的，讓首頁→訂位不會洗掉。
export function captureAttribution(search = '') {
  const found = parseAttribution(search)
  if (!found) return readAttribution()
  try { window.sessionStorage.setItem(KEY, JSON.stringify(found)) } catch { /* 無痕／封鎖儲存：略過，不影響訂位 */ }
  return found
}

export function readAttribution() {
  try { return cleanAttribution(JSON.parse(window.sessionStorage.getItem(KEY) || 'null')) } catch { return null }
}

export function clearAttribution() {
  try { window.sessionStorage.removeItem(KEY) } catch { /* ignore */ }
}

// 會被記錄追蹤碼的客人落地頁。
export const ATTRIBUTION_LANDING_PATHS = ['/', '/book']

// CSV「廣告來源」欄：campaign/content；都沒有時退回 source，再沒有但有 fbclid 就標 fb。
export function formatAttribution(attribution) {
  const a = cleanAttribution(attribution)
  if (!a) return ''
  const label = [a.campaign, a.content].filter(Boolean).join('/') || a.source || (a.fbclid ? 'fb' : '')
  // 試算表公式注入防護：值來自網址，開頭是 = + - @ 時前置單引號。
  return /^[=+\-@]/.test(label) ? `'${label}` : label
}
