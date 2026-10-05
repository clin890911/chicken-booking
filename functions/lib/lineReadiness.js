const SITE_ORIGIN = 'https://chicken-booking.zeabur.app'
const FUNCTION_ORIGIN = 'https://us-central1-chicken-booking-tw.cloudfunctions.net'
const ENDPOINTS = {
  lineLoginStartEndpoint: ['lineLoginStart', 'https://lineloginstart-reaor76eyq-uc.a.run.app'],
  lineLoginCallbackUrl: ['lineLoginCallback', 'https://linelogincallback-reaor76eyq-uc.a.run.app'],
}

function httpsUrl(value) {
  try {
    const url = new URL(String(value || '').trim())
    return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash ? url : null
  } catch { return null }
}

// Configuration readiness only: credentials, LINE Console registration and delivery
// still require controlled verification. Never infer a Login channel from a LIFF ID.
export function validateLineReadiness(settings = {}) {
  const checks = []
  const add = (field, label, ok, message) => checks.push({ field, label, ok: !!ok, message })
  add('lineLoginChannelId', 'LINE Login Channel ID', /^\d{8,12}$/.test(String(settings.lineLoginChannelId || '').trim()), '請填入 LINE Login channel 的數字 Channel ID，不能使用 LIFF ID。')
  for (const [field, [name, serviceUrl]] of Object.entries(ENDPOINTS)) {
    const url = httpsUrl(settings[field])
    const allowed = url && (url.href === serviceUrl + '/' || url.href === FUNCTION_ORIGIN + '/' + name)
    add(field, field === 'lineLoginCallbackUrl' ? 'LINE Login 回呼網址' : 'LINE Login 綁定入口', allowed, '請使用此訂位系統已部署的 HTTPS LINE 端點；回呼網址仍需與 LINE Console 完全一致。')
  }
  const site = httpsUrl(settings.publicSiteUrl)
  add('publicSiteUrl', '訂位網站網址', site && site.origin === SITE_ORIGIN && site.pathname === '/', '請填入正式訂位網站的 HTTPS 首頁網址。')
  const official = httpsUrl(settings.lineOfficialUrl)
  add('lineOfficialUrl', '官方帳號加入連結', official && ['lin.ee', 'line.me'].includes(official.hostname), '請填入 LINE 官方帳號的 HTTPS 加好友連結。')
  if (settings.lineUseLiff === true) {
    const id = String(settings.lineLiffId || '').trim()
    add('lineLiffId', 'LIFF ID', /^\d+-[A-Za-z0-9_-]+$/.test(id), '已啟用 LIFF，請填入完整 LIFF ID。')
    const liff = httpsUrl(settings.lineLiffUrl)
    add('lineLiffUrl', 'LIFF 綁定連結', liff && liff.hostname === 'liff.line.me' && liff.pathname === '/' + id, 'LIFF 連結需使用 liff.line.me，且與 LIFF ID 相同。')
  }
  return { ready: checks.every(c => c.ok), issues: checks.filter(c => !c.ok), checks }
}

// The public server response is authoritative. Missing fields fail closed.
export const isGuestLineReady = settings => settings?.lineLoginReady === true
