import { describe, it, expect, vi } from 'vitest'
import { buildLabel, fetchLatestBuildId, isNewBuild, addReloadBlocker, canAutoReload, BUILD_ID } from '../../src/utils/appVersion'

describe('appVersion', () => {
  it('測試／開發環境沒有 build 戳記 → BUILD_ID 為 dev、標籤「開發版」', () => {
    expect(BUILD_ID).toBe('dev')
    expect(buildLabel('', '')).toBe('開發版')
  })

  it('buildLabel：commit＋台北時間', () => {
    expect(buildLabel('3546498', '2026-10-12T03:31:27Z')).toBe('3546498 · 10/12 11:31')
    expect(buildLabel('', '2026-10-12T03:31:27Z')).toBe('10/12 11:31')
  })

  it('fetchLatestBuildId：不快取抓 /version.json，失敗一律回 null', async () => {
    const ok = vi.fn(async () => ({ ok: true, json: async () => ({ id: 'abc-1' }) }))
    expect(await fetchLatestBuildId(ok)).toBe('abc-1')
    expect(ok.mock.calls[0][0]).toMatch(/^\/version\.json\?t=\d+$/)
    expect(ok.mock.calls[0][1]).toEqual({ cache: 'no-store' })
    expect(await fetchLatestBuildId(async () => ({ ok: false }))).toBeNull()
    expect(await fetchLatestBuildId(async () => { throw new Error('offline') })).toBeNull()
    expect(await fetchLatestBuildId(async () => ({ ok: true, json: async () => '<html>' }))).toBeNull()
  })

  it('isNewBuild：id 不同才算新版；dev 或抓不到不判斷', () => {
    expect(isNewBuild('b', 'a')).toBe(true)
    expect(isNewBuild('a', 'a')).toBe(false)
    expect(isNewBuild(null, 'a')).toBe(false)
    expect(isNewBuild('b', 'dev')).toBe(false)
  })

  it('有登記擋板（未存資料）時不自動重新整理，解除後恢復', () => {
    expect(canAutoReload()).toBe(true)
    const off = addReloadBlocker(() => true)
    expect(canAutoReload()).toBe(false)
    off()
    expect(canAutoReload()).toBe(true)
  })
})
