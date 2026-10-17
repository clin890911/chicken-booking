import { describe, it, expect } from 'vitest'
import { describeAuthError, STAFF_DENIED_CODE, STAFF_UNVERIFIED_CODE, GENERIC_LOGIN_MESSAGE } from '../../src/utils/authErrors'

const e = (code) => Object.assign(new Error(`Firebase: Error (${code}).`), { code })

describe('describeAuthError', () => {
  it('使用者自己關彈窗／重複點擊 → 靜默', () => {
    expect(describeAuthError(e('auth/popup-closed-by-user')).silent).toBe(true)
    expect(describeAuthError(e('auth/cancelled-popup-request')).silent).toBe(true)
  })
  it.each([
    ['auth/popup-blocked', '允許彈出視窗'],
    ['auth/network-request-failed', '網路不穩'],
    ['auth/operation-not-supported-in-this-environment', 'Safari 或 Chrome'],
    ['auth/web-storage-unsupported', 'Safari 或 Chrome'],
    ['auth/too-many-requests', '稍候'],
    ['auth/user-disabled', '停用'],
    ['auth/internal-error', '稍後再試'],
    [STAFF_DENIED_CODE, '未授權'],
    [STAFF_UNVERIFIED_CODE, '連線不穩'],
  ])('%s → 中文', (code, frag) => {
    const d = describeAuthError(e(code))
    expect(d.silent).toBe(false)
    expect(d.message).toContain(frag)
    expect(d.message).not.toMatch(/auth\/|Firebase/)
    expect(d.detail).toBe('')
  })
  it('未知碼 → 通用中文＋小字原始碼', () => {
    const d = describeAuthError(e('auth/some-new-thing'))
    expect(d.message).toBe(GENERIC_LOGIN_MESSAGE)
    expect(d.detail).toBe('auth/some-new-thing')
  })
  it('只在 message 內含碼（無 code 屬性）也能辨識', () => {
    expect(describeAuthError(new Error('Firebase: Error (auth/popup-blocked).')).message).toContain('彈出視窗')
  })
  it('英文且無碼的錯誤不外洩原文', () => {
    const d = describeAuthError(new Error('Something exploded'))
    expect(d.message).toBe(GENERIC_LOGIN_MESSAGE)
    expect(d.message).not.toContain('exploded')
  })
  it('自家中文訊息保留', () => {
    expect(describeAuthError(new Error('請輸入 email')).message).toBe('請輸入 email')
  })
})
