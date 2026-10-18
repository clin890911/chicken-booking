import crypto from 'node:crypto'
import { businessDate } from './operationalCommands.js'
import { normalizeTwMobile } from './smsPhone.js'
import { EVERY8D_DEFAULT_HOST, isAllowedEvery8dHost, sendEvery8dSms, smsCharCount, smsCredits } from './every8d.js'

// 叫號簡訊專用 dispatcher（與 notifications／retryNotifications 完全分開）。
// 設計鐵律（見 docs/候位簡訊_工作量與衝擊評估 §2、§6、§8）：
//  1. 結果不明不重送（at-most-once）：送出前先 claim 成 processing；lease 過期還是 processing ＝ 可能已送出 → unknown。
//  2. 送前重讀 waitlist：不是 called、calledAt 對不上、叫號超過 10 分鐘 → superseded，不送。
//  3. 只有「確定沒送出」的錯誤才短退避重試（15s／45s），最多 3 次。
//  4. 總開關 system/smsConfig fail-closed：文件不存在／讀取失敗／enabled!==true 一律不送。
//  5. 回寫 waitlist/{id}.smsStatus 只更新這一欄，絕不碰 queueVersion（否則別台裝置的命令會被 waitlist-changed 擋）。
//  6. 叫號交易不讀也不等這裡任何東西：這裡壞掉，叫號／入座照常。

export const SMS_CONFIG_DOC = ['system', 'smsConfig']
export const SMS_OUTBOX = 'smsOutbox'
export const SMS_COUNTERS = 'smsCounters'
export const DEFAULT_SMS_TEMPLATE = '【{店名}】您的候位 #{號碼} 已可入座，請於 10 分鐘內至櫃台報到。'
export const DEFAULT_STORE_NAME = '雞王涮涮鍋'
export const SMS_LEASE_MS = 60_000
export const SMS_BACKOFF_MS = [15_000, 45_000]
export const SMS_MAX_ATTEMPTS = 3
export const SMS_STALE_MS = 10 * 60_000
export const SMS_DAILY_LIMIT_DEFAULT = 300
export const SMS_PER_WAITLIST_LIMIT_DEFAULT = 3
export const SMS_SINGLE_MAX_CHARS = 70

const QUIET_STATES = new Set(['skipped-disabled', 'superseded'])
export const SMS_TERMINAL = new Set(['sent', 'dry-run', 'failed', 'unknown', 'superseded', 'skipped-disabled', 'skipped-unconfigured', 'limited'])

const clampInt = (v, min, max, fallback) => {
  const n = Number(v)
  return Number.isInteger(n) ? Math.min(max, Math.max(min, n)) : fallback
}

export function normalizeSmsConfig(raw = {}) {
  const r = raw && typeof raw === 'object' ? raw : {}
  return {
    enabled: r.enabled === true,
    dryRun: r.dryRun === true,
    dailyLimit: clampInt(r.dailyLimit, 1, 5000, SMS_DAILY_LIMIT_DEFAULT),
    perWaitlistLimit: clampInt(r.perWaitlistLimit, 1, 5, SMS_PER_WAITLIST_LIMIT_DEFAULT),
    template: typeof r.template === 'string' && r.template.trim() ? r.template.trim() : DEFAULT_SMS_TEMPLATE,
    senderName: typeof r.senderName === 'string' ? r.senderName.trim() : '',
    apiHost: isAllowedEvery8dHost(r.apiHost) ? r.apiHost.toLowerCase() : EVERY8D_DEFAULT_HOST,
  }
}

export function renderSmsMessage({ template = DEFAULT_SMS_TEMPLATE, senderName = '', storeName = '', queueNumber = '' }) {
  const name = String(senderName || storeName || DEFAULT_STORE_NAME).trim()
  return String(template).replaceAll('{店名}', name).replaceAll('{號碼}', String(queueNumber ?? ''))
}

