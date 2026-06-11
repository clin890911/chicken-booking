import { describe, it, expect } from 'vitest'
import { resolveLiffStatePath } from '../../src/utils/liffState'

// LIFF Endpoint=站根後的 liff.state 路由 shim（main.jsx 在 React 掛載前呼叫）。
// 安全重點：liff.state 是攻擊者可控輸入——只接受站內相對路徑，否則就是 open redirect。

describe('resolveLiffStatePath', () => {
  it('解析未編碼的相對路徑', () => {
    expect(resolveLiffStatePath('?liff.state=/book')).toBe('/book')
  })

  it('解析 URL 編碼的路徑（LINE 平台實際傳遞格式）', () => {
    expect(resolveLiffStatePath('?liff.state=%2Fline%2Fmy-bookings')).toBe('/line/my-bookings')
  })

  it('保留 path 上的 query（綁定頁參數）', () => {
    expect(resolveLiffStatePath('?liff.state=' + encodeURIComponent('/line/bind?bookingId=B1&token=t1')))
      .toBe('/line/bind?bookingId=B1&token=t1')
  })

  it('【open redirect 回歸】拒絕絕對 URL 與 protocol-relative URL', () => {
    expect(resolveLiffStatePath('?liff.state=' + encodeURIComponent('https://evil.example/phish'))).toBe('')
    expect(resolveLiffStatePath('?liff.state=' + encodeURIComponent('//evil.example/phish'))).toBe('')
    expect(resolveLiffStatePath('?liff.state=javascript:alert(1)')).toBe('')
  })

  it('無 liff.state 且無 legacy 參數 → 空字串（不動作）', () => {
    expect(resolveLiffStatePath('')).toBe('')
    expect(resolveLiffStatePath('?foo=bar')).toBe('')
    expect(resolveLiffStatePath('?bookingId=B1')).toBe('')
  })

  it('legacy catch：舊 query-style 綁定連結落站根 → 導回 /line/bind 原 query 保留', () => {
    expect(resolveLiffStatePath('?bookingId=B1&token=t1&useLiff=1', '/'))
      .toBe('/line/bind?bookingId=B1&token=t1&useLiff=1')
    expect(resolveLiffStatePath('?bookingId=B1&payload=abc', '/'))
      .toBe('/line/bind?bookingId=B1&payload=abc')
  })

  it('legacy catch 只在站根生效（其他頁面的 bookingId 參數不動）', () => {
    expect(resolveLiffStatePath('?bookingId=B1&token=t1', '/line/bind')).toBe('')
    expect(resolveLiffStatePath('?bookingId=B1&token=t1', '/manage/B1')).toBe('')
  })
})
