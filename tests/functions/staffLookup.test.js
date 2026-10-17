import { describe, it, expect } from 'vitest'
import { lookupAdminStaff, STAFF_LOOKUP_UNAVAILABLE } from '../../functions/lib/staffAccess.js'

// requireStaff 依此結果決定回碼：unavailable → 503、found:false → 403（查無此人仍是未授權）。
describe('lookupAdminStaff（admins 查詢：讀取失敗 ≠ 查無此人）', () => {
  it('Firestore 讀取失敗 → unavailable（後端據此回 503 staff_lookup_unavailable）', async () => {
    const r = await lookupAdminStaff(async () => { throw new Error('UNAVAILABLE') })
    expect(r.unavailable).toBe(true)
    expect(STAFF_LOOKUP_UNAVAILABLE).toBe('staff_lookup_unavailable')
  })
  it('查無此人 → found:false（後端回 403）', async () => {
    expect(await lookupAdminStaff(async () => ({ exists: false }))).toEqual({ found: false })
  })
  it('active:false → found:false', async () => {
    expect(await lookupAdminStaff(async () => ({ exists: true, data: () => ({ active: false, role: 'host' }) }))).toEqual({ found: false })
  })
  it('查到且啟用 → 角色（非法角色降 floor）', async () => {
    expect(await lookupAdminStaff(async () => ({ exists: true, data: () => ({ role: 'host' }) }))).toEqual({ found: true, role: 'host' })
    expect((await lookupAdminStaff(async () => ({ exists: true, data: () => ({ role: 'zzz' }) }))).role).toBe('floor')
  })
})
