// 管理員帳號管理純邏輯（不碰 Firestore / auth），抽出供根目錄 Vitest 直接測試。
// 設計：環境變數 ADMIN_EMAILS = 固定管理員（店長，永遠有效，防 admins 集合誤刪鎖死）；
// admins 集合 = 後台動態新增的管理員（毋須重新部署即可增減）。

// 與前端 AuthContext 的 PERMISSIONS 角色集合成對（manager 店長 / floor 外場 / host 訂位專員 / kitchen 廚房）。
export const STAFF_ROLES = ['manager', 'floor', 'host', 'kitchen']

// email 正規化：小寫、去空白；格式不合法回空字串。
export function normalizeStaffEmail(value) {
  const s = String(value || '').trim().toLowerCase()
  // 寬鬆但足夠的 email 格式（Google 帳號一定過得了；擋掉手滑輸入）
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s) ? s : ''
}

// 角色正規化：非法角色一律降為 floor（與前端「沒指定預設 floor」同口徑）。
export function resolveStaffRole(value) {
  return STAFF_ROLES.includes(value) ? value : 'floor'
}

// === 角色權限矩陣（後端把關用）===
// 與前端 src/contexts/AuthContext.jsx 的 PERMISSIONS 成對；前端負責 UI 隱藏、後端負責真正擋寫。
// 任何已授權員工都能呼叫 adminPushData，故必須在後端依角色檢查「寫入/刪除/改設定」的權限，
// 否則 kitchen（廚房唯讀）也能改/刪訂位、桌位、顧客、團體、設定。
// 註：相較前端，manager 多了 'customer.delete'（顧客刪除為高權限、僅店長），前端亦同步補上。
export const PERMISSIONS = {
  manager: new Set([
    'booking.read', 'booking.create', 'booking.update', 'booking.delete', 'booking.assign',
    'table.read', 'table.update', 'table.block', 'table.merge', 'table.config',
    'waitlist.read', 'waitlist.create', 'waitlist.update', 'waitlist.delete',
    'customer.read', 'customer.update', 'customer.delete', 'customer.blacklist',
    'group.read', 'group.create', 'group.update', 'group.delete', 'agency.manage',
    'settings.read', 'settings.update',
    'staff.manage',
  ]),
  floor: new Set([
    'booking.read', 'booking.create', 'booking.update', 'booking.assign',
    'table.read', 'table.update', 'table.block', 'table.merge',
    'waitlist.read', 'waitlist.create', 'waitlist.update',
    'customer.read', 'customer.update',
    'group.read',
  ]),
  host: new Set([
    'booking.read', 'booking.create', 'booking.update', 'booking.assign',
    'table.read',
    'waitlist.read', 'waitlist.create', 'waitlist.update',
    'customer.read', 'customer.update',
    'group.read', 'group.create', 'group.update', 'group.delete', 'agency.manage',
  ]),
  kitchen: new Set([
    'booking.read',
    'table.read',
    'waitlist.read',
    'group.read',
  ]),
}

// 同步集合 → 寫入(upsert)所需權限。adminPushData 以此把關每個 dataset 集合。
const COLLECTION_WRITE_PERM = {
  bookings: 'booking.update',
  tables: 'table.update',
  waitlist: 'waitlist.update',
  customers: 'customer.update',
  agencies: 'agency.manage',
  guides: 'agency.manage',
  groupReservations: 'group.update',
}

// 同步集合 → 刪除(deletedIds)所需權限。刪除一律比寫入更高權（多為 manager-only）。
const COLLECTION_DELETE_PERM = {
  bookings: 'booking.delete',
  tables: 'table.config',
  waitlist: 'waitlist.delete',
  customers: 'customer.delete',
  agencies: 'agency.manage',
  guides: 'agency.manage',
  groupReservations: 'group.delete',
}

// 角色是否具備某權限。未知角色 → 一律否。
export function roleCan(role, permission) {
  const set = PERMISSIONS[role]
  return set ? set.has(permission) : false
}

// 角色可否寫入某同步集合。未知集合保守視為高權限（僅 manager）。
export function canWriteCollection(role, collection) {
  const perm = COLLECTION_WRITE_PERM[collection]
  if (!perm) return role === 'manager'
  return roleCan(role, perm)
}

// 角色可否刪除某同步集合的文件。未知集合保守視為高權限（僅 manager）。
export function canDeleteCollection(role, collection) {
  const perm = COLLECTION_DELETE_PERM[collection]
  if (!perm) return role === 'manager'
  return roleCan(role, perm)
}

// 角色可否變更店家設定（settings/main）。僅 manager。
export function canWriteSettings(role) {
  return roleCan(role, 'settings.update')
}

// 新增/更新管理員的輸入驗證 + 清洗。
export function validateStaffUpsert({ email, role, name } = {}) {
  const cleanEmail = normalizeStaffEmail(email)
  if (!cleanEmail) return { ok: false, error: 'email 格式不正確' }
  if (role !== undefined && role !== null && role !== '' && !STAFF_ROLES.includes(role)) {
    return { ok: false, error: `角色必須是 ${STAFF_ROLES.join(' / ')} 其中之一` }
  }
  return {
    ok: true,
    value: {
      email: cleanEmail,
      role: resolveStaffRole(role),
      name: String(name || '').trim().slice(0, 40),
    },
  }
}