// 後台存設定前的驗證：範本必須含 {號碼}、以 4 位數號碼試算仍 ≤ 70 字（單則 1 點），不放網址（網址要先跟電信報備）。
export function validateSmsConfigPatch(patch = {}, { storeName = DEFAULT_STORE_NAME, current = {} } = {}) {
  const p = patch && typeof patch === 'object' ? patch : {}
  const out = {}
  for (const k of ['enabled', 'dryRun']) if (Object.hasOwn(p, k)) {
    if (typeof p[k] !== 'boolean') return { ok: false, error: `${k} 必須是 true／false` }
    out[k] = p[k]
  }
  if (Object.hasOwn(p, 'dailyLimit')) {
    const n = Number(p.dailyLimit)
    if (!Number.isInteger(n) || n < 1 || n > 5000) return { ok: false, error: '每日上限需為 1～5000 的整數' }
    out.dailyLimit = n
  }
  if (Object.hasOwn(p, 'perWaitlistLimit')) {
    const n = Number(p.perWaitlistLimit)
    if (!Number.isInteger(n) || n < 1 || n > 5) return { ok: false, error: '單一候位上限需為 1～5 的整數' }
    out.perWaitlistLimit = n
  }
  if (Object.hasOwn(p, 'senderName')) {
    if (typeof p.senderName !== 'string' || p.senderName.trim().length > 20) return { ok: false, error: '署名最多 20 字' }
    out.senderName = p.senderName.trim()
  }
  if (Object.hasOwn(p, 'template')) {
    if (typeof p.template !== 'string') return { ok: false, error: '範本格式不正確' }
    out.template = p.template.trim() || DEFAULT_SMS_TEMPLATE
  }
  if (Object.hasOwn(p, 'apiHost')) {
    if (!isAllowedEvery8dHost(p.apiHost)) return { ok: false, error: 'API 主機只能是 EVERY8D 網域（*.e8d.tw／*.every8d.com.tw）' }
    out.apiHost = p.apiHost.toLowerCase()
  }
  const merged = normalizeSmsConfig({ ...(current || {}), ...out })
  if (Object.hasOwn(out, 'template') || Object.hasOwn(out, 'senderName')) {
    if (!merged.template.includes('{號碼}')) return { ok: false, error: '範本必須包含 {號碼}' }
    if (/https?:\/\/|www\.|\.com|\.tw\b/i.test(merged.template)) return { ok: false, error: '範本不可放網址（需先向電信報備）' }
    const sample = renderSmsMessage({ ...merged, storeName, queueNumber: '9999' })
    if (smsCharCount(sample) > SMS_SINGLE_MAX_CHARS) return { ok: false, error: `範本試算 ${smsCharCount(sample)} 字，超過單則 ${SMS_SINGLE_MAX_CHARS} 字` }
  }
  return { ok: true, value: out }
}

// fail-closed 讀總開關。叫號交易從不呼叫這支。
export async function readSmsConfig(db) {
  let snap
  try { snap = await db.collection(SMS_CONFIG_DOC[0]).doc(SMS_CONFIG_DOC[1]).get() }
  catch (err) { return { enabled: false, reason: 'config-read-failed', error: err?.message || String(err), config: normalizeSmsConfig({}) } }
  if (!snap?.exists) return { enabled: false, reason: 'config-missing', config: normalizeSmsConfig({}) }
  const config = normalizeSmsConfig(snap.data())
  return config.enabled ? { enabled: true, reason: null, config } : { enabled: false, reason: 'disabled', config }
}

async function readStoreName(db) {
  try {
    const s = await db.collection('settings').doc('main').get()
    return String((s?.exists && s.data()?.storeName) || DEFAULT_STORE_NAME)
  } catch { return DEFAULT_STORE_NAME }
}

export const maskMobile = to => (to && to.length >= 7 ? `${to.slice(0, 4)}***${to.slice(-3)}` : '***')
const dayOf = ms => businessDate(new Date(ms).toISOString())
const iso = ms => new Date(ms).toISOString()

// 回寫候位卡片狀態：只在候位的 calledAt 仍是這封簡訊對應的那次叫號時才寫（避免舊簡訊蓋掉 return→重叫後新的一封）。
// 只 update smsStatus 一欄；waitlist 文件不存在就略過（絕不用 set merge 把已刪的候位「復活」）。
async function writeWaitlistSmsStatus(db, outbox, id, state, extra = {}, nowMs) {
  if (outbox.kind !== 'waitlist-call' || !outbox.waitlistId) return
  const ref = db.collection('waitlist').doc(outbox.waitlistId)
  try {
    await db.runTransaction(async tx => {
      const snap = await tx.get(ref)
      if (!snap.exists) return
      const w = snap.data() || {}
      if (outbox.calledAt && w.calledAt && w.calledAt !== outbox.calledAt) return
      tx.update(ref, { smsStatus: { state, outboxId: id, calledAt: outbox.calledAt || null, at: iso(nowMs), ...extra } })
    }, { maxAttempts: 5 })
  } catch (err) {
    console.error('SMS_STATUS_WRITE_FAILED', id, err?.message)
  }
}

