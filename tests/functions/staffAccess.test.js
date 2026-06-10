import { describe, it, expect } from 'vitest'
import {
  STAFF_ROLES,
  normalizeStaffEmail,
  resolveStaffRole,
  validateStaffUpsert,
} from '../../functions/lib/staffAccess.js'

// 管理員帳號管理純邏輯（functions/lib/staffAccess.js）。
// 這層擋的是：手滑輸入的壞 email 變成永遠登不進的殭屍帳號、
// 非法角色寫進 admins 集合導致前端權限表查無對應。

describe('normalizeStaffEmail', () => {
  it('小寫化 + 去空白', () => {
    expect(normalizeStaffEmail('  Staff@Gmail.COM ')).toBe('staff@gmail.com')
  })
  it('非法格式回空字串（缺 @、缺網域、有空白）', () => {
    expect(normalizeStaffEmail('not-an-email')).toBe('')
    expect(normalizeStaffEmail('a@b')).toBe('')
    expect(normalizeStaffEmail('a b@gmail.com')).toBe('')
    expect(normalizeStaffEmail('')).toBe('')
    expect(normalizeStaffEmail(null)).toBe('')
  })
})

describe('resolveStaffRole', () => {
  it('四種合法角色原樣保留', () => {
    for (const r of STAFF_ROLES) expect(resolveStaffRole(r)).toBe(r)
  })
  it('非法/缺省角色降為 floor（與前端 DEFAULT_ROLE 同口徑）', () => {
    expect(resolveStaffRole('admin')).toBe('floor')
    expect(resolveStaffRole(undefined)).toBe('floor')
    expect(resolveStaffRole('')).toBe('floor')
  })
})

describe('validateStaffUpsert', () => {
  it('合法輸入：email 正規化、角色保留、稱呼裁切 40 字', () => {
    const out = validateStaffUpsert({ email: ' New@Gmail.com ', role: 'host', name: '  小美  ' })
    expect(out.ok).toBe(true)
    expect(out.value).toEqual({ email: 'new@gmail.com', role: 'host', name: '小美' })
  })
  it('壞 email 直接打回', () => {
    expect(validateStaffUpsert({ email: 'oops', role: 'floor' }).ok).toBe(false)
  })
  it('明確給了非法角色 → 報錯（避免手滑寫進集合）；未給角色 → 預設 floor', () => {
    expect(validateStaffUpsert({ email: 'a@b.com', role: 'boss' }).ok).toBe(false)
    const out = validateStaffUpsert({ email: 'a@b.com' })
    expect(out.ok).toBe(true)
    expect(out.value.role).toBe('floor')
  })
  it('超長稱呼裁切到 40 字', () => {
    const out = validateStaffUpsert({ email: 'a@b.com', name: 'x'.repeat(80) })
    expect(out.value.name).toHaveLength(40)
  })
})
