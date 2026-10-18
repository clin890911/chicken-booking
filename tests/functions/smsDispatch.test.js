import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  processSmsOutbox, kickWaitlistSms, sweepSmsOutbox, sendTestSms, readSmsConfig, normalizeSmsConfig,
  validateSmsConfigPatch, renderSmsMessage, DEFAULT_SMS_TEMPLATE, SMS_LEASE_MS, SMS_STALE_MS,
} from '../../functions/lib/smsDispatch.js'
import { every8dCredentials } from '../../functions/lib/every8d.js'

// In-memory Firestore（只實作 dispatcher 用到的 API）；交易內「寫後再讀」直接 throw。HTTP 一律 mock。
const clone = v => (v === undefined ? v : structuredClone(v))
function fakeDb({ failConfigRead = false } = {}) {
  const records = new Map()
  const docRef = (col, id) => {
    const path = `${col}/${id}`
    return {
      path, id,
      get: async () => {
        if (failConfigRead && col === 'system') throw Error('firestore-unavailable')
        return { exists: records.has(path), id, data: () => clone(records.get(path)) }
      },
      set: async (d, opt) => { records.set(path, opt?.merge ? { ...(records.get(path) || {}), ...clone(d) } : clone(d)) },
      update: async d => { if (!records.has(path)) throw Error('NOT_FOUND'); records.set(path, { ...records.get(path), ...clone(d) }) },
    }
  }
  const query = (col, filters = [], lim = Infinity) => ({
    where: (f, op, v) => query(col, [...filters, [f, op, v]], lim),
    limit: n => query(col, filters, n),
    get: async () => ({ docs: [...records].filter(([p]) => p.startsWith(col + '/') && p.split('/').length === 2)
      .filter(([, v]) => filters.every(([f, op, val]) => (op === '==' ? v[f] === val : val.includes(v[f]))))
      .slice(0, lim).map(([p, v]) => ({ id: p.split('/')[1], data: () => clone(v) })) }),
  })
  const db = {
    collection: col => ({ doc: id => docRef(col, id), where: (...a) => query(col).where(...a), limit: n => query(col).limit(n) }),
    runTransaction: async fn => {
      const staged = []; let writing = false
      const tx = {
        get: async r => { if (writing) throw Error('read-after-write'); return r.get() },
        set: (r, d) => { writing = true; staged.push(['set', r, d]) },
        update: (r, d) => { writing = true; staged.push(['update', r, d]) },
      }
      const out = await fn(tx)
      for (const [k, r, d] of staged) {
        if (k === 'set') records.set(r.path, clone(d))
        else { if (!records.has(r.path)) throw Error('NOT_FOUND'); records.set(r.path, { ...records.get(r.path), ...clone(d) }) }
      }
      return out
    },
  }
  return { db, records }
}

const T0 = Date.parse('2026-10-18T04:00:00.000Z')
const CALLED = new Date(T0).toISOString()
const creds = every8dCredentials('test-uid', 'test-pwd')
const okFetch = () => vi.fn(async () => ({ ok: true, status: 200, text: async () => '9999.00,1,1,0,BATCH-1' }))
let clockMs
const clock = () => clockMs

function seedCall(records, { id = 'W1', outboxId = 'wl_call_1', status = 'called', calledAt = CALLED, queueNumber = 12, to = '0912345678', outbox = {} } = {}) {
  records.set(`waitlist/${id}`, { id, status, calledAt, queueNumber, queueVersion: 2, phone: to, serverManaged: true })
  records.set(`smsOutbox/${outboxId}`, { kind: 'waitlist-call', waitlistId: id, commandId: 'cmd_00000001', queueNumber, calledAt, to, status: 'pending', attempts: 0, nextAttemptAt: null, createdAt: calledAt, ...outbox })
}
const enable = (records, extra = {}) => records.set('system/smsConfig', { enabled: true, ...extra })
const run = (db, id, deps = {}) => processSmsOutbox({ db, id, clock, fetchImpl: deps.fetchImpl || okFetch(), credentials: Object.hasOwn(deps, 'credentials') ? deps.credentials : creds, alert: deps.alert || vi.fn() })

beforeEach(() => { clockMs = T0 + 1000 })

