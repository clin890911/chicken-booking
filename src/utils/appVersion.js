// 前端版本偵測：build 時 vite.config.js 把唯一 id 寫進程式（__BUILD_ID__）並輸出 /version.json。
// 執行中定期抓 /version.json，id 不同＝伺服器已有新版本、這個分頁還在跑舊程式。
// 背景：店裡 iPad 常駐現場頁、好幾天不重新整理，新功能上線一週仍跑舊版（2026-10 擠一擠事件）。

/* global __BUILD_ID__, __BUILD_SHA__, __BUILD_TIME__ */
export const BUILD_ID = typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : 'dev'
export const BUILD_SHA = typeof __BUILD_SHA__ !== 'undefined' ? __BUILD_SHA__ : ''
export const BUILD_TIME = typeof __BUILD_TIME__ !== 'undefined' ? __BUILD_TIME__ : ''

// 給人看的版本字樣：「3546498 · 10/12 11:31」（台北時間）；dev 模式回「開發版」
export function buildLabel(sha = BUILD_SHA, time = BUILD_TIME) {
  if (!time) return '開發版'
  const d = new Date(time)
  if (Number.isNaN(d.getTime())) return sha || '開發版'
  const parts = new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d)
  const get = (t) => parts.find(p => p.type === t)?.value || ''
  const when = `${get('month')}/${get('day')} ${get('hour')}:${get('minute')}`
  return sha ? `${sha} · ${when}` : when
}

// 抓伺服器上最新的 build id；任何失敗（離線、404、格式不對）回 null＝不判斷
export async function fetchLatestBuildId(fetchImpl = globalThis.fetch) {
  try {
    const res = await fetchImpl(`/version.json?t=${Date.now()}`, { cache: 'no-store' })
    if (!res?.ok) return null
    const json = await res.json()
    return typeof json?.id === 'string' && json.id ? json.id : null
  } catch {
    return null
  }
}

export function isNewBuild(latestId, currentId = BUILD_ID) {
  return !!latestId && currentId !== 'dev' && latestId !== currentId
}

// 自動重新整理的擋板：有未存資料的畫面（設定頁未儲存變更等）登記一個「現在不能重整」的判斷。
const reloadBlockers = new Set()
export function addReloadBlocker(fn) {
  reloadBlockers.add(fn)
  return () => reloadBlockers.delete(fn)
}
export function canAutoReload() {
  for (const fn of reloadBlockers) {
    try { if (fn()) return false } catch { return false }
  }
  return true
}
