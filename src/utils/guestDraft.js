const KEY = 'chicken_guest_submission_v1'
const storage = () => window.sessionStorage

// Match the server's intent normalization; never persist a LINE identity/token.
export function canonicalGuestPayload(data = {}) {
  return {
    name: String(data.name || '').trim(),
    phone: String(data.phone || '').replace(/\D/g, ''),
    guests: Number(data.guests),
    date: String(data.date || '').trim(),
    timeSlot: String(data.timeSlot || '').trim(),
    notes: { pet: !!data.notes?.pet, child: !!data.notes?.child, mobility: !!data.notes?.mobility, text: String(data.notes?.text || '').trim().slice(0, 500) },
  }
}
export function newSubmissionKey() {
  const bytes = new Uint8Array(32)
  globalThis.crypto.getRandomValues(bytes)
  return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('')
}
export function loadGuestDraft() {
  try {
    const draft = JSON.parse(storage().getItem(KEY) || 'null')
    const payload = draft?.payload
    const validPayload = payload && typeof payload === 'object' && !Array.isArray(payload) && typeof payload.name === 'string' && typeof payload.phone === 'string' && Number.isInteger(payload.guests) && payload.guests >= 1 && payload.guests <= 12 && /^\d{4}-\d{2}-\d{2}$/.test(payload.date) && (payload.timeSlot === '' || /^([01]\d|2[0-3]):[0-5]\d$/.test(payload.timeSlot)) && payload.notes && typeof payload.notes === 'object'
    return draft?.version === 1 && /^[a-f0-9]{64}$/.test(draft.submissionKey) && ['editing', 'pending', 'unknown'].includes(draft.phase) && validPayload ? { ...draft, payload: canonicalGuestPayload(payload) } : null
  } catch { return null }
}
export function saveGuestDraft(draft) {
  storage().setItem(KEY, JSON.stringify(draft))
  // Fail before sending if the browser cannot durably retain the recovery key.
  if (storage().getItem(KEY) !== JSON.stringify(draft)) throw new Error('無法保存訂位草稿，請檢查瀏覽器儲存設定後再試')
  return draft
}
export function clearGuestDraft() { storage().removeItem(KEY) }
export function prepareGuestDraft(data, previous, phase = 'editing') {
  const payload = canonicalGuestPayload(data)
  const same = previous && JSON.stringify(previous.payload) === JSON.stringify(payload)
  if (previous && ['pending', 'unknown'].includes(previous.phase) && !same) throw new Error('上一筆訂位結果尚未確認，請先確認同一筆訂位')
  return { version: 1, payload, submissionKey: same ? previous.submissionKey : newSubmissionKey(), phase }
}
export function isUncertainDraft(draft) { return ['pending', 'unknown'].includes(draft?.phase) }
