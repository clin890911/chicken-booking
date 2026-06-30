import { describe, it, expect } from 'vitest'
import {
  STAFF_ROLES,
  normalizeStaffEmail,
  resolveStaffRole,
  validateStaffUpsert,
  roleCan,
  canWriteCollection,
  canDeleteCollection,
  canWriteSettings,
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

// 後端 RBAC：adminPushData / groupReserveTables 依角色把關寫入/刪除/設定。
// 與前端 AuthContext PERMISSIONS 成對；這層擋的是「繞過 UI 直接打 API 的越權」。
describe('roleCan / 權限矩陣', () => {
  it('manager 全可（含新增的 customer.delete）', () => {
    expect(roleCan('manager', 'settings.update')).toBe(true)
    expect(roleCan('manager', 'booking.delete')).toBe(true)
    expect(roleCan('manager', 'customer.delete')).toBe(true)
    expect(roleCan('manager', 'staff.manage')).toBe(true)
  })
  it('kitchen 只有 *.read', () => {
    expect(roleCan('kitchen', 'booking.read')).toBe(true)
    expect(roleCan('kitchen', 'booking.update')).toBe(false)
    expect(roleCan('kitchen', 'settings.update')).toBe(false)
  })
  it('未知角色一律否', () => {
    expect(roleCan('intern', 'booking.read')).toBe(false)
    expect(roleCan(undefined, 'booking.read')).toBe(false)
  })
})

describe('canWriteCollection', () => {
  it('kitchen 不可寫任何同步集合', () => {
    for (const c of ['bookings', 'tables', 'waitlist', 'customers', 'agencies', 'guides', 'groupReservations']) {
      expect(canWriteCollection('kitchen', c)).toBe(false)
    }
  })
  it('floor 可寫 bookings/tables/waitlist/customers，但不可寫 groupReservations/agencies', () => {
    expect(canWriteCollection('floor', 'bookings')).toBe(true)
    expect(canWriteCollection('floor', 'tables')).toBe(true)
    expect(canWriteCollection('floor', 'waitlist')).toBe(true)
    expect(canWriteCollection('floor', 'customers')).toBe(true)
    expect(canWriteCollection('floor', 'groupReservations')).toBe(false)
    expect(canWriteCollection('floor', 'agencies')).toBe(false)
  })
  it('host 可寫 bookings/groupReservations/agencies，但不可寫 tables（host 無 table 寫權）', () => {
    expect(canWriteCollection('host', 'bookings')).toBe(true)
    expect(canWriteCollection('host', 'groupReservations')).toBe(true)
    expect(canWriteCollection('host', 'agencies')).toBe(true)
    expect(canWriteCollection('host', 'tables')).toBe(false)
  })
  it('manager 可寫全部；未知集合保守僅 manager', () => {
    for (const c of ['bookings', 'tables', 'waitlist', 'customers', 'agencies', 'guides', 'groupReservations']) {
      expect(canWriteCollection('manager', c)).toBe(true)
    }
    expect(canWriteCollection('manager', 'mysteryColl')).toBe(true)
    expect(canWriteCollection('floor', 'mysteryColl')).toBe(false)
  })
})

describe('canDeleteCollection', () => {
  it('刪訂位/桌位/候位/顧客一律僅 manager', () => {
    for (const r of ['floor', 'host', 'kitchen']) {
      expect(canDeleteCollection(r, 'bookings')).toBe(false)
      expect(canDeleteCollection(r, 'tables')).toBe(false)
      expect(canDeleteCollection(r, 'waitlist')).toBe(false)
      expect(canDeleteCollection(r, 'customers')).toBe(false)
    }
    expect(canDeleteCollection('manager', 'bookings')).toBe(true)
    expect(canDeleteCollection('manager', 'customers')).toBe(true)
  })
  it('刪團體預排：manager 與 host 可，floor/kitchen 不可', () => {
    expect(canDeleteCollection('host', 'groupReservations')).toBe(true)
    expect(canDeleteCollection('manager', 'groupReservations')).toBe(true)
    expect(canDeleteCollection('floor', 'groupReservations')).toBe(false)
    expect(canDeleteCollection('kitchen', 'groupReservations')).toBe(false)
  })
})

describe('canWriteSettings', () => {
  it('僅 manager 可改設定', () => {
    expect(canWriteSettings('manager')).toBe(true)
    expect(canWriteSettings('floor')).toBe(false)
    expect(canWriteSettings('host')).toBe(false)
    expect(canWriteSettings('kitchen')).toBe(false)
  })
})
