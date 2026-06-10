import { getSettings, saveSettings } from './settingsService'
import { INITIAL_TABLES } from '../data/tables'

const DEFAULT_FUNCTION_BASE = 'https://us-central1-chicken-booking-tw.cloudfunctions.net'

const KEYS = {
  bookings: 'chicken_bookings_v1',
  tables: 'chicken_tables_v3',
  waitlist: 'chicken_waitlist_v1',
  customers: 'chicken_customers_v1',
  agencies: 'chicken_agencies_v1',
  guides: 'chicken_guides_v1',
  groupReservations: 'chicken_group_reservations_v1',
  migration: 'chicken_firestore_migrated_v1',
}

function endpoint(name) {
  const base = (import.meta.env.VITE_FUNCTION_BASE_URL || DEFAULT_FUNCTION_BASE).replace(/\/$/, '')
  return `${base}/${name}`
}

// === 員工身分 Token 提供者 ===
// admin 端點（pull/push）需要帶 Firebase ID Token。
// AuthContext / BookingContext 在啟動時呼叫 setAuthTokenProvider 注入取 token 的函式，
// 避免本檔案直接依賴 React context（這是純 service 模組）。
let _tokenProvider = null
export function setAuthTokenProvider(fn) {
  _tokenProvider = typeof fn === 'function' ? fn : null
}

async function authHeader() {
  if (!_tokenProvider) return {}
  try {
    const token = await _tokenProvider()
    return token ? { Authorization: `Bearer ${token}` } : {}
  } catch {
    return {}
  }
}

function readJson(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback))
  } catch {
    return fallback
  }
}

function writeJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value))
}

function customersArrayToMap(customers = []) {
  return customers.reduce((map, customer) => {
    if (customer?.phone) map[customer.phone] = customer
    return map
  }, {})
}

export function localDataset() {
  return {
    bookings: readJson(KEYS.bookings, []),
    tables: readJson(KEYS.tables, []),
    waitlist: readJson(KEYS.waitlist, []),
    customers: Object.values(readJson(KEYS.customers, {})),
    agencies: readJson(KEYS.agencies, []),
    guides: readJson(KEYS.guides, []),
    groupReservations: readJson(KEYS.groupReservations, []),
    settings: getSettings(),
  }
}

// === 差異同步狀態（P1-2：避免兩台裝置「全量覆寫」互相蓋掉變更）===
// 雞王現場有兩台裝置（接待台 + 二樓）同時操作。舊作法每次都把整份本機資料推上雲端、
// 每 5 秒又整份覆寫本機，導致：
//   (a) B 台推送時用自己（可能過時）的整份蓋掉 A 台剛改的桌；
//   (b) 5 秒拉取的整份覆寫，洗掉本機 250ms 推送視窗內尚未上傳的變更。
// 解法：用 lastSynced 記錄「上次與雲端確認一致」的每筆文件內容（JSON 字串），
//   - 推送時只送與 lastSynced 不同的文件（dirty），後端本就逐筆 merge-upsert；
//   - 拉取時改為合併：dirty 文件保留本機版本，其餘採雲端最新值。
const DIFF_COLLECTIONS = ['bookings', 'tables', 'waitlist', 'customers', 'agencies', 'guides', 'groupReservations']
const COLLECTION_ID_KEY = { bookings: 'id', tables: 'number', waitlist: 'id', customers: 'phone', agencies: 'id', guides: 'id', groupReservations: 'id' }
// lastSynced / pendingDeletes 由 DIFF_COLLECTIONS 動態生成，避免「加集合卻漏補字面量」→
// push 時對未知集合存取 undefined[id] 拋 TypeError，進而中斷所有集合同步（含 bookings）。
const emptyColMap = () => Object.fromEntries(DIFF_COLLECTIONS.map(c => [c, {}]))
let lastSynced = { ...emptyColMap(), settings: null }
// 本機已刪、尚未經雲端確認刪除的文件 id。用來在「刪除後、下一輪推送成功前」的
// 拉取視窗內，阻止 applyCloudSnapshot 把仍存在於雲端的文件復原回本機（修 F-A）。
const pendingDeletes = Object.fromEntries(DIFF_COLLECTIONS.map(c => [c, new Set()]))
let initialized = false