// 條件式狀態轉移：只在文件仍是 expected 狀態時才改（與另一個 worker 競爭時不互蓋）。
async function transition(db, ref, expected, patch) {
  return db.runTransaction(async tx => {
    const snap = await tx.get(ref)
    if (!snap.exists) return null
    const cur = snap.data()
    if (cur.status !== expected.status) return null
    if (Object.hasOwn(expected, 'claimToken') && cur.claimToken !== expected.claimToken) return null
    tx.update(ref, patch)
    return { ...cur, ...patch }
  }, { maxAttempts: 5 })
}

async function safeAlert(alert, text) {
  try { await alert?.(text) } catch (err) { console.error('SMS_ALERT_FAILED', err?.message) }
}

// 同一天同一類告警只發一次（每日上限／帳密未設定這種會連續觸發的）。
async function alertOncePerDay(db, alert, nowMs, key, text) {
  const ref = db.collection(SMS_COUNTERS).doc(dayOf(nowMs))
  let first = false
  try {
    await db.runTransaction(async tx => {
      const snap = await tx.get(ref)
      const data = snap.exists ? snap.data() : {}
      if (data?.alerts?.[key]) return
      first = true
      tx.set(ref, { ...data, alerts: { ...(data?.alerts || {}), [key]: iso(nowMs) }, updatedAt: iso(nowMs) })
    }, { maxAttempts: 5 })
  } catch { first = true }
  if (first) await safeAlert(alert, text)
}

const label = o => (o.kind === 'test' ? '測試簡訊' : `候位 #${o.queueNumber ?? '?'}`)

