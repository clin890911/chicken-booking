import { describe, it, expect, vi } from 'vitest'
import {
  every8dCredentials, smsCharCount, smsCredits, buildSendSmsRequest, parseSendSmsResponse,
  classifyHttpStatus, classifyFetchError, sendEvery8dSms, isAllowedEvery8dHost,
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
  it('-99 不明錯誤 → 明確失敗、可重試；其他負數 → 明確失敗、不重試', () => {
    expect(parseSendSmsResponse('-99,發生不明錯誤')).toMatchObject({ outcome: 'rejected', retryable: true, code: '-99' })
    expect(parseSendSmsResponse('-2,帳號密碼錯誤')).toMatchObject({ outcome: 'rejected', retryable: false, code: '-2' })
    expect(parseSendSmsResponse('-28,時間格式錯誤')).toMatchObject({ outcome: 'rejected', retryable: false })
  })
  it('看不懂的回應 → unknown（不重送）', () => {
    for (const t of ['', '<html>error</html>', 'OK', '{"Result":false}']) expect(parseSendSmsResponse(t).outcome).toBe('unknown')
  })
  it('HTTP 狀態：429/502/503 可重試；401/403 不重試；500/504 不明', () => {
    expect(classifyHttpStatus(503)).toMatchObject({ outcome: 'rejected', retryable: true })
    expect(classifyHttpStatus(429)).toMatchObject({ outcome: 'rejected', retryable: true })
    expect(classifyHttpStatus(401)).toMatchObject({ outcome: 'rejected', retryable: false })
    expect(classifyHttpStatus(500).outcome).toBe('unknown')
    expect(classifyHttpStatus(504).outcome).toBe('unknown')
  })
  it('連線前失敗可重試；逾時與中途斷線不明', () => {
    expect(classifyFetchError(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }))).toMatchObject({ outcome: 'rejected', retryable: true })
    expect(classifyFetchError(Object.assign(Error('aborted'), { name: 'AbortError' })).outcome).toBe('unknown')
    expect(classifyFetchError(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } })).outcome).toBe('unknown')
  })
})

describe('sendEvery8dSms（fetch 一律 mock）', () => {
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
