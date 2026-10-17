// 動態管理員（不在建置期白名單、靠後端 staffWhoAmI 查 admins 集合）的身分閘門。
// 純邏輯、無 React / Firebase 依賴，方便測。
//
// 設計原則：真正的權限由後端 requireStaff 把關，前端可以樂觀。
//   - 只有後端「明確拒絕」(401/403 或 ok:false) 才算 denied → 才會登出。
//   - 網路、逾時、5xx、取不到 token 一律是 error：不登出。
//   - error 時若本機有此 email 上次驗證成功的角色 → 樂觀放行，背景退避重試。

const CACHE_KEY = 'chicken_staff_role_v1'
export const BACKOFF_DELAYS_MS = [3000, 10000, 30000]
const RECENT_OK_MS = 30_000

// ---------- 角色快取（只存 email/role/verifiedAt，不存 token） ----------
export function readRoleCache(email, storage = globalThis.localStorage) {
  try {
    const raw = JSON.parse(storage.getItem(CACHE_KEY) || 'null')
    if (raw && raw.email === email && typeof raw.role === 'string' && raw.role) return raw
  } catch { /* 無痕/封鎖儲存 → 當作沒快取 */ }
  return null
}

export function writeRoleCache(email, role, storage = globalThis.localStorage) {
  try {
    storage.setItem(CACHE_KEY, JSON.stringify({ email, role, verifiedAt: new Date().toISOString() }))
  } catch { /* 寫不進去不影響登入 */ }
}

export function clearRoleCache(email, storage = globalThis.localStorage) {
  try {
    const raw = JSON.parse(storage.getItem(CACHE_KEY) || 'null')
    if (!email || !raw || raw.email === email) storage.removeItem(CACHE_KEY)
  } catch { /* ignore */ }
}

// ---------- 三態驗證 ----------
// 回 {status:'ok', role} / {status:'denied'} / {status:'error', message}
export async function verifyStaffRole({ getToken, whoAmI }) {
  let token
  try { token = await getToken() } catch { token = null }
  if (!token) return { status: 'error', message: 'token-unavailable' }
  const attempt = async (t) => {
    try {
      const info = await whoAmI(t)
      if (info?.ok && info.role) return { status: 'ok', role: info.role }
      if (info?.ok === false) return { status: 'denied' }
      return { status: 'error', message: 'unexpected-response' }
    } catch (err) {
      const s = err?.status
      if (s === 401 || s === 403) return { status: 'denied', httpStatus: s }
      return { status: 'error', message: err?.code || err?.message || 'request-failed' }
    }
  }
  let result = await attempt(token)
  // 401 可能只是快取的 token 剛好過期：換新 token 再問一次，仍 401 才算拒絕。
  if (result.status === 'denied' && result.httpStatus === 401) {
    let fresh = null
    try { fresh = await getToken(true) } catch { fresh = null }
    if (!fresh) return { status: 'error', message: 'token-unavailable' }
    result = await attempt(fresh)
  }
  return result.status === 'denied' ? { status: 'denied' } : result
}

// 失敗（error）時依序退避重試；ok/denied 立即結束；最終仍 error 就回 error。
export async function verifyWithBackoff({ verify, delays = BACKOFF_DELAYS_MS, sleep, isCancelled = () => false }) {
  const wait = sleep || ((ms) => new Promise(r => setTimeout(r, ms)))
  let last = { status: 'error', message: 'not-run' }
  for (let i = 0; i <= delays.length; i++) {
    if (isCancelled()) return { status: 'cancelled' }
    last = await verify()
    if (last.status !== 'error') return last
    if (i < delays.length) await wait(delays[i])
  }
  return isCancelled() ? { status: 'cancelled' } : last
}

// ---------- 閘門 ----------
// check(email) → Promise<
//   {status:'allowed', role, cached, background}   background: Promise<bg結果>|null
//   {status:'denied'}
//   {status:'unverified', message}>
// bg 結果：{status:'ok', role, changed} / {status:'denied'} / {status:'error'} / {status:'cancelled'}
// 同一 email 併發呼叫共用同一個 in-flight promise（只打一次 staffWhoAmI）。
export function createStaffGate({ verify, storage, delays, sleep, now = () => Date.now() } = {}) {
  const inflight = new Map()
  const recentOk = new Map() // email → 最近一次驗證成功時間；剛驗過就不必再背景重驗
  let generation = 0
  const bgRunning = new Set()

  const store = () => storage || globalThis.localStorage

  function startBackground(email, cachedRole) {
    if (bgRunning.has(email)) return null
    bgRunning.add(email)
    const gen = generation
    return verifyWithBackoff({ verify, delays, sleep, isCancelled: () => gen !== generation })
      .then((res) => {
        if (gen !== generation) return { status: 'cancelled' }
        if (res.status === 'ok') {
          writeRoleCache(email, res.role, store())
          recentOk.set(email, now())
          return { status: 'ok', role: res.role, changed: res.role !== cachedRole }
        }
        if (res.status === 'denied') clearRoleCache(email, store())
        return { status: res.status }
      })
      .finally(() => { bgRunning.delete(email) })
  }

  async function run(email) {
    const cache = readRoleCache(email, store())
    if (cache) {
      if (now() - (recentOk.get(email) || 0) < RECENT_OK_MS) {
        return { status: 'allowed', role: cache.role, cached: true, background: null }
      }
      // 有快取：立刻放行，背景驗證（重整/喚醒不必等 staffWhoAmI）。
      return { status: 'allowed', role: cache.role, cached: true, background: startBackground(email, cache.role) }
    }
    const res = await verify()
    if (res.status === 'ok') {
      writeRoleCache(email, res.role, store())
      recentOk.set(email, now())
      return { status: 'allowed', role: res.role, cached: false, background: null }
    }
    if (res.status === 'denied') {
      clearRoleCache(email, store())
      return { status: 'denied' }
    }
    return { status: 'unverified', message: res.message || '' }
  }

  return {
    check(email) {
      if (inflight.has(email)) return inflight.get(email)
      const p = run(email).finally(() => { inflight.delete(email) })
      inflight.set(email, p)
      return p
    },
    // 登出／換人時取消進行中的背景驗證（結果會變 cancelled，不再動 UI／快取）。
    cancelBackground() { generation++; bgRunning.clear() },
    clear(email) { clearRoleCache(email, store()) },
  }
}
