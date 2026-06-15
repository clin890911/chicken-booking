import { describe, it, expect } from 'vitest'
import { lineBindUrl, decodeLinePayload, lineLiffId, lineOfficialUrl } from '../../src/services/lineService'

// LINE 綁定連結與相容解碼。
// 重點回歸：綁定連結「不得」夾帶個資 payload——舊版把 base64(姓名/電話) 塞 URL，
// 會進 LINE 伺服器 log 與瀏覽器歷史（隱私缺陷，PR feat/line-bind-funnel 移除）。

const BOOKING = {
  id: 'B250610AB12',
  manageToken: 'tok-abc-123',
  name: '王小明',
  phone: '0912345678',
  guests: 4,
  date: '2026-06-20',
  timeSlot: '18:00',
}

describe('lineBindUrl', () => {
  it('帶 bookingId / token / manageUrl，useLiff 開啟時帶旗標', () => {
    const url = new URL(lineBindUrl({ lineUseLiff: true }, BOOKING))
    expect(url.pathname).toBe('/line/bind')
    expect(url.searchParams.get('bookingId')).toBe(BOOKING.id)
    expect(url.searchParams.get('token')).toBe(BOOKING.manageToken)
    expect(url.searchParams.get('manageUrl')).toContain(`/manage/${BOOKING.id}`)
    expect(url.searchParams.get('useLiff')).toBe('1')
  })

  it('lineUseLiff 關閉時不帶 useLiff 旗標', () => {
    const url = new URL(lineBindUrl({ lineUseLiff: false }, BOOKING))
    expect(url.searchParams.get('useLiff')).toBeNull()
  })

  it('【隱私回歸】URL 不含 payload 參數，也不含姓名/電話', () => {
    const url = lineBindUrl({ lineUseLiff: true }, BOOKING)
    expect(new URL(url).searchParams.get('payload')).toBeNull()
    expect(url).not.toContain(encodeURIComponent(BOOKING.name))
    expect(url).not.toContain(BOOKING.phone)
    // base64url(JSON) 也不行：整串 URL 解碼後不得出現姓名/電話
    expect(decodeURIComponent(url)).not.toContain(BOOKING.name)
    expect(decodeURIComponent(url)).not.toContain(BOOKING.phone)
  })

  it('無 booking 回空字串', () => {
    expect(lineBindUrl({}, null)).toBe('')
  })
})

describe('decodeLinePayload（舊版連結相容）', () => {
  it('可解出舊版 base64url payload', () => {
    const legacy = { booking: { id: 'B1', token: 't', name: '舊客人' } }
    const json = JSON.stringify(legacy)
    const bytes = new TextEncoder().encode(json)
    let binary = ''
    bytes.forEach(b => { binary += String.fromCharCode(b) })
    const encoded = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    expect(decodeLinePayload(encoded)).toEqual(legacy)
  })

  it('壞輸入回 null，不丟例外', () => {
    expect(decodeLinePayload('not-base64!!!')).toBeNull()
    expect(decodeLinePayload('')).toBeNull()
  })
})

describe('lineLiffId', () => {
  it('lineUseLiff 關閉 → 空字串', () => {
    expect(lineLiffId({ lineUseLiff: false, lineLiffId: 'x' })).toBe('')
  })

  it('優先用明確設定的 lineLiffId', () => {
    expect(lineLiffId({ lineUseLiff: true, lineLiffId: '123-abc' })).toBe('123-abc')
  })

  it('從 lineLiffUrl 解析 LIFF ID', () => {
    expect(lineLiffId({ lineUseLiff: true, lineLiffUrl: 'https://liff.line.me/999-zzz' })).toBe('999-zzz')
  })
})

describe('lineOfficialUrl', () => {
  it('回傳設定值；未設定回空字串', () => {
    expect(lineOfficialUrl({ lineOfficialUrl: 'https://lin.ee/xxx' })).toBe('https://lin.ee/xxx')
  })
})

describe('lineMyBookingsEndpoint / fetchLineMyBookings', () => {
  it('優先用 settings，未設定回預設端點', async () => {
    const { lineMyBookingsEndpoint } = await import('../../src/services/lineService')
    expect(lineMyBookingsEndpoint({ lineMyBookingsEndpoint: 'https://custom.example.com' })).toBe('https://custom.example.com')
    expect(lineMyBookingsEndpoint({})).toBe('https://linemybookings-reaor76eyq-uc.a.run.app')
  })

  it('fetchLineMyBookings：無 idToken 直接回 not-configured，不打網路', async () => {
    const { fetchLineMyBookings } = await import('../../src/services/lineService')
    const result = await fetchLineMyBookings({}, '')
    expect(result).toEqual({ ok: false, error: 'not-configured' })
  })
})

describe('lineLoginStartUrl / lineLoginStartEndpoint（LINE Login 網頁授權綁定入口）', () => {
  it('優先用 settings 端點，未設定回預設', async () => {
    const { lineLoginStartEndpoint } = await import('../../src/services/lineService')
    expect(lineLoginStartEndpoint({ lineLoginStartEndpoint: 'https://custom.example.com' })).toBe('https://custom.example.com')
    expect(lineLoginStartEndpoint({})).toBe('https://lineloginstart-reaor76eyq-uc.a.run.app')
  })

  it('組出只帶 bookingId / token 的入口連結，不夾個資', async () => {
    const { lineLoginStartUrl } = await import('../../src/services/lineService')
    const url = new URL(lineLoginStartUrl({}, BOOKING))
    expect(url.searchParams.get('bookingId')).toBe(BOOKING.id)
    expect(url.searchParams.get('token')).toBe(BOOKING.manageToken)
    expect(decodeURIComponent(url.toString())).not.toContain(BOOKING.name)
    expect(decodeURIComponent(url.toString())).not.toContain(BOOKING.phone)
  })

  it('無 booking 回空字串', async () => {
    const { lineLoginStartUrl } = await import('../../src/services/lineService')
    expect(lineLoginStartUrl({}, null)).toBe('')
  })
})
