import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  createStaffGate, verifyStaffRole, verifyWithBackoff,
  readRoleCache, writeRoleCache, clearRoleCache,
} from '../../src/utils/staffGate'

function memStorage() {
  const m = new Map()
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }
}
const httpErr = (status, code = '') => Object.assign(new Error(code || `request-failed-${status}`), { status, code })
const EMAIL = 'staff@example.com'

describe('verifyStaffRole 三態', () => {
  const tok = vi.fn(async () => 'tok')
  it('ok', async () => {
    expect(await verifyStaffRole({ getToken: tok, whoAmI: async () => ({ ok: true, role: 'host' }) })).toEqual({ status: 'ok', role: 'host' })
  })
  it('403 / ok:false → denied', async () => {
    expect((await verifyStaffRole({ getToken: tok, whoAmI: async () => { throw httpErr(403, 'not-authorized') } })).status).toBe('denied')
    expect((await verifyStaffRole({ getToken: tok, whoAmI: async () => ({ ok: false }) })).status).toBe('denied')
  })
  it('401 先換新 token 重問，仍 401 才 denied', async () => {
    const getToken = vi.fn(async () => 't')
    const whoAmI = vi.fn(async () => { throw httpErr(401, 'invalid-auth-token') })
    expect((await verifyStaffRole({ getToken, whoAmI })).status).toBe('denied')
    expect(whoAmI).toHaveBeenCalledTimes(2)
    expect(getToken).toHaveBeenLastCalledWith(true)
  })
  it('401 換 token 後成功 → ok', async () => {
    let n = 0
    const whoAmI = async () => { if (n++ === 0) throw httpErr(401); return { ok: true, role: 'floor' } }
    expect((await verifyStaffRole({ getToken: tok, whoAmI })).status).toBe('ok')
  })
  it('503 / 無 status(網路) / 逾時 / 取不到 token → error，不是 denied', async () => {
    expect((await verifyStaffRole({ getToken: tok, whoAmI: async () => { throw httpErr(503, 'staff_lookup_unavailable') } })).status).toBe('error')
    expect((await verifyStaffRole({ getToken: tok, whoAmI: async () => { throw new TypeError('Failed to fetch') } })).status).toBe('error')
    expect((await verifyStaffRole({ getToken: tok, whoAmI: async () => { throw Object.assign(new Error('逾時'), { code: 'timeout' }) } })).status).toBe('error')
    expect((await verifyStaffRole({ getToken: async () => null, whoAmI: vi.fn() })).status).toBe('error')
  })
})

describe('verifyWithBackoff', () => {
  it('error 依序退避後成功', async () => {
    const seq = [{ status: 'error' }, { status: 'error' }, { status: 'ok', role: 'floor' }]
    const verify = vi.fn(async () => seq.shift())
    const waits = []
    const r = await verifyWithBackoff({ verify, delays: [3000, 10000, 30000], sleep: async ms => { waits.push(ms) } })
    expect(r.status).toBe('ok')
    expect(waits).toEqual([3000, 10000])
  })
  it('一直 error → 最終回 error（共 4 次）', async () => {
    const verify = vi.fn(async () => ({ status: 'error' }))
    const r = await verifyWithBackoff({ verify, delays: [1, 2, 3], sleep: async () => {} })
    expect(r.status).toBe('error')
    expect(verify).toHaveBeenCalledTimes(4)
  })
  it('denied 立即結束', async () => {
    const verify = vi.fn(async () => ({ status: 'denied' }))
    expect((await verifyWithBackoff({ verify, delays: [1], sleep: async () => {} })).status).toBe('denied')
    expect(verify).toHaveBeenCalledTimes(1)
  })
})

describe('角色快取', () => {
  it('只存 email/role/verifiedAt，換 email 讀不到，clear 只清自己', () => {
    const st = memStorage()
    writeRoleCache(EMAIL, 'host', st)
    const c = readRoleCache(EMAIL, st)
    expect(Object.keys(c).sort()).toEqual(['email', 'role', 'verifiedAt'])
    expect(readRoleCache('other@x.com', st)).toBeNull()
    clearRoleCache('other@x.com', st)
    expect(readRoleCache(EMAIL, st)).not.toBeNull()
    clearRoleCache(EMAIL, st)
    expect(readRoleCache(EMAIL, st)).toBeNull()
  })
  it('儲存壞掉不拋錯', () => {
    const bad = { getItem() { throw new Error('x') }, setItem() { throw new Error('x') }, removeItem() { throw new Error('x') } }
    expect(readRoleCache(EMAIL, bad)).toBeNull()
    expect(() => writeRoleCache(EMAIL, 'a', bad)).not.toThrow()
    expect(() => clearRoleCache(EMAIL, bad)).not.toThrow()
  })
})

