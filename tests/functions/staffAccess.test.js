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
  classifyDatasetByPermission,
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
  it('floor 可寫 bookings/tables/waitlist/customers，但不可寫 agencies', () => {
    expect(canWriteCollection('floor', 'bookings')).toBe(true)
    expect(canWriteCollection('floor', 'tables')).toBe(true)
    expect(canWriteCollection('floor', 'waitlist')).toBe(true)
    expect(canWriteCollection('floor', 'customers')).toBe(true)
    expect(canWriteCollection('floor', 'agencies')).toBe(false)
  })
  // 🔴 此條原本斷言 floor 不可寫 groupReservations——那是把 bug 當規格釘住了。
  // 外場帶團入座（seatGroupBatch → setStatus('arrived')）與**開機自動跑的**換日掃除
  // complete-group（opsSweep → finalizeGroup）都會寫 groupReservations。
  // 後端採「任一集合越權即整包 403」，因此少了 group.update 會讓外場裝置
  // 一開機就整包被拒 → 連 bookings/tables 都推不上雲 → 與雲端永久分歧。不可回退。
  it('floor 必須可寫 groupReservations（帶團入座＋換日掃除會寫，否則整台同步全死）', () => {
    expect(canWriteCollection('floor', 'groupReservations')).toBe(true)
    expect(roleCan('floor', 'group.update')).toBe(true)
  })
  it('但 floor 仍不可建立/刪除團單，也不可改設定（規劃與設定仍是店長/訂位專員的事）', () => {
    expect(roleCan('floor', 'group.create')).toBe(false)
    expect(roleCan('floor', 'group.delete')).toBe(false)
    expect(canDeleteCollection('floor', 'groupReservations')).toBe(false)
    expect(canWriteSettings('floor')).toBe(false)
    expect(roleCan('floor', 'table.config')).toBe(false)
  })
  it('host 可寫 bookings/tables/groupReservations/agencies（領位台需帶位指派桌）', () => {
    expect(canWriteCollection('host', 'bookings')).toBe(true)
    expect(canWriteCollection('host', 'groupReservations')).toBe(true)
    expect(canWriteCollection('host', 'agencies')).toBe(true)
    // 帶位/指派/換桌/併桌/團體入座都會寫 tables，host 必須能寫，否則整包 403。
    expect(canWriteCollection('host', 'tables')).toBe(true)
  })
  it('host 能帶位寫桌，但仍不可維修停用/併桌設定/改佈局/刪桌', () => {
    expect(roleCan('host', 'table.update')).toBe(true)
    expect(roleCan('host', 'table.block')).toBe(false)
    expect(roleCan('host', 'table.merge')).toBe(false)
    expect(roleCan('host', 'table.config')).toBe(false)
    expect(canDeleteCollection('host', 'tables')).toBe(false)
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

// === 部分推送的權限分類 ===
// 這組守的是「單一集合越權即整包 403」造成的連坐災難：前端把所有髒集合綁成同一個
// payload，任何一條沒被 UI 擋住的越權寫入，都會讓該裝置全部集合的同步一起失敗。
describe('classifyDatasetByPermission（部分推送）', () => {
  const COLS = ['bookings', 'tables', 'waitlist', 'customers', 'agencies', 'guides', 'groupReservations']
  const call = (dataset, role) => classifyDatasetByPermission(dataset, role, COLS)

  it('全部有權 → 無越權、writable 與輸入等價', () => {
    const ds = { bookings: [{ id: 'b1' }], tables: [{ number: '101' }] }
    const r = call(ds, 'floor')
    expect(r.hasRejection).toBe(false)
    expect(r.rejected).toEqual({ writes: [], deletes: [], settings: false })
    expect(r.writable.bookings).toHaveLength(1)
    expect(r.writable.tables).toHaveLength(1)
  })

  it('🔴 只剔除越權集合，有權的照留——這是整個重構的重點（不再連坐）', () => {
    const ds = {
      bookings: [{ id: 'b1' }],           // floor 有權
      tables: [{ number: '101' }],        // floor 有權
      agencies: [{ id: 'a1' }],           // floor 無權（需 agency.manage）
      settings: { openTime: '11:00' },    // floor 無權（僅 manager）
    }
    const r = call(ds, 'floor')
    expect(r.hasRejection).toBe(true)
    expect(r.rejected.writes).toEqual(['agencies'])
    expect(r.rejected.settings).toBe(true)
    // 有權的部分必須完整保留 —— 舊行為是整包 403、一筆都不寫
    expect(r.writable.bookings).toHaveLength(1)
    expect(r.writable.tables).toHaveLength(1)
    // 越權的部分必須被剔除，不能漏進寫入路徑
    expect(r.writable.agencies).toBeUndefined()
    expect(r.writable.settings).toBeUndefined()
  })

  it('刪除與寫入分開判定：floor 可寫 groupReservations 但不可刪', () => {
    const ds = {
      groupReservations: [{ id: 'g1' }],
      deletedIds: { groupReservations: ['g2'], bookings: ['b9'] },
    }
    const r = call(ds, 'floor')
    expect(r.rejected.writes).toEqual([])          // group.update 有
    expect(r.rejected.deletes.sort()).toEqual(['bookings', 'groupReservations']) // 兩者的 delete 都沒有
    expect(r.writable.groupReservations).toHaveLength(1)
    expect(r.writable.deletedIds).toEqual({})
  })

  it('manager 全通過；kitchen 幾乎全被拒', () => {
    const ds = { bookings: [{ id: 'b1' }], tables: [{ number: '101' }], settings: { openTime: '11:00' } }
    expect(call(ds, 'manager').hasRejection).toBe(false)
    const k = call(ds, 'kitchen')
    expect(k.rejected.writes.sort()).toEqual(['bookings', 'tables'])
    expect(k.rejected.settings).toBe(true)
    expect(k.writable.bookings).toBeUndefined()
    expect(k.writable.tables).toBeUndefined()
  })

  it('不得變動呼叫端傳入的原始 dataset（通知路徑仍需要原始輸入）', () => {
    const ds = { bookings: [{ id: 'b1' }], agencies: [{ id: 'a1' }], settings: { openTime: '11:00' } }
    const snapshot = JSON.stringify(ds)
    call(ds, 'floor')
    expect(JSON.stringify(ds)).toBe(snapshot)
  })

  it('空陣列不算越權（避免無資料的集合也被誤判成被拒）', () => {
    const r = call({ agencies: [], deletedIds: { bookings: [] } }, 'floor')
    expect(r.hasRejection).toBe(false)
  })

  it('message 沿用原本的中文格式，供舊 403 路徑與新回報共用', () => {
    const r = call({ agencies: [{ id: 'a1' }] }, 'floor')
    expect(r.message).toBe('角色「floor」無權：寫入 agencies')
  })
})