describe('總開關 fail-closed：預設關閉', () => {
  it('normalizeSmsConfig({}) 預設 enabled:false、dryRun:false、上限 300／3', () => {
    expect(normalizeSmsConfig({})).toMatchObject({ enabled: false, dryRun: false, dailyLimit: 300, perWaitlistLimit: 3, template: DEFAULT_SMS_TEMPLATE, apiHost: 'new.e8d.tw' })
    expect(normalizeSmsConfig({ enabled: 'true' }).enabled).toBe(false) // 只認 boolean true
  })
  it.each([
    ['文件不存在', {}, null],
    ['enabled:false', {}, { enabled: false }],
    ['enabled 非 boolean', {}, { enabled: 1 }],
    ['讀取失敗', { failConfigRead: true }, { enabled: true }],
  ])('%s → skipped-disabled、不呼叫 HTTP', async (_, opts, cfg) => {
    const { db, records } = fakeDb(opts); seedCall(records)
    if (cfg) records.set('system/smsConfig', cfg)
    const fetchImpl = okFetch()
    const r = await run(db, 'wl_call_1', { fetchImpl })
    expect(r.status).toBe('skipped-disabled')
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(records.get('smsOutbox/wl_call_1').status).toBe('skipped-disabled')
    expect(records.get('waitlist/W1')).not.toHaveProperty('smsStatus') // 開關關閉：完全不碰 waitlist 文件
    expect(records.get('waitlist/W1').queueVersion).toBe(2)
  })
  it('readSmsConfig 讀取失敗回 enabled:false（不 throw）', async () => {
    const { db } = fakeDb({ failConfigRead: true })
    expect(await readSmsConfig(db)).toMatchObject({ enabled: false, reason: 'config-read-failed' })
  })
  it('關閉時 skipped 是終態：之後再打開也不會補發過去的叫號', async () => {
    const { db, records } = fakeDb(); seedCall(records)
    await run(db, 'wl_call_1')
    enable(records)
    const fetchImpl = okFetch()
    expect((await run(db, 'wl_call_1', { fetchImpl })).noop).toBe(true)
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

describe('帳密未設定（UNSET）不送', () => {
  it('開關開、帳密 UNSET → skipped-unconfigured、不呼叫 HTTP、同一天只告警一次', async () => {
    const { db, records } = fakeDb(); enable(records)
    seedCall(records); seedCall(records, { id: 'W2', outboxId: 'wl_call_2' })
    const fetchImpl = okFetch(), alert = vi.fn()
    const credentials = every8dCredentials('UNSET', 'UNSET')
    expect(credentials).toBeNull()
    expect((await run(db, 'wl_call_1', { fetchImpl, alert, credentials })).status).toBe('skipped-unconfigured')
    expect((await run(db, 'wl_call_2', { fetchImpl, alert, credentials })).status).toBe('skipped-unconfigured')
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(alert).toHaveBeenCalledTimes(1)
  })
})

describe('dryRun：不呼叫 EVERY8D，只記錄將送出的內容', () => {
  it('沒有帳密也能乾跑；記下內容與門號；smsStatus=dry-run；不動 queueVersion', async () => {
    const { db, records } = fakeDb(); enable(records, { dryRun: true }); seedCall(records)
    records.set('settings/main', { storeName: '雞王涮涮鍋' })
    const fetchImpl = okFetch()
    const r = await run(db, 'wl_call_1', { fetchImpl, credentials: null })
    expect(r.status).toBe('dry-run')
    expect(fetchImpl).not.toHaveBeenCalled()
    const o = records.get('smsOutbox/wl_call_1')
    expect(o).toMatchObject({ status: 'dry-run', dryRunTo: '0912345678', mode: 'dry', credits: 1, attempts: 1 })
    expect(o.dryRunMessage).toBe('【雞王涮涮鍋】您的候位 #12 已可入座，請於 10 分鐘內至櫃台報到。')
    expect(records.get('waitlist/W1')).toMatchObject({ queueVersion: 2, status: 'called', smsStatus: { state: 'dry-run', outboxId: 'wl_call_1', calledAt: CALLED } })
  })
})

describe('過時判斷 superseded（送前重讀 waitlist）', () => {
  it.each([
    ['已入座', { status: 'seated' }, 'waitlist-seated'],
    ['已棄號', { status: 'left' }, 'waitlist-left'],
    ['暫過號', { status: 'skipped' }, 'waitlist-skipped'],
  ])('%s → superseded、不送', async (_, patch, reason) => {
    const { db, records } = fakeDb(); enable(records); seedCall(records)
    records.set('waitlist/W1', { ...records.get('waitlist/W1'), ...patch })
    const fetchImpl = okFetch()
    expect(await run(db, 'wl_call_1', { fetchImpl })).toMatchObject({ status: 'superseded', reason })
    expect(fetchImpl).not.toHaveBeenCalled()
  })
  it('calledAt 對不上（回來了之後又重叫）→ superseded，且不蓋掉新一次叫號的 smsStatus', async () => {
    const { db, records } = fakeDb(); enable(records); seedCall(records)
    records.set('waitlist/W1', { ...records.get('waitlist/W1'), calledAt: '2026-10-18T04:00:30.000Z', smsStatus: { state: 'sent', outboxId: 'newer' } })
    const fetchImpl = okFetch()
    expect(await run(db, 'wl_call_1', { fetchImpl })).toMatchObject({ status: 'superseded', reason: 'called-again' })
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(records.get('waitlist/W1').smsStatus).toEqual({ state: 'sent', outboxId: 'newer' })
  })
  it('叫號超過 10 分鐘 → superseded（stale）', async () => {
    const { db, records } = fakeDb(); enable(records); seedCall(records)
    clockMs = T0 + SMS_STALE_MS + 1
    const fetchImpl = okFetch()
    expect(await run(db, 'wl_call_1', { fetchImpl })).toMatchObject({ status: 'superseded', reason: 'stale' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })
  it('superseded 不回寫 waitlist（卡片本來就不顯示，少一次寫入）', async () => {
    const { db, records } = fakeDb(); enable(records); seedCall(records)
    records.set('waitlist/W1', { ...records.get('waitlist/W1'), status: 'seated' })
    await run(db, 'wl_call_1')
    expect(records.get('waitlist/W1')).not.toHaveProperty('smsStatus')
  })
  it('候位已被刪 → superseded，且不會用 smsStatus 把候位「復活」', async () => {
    const { db, records } = fakeDb(); enable(records); seedCall(records)
    records.delete('waitlist/W1')
    expect((await run(db, 'wl_call_1')).status).toBe('superseded')
    expect(records.has('waitlist/W1')).toBe(false)
  })
})

describe('at-most-once：結果不明不重送', () => {
  it('lease 過期的 processing → unknown、不呼叫 HTTP、告警', async () => {
    const { db, records } = fakeDb(); enable(records)
    seedCall(records, { outbox: { status: 'processing', attempts: 1, claimToken: 'x', leaseUntil: new Date(T0 + SMS_LEASE_MS).toISOString() } })
    clockMs = T0 + SMS_LEASE_MS + 1
    const fetchImpl = okFetch(), alert = vi.fn()
    expect((await run(db, 'wl_call_1', { fetchImpl, alert })).status).toBe('unknown')
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(alert).toHaveBeenCalledTimes(1)
    expect(records.get('waitlist/W1').smsStatus.state).toBe('unknown')
    // 之後 sweeper 再跑也不會重送
    expect((await run(db, 'wl_call_1', { fetchImpl })).noop).toBe(true)
    expect(fetchImpl).not.toHaveBeenCalled()
  })
  it('lease 未過期的 processing → 不動（另一個 worker 正在送）', async () => {
    const { db, records } = fakeDb(); enable(records)
    seedCall(records, { outbox: { status: 'processing', attempts: 1, claimToken: 'x', leaseUntil: new Date(T0 + SMS_LEASE_MS).toISOString() } })
    const fetchImpl = okFetch()
    expect(await run(db, 'wl_call_1', { fetchImpl })).toMatchObject({ status: 'processing', noop: true })
    expect(fetchImpl).not.toHaveBeenCalled()
  })
  it('EVERY8D 逾時 → unknown、只呼叫一次、不重試', async () => {
    const { db, records } = fakeDb(); enable(records); seedCall(records)
    const fetchImpl = vi.fn(async () => { throw Object.assign(Error('aborted'), { name: 'AbortError' }) })
    const alert = vi.fn()
    expect((await run(db, 'wl_call_1', { fetchImpl, alert })).status).toBe('unknown')
    clockMs += 120_000
    await run(db, 'wl_call_1', { fetchImpl })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(alert).toHaveBeenCalledTimes(1)
  })
  it('送出前先 claim 成 processing（HTTP 呼叫期間文件是 processing、有 lease）', async () => {
    const { db, records } = fakeDb(); enable(records); seedCall(records)
    let during
    const fetchImpl = vi.fn(async () => { during = structuredClone(records.get('smsOutbox/wl_call_1')); return { ok: true, status: 200, text: async () => '1.00,1,1,0,B' } })
    await run(db, 'wl_call_1', { fetchImpl })
    expect(during).toMatchObject({ status: 'processing', attempts: 1 })
    expect(Date.parse(during.leaseUntil)).toBe(T0 + 1000 + SMS_LEASE_MS)
  })
})

describe('短退避與 3 次上限（只對「確定沒送出」的錯誤）', () => {
  it('-99 → 15 秒後重試 → 45 秒後重試 → 第 3 次仍失敗標 failed＋告警', async () => {
    const { db, records } = fakeDb(); enable(records); seedCall(records)
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, text: async () => '-99,發生不明錯誤' }))
    const alert = vi.fn()
    const r1 = await run(db, 'wl_call_1', { fetchImpl, alert })
    expect(r1.status).toBe('pending')
    expect(Date.parse(r1.retryAt)).toBe(clockMs + 15_000)
    expect(records.get('waitlist/W1').smsStatus).toMatchObject({ state: 'retrying', attempts: 1 })
    expect((await run(db, 'wl_call_1', { fetchImpl, alert })).notDue).toBe(true) // 還沒到時間
    clockMs += 15_000
    const r2 = await run(db, 'wl_call_1', { fetchImpl, alert })
    expect(Date.parse(r2.retryAt)).toBe(clockMs + 45_000)
    clockMs += 45_000
    expect((await run(db, 'wl_call_1', { fetchImpl, alert })).status).toBe('failed')
    expect(fetchImpl).toHaveBeenCalledTimes(3)
    expect(alert).toHaveBeenCalledTimes(1)
    expect(records.get('waitlist/W1').smsStatus.state).toBe('failed')
    clockMs += 60_000
    await run(db, 'wl_call_1', { fetchImpl, alert })
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })
  it('帳密錯（-2）→ 直接 failed、不重試', async () => {
    const { db, records } = fakeDb(); enable(records); seedCall(records)
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, text: async () => '-2,帳號或密碼錯誤' }))
    expect((await run(db, 'wl_call_1', { fetchImpl })).status).toBe('failed')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(records.get('smsOutbox/wl_call_1')).toMatchObject({ status: 'failed', errorCode: '-2' })
  })
})