describe('createStaffGate', () => {
  let st
  beforeEach(() => { st = memStorage() })
  const mk = (verify) => createStaffGate({ verify, storage: st, delays: [1, 2], sleep: async () => {} })

  it('denied 無快取 → denied（呼叫端據此登出）', async () => {
    const g = mk(async () => ({ status: 'denied' }))
    expect((await g.check(EMAIL)).status).toBe('denied')
  })
  it('ok 無快取 → allowed 並寫快取', async () => {
    const g = mk(async () => ({ status: 'ok', role: 'host' }))
    const r = await g.check(EMAIL)
    expect(r).toMatchObject({ status: 'allowed', role: 'host', cached: false })
    expect(readRoleCache(EMAIL, st).role).toBe('host')
  })
  it('error 無快取 → unverified（不登出，可重試；重試成功即放行）', async () => {
    const seq = [{ status: 'error', message: 'net' }, { status: 'ok', role: 'floor' }]
    const g = mk(async () => seq.shift())
    expect((await g.check(EMAIL)).status).toBe('unverified')
    expect((await g.check(EMAIL)).status).toBe('allowed')
  })
  it('error 有快取 → 樂觀放行用快取角色，背景最終仍 error 也維持放行且保留快取', async () => {
    writeRoleCache(EMAIL, 'host', st)
    const verify = vi.fn(async () => ({ status: 'error' }))
    const g = mk(verify)
    const r = await g.check(EMAIL)
    expect(r).toMatchObject({ status: 'allowed', role: 'host', cached: true })
    expect((await r.background).status).toBe('error')
    expect(verify).toHaveBeenCalledTimes(3)
    expect(readRoleCache(EMAIL, st).role).toBe('host')
  })
  it('有快取：不等驗證就回傳（重整不必等 staffWhoAmI）', async () => {
    writeRoleCache(EMAIL, 'host', st)
    let release
    const g = mk(() => new Promise(r => { release = () => r({ status: 'ok', role: 'host' }) }))
    const r = await g.check(EMAIL) // 若會等 verify 這裡會卡死
    expect(r.status).toBe('allowed')
    release()
    expect((await r.background).status).toBe('ok')
  })
  it('背景驗證角色變了 → changed，快取更新', async () => {
    writeRoleCache(EMAIL, 'floor', st)
    const g = mk(async () => ({ status: 'ok', role: 'manager' }))
    const bg = await (await g.check(EMAIL)).background
    expect(bg).toMatchObject({ status: 'ok', role: 'manager', changed: true })
    expect(readRoleCache(EMAIL, st).role).toBe('manager')
  })
  it('背景驗證 denied → 回 denied 並清快取', async () => {
    writeRoleCache(EMAIL, 'host', st)
    const g = mk(async () => ({ status: 'denied' }))
    const bg = await (await g.check(EMAIL)).background
    expect(bg.status).toBe('denied')
    expect(readRoleCache(EMAIL, st)).toBeNull()
  })
  it('併發去重：同 email 同時兩次 check 只打一次 verify', async () => {
    const verify = vi.fn(async () => ({ status: 'ok', role: 'host' }))
    const g = mk(verify)
    const [a, b] = await Promise.all([g.check(EMAIL), g.check(EMAIL)])
    expect(a).toBe(b)
    expect(verify).toHaveBeenCalledTimes(1)
  })
  it('剛驗證成功後再 check 不重複背景驗證', async () => {
    const verify = vi.fn(async () => ({ status: 'ok', role: 'host' }))
    const g = mk(verify)
    await g.check(EMAIL)
    const r2 = await g.check(EMAIL)
    expect(r2.background).toBeNull()
    expect(verify).toHaveBeenCalledTimes(1)
  })
  it('cancelBackground：登出後背景結果不再生效', async () => {
    writeRoleCache(EMAIL, 'host', st)
    let release
    const g = mk(() => new Promise(r => { release = () => r({ status: 'denied' }) }))
    const r = await g.check(EMAIL)
    g.cancelBackground()
    release()
    expect((await r.background).status).toBe('cancelled')
    expect(readRoleCache(EMAIL, st)).not.toBeNull()
  })
})
