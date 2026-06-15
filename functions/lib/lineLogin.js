// LINE Login（OAuth 2.0 網頁授權）純邏輯：授權 URL 組裝、friendFlag 解析、結果頁導回。
// 不碰 Firestore / 網路，供 Vitest 直接測試（同 lib/lineBinding.js 風格）。
//
// 為什麼用 LINE Login 取代 LIFF：LIFF 是 client 端 SDK 多段重導（init→login→callback），
// 在 LINE in-app 與外部瀏覽器間易彈跳成「一直載入」。LINE Login 是純伺服器 302 重導，
// 任何瀏覽器都穩，且 bot_prompt=aggressive 可在同一流程加官方帳號好友（push 才送得到）。

const AUTHORIZE_URL = 'https://access.line.me/oauth2/v2.1/authorize'

// state 一次性憑證有效期（10 分鐘）：授權往返綽綽有餘，過期即拒，降低重放風險。
export const LINE_LOGIN_STATE_TTL_MS = 10 * 60 * 1000

// 組 LINE Login 授權網址。scope=profile openid 才能用 id_token 取 userId/姓名/頭像；
// bot_prompt=aggressive 讓使用者在同一授權頁加官方帳號好友。
export function buildAuthorizeUrl({ channelId, redirectUri, state }) {
  const url = new URL(AUTHORIZE_URL)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', String(channelId || ''))
  url.searchParams.set('redirect_uri', String(redirectUri || ''))
  url.searchParams.set('state', String(state || ''))
  url.searchParams.set('scope', 'profile openid')
  url.searchParams.set('bot_prompt', 'aggressive')
  return url.toString()
}

// 解析授權回呼的 friendship_status_changed：'true'/'false' → boolean；其餘 → null（未知，
// 交由呼叫端改打 friendship API 確認）。
export function parseFriendFlag(value) {
  if (value === 'true' || value === true) return true
  if (value === 'false' || value === false) return false
  return null
}

// 組導回 SPA 綁定結果頁的網址。callback 落在 Functions 網域，必須用 publicSiteUrl 跨回站台；
// 未設定 publicSiteUrl 回空字串，呼叫端改送純文字後援頁（不致整頁卡死）。
export function buildBindResultUrl(publicSiteUrl, { bookingId = '', token = '', bound = 0, needFriend = 0, err = '' } = {}) {
  const base = String(publicSiteUrl || '').trim()
  if (!base) return ''
  const url = new URL(`${base.replace(/\/+$/, '')}/line/bind`)
  if (bookingId) url.searchParams.set('bookingId', bookingId)
  if (token) url.searchParams.set('token', token)
  url.searchParams.set('bound', bound ? '1' : '0')
  if (needFriend) url.searchParams.set('needFriend', '1')
  if (err) url.searchParams.set('err', String(err).slice(0, 40))
  return url.toString()
}