describe('成功送出', () => {
  it('sent：記 batchId；smsStatus=sent；waitlist 其他欄位與 queueVersion 不變', async () => {
    const { db, records } = fakeDb(); enable(records); seedCall(records)
    const before = structuredClone(records.get('waitlist/W1'))
    const fetchImpl = okFetch()
    expect((await run(db, 'wl_call_1', { fetchImpl })).status).toBe('sent')
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe('https://new.e8d.tw/API21/HTTP/SendSMS.ashx')
    const body = Object.fromEntries(new URLSearchParams(init.body))
    expect(body).toMatchObject({ DEST: '0912345678', UID: 'test-uid' })
    expect(body.MSG).toContain('#12')
    expect(records.get('smsOutbox/wl_call_1')).toMatchObject({ status: 'sent', batchId: 'BATCH-1', attempts: 1 })
    const { smsStatus, ...rest } = records.get('waitlist/W1')
    expect(rest).toEqual(before)
    expect(smsStatus).toMatchObject({ state: 'sent', outboxId: 'wl_call_1' })
  })
})

describe('每日上限與單一候位上限', () => {
  it('dailyLimit=1：第二封 limited、不呼叫 HTTP、告警一次', async () => {
    const { db, records } = fakeDb(); enable(records, { dailyLimit: 1 })
    seedCall(records); seedCall(records, { id: 'W2', outboxId: 'wl_call_2' }); seedCall(records, { id: 'W3', outboxId: 'wl_call_3' })
    const fetchImpl = okFetch(), alert = vi.fn()
    expect((await run(db, 'wl_call_1', { fetchImpl, alert })).status).toBe('sent')
    expect(await run(db, 'wl_call_2', { fetchImpl, alert })).toMatchObject({ status: 'limited', reason: 'daily-limit' })
    expect((await run(db, 'wl_call_3', { fetchImpl, alert })).status).toBe('limited')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(alert).toHaveBeenCalledTimes(1)
    expect(records.get('waitlist/W2').smsStatus.state).toBe('limited')
  })
  it('同一候位最多 3 封（return→重叫第 4 次不發）', async () => {
    const { db, records } = fakeDb(); enable(records)
    const fetchImpl = okFetch()
    for (let i = 1; i <= 4; i++) {
      const calledAt = new Date(T0 + i * 1000).toISOString()
      clockMs = T0 + i * 1000 + 500
      seedCall(records, { outboxId: `wl_call_${i}`, calledAt })
      const r = await run(db, `wl_call_${i}`, { fetchImpl })
      expect(r.status).toBe(i <= 3 ? 'sent' : 'limited')
    }
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })
  it('乾跑與真送分開計數（乾跑測試不吃掉真送額度）', async () => {
    const { db, records } = fakeDb(); enable(records, { dryRun: true, dailyLimit: 1 })
    seedCall(records)
    expect((await run(db, 'wl_call_1')).status).toBe('dry-run')
    enable(records, { dryRun: false, dailyLimit: 1 })
    seedCall(records, { id: 'W2', outboxId: 'wl_call_2' })
    expect((await run(db, 'wl_call_2')).status).toBe('sent')
  })
})

