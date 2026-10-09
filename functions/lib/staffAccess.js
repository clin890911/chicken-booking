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
    'settings.read', 'settings.update', 'settings.closures',
    'staff.manage',
  ]),
  floor: new Set([
    'booking.read', 'booking.create', 'booking.update', 'booking.assign',
    'table.read', 'table.update', 'table.block', 'table.merge',
    'waitlist.read', 'waitlist.create', 'waitlist.update',
    'customer.read', 'customer.update', 'customer.blacklist',
    // 外場帶團入座會寫 groupReservations（seatGroupBatch → groupService.setStatus('arrived')），
    // 換日掃除的 complete-group 也會（opsSweep → finalizeGroup），且掃除是開機自動跑的。
    // 少了 group.update，外場裝置只要昨天有團沒結，一開機就整包 403、整台同步全死。
    // ⚠️ 只給 update、不給 create/delete，但要清楚它們的把關層級不同：
    //   delete 由後端真的擋（COLLECTION_DELETE_PERM.groupReservations = 'group.delete'）。
    //   create **後端擋不了**——集合層的 upsert 分不出新建與更新，兩者都只看 group.update。
    //   「外場不建新團單」是前端 GroupEditorStage 的 can('group.create') 在守。
    'group.read', 'group.update',
  ]),
  host: new Set([
    'booking.read', 'booking.create', 'booking.update', 'booking.assign',
    // 帶位/指派/換桌/併桌/團體入座都會寫 tables（COLLECTION_WRITE_PERM.tables），
    // 領位台就是 host 的主場，故給 table.update；桌位維修停用(table.block)與
    // 佈局/刪桌(table.config)仍不給。
    'table.read', 'table.update',
    'waitlist.read', 'waitlist.create', 'waitlist.update',
    'customer.read', 'customer.update', 'customer.blacklist',
    'group.read', 'group.create', 'group.update', 'group.delete', 'agency.manage',
    // 窄權限：只能儲存 settings 的「休店／關閉」key（CLOSURE_SETTING_KEYS），其餘設定仍唯讀。
    // 店主用訂位專員帳號關閉場次把位子留給團體（關閉只擋線上客人）。刻意不給 settings.update：
    // 那會連 LINE／營業時間／佈局都能整份覆寫（LINE 設定已因整份覆寫被洗空三次）。
    'settings.closures',
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
  // 顧客黑名單（blacklisted／blacklistReason）是 customers 文件的欄位，集合層推送只看 customer.update；
  // 'customer.blacklist' 為語意權限（manager／host／floor 皆有、kitchen 無），與前端成對，欄位層不另擋。
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

// settings 裡屬於「休店／關閉」的頂層 key。只有 settings.closures（無 settings.update）的角色
// 只能寫這些 key，其餘一律沿用雲端值。
// ★ PR #156 的每週預設關閉（weeklySeatings）／本日開放（openSeatings）都在 closures 物件內，自然涵蓋。
// ★ 與前端 src/utils/settingsScope.js 的 CLOSURE_SETTING_KEYS 成對（有測試比對）。
export const CLOSURE_SETTING_KEYS = Object.freeze(['closures'])

// 角色對 settings 的寫入範圍：'full'（整份，manager）／'closures'（只關閉 key，host）／null（不可寫）。
export function settingsWriteScope(role) {
  if (canWriteSettings(role)) return 'full'
  if (roleCan(role, 'settings.closures')) return 'closures'
  return null
}

// === 差異推送的權限分類（adminPushData 用）===
// 背景：adminPushData 原本採「任一集合越權即整包 403」。配合前端把所有髒集合綁成同一個
// payload 推送，任何一條沒被 UI 擋住的越權寫入，都會讓該裝置**全部**集合的同步一起失敗，
// 且髒資料永遠留在本機重試、不會自癒（現場曾整天推不上雲）。此函式把 dataset 拆成
// 「可寫的」與「被拒的」，讓呼叫端能只寫可寫的部分、並如實回報被拒的部分。
//
// settings 的三種情形（settingsWriteScope）：
//   'full'     照舊整份可寫。
//   'closures' 只能寫 CLOSURE_SETTING_KEYS。🔴 必須由客戶端以 settingsChangedKeys 表態「我改了哪些 key」
//              （＝本機相對於上次同步基準線的差異）才啟用；沒表態的舊前端一律照舊拒絕整份 settings。
//              理由：host 裝置的本機 settings 可能是過時的（基準線錯位、舊表單），若後端自行拿它的
//              closures 去覆蓋雲端，會把店長剛改的關閉設定蓋回舊值。只套「客戶端真的改過」的關閉 key
//              ＝頂層 key 粒度的三方合併。改了非關閉 key 的部分不寫入、回報在 rejected.settingsKeys，
//              但不連坐（關閉 key 照寫）。
//   null       照舊拒絕。
//
// 回傳：
//   rejected      { writes: string[], deletes: string[], settings: boolean, settingsKeys?: string[] }
//   writable      剔除越權部分後的 dataset（原物件不變動）
//   message       給人看的中文說明（沿用原 403 文案格式）
//   hasRejection  是否有任何越權
//   settingsScope writable.settings 的寫入範圍：'full' | 'closures' | null（無 settings 可寫）
//   settingsKeys  settingsScope='closures' 時要套用的 key（⊆ CLOSURE_SETTING_KEYS）
export function classifyDatasetByPermission(dataset = {}, role, collectionNames = [], { settingsChangedKeys } = {}) {
  const denied = []
  const rejected = { writes: [], deletes: [], settings: false }
  const deletedIds = dataset.deletedIds || {}
  let settingsScope = null
  let settingsKeys = []

  for (const name of collectionNames) {
    if (Array.isArray(dataset[name]) && dataset[name].length && !canWriteCollection(role, name)) {
      denied.push(`寫入 ${name}`)
      rejected.writes.push(name)
    }
  }
  for (const name of collectionNames) {
    if (Array.isArray(deletedIds[name]) && deletedIds[name].length && !canDeleteCollection(role, name)) {
      denied.push(`刪除 ${name}`)
      rejected.deletes.push(name)
    }
  }
  if (dataset.settings) {
    const scope = settingsWriteScope(role)
    if (scope === 'full') {
      settingsScope = 'full'
    } else if (scope === 'closures' && Array.isArray(settingsChangedKeys)) {
      const changed = [...new Set(settingsChangedKeys.map(String))]
      settingsKeys = changed.filter(k => CLOSURE_SETTING_KEYS.includes(k))
      const ignored = changed.filter(k => !CLOSURE_SETTING_KEYS.includes(k)).sort()
      if (settingsKeys.length) settingsScope = 'closures'
      if (ignored.length) {
        denied.push(`變更設定（只能儲存休店／關閉設定；未寫入：${ignored.join('、')}）`)
        rejected.settings = true
        rejected.settingsKeys = ignored
      }
    } else {
      denied.push('變更設定')
      rejected.settings = true
    }
  }

  // 剔除越權部分（淺拷貝，不動原 dataset——呼叫端的通知路徑仍可能需要原始輸入）。
  const writable = { ...dataset }
  rejected.writes.forEach(name => { delete writable[name] })
  if (rejected.deletes.length) {
    const nextDeletes = { ...deletedIds }
    rejected.deletes.forEach(name => { delete nextDeletes[name] })
    writable.deletedIds = nextDeletes
  }
  if (!settingsScope) delete writable.settings

  return {
    rejected,
    writable,
    message: denied.length ? `角色「${role}」無權：${denied.join('、')}` : '',
    hasRejection: denied.length > 0,
    settingsScope,
    settingsKeys,
  }
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
