// 線上訂位的廣告追蹤碼（FB utm_*／fbclid）。前端 src/utils/adAttribution.js 同規則。
// 只收這四個欄位；每個值轉字串、去控制字元、trim、限長 100；空值不寫；全空回 null（record 不寫 attribution）。
// 不參與 submissionProof 的 payloadHash（canonicalGuestIntent 只取固定欄位），帶不帶都不影響防重複送出。
export const ATTRIBUTION_FIELDS = ['source', 'campaign', 'content', 'fbclid']
export const ATTRIBUTION_MAX_LEN = 100

export function sanitizeAttribution(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const out = {}
  for (const field of ATTRIBUTION_FIELDS) {
    const value = raw[field]
    if (value == null || typeof value === 'object' || typeof value === 'function') continue
    // eslint-disable-next-line no-control-regex
    const s = String(value).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, ATTRIBUTION_MAX_LEN)
    if (s) out[field] = s
  }
  return Object.keys(out).length ? out : null
}