function stable(doc) { return JSON.stringify(doc ?? null) }
function idOf(collection, doc) {
  return String(doc?.[COLLECTION_ID_KEY[collection]] ?? doc?.id ?? '').trim()
}
function indexDocs(collection, arr = []) {
  const map = {}
  ;(Array.isArray(arr) ? arr : []).forEach(doc => {
    const id = idOf(collection, doc)
    if (id) map[id] = doc
  })
  return map
}
function localArrayOf(collection) {
  return collection === 'customers'
    ? Object.values(readJson(KEYS.customers, {}))
    : readJson(KEYS[collection], [])
}
function writeArrayOf(collection, arr) {
  if (collection === 'customers') writeJson(KEYS.customers, customersArrayToMap(arr))
  else writeJson(KEYS[collection], arr)
}
function seedLastSyncedFromLocal() {
  const ds = localDataset()
  for (const col of DIFF_COLLECTIONS) {
    const map = {}
    Object.entries(indexDocs(col, ds[col])).forEach(([id, doc]) => { map[id] = stable(doc) })
    lastSynced[col] = map
  }
  lastSynced.settings = stable(ds.settings)
}

// 整份推送/採用後呼叫：把目前本機狀態標記為「與雲端一致」，重置差異基準。
export function markLocalAsSynced() {
  seedLastSyncedFromLocal()
  initialized = true
}

export function applyCloudSnapshot(data = {}) {
  // 首次拉取：以雲端為準整份覆寫，並 seed lastSynced（之後才做合併）。
  if (!initialized) {
    for (const col of DIFF_COLLECTIONS) {
      const arr = data[col]
      if (!Array.isArray(arr)) continue
      if (col === 'tables' && arr.length === 0) continue // 不因雲端空白清掉桌位
      writeArrayOf(col, arr) // customers 由 writeArrayOf 轉成 phone-map，其餘為普通陣列
    }
    if (data.settings) saveSettings(data.settings)
    seedLastSyncedFromLocal()
    initialized = true
    return
  }
  // 後續拉取：合併。本機尚未推送的 dirty 文件保留本機版本，其餘採雲端最新值。
  for (const col of DIFF_COLLECTIONS) {
    const cloudArr = data[col]
    if (!Array.isArray(cloudArr)) continue
    if (col === 'tables' && cloudArr.length === 0) continue // 不因雲端空白清掉桌位
    const localMap = indexDocs(col, localArrayOf(col))
    const cloudMap = indexDocs(col, cloudArr)
    const merged = { ...cloudMap }
    // 本機剛刪、尚未經雲端確認的文件：不從雲端版本復原（修 F-A 刪除復活）。
    pendingDeletes[col].forEach(id => { delete merged[id] })
    for (const [id, doc] of Object.entries(localMap)) {
      const dirty = lastSynced[col][id] !== stable(doc)
      if (dirty) merged[id] = doc                       // 保留待推送的本機變更
      else if (cloudMap[id]) lastSynced[col][id] = stable(cloudMap[id]) // 已同步 → 採雲端值
    }
    // 雲端有、本機沒有的文件（其他裝置新增）一併納入並記為已同步；
    // 但本機正在刪除的文件不納入、也不記為已同步。
    for (const [id, doc] of Object.entries(cloudMap)) {
      if (!localMap[id] && !pendingDeletes[col].has(id)) lastSynced[col][id] = stable(doc)
    }
    writeArrayOf(col, Object.values(merged))
  }
  if (data.settings) {
    const settingsDirty = stable(getSettings()) !== lastSynced.settings
    if (!settingsDirty) { saveSettings(data.settings); lastSynced.settings = stable(data.settings) }
  }
}

async function requestJson(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || data.ok === false) {
    const err = new Error(data.error || data.reason || `request-failed-${res.status}`)
    err.status = res.status
    err.code = data.error || data.reason || ''
    throw err
  }
  return data
}

export async function pullCloudData() {
  return requestJson(endpoint('adminPullData'), {
    method: 'GET',
    headers: await authHeader(),
  })
}

export async function pushCloudData(dataset = localDataset()) {
  return requestJson(endpoint('adminPushData'), {
    method: 'POST',
    headers: await authHeader(),
    body: JSON.stringify({ dataset }),
  })
}