describe('kick／sweeper／測試簡訊', () => {
  it('kickWaitlistSms 只處理該候位的 outbox', async () => {
    const { db, records } = fakeDb(); enable(records)
    seedCall(records); seedCall(records, { id: 'W2', outboxId: 'wl_call_2' })
    const fetchImpl = okFetch()
    const results = await kickWaitlistSms({ db, waitlistId: 'W1', clock, fetchImpl, credentials: creds, alert: vi.fn() })
    expect(results.map(r => r.id)).toEqual(['wl_call_1'])
    expect(records.get('smsOutbox/wl_call_2').status).toBe('pending')
  })
  it('sweeper 撿 pending 與 processing；單筆出錯不影響其他筆', async () => {
    const { db, records } = fakeDb(); enable(records)
    seedCall(records); seedCall(records, { id: 'W2', outboxId: 'wl_call_2' })
    records.set('smsOutbox/done', { status: 'sent' })
    let n = 0
    const fetchImpl = vi.fn(async () => { if (n++ === 0) throw Error('boom-not-network'); return { ok: true, status: 200, text: async () => '1.00,1,1,0,B' } })
    const results = await sweepSmsOutbox({ db, clock, fetchImpl, credentials: creds, alert: vi.fn() })
    expect(results.map(r => r.status).sort()).toEqual(['sent', 'unknown'])
  })
  it('測試簡訊也受開關／dryRun 約束，號碼必須是手機', async () => {
    const { db, records } = fakeDb()
    const fetchImpl = okFetch()
    expect((await sendTestSms({ db, to: '049-2753377', clock, fetchImpl, credentials: creds })).status).toBe('invalid-mobile')
    expect((await sendTestSms({ db, to: '0912345678', clock, fetchImpl, credentials: creds })).status).toBe('skipped-disabled')
    enable(records, { dryRun: true })
    const dry = await sendTestSms({ db, to: '0912345678', clock, fetchImpl, credentials: null })
    expect(dry).toMatchObject({ ok: true, status: 'dry-run' })
    expect(dry.dryRunMessage).toContain('雞王涮涮鍋')
    expect(fetchImpl).not.toHaveBeenCalled()
    enable(records)
    expect((await sendTestSms({ db, to: '+886912345678', clock, fetchImpl, credentials: creds })).status).toBe('sent')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
  it('告警函式本身壞掉也不會讓處理流程 throw', async () => {
    const { db, records } = fakeDb(); enable(records); seedCall(records)
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, text: async () => '-2,x' }))
    const alert = vi.fn(async () => { throw Error('telegram-down') })
    expect((await run(db, 'wl_call_1', { fetchImpl, alert })).status).toBe('failed')
  })
})

