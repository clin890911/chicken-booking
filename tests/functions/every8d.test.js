import { describe, it, expect, vi } from 'vitest'
import {
  every8dCredentials, smsCharCount, smsCredits, buildSendSmsRequest, parseSendSmsResponse,
  classifyHttpStatus, classifyFetchError, sendEvery8dSms, isAllowedEvery8dHost, EVERY8D_TIMEOUT_MS,
} from '../../functions/lib/every8d.js'

const creds = { uid: 'test-uid', pwd: 'test-pwd' }

describe('EVERY8D 帳密：空值或 UNSET 視為未設定', () => {
  it.each([['', ''], ['UNSET', 'UNSET'], ['uid', 'UNSET'], ['UNSET', 'pwd'], ['  ', 'pwd'], [undefined, undefined], ['unset', 'x']])('%s / %s → null', (u, p) => {
    expect(every8dCredentials(u, p)).toBeNull()
  })
  it('有值才回傳（去頭尾空白）', () => expect(every8dCredentials(' a ', ' b\n')).toEqual({ uid: 'a', pwd: 'b' }))
})

describe('字數與扣點', () => {
  it('中文、全形標點都算 1 字；預設叫號範本 ≤70 字＝1 點', () => {
    const msg = '【雞王涮涮鍋】您的候位 #9999 已可入座，請於 10 分鐘內至櫃台報到。'
    expect(smsCharCount(msg)).toBeLessThanOrEqual(70)
    expect(smsCredits(msg)).toBe(1)
  })
  it.each([[0, 0], [1, 1], [70, 1], [71, 2], [134, 2], [135, 3], [201, 3], [202, 4], [268, 4], [269, 5], [333, 5], [334, null]])('%i 字 → %s 點', (n, credits) => {
    expect(smsCredits('字'.repeat(n))).toBe(credits)
  })
})

describe('組請求', () => {
  it('POST form-urlencoded 到 API21/HTTP/SendSMS.ashx，帶 UID/PWD/MSG/DEST、立即發送、有效 10 分鐘', () => {
    const { url, init } = buildSendSmsRequest({ credentials: creds, to: '0912345678', message: '【雞王】#12 請入座' })
    expect(url).toBe('https://new.e8d.tw/API21/HTTP/SendSMS.ashx')
    expect(init.method).toBe('POST')
    expect(init.headers['Content-Type']).toMatch(/application\/x-www-form-urlencoded/)
    const body = new URLSearchParams(init.body)
    expect(Object.fromEntries(body)).toMatchObject({ UID: 'test-uid', PWD: 'test-pwd', DEST: '0912345678', MSG: '【雞王】#12 請入座', ST: '', RETRYTIME: '10' })
  })
  it('只允許 EVERY8D 網域（防設定被改去送帳密到別處）', () => {
    expect(isAllowedEvery8dHost('new.e8d.tw')).toBe(true)
    expect(isAllowedEvery8dHost('api.every8d.com.tw')).toBe(true)
    for (const h of ['evil.com', 'new.e8d.tw.evil.com', 'fakee8d.tw', 'e8d.tw/../x', '', null]) expect(isAllowedEvery8dHost(h)).toBe(false)
    expect(() => buildSendSmsRequest({ host: 'evil.com', credentials: creds, to: '0912345678', message: 'x' })).toThrow('every8d-host-not-allowed')
    expect(() => buildSendSmsRequest({ credentials: null, to: '0912345678', message: 'x' })).toThrow('every8d-not-configured')
  })
})

describe('解析回應', () => {
  it('成功：CREDIT,SENDED,COST,UNSEND,BATCHID', () => {
    expect(parseSendSmsResponse('9610040.00,1,1,0,c496f706-1234-5678')).toEqual({ outcome: 'sent', credit: 9610040, sended: 1, cost: 1, unsend: 0, batchId: 'c496f706-1234-5678' })
  })
  it('SENDED=0 → 確定沒送出、不重試', () => {
    expect(parseSendSmsResponse('100.00,0,0,1,abc')).toMatchObject({ outcome: 'rejected', retryable: false })
  })
  it('-99 未知錯誤 → unknown（不能確定對方有沒有受理，不重送）；其他負數 → 明確失敗、不重試', () => {
    const r = parseSendSmsResponse('-99,發生不明錯誤')
    expect(r).toMatchObject({ outcome: 'unknown', code: '-99' })
    expect(r.retryable).toBeUndefined()
    expect(parseSendSmsResponse('-2,帳號密碼錯誤')).toMatchObject({ outcome: 'rejected', retryable: false, code: '-2' })
    expect(parseSendSmsResponse('-28,時間格式錯誤')).toMatchObject({ outcome: 'rejected', retryable: false })
  })
  it('看不懂的回應 → unknown（不重送）', () => {
    for (const t of ['', '<html>error</html>', 'OK', '{"Result":false}']) expect(parseSendSmsResponse(t).outcome).toBe('unknown')
  })
  it('HTTP 狀態：429/503 可重試；401/403 不重試；500/502/504 不明（不重送）', () => {
    expect(classifyHttpStatus(502)).toMatchObject({ outcome: 'unknown', code: 'http-502' })
    expect(classifyHttpStatus(503)).toMatchObject({ outcome: 'rejected', retryable: true })
    expect(classifyHttpStatus(429)).toMatchObject({ outcome: 'rejected', retryable: true })
    expect(classifyHttpStatus(401)).toMatchObject({ outcome: 'rejected', retryable: false })
    expect(classifyHttpStatus(500).outcome).toBe('unknown')
    expect(classifyHttpStatus(504).outcome).toBe('unknown')
  })
  it('連線前失敗可重試；逾時與中途斷線不明', () => {
    expect(classifyFetchError(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }))).toMatchObject({ outcome: 'rejected', retryable: true })
    expect(classifyFetchError(Object.assign(Error('aborted'), { name: 'AbortError' })).outcome).toBe('unknown')
    expect(classifyFetchError(Object.assign(Error('timeout'), { name: 'TimeoutError' })).outcome).toBe('unknown')
    expect(classifyFetchError(new TypeError('fetch failed')).outcome).toBe('unknown')
    expect(classifyFetchError(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } }))).toMatchObject({ outcome: 'rejected', retryable: true })
    expect(classifyFetchError(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } })).outcome).toBe('unknown')
  })
})

