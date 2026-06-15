import { describe, it, expect } from 'vitest'
import {
  buildAuthorizeUrl,
  parseFriendFlag,
  buildBindResultUrl,
  LINE_LOGIN_STATE_TTL_MS,
} from '../../functions/lib/lineLogin.js'

// LINE Login 網頁授權純邏輯（functions/lib/lineLogin.js）。
// 取代易卡「一直載入」的 LIFF：純伺服器 302 重導 + bot_prompt 同步加好友。

describe('buildAuthorizeUrl', () => {
  it('組出 LINE Login 授權網址（含 scope / bot_prompt）', () => {
    const url = new URL(buildAuthorizeUrl({ channelId: '123', redirectUri: 'https://cb.example/x', state: 'st-1' }))
    expect(`${url.origin}${url.pathname}`).toBe('https://access.line.me/oauth2/v2.1/authorize')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('client_id')).toBe('123')
    expect(url.searchParams.get('redirect_uri')).toBe('https://cb.example/x')
    expect(url.searchParams.get('state')).toBe('st-1')
    expect(url.searchParams.get('scope')).toBe('profile openid')
    expect(url.searchParams.get('bot_prompt')).toBe('aggressive')
  })
})

describe('parseFriendFlag', () => {
  it('true/false 字串或布林轉 boolean，其餘 null（未知）', () => {
    expect(parseFriendFlag('true')).toBe(true)
    expect(parseFriendFlag('false')).toBe(false)
    expect(parseFriendFlag(true)).toBe(true)
    expect(parseFriendFlag(false)).toBe(false)
    expect(parseFriendFlag(undefined)).toBeNull()
    expect(parseFriendFlag('')).toBeNull()
    expect(parseFriendFlag('1')).toBeNull()
  })
})

describe('buildBindResultUrl', () => {
  it('有 publicSiteUrl → 導回 /line/bind（含 bound / needFriend）', () => {
    const url = new URL(buildBindResultUrl('https://site.example/', { bookingId: 'B1', token: 't', bound: 1, needFriend: 1 }))
    expect(url.pathname).toBe('/line/bind')
    expect(url.searchParams.get('bookingId')).toBe('B1')
    expect(url.searchParams.get('token')).toBe('t')
    expect(url.searchParams.get('bound')).toBe('1')
    expect(url.searchParams.get('needFriend')).toBe('1')
  })

  it('bound=0 帶 err；needFriend 缺省不帶旗標', () => {
    const url = new URL(buildBindResultUrl('https://site.example', { bookingId: 'B1', token: 't', bound: 0, err: 'expired' }))
    expect(url.searchParams.get('bound')).toBe('0')
    expect(url.searchParams.get('err')).toBe('expired')
    expect(url.searchParams.get('needFriend')).toBeNull()
  })

  it('無 publicSiteUrl → 空字串（呼叫端走純文字後援）', () => {
    expect(buildBindResultUrl('', { bookingId: 'B1' })).toBe('')
  })
})

describe('LINE_LOGIN_STATE_TTL_MS', () => {
  it('為 10 分鐘', () => {
    expect(LINE_LOGIN_STATE_TTL_MS).toBe(10 * 60 * 1000)
  })
})