describe('設定驗證', () => {
  it('預設範本以 4 位數號碼試算仍 ≤70 字', () => {
    const msg = renderSmsMessage({ storeName: '雞王涮涮鍋', queueNumber: '9999' })
    expect([...msg].length).toBeLessThanOrEqual(70)
    expect(validateSmsConfigPatch({ template: DEFAULT_SMS_TEMPLATE })).toEqual({ ok: true, value: { template: DEFAULT_SMS_TEMPLATE } })
  })
  it('擋：缺 {號碼}、含網址、超過 70 字、非 EVERY8D 主機、型別錯', () => {
    expect(validateSmsConfigPatch({ template: '【{店名}】請入座' }).ok).toBe(false)
    expect(validateSmsConfigPatch({ template: '#{號碼} 請看 https://x.tw' }).ok).toBe(false)
    expect(validateSmsConfigPatch({ template: '#{號碼}' + '字'.repeat(70) }).ok).toBe(false)
    expect(validateSmsConfigPatch({ apiHost: 'evil.com' }).ok).toBe(false)
    expect(validateSmsConfigPatch({ enabled: 'yes' }).ok).toBe(false)
    expect(validateSmsConfigPatch({ dailyLimit: 0 }).ok).toBe(false)
  })
  it('只改署名時，以目前範本試算字數', () => {
    expect(validateSmsConfigPatch({ senderName: '很長的店名'.repeat(4) }, { current: { template: '{店名}#{號碼}' + '字'.repeat(50) } }).ok).toBe(false)
    expect(validateSmsConfigPatch({ senderName: '雞王' }, { current: {} }).ok).toBe(true)
  })
})