describe('重試資格總表：只有確定未送出才可重試', () => {
  const retryable = r => r.outcome === 'rejected' && r.retryable === true
  it('可重試＝HTTP 429／503、連線前失敗；其餘一律不可', () => {
    const all = [
      classifyHttpStatus(429), classifyHttpStatus(503),
      classifyFetchError(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } })),
    ]
    all.forEach(r => expect(retryable(r)).toBe(true))
    const never = [
      parseSendSmsResponse('-99,x'), parseSendSmsResponse('-2,x'), parseSendSmsResponse('garbage'), parseSendSmsResponse('1,0,0,1,B'),
      classifyHttpStatus(500), classifyHttpStatus(502), classifyHttpStatus(504), classifyHttpStatus(401), classifyHttpStatus(403),
      classifyFetchError(Object.assign(Error('aborted'), { name: 'AbortError' })),
      classifyFetchError(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } })),
    ]
    never.forEach(r => expect(retryable(r)).toBe(false))
  })
})

describe('sendEvery8dSms（fetch 一律 mock）', () => {
  it('-99／HTTP 502 經完整送出流程 → unknown', async () => {
    const f99 = vi.fn(async () => ({ ok: true, status: 200, text: async () => '-99,未知錯誤' }))
    expect(await sendEvery8dSms({ fetchImpl: f99, credentials: creds, to: '0912345678', message: 'hi' })).toMatchObject({ outcome: 'unknown', code: '-99' })
    const f502 = vi.fn(async () => ({ ok: false, status: 502, text: async () => '' }))
    expect(await sendEvery8dSms({ fetchImpl: f502, credentials: creds, to: '0912345678', message: 'hi' })).toMatchObject({ outcome: 'unknown', code: 'http-502' })
  })
  it('預設逾時明確且遠小於 lease 前提（≤15 秒）', () => {
    expect(EVERY8D_TIMEOUT_MS).toBeGreaterThan(0)
    expect(EVERY8D_TIMEOUT_MS).toBeLessThanOrEqual(15_000)
  })
  it('fetch 完全不理會 signal 也在 timeoutMs 內回 unknown（硬上限）', async () => {
    const fetchImpl = vi.fn(() => new Promise(() => {})) // 永遠不 resolve、不看 signal
    const t0 = Date.now()
    const r = await sendEvery8dSms({ fetchImpl, credentials: creds, to: '0912345678', message: 'hi', timeoutMs: 30 })
    expect(r).toMatchObject({ outcome: 'unknown', code: 'timeout' })
    expect(Date.now() - t0).toBeLessThan(1000)
  })
  it('body 讀取卡住（headers 已回）同樣逾時 → unknown', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, text: () => new Promise(() => {}) }))
    expect((await sendEvery8dSms({ fetchImpl, credentials: creds, to: '0912345678', message: 'hi', timeoutMs: 30 })).outcome).toBe('unknown')
  })
  it('成功', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, text: async () => '500.00,1,1,0,BATCH1' }))
    const r = await sendEvery8dSms({ fetchImpl, credentials: creds, to: '0912345678', message: 'hi' })
    expect(r).toMatchObject({ outcome: 'sent', batchId: 'BATCH1' })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(fetchImpl.mock.calls[0][1].signal).toBeTruthy()
  })
  it('未設定帳密不呼叫 fetch', async () => {
    const fetchImpl = vi.fn()
    expect(await sendEvery8dSms({ fetchImpl, credentials: null, to: '0912345678', message: 'hi' })).toMatchObject({ outcome: 'rejected', retryable: false })
    expect(fetchImpl).not.toHaveBeenCalled()
  })
  it('逾時 → unknown', async () => {
    const fetchImpl = vi.fn((url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(Error('aborted'), { name: 'AbortError' })))))
    expect((await sendEvery8dSms({ fetchImpl, credentials: creds, to: '0912345678', message: 'hi', timeoutMs: 5 })).outcome).toBe('unknown')
  })
})
