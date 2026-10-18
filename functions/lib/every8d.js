// EVERY8D（互動資通）簡訊 API 2.1 client：純函式組請求＋解析回應＋錯誤分類。
// HTTP 一律用注入的 fetch（測試可 mock，絕不真打）。規格依 docs/候位簡訊_EVERY8D_API查證_2026-10-18.md：
//   POST https://{host}/API21/HTTP/SendSMS.ashx（application/x-www-form-urlencoded）
//   欄位 UID、PWD、SB（主旨，不發出）、MSG、DEST、ST（空＝立即）、RETRYTIME（有效分鐘）
//   成功：純文字 `CREDIT,SENDED,COST,UNSEND,BATCHID`；失敗：`Status,Msg`（Status 為負數，例 -99）
// ⚠ 開戶後要用測試簡訊實測：中文編碼（規格書未載明，這裡送 UTF-8）、實際 SiteUrl、錯誤碼表。

export const EVERY8D_DEFAULT_HOST = 'new.e8d.tw'
export const EVERY8D_TIMEOUT_MS = 10_000
// 簡訊有效期限（分鐘）：叫號 10 分鐘後就沒意義，不讓電信端一直重送到隔天。
export const EVERY8D_RETRY_MINUTES = 10

// 只允許 EVERY8D 自家網域，避免設定被改去把帳密送到別的主機。
export function isAllowedEvery8dHost(host) {
  return typeof host === 'string' && /^[a-z0-9-]+(\.[a-z0-9-]+)*$/i.test(host) && /(^|\.)(e8d\.tw|every8d\.com\.tw)$/i.test(host)
}

// secret 值為空、或占位值 UNSET（建 secret 時帳號還沒開好先存的）→ 視為未設定。
export function every8dCredentials(uid, pwd) {
  const clean = v => String(v ?? '').trim()
  const u = clean(uid), p = clean(pwd)
  const unset = v => !v || v.toUpperCase() === 'UNSET'
  if (unset(u) || unset(p)) return null
  return { uid: u, pwd: p }
}

// 字數＝Unicode 字元數（中文、英數、全形標點都算 1）。EVERY8D 扣點級距：
// 1–70 字 1 點、71–134 字 2 點、135–201 字 3 點、202–268 字 4 點、269–333 字 5 點；超過 333 不送。
export function smsCharCount(text) {
  return [...String(text ?? '')].length
}
export function smsCredits(text) {
  const n = smsCharCount(text)
  if (n === 0) return 0
  const tiers = [70, 134, 201, 268, 333]
  const i = tiers.findIndex(max => n <= max)
  return i === -1 ? null : i + 1
}

export function buildSendSmsRequest({ host = EVERY8D_DEFAULT_HOST, credentials, to, message, subject = '候位叫號', retryMinutes = EVERY8D_RETRY_MINUTES }) {
  if (!isAllowedEvery8dHost(host)) throw Object.assign(Error('every8d-host-not-allowed'), { code: 'host-not-allowed' })
  if (!credentials?.uid || !credentials?.pwd) throw Object.assign(Error('every8d-not-configured'), { code: 'not-configured' })
  const body = new URLSearchParams({
    UID: credentials.uid,
    PWD: credentials.pwd,
    SB: subject,
    MSG: message,
    DEST: to,
    ST: '',
    RETRYTIME: String(retryMinutes),
  })
  return {
    url: `https://${host}/API21/HTTP/SendSMS.ashx`,
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8' },
      body: body.toString(),
    },
  }
}

// 解析回應本文。回傳 outcome：
//   sent      — 確定已交給 EVERY8D（SENDED ≥ 1）
//   rejected  — 確定沒送出（明確錯誤碼、或 SENDED=0），retryable 表示值不值得短退避重試
//   unknown   — 看不懂回應：不能確定有沒有送出 → at-most-once，不重送
const RETRYABLE_CODES = new Set(['-99']) // 規格書只列 -99（不明錯誤）／-28（時間格式錯）；-99 明確表示這次沒成功
export function parseSendSmsResponse(text) {
  const raw = String(text ?? '').trim()
  const parts = raw.split(',').map(s => s.trim())
  const num = v => (v !== '' && Number.isFinite(Number(v)) ? Number(v) : null)
  if (parts.length >= 5 && num(parts[0]) !== null && num(parts[0]) >= 0 && num(parts[1]) !== null) {
    const credit = num(parts[0]), sended = num(parts[1]), cost = num(parts[2]), unsend = num(parts[3]), batchId = parts.slice(4).join(',')
    if (sended >= 1) return { outcome: 'sent', credit, sended, cost, unsend, batchId }
    return { outcome: 'rejected', retryable: false, code: 'unsend', error: `EVERY8D 未送出（UNSEND=${unsend ?? '?'}）`, credit, batchId }
  }
  if (parts.length >= 1 && num(parts[0]) !== null && num(parts[0]) < 0) {
    const code = String(num(parts[0]))
    return { outcome: 'rejected', retryable: RETRYABLE_CODES.has(code), code, error: `EVERY8D ${code}：${parts.slice(1).join(',').slice(0, 120) || '錯誤'}` }
  }
  return { outcome: 'unknown', code: 'unparseable', error: `EVERY8D 回應無法解析：${raw.slice(0, 120)}` }
}

// 依 HTTP 狀態分類：429／502／503 是閘道層擋下、請求沒被處理 → 可重試；
// 其他非 2xx（500、504…）可能已處理一半 → unknown（不重送）。
export function classifyHttpStatus(status) {
  if ([429, 502, 503].includes(status)) return { outcome: 'rejected', retryable: true, code: `http-${status}`, error: `EVERY8D HTTP ${status}` }
  if (status === 401 || status === 403) return { outcome: 'rejected', retryable: false, code: `http-${status}`, error: `EVERY8D HTTP ${status}（帳密或權限）` }
  return { outcome: 'unknown', code: `http-${status}`, error: `EVERY8D HTTP ${status}` }
}

// 連線前就失敗（DNS 查不到、連線被拒）＝請求確定沒送到 → 可重試；逾時／中途斷線 → unknown。
const PRE_CONNECT_CODES = new Set(['ENOTFOUND', 'ECONNREFUSED', 'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH'])
export function classifyFetchError(err) {
  const code = err?.cause?.code || err?.code || ''
  if (err?.name === 'AbortError' || err?.name === 'TimeoutError') return { outcome: 'unknown', code: 'timeout', error: 'EVERY8D 逾時（無法確定是否已送出）' }
  if (PRE_CONNECT_CODES.has(code)) return { outcome: 'rejected', retryable: true, code: code.toLowerCase(), error: `EVERY8D 連線失敗 ${code}` }
  return { outcome: 'unknown', code: 'network', error: `EVERY8D 網路錯誤：${String(err?.message || err).slice(0, 120)}` }
}

// 實際送出。永遠不 throw（除設定錯誤外）：結果一律回 outcome 物件，由 dispatcher 決定回寫。
export async function sendEvery8dSms({ fetchImpl, host, credentials, to, message, timeoutMs = EVERY8D_TIMEOUT_MS }) {
  let request
  try { request = buildSendSmsRequest({ host, credentials, to, message }) }
  catch (err) { return { outcome: 'rejected', retryable: false, code: err.code || 'config', error: err.message } }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetchImpl(request.url, { ...request.init, signal: controller.signal })
    if (!res.ok) return classifyHttpStatus(res.status)
    return parseSendSmsResponse(await res.text())
  } catch (err) {
    return classifyFetchError(err)
  } finally {
    clearTimeout(timer)
  }
}