// P1-2：只推送與雲端不一致的文件（dirty），避免整份覆寫蓋掉其他裝置的變更。
// 後端 adminPushData 本就逐筆 merge-upsert，接受「部分資料集」。
export async function pushChangedData() {
  const ds = localDataset()
  const changed = {}
  const deletedIds = {}
  let hasChange = false
  for (const col of DIFF_COLLECTIONS) {
    const cur = indexDocs(col, ds[col])
    const list = []
    for (const [id, doc] of Object.entries(cur)) {
      if (lastSynced[col][id] !== stable(doc)) list.push(doc)
    }
    if (list.length) { changed[col] = list; hasChange = true }
    // 刪除偵測：上次同步有、現在本機沒有的文件視為「本機已刪」，請後端一併刪除。
    const removed = Object.keys(lastSynced[col]).filter(id => !(id in cur))
    if (removed.length) {
      deletedIds[col] = removed
      removed.forEach(id => pendingDeletes[col].add(id))
      hasChange = true
    }
  }
  const settingsChanged = stable(ds.settings) !== lastSynced.settings
  if (settingsChanged) { changed.settings = ds.settings; hasChange = true }
  if (!hasChange) return { ok: true, skipped: true }

  const payload = { ...changed }
  if (Object.keys(deletedIds).length) payload.deletedIds = deletedIds
  const result = await pushCloudData(payload)
  // 推送成功後，把已上傳的文件記為「與雲端一致」、把已刪除的文件移出基準與待刪集合。
  for (const col of DIFF_COLLECTIONS) {
    if (changed[col]) changed[col].forEach(doc => { lastSynced[col][idOf(col, doc)] = stable(doc) })
    if (deletedIds[col]) deletedIds[col].forEach(id => {
      delete lastSynced[col][id]
      pendingDeletes[col].delete(id)
    })
  }
  if (settingsChanged) lastSynced.settings = stable(ds.settings)
  return result
}

export async function migrateLocalToCloudOnce() {
  if (localStorage.getItem(KEYS.migration) === '1') return { ok: true, skipped: true }
  const result = await pushCloudData(localDataset())
  localStorage.setItem(KEYS.migration, '1')
  return result
}

// 一次性桌位佈局遷移：把雲端的舊桌號（如 A1–B19）刪除、改成「雞王座號圖」新桌號（101–267）。
// 必須在首次 pull 之前執行，否則首拉會用雲端舊桌位覆寫本機新桌位（見 applyCloudSnapshot 首拉分支）。
const TABLE_LAYOUT_VERSION = 'kingchicken-2026-06'
const LAYOUT_FLAG = 'chicken_table_layout_version'

export async function migrateTableLayoutOnce() {
  if (localStorage.getItem(LAYOUT_FLAG) === TABLE_LAYOUT_VERSION) return { ok: true, skipped: true }
  // 先看雲端目前有哪些桌（用來算出要刪除的舊桌號）
  let cloudTables = []
  try {
    const data = await pullCloudData()
    cloudTables = Array.isArray(data.tables) ? data.tables : []
  } catch (err) {
    // 連不上雲端就先不標記，下次載入再試（避免錯過遷移）
    return { ok: false, reason: err?.message || 'pull-failed' }
  }
  const newNumbers = new Set(INITIAL_TABLES.map(t => t.number))
  const oldNumbers = cloudTables
    .map(t => t.number)
    .filter(n => n && !newNumbers.has(n))
  // 本機先換成新桌位
  writeJson(KEYS.tables, INITIAL_TABLES)
  // 推送：寫入全部新桌 + 刪除雲端舊桌（沿用 adminPushData 的 deletedIds 機制）
  const payload = { tables: INITIAL_TABLES }
  if (oldNumbers.length) payload.deletedIds = { tables: oldNumbers }
  await pushCloudData(payload)
  localStorage.setItem(LAYOUT_FLAG, TABLE_LAYOUT_VERSION)
  return { ok: true, migrated: true, removed: oldNumbers.length }
}