// 處理單一 outbox。deps：
//   fetchImpl     — 注入的 fetch（測試一律 mock）
//   credentials   — every8dCredentials(uid,pwd) 的結果；null＝未設定
//   alert(text)   — 店員群組告警（index.js 接 tgSend）
//   clock()       — 現在毫秒（測試可控）
export async function processSmsOutbox({ db, id, fetchImpl, credentials, alert, clock = Date.now }) {
  const ref = db.collection(SMS_OUTBOX).doc(id)
  const snap = await ref.get()
  if (!snap.exists) return { id, status: 'missing' }
  const o = snap.data()
  let nowMs = clock()
  if (SMS_TERMINAL.has(o.status)) return { id, status: o.status, noop: true }

  if (o.status === 'processing') {
    if (Date.parse(o.leaseUntil || 0) > nowMs) return { id, status: 'processing', noop: true }
    // 上一個 worker 在送出途中消失：可能已送出，也可能沒有 → 不重送，交給店員打電話。
    const done = await transition(db, ref, { status: 'processing', claimToken: o.claimToken }, { status: 'unknown', error: 'lease-expired', finishedAt: iso(nowMs), updatedAt: iso(nowMs) })
    if (!done) return { id, status: 'raced' }
    await writeWaitlistSmsStatus(db, o, id, 'unknown', {}, nowMs)
    await safeAlert(alert, `⚠️ 叫號簡訊狀態不明（${label(o)}，${maskMobile(o.to)}）：送出途中中斷，未重送。請改打電話或喊號。`)
    return { id, status: 'unknown' }
  }
  if (o.status !== 'pending') return { id, status: o.status, noop: true }
  if (o.nextAttemptAt && Date.parse(o.nextAttemptAt) > nowMs) return { id, status: 'pending', notDue: true }

  const finishFromPending = async (status, patch = {}, smsExtra = {}) => {
    const done = await transition(db, ref, { status: 'pending' }, { status, ...patch, finishedAt: iso(nowMs), updatedAt: iso(nowMs) })
    if (!done) return { id, status: 'raced' }
    // 開關關閉／已過時：卡片本來就不顯示，完全不碰 waitlist 文件（預設關閉時叫號路徑零額外寫入）。
    if (!QUIET_STATES.has(status)) await writeWaitlistSmsStatus(db, o, id, status, smsExtra, nowMs)
    return { id, status, ...patch }
  }

  const cfg = await readSmsConfig(db)
  if (!cfg.enabled) return finishFromPending('skipped-disabled', { reason: cfg.reason })

  // 過時判斷：叫號超過 10 分鐘（含重試期間）就不送。
  const anchor = o.kind === 'test' ? o.createdAt : o.calledAt
  if (!anchor || nowMs - Date.parse(anchor) > SMS_STALE_MS) return finishFromPending('superseded', { reason: 'stale' })
  if (o.kind === 'waitlist-call') {
    let w
    try {
      const ws = await db.collection('waitlist').doc(o.waitlistId).get()
      w = ws.exists ? ws.data() : null
    } catch (err) {
      return { id, status: 'pending', error: 'waitlist-read-failed' } // 暫時讀不到：留 pending，sweeper 下一輪再試（仍受 10 分鐘限制）
    }
    if (!w) return finishFromPending('superseded', { reason: 'waitlist-missing' })
    if (w.status !== 'called') return finishFromPending('superseded', { reason: `waitlist-${w.status}` })
    if (w.calledAt !== o.calledAt) return finishFromPending('superseded', { reason: 'called-again' })
  }
  const to = normalizeTwMobile(o.to)
  if (!to) return finishFromPending('failed', { error: 'invalid-mobile' })

  const dry = cfg.config.dryRun
  if (!dry && !credentials) {
    const r = await finishFromPending('skipped-unconfigured', { reason: 'credentials-unset' })
    await alertOncePerDay(db, alert, nowMs, 'unconfigured', '⚠️ 叫號簡訊總開關已開，但 EVERY8D 帳密尚未設定（UNSET），簡訊沒有送出。請改喊號／打電話，並請店長檢查設定。')
    return r
  }

  const storeName = await readStoreName(db)
  const message = renderSmsMessage({ ...cfg.config, storeName, queueNumber: o.kind === 'test' ? '0' : o.queueNumber })
  const credits = smsCredits(message)
  if (credits === null) return finishFromPending('failed', { error: 'message-too-long' })

  // claim：同一筆交易內檢查上限並遞增計數、把 outbox 標成 processing（lease）。
  const mode = dry ? 'dry' : 'live'
  const counterRef = db.collection(SMS_COUNTERS).doc(dayOf(nowMs))
  const claimToken = crypto.randomBytes(8).toString('hex')
  const claim = await db.runTransaction(async tx => {
    const [cur, cnt] = await Promise.all([tx.get(ref), tx.get(counterRef)])
    if (!cur.exists) return { raced: true }
    const c = cur.data()
    if (c.status !== 'pending' || (c.nextAttemptAt || null) !== (o.nextAttemptAt || null)) return { raced: true }
    const counters = cnt.exists ? cnt.data() : {}
    const bucket = { total: 0, perWaitlist: {}, ...(counters[mode] || {}) }
    const attempts = (c.attempts || 0) + 1
    if (attempts === 1) {
      let limited = null
      if (bucket.total >= cfg.config.dailyLimit) limited = 'daily-limit'
      else if (c.kind === 'waitlist-call' && (bucket.perWaitlist?.[c.waitlistId] || 0) >= cfg.config.perWaitlistLimit) limited = 'per-waitlist-limit'
      if (limited) {
        tx.update(ref, { status: 'limited', reason: limited, finishedAt: iso(nowMs), updatedAt: iso(nowMs) })
        return { limited }
      }
      const perWaitlist = { ...(bucket.perWaitlist || {}) }
      if (c.kind === 'waitlist-call') perWaitlist[c.waitlistId] = (perWaitlist[c.waitlistId] || 0) + 1
      tx.set(counterRef, { ...counters, [mode]: { total: bucket.total + 1, perWaitlist }, updatedAt: iso(nowMs) })
    }
    tx.update(ref, { status: 'processing', attempts, claimToken, mode, leaseUntil: iso(nowMs + SMS_LEASE_MS), claimedAt: iso(nowMs), message, credits, updatedAt: iso(nowMs) })
    return { attempts }
  })
  if (claim.raced) return { id, status: 'raced' }
  if (claim.limited) {
    await writeWaitlistSmsStatus(db, o, id, 'limited', {}, nowMs)
    if (claim.limited === 'daily-limit') await alertOncePerDay(db, alert, nowMs, 'daily-limit', `⚠️ 叫號簡訊已達今日上限（${cfg.config.dailyLimit} 封），之後的叫號不再發簡訊。請改喊號／打電話。`)
    else await safeAlert(alert, `⚠️ ${label(o)} 已達單一候位簡訊上限（${cfg.config.perWaitlistLimit} 封），這次未發送。`)
    return { id, status: 'limited', reason: claim.limited }
  }

  const finishFromProcessing = async (status, patch = {}, smsExtra = {}) => {
    nowMs = clock()
    const done = await transition(db, ref, { status: 'processing', claimToken }, { status, ...patch, leaseUntil: null, finishedAt: iso(nowMs), updatedAt: iso(nowMs) })
    // 被 sweeper 搶先標成 unknown（lease 過期）也沒關係：我們知道真實結果，直接覆寫成真實結果。
    if (!done) {
      try { await ref.update({ status, ...patch, leaseUntil: null, finishedAt: iso(nowMs), updatedAt: iso(nowMs) }) } catch (err) { console.error('SMS_FINAL_WRITE_FAILED', id, err?.message) }
    }
    await writeWaitlistSmsStatus(db, o, id, status, smsExtra, nowMs)
    return { id, status, ...patch }
  }

  if (dry) return finishFromProcessing('dry-run', { dryRunTo: to, dryRunMessage: message })

  const result = await sendEvery8dSms({ fetchImpl, host: cfg.config.apiHost, credentials, to, message })
  if (result.outcome === 'sent') return finishFromProcessing('sent', { batchId: result.batchId || null, credit: result.credit ?? null, cost: result.cost ?? null, sentAt: iso(clock()) })
  if (result.outcome === 'unknown') {
    const r = await finishFromProcessing('unknown', { error: result.error, errorCode: result.code })
    await safeAlert(alert, `⚠️ 叫號簡訊狀態不明（${label(o)}，${maskMobile(to)}）：${result.error}。未重送，請改打電話或喊號。`)
    return r
  }
  if (result.retryable && claim.attempts < SMS_MAX_ATTEMPTS) {
    nowMs = clock()
    const next = iso(nowMs + SMS_BACKOFF_MS[Math.min(claim.attempts - 1, SMS_BACKOFF_MS.length - 1)])
    const done = await transition(db, ref, { status: 'processing', claimToken }, { status: 'pending', nextAttemptAt: next, leaseUntil: null, lastError: result.error, errorCode: result.code, updatedAt: iso(nowMs) })
    if (done) await writeWaitlistSmsStatus(db, o, id, 'retrying', { attempts: claim.attempts }, nowMs)
    return { id, status: 'pending', retryAt: next, error: result.error }
  }
  const r = await finishFromProcessing('failed', { error: result.error, errorCode: result.code })
  await safeAlert(alert, `❌ 叫號簡訊失敗（${label(o)}，${maskMobile(to)}）：${result.error}。請改打電話或喊號。`)
  return r
}

