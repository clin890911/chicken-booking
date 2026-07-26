import { describe, it, expect } from 'vitest'
import { statusFromPushResult, statusAfterPull, statusAfterError } from '../../src/utils/syncStatus'

const T1 = '2026-07-26T10:00:00.000Z'
const T2 = '2026-07-26T10:00:05.000Z'
const REJECTED = { writes: ['agencies'], deletes: [], settings: false }

describe('statusFromPushResult', () => {
  it('沒有被拒 → synced，且清掉先前的 rejected', () => {
    expect(statusFromPushResult({ ok: true }, T1)).toEqual({
      state: 'synced', lastSyncAt: T1, error: '', rejected: null,
    })
  })

  it('有被拒 → rejected，帶上訊息與明細', () => {
    const s = statusFromPushResult({ ok: true, rejected: REJECTED, rejectedMessage: '角色「floor」無權：寫入 agencies' }, T1)
    expect(s.state).toBe('rejected')
    expect(s.rejected).toMatchObject(REJECTED)
    expect(s.error).toContain('agencies')
  })

  it('後端沒給訊息時有可讀的預設文案', () => {
    expect(statusFromPushResult({ ok: true, rejected: REJECTED }, T1).error).toBe('部分變更因權限不足未能上雲')
  })

  it('skipped（無變更可推）不算被拒', () => {
    expect(statusFromPushResult({ ok: true, skipped: true }, T1).state).toBe('synced')
  })
})

describe('statusAfterPull', () => {
  // 🔴 這條守的是一個「做了 UI 卻等於沒做」的缺陷：拉取每 5 秒跑一次，
  // 若無條件設成 synced，rejected 警示與「放棄這些變更」按鈕會在幾秒內消失，
  // 店員永遠不會發現畫面上有雲端根本不存在的資料。
  it('仍有 rejected 時，拉取成功不得把狀態洗成 synced', () => {
    const prev = statusFromPushResult({ ok: true, rejected: REJECTED, rejectedMessage: 'x' }, T1)
    const next = statusAfterPull(prev, T2)
    expect(next.state).toBe('rejected')
    expect(next.rejected).toMatchObject(REJECTED)
    expect(next.error).toBe('x')
    expect(next.lastSyncAt).toBe(T2) // 時間仍要前進
  })

  it('連續多次拉取都不會磨掉 rejected', () => {
    let s = statusFromPushResult({ ok: true, rejected: REJECTED, rejectedMessage: 'x' }, T1)
    for (let i = 0; i < 10; i++) s = statusAfterPull(s, T2)
    expect(s.state).toBe('rejected')
  })

  it('沒有 rejected 時，拉取成功 → synced', () => {
    expect(statusAfterPull({ state: 'idle' }, T1)).toEqual({
      state: 'synced', lastSyncAt: T1, error: '', rejected: null,
    })
  })

  it('乾淨的推送成功可以清掉 rejected（這是唯一自動清除的途徑）', () => {
    const rejectedState = statusFromPushResult({ ok: true, rejected: REJECTED }, T1)
    const cleaned = statusFromPushResult({ ok: true }, T2)
    expect(rejectedState.state).toBe('rejected')
    expect(cleaned.state).toBe('synced')
    expect(cleaned.rejected).toBeNull()
  })
})

describe('statusAfterError', () => {
  it('離線時保留 rejected——連線恢復後仍要繼續警示', () => {
    const prev = statusFromPushResult({ ok: true, rejected: REJECTED, rejectedMessage: 'x' }, T1)
    const off = statusAfterError(prev, 'Failed to fetch', 'cloud-sync-failed')
    expect(off.state).toBe('offline')
    expect(off.error).toBe('Failed to fetch') // 離線期間顯示離線原因
    expect(off.rejected).toMatchObject(REJECTED)
    // 回線後拉取成功 → 因為 rejected 還在，必須回到 rejected 而不是 synced
    const back = statusAfterPull(off, T2)
    expect(back.state).toBe('rejected')
    expect(back.error).toBe('x') // 回線後警示文案要原樣還原，不能留著離線訊息
  })

  it('沒有訊息時用 fallback', () => {
    expect(statusAfterError({ state: 'synced' }, '', 'cloud-push-failed').error).toBe('cloud-push-failed')
  })
})