// 一次性桌位「尺寸正規化」遷移：六人桌由直式（80×100）改為橫式（90×75，較寬）。
// 只依桌號把既有桌位的 x/y/w/h 對齊到新版 INITIAL_TABLES，保留 status/currentBookingId/
// seatedAt/mergedWith 等運營狀態（不像 layout 遷移會整份覆寫）。在首次 pull 之前執行，
// 並把更新後的桌位推到雲端，確保各裝置一致。
const TABLE_DIMS_VERSION = 'wide-6p-2026-06'
const DIMS_FLAG = 'chicken_table_dims_version'

export async function migrateTableDimsOnce() {
  if (localStorage.getItem(DIMS_FLAG) === TABLE_DIMS_VERSION) return { ok: true, skipped: true }
  const defByNumber = new Map(INITIAL_TABLES.map(t => [t.number, t]))
  const local = readJson(KEYS.tables, [])
  if (!Array.isArray(local) || local.length === 0) {
    // 還沒有本機桌位（會由 layout 遷移或首次 read seed 出新尺寸）→ 直接標記，避免日後誤改
    localStorage.setItem(DIMS_FLAG, TABLE_DIMS_VERSION)
    return { ok: true, skipped: true }
  }
  let changed = 0
  const patched = local.map(t => {
    const def = defByNumber.get(t.number)
    if (!def) return t
    if (t.x !== def.x || t.y !== def.y || t.w !== def.w || t.h !== def.h) {
      changed++
      return { ...t, x: def.x, y: def.y, w: def.w, h: def.h }
    }
    return t
  })
  if (changed === 0) {
    localStorage.setItem(DIMS_FLAG, TABLE_DIMS_VERSION)
    return { ok: true, skipped: true }
  }
  writeJson(KEYS.tables, patched)
  try {
    await pushCloudData({ tables: patched })
  } catch (err) {
    // 推送失敗：本機已更新、雲端尚未。先不標記旗標，下次載入再試（避免首拉用雲端舊尺寸蓋回卻不再重試）。
    return { ok: false, reason: err?.message || 'push-failed', localUpdated: true }
  }
  localStorage.setItem(DIMS_FLAG, TABLE_DIMS_VERSION)
  return { ok: true, migrated: true, changed }
}

// 團體預排桌位原子把關（員工端，需帶 Bearer token）。回 { ok, group } 或丟出含 409 的錯誤。
export async function groupReserveTables(group) {
  return requestJson(endpoint('groupReserveTables'), {
    method: 'POST',
    headers: await authHeader(),
    body: JSON.stringify({ group }),
  })
}

// 員工身分查詢（登入流程用）：可帶明確 token（AuthContext 在 BookingContext 注入
// token provider 之前就要呼叫，不能依賴 authHeader 的注入時序）。
export async function staffWhoAmI(token) {
  return requestJson(endpoint('staffWhoAmI'), {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : await authHeader(),
    body: JSON.stringify({}),
  })
}

// 管理員帳號管理（僅店長；後端硬性檢查角色）。payload: { action: 'list'|'upsert'|'remove', email, role, name }
export async function adminManageStaff(payload) {
  return requestJson(endpoint('adminManageStaff'), {
    method: 'POST',
    headers: await authHeader(),
    body: JSON.stringify(payload || {}),
  })
}

export async function guestGetAvailability(date) {
  return requestJson(endpoint('guestGetAvailability'), {
    method: 'POST',
    body: JSON.stringify({ date }),
  })
}

export async function guestCreateBooking(payload) {
  return requestJson(endpoint('guestCreateBooking'), {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function guestLookupBooking(payload) {
  return requestJson(endpoint('guestLookupBooking'), {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function guestGetBooking(bookingId, token) {
  return requestJson(endpoint('guestGetBooking'), {
    method: 'POST',
    body: JSON.stringify({ bookingId, token }),
  })
}

export async function guestUpdateBooking(bookingId, token, patch) {
  return requestJson(endpoint('guestUpdateBooking'), {
    method: 'POST',
    body: JSON.stringify({ bookingId, token, patch }),
  })
}

export async function guestCancelBooking(bookingId, token, reason) {
  return requestJson(endpoint('guestCancelBooking'), {
    method: 'POST',
    body: JSON.stringify({ bookingId, token, reason }),
  })
}