// 依序處理多筆（sweeper／kick 共用）。單筆出錯不影響其他筆。
export async function processSmsBatch({ db, ids, ...deps }) {
  const results = []
  for (const id of ids) {
    try { results.push(await processSmsOutbox({ db, id, ...deps })) }
    catch (err) { console.error('SMS_PROCESS_FAILED', id, err?.message); results.push({ id, status: 'error', error: err?.message || 'process-failed' }) }
  }
  return results
}

// smsKick：只處理這個候位的 outbox（單欄位等值查詢，不需複合索引）。
export async function kickWaitlistSms({ db, waitlistId, ...deps }) {
  const snap = await db.collection(SMS_OUTBOX).where('waitlistId', '==', waitlistId).get()
  const ids = snap.docs.filter(d => ['pending', 'processing'].includes(d.data().status)).map(d => d.id)
  return processSmsBatch({ db, ids, ...deps })
}

// smsSweeper：撿 pending／processing（lease 過期的會被標 unknown，不重送）。
export async function sweepSmsOutbox({ db, limit = 50, ...deps }) {
  const snap = await db.collection(SMS_OUTBOX).where('status', 'in', ['pending', 'processing']).limit(limit).get()
  return processSmsBatch({ db, ids: snap.docs.map(d => d.id), ...deps })
}

// 後台「發測試簡訊」：同樣受總開關／dryRun／每日上限約束；留一筆 kind:'test' 的 outbox 當紀錄。
export async function sendTestSms({ db, to, actor = '', clock = Date.now, ...deps }) {
  const mobile = normalizeTwMobile(to)
  if (!mobile) return { ok: false, status: 'invalid-mobile', error: '請輸入 09 開頭的 10 碼手機' }
  const nowMs = clock()
  const id = 'test_' + crypto.randomBytes(12).toString('hex')
  await db.collection(SMS_OUTBOX).doc(id).set({ kind: 'test', to: mobile, status: 'pending', attempts: 0, nextAttemptAt: null, calledAt: null, requestedBy: actor, createdAt: iso(nowMs), updatedAt: iso(nowMs) })
  const result = await processSmsOutbox({ db, id, clock, ...deps })
  return { ok: ['sent', 'dry-run'].includes(result.status), ...result }
}

export async function readSmsCounters(db, nowMs = Date.now()) {
  try {
    const s = await db.collection(SMS_COUNTERS).doc(dayOf(nowMs)).get()
    const d = s.exists ? s.data() : {}
    return { day: dayOf(nowMs), live: d.live?.total || 0, dry: d.dry?.total || 0 }
  } catch { return { day: dayOf(nowMs), live: null, dry: null } }
}
