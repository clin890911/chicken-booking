// 登入錯誤 → 店員看得懂的中文。LoginPage 不可再把 Firebase 英文錯誤原樣顯示。
// 回傳 { silent, message, detail }：
//   silent  使用者自己關掉彈窗／重複點擊造成的取消 → 不顯示任何錯誤
//   message 給店員看的中文
//   detail  只有「未知錯誤碼」才有，小字附註方便回報

export const STAFF_DENIED_CODE = 'staff-denied'
export const STAFF_UNVERIFIED_CODE = 'staff-verify-unavailable'

export const STAFF_DENIED_MESSAGE = '此 Google 帳號未授權，請聯絡店長在後台「設定 → 管理員帳號」新增'
export const STAFF_UNVERIFIED_MESSAGE = '無法確認帳號權限（連線不穩），請再試一次'
export const GENERIC_LOGIN_MESSAGE = '登入失敗，請再試一次'

const IN_APP_BROWSER_MESSAGE = '請改用 Safari 或 Chrome 開啟（LINE 等 App 內建瀏覽器無法登入）'

const SILENT_CODES = new Set(['auth/popup-closed-by-user', 'auth/cancelled-popup-request'])

const MESSAGES = {
  'auth/popup-blocked': '瀏覽器擋住了登入視窗，請允許彈出視窗後再按一次',
  'auth/network-request-failed': '網路不穩，請確認連線後再試',
  'auth/operation-not-supported-in-this-environment': IN_APP_BROWSER_MESSAGE,
  'auth/web-storage-unsupported': IN_APP_BROWSER_MESSAGE,
  'auth/too-many-requests': '嘗試次數過多，請稍候幾分鐘再試',
  'auth/user-disabled': '此 Google 帳號已被停用，請聯絡店長',
  'auth/internal-error': '登入服務暫時發生問題，請稍後再試',
  'auth/unauthorized-domain': '此網址尚未開放登入，請聯絡系統管理員',
  'auth/account-exists-with-different-credential': '此 Email 已用其他方式登入過，請聯絡店長',
  'auth/timeout': '連線逾時，請確認網路後再試',
  [STAFF_DENIED_CODE]: STAFF_DENIED_MESSAGE,
  [STAFF_UNVERIFIED_CODE]: STAFF_UNVERIFIED_MESSAGE,
}

// Firebase 有時只把錯誤碼放在 message："Firebase: Error (auth/xxx)."
function extractCode(err) {
  if (!err) return ''
  if (typeof err.code === 'string' && err.code) return err.code
  const m = /\((auth\/[a-z0-9-]+)\)/i.exec(String(err.message || ''))
  return m ? m[1] : ''
}

const HAS_CJK = /[㐀-鿿]/

export function describeAuthError(err) {
  const code = extractCode(err)
  if (SILENT_CODES.has(code)) return { silent: true, message: '', detail: '' }
  if (MESSAGES[code]) return { silent: false, message: MESSAGES[code], detail: '' }
  // 我們自己丟的中文訊息（例如開發模式「請輸入 email」）原樣保留。
  const msg = String(err?.message || '')
  if (!code && msg && HAS_CJK.test(msg)) return { silent: false, message: msg, detail: '' }
  return { silent: false, message: GENERIC_LOGIN_MESSAGE, detail: code || '' }
}
