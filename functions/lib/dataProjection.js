// 欄位級資料把關（讀取投影 + 寫入白名單）。純函式、不碰 Firestore / secrets，供根目錄 Vitest 直接測。
// 與 staffAccess.js 分工：RBAC（staffAccess）決定「角色能碰哪個集合」；本模組決定「集合內哪些欄位
// 可下發 / 可由客戶端寫入」。兩者正交，本模組不新增任何 permission 字串。

// 本地 digits：與 index.js 的同名工具同邏輯（只留數字），複製一份讓本模組自足可測。
function digits(value) {
  return String(value || '').replace(/\D/g, '')
}

// === 讀取投影（adminPullData）=================================================
// manageToken/token 是客人端改單/取消的密鑰，任何店員裝置都不該持有 → 所有角色一律剝除。
const BOOKING_SECRET_FIELDS = ['manageToken', 'token']
// PII 僅對 kitchen 剝除（廚房只需 date/time/人數/狀態/桌位，不需要「誰」的聯絡方式）。
const BOOKING_PII_FIELDS = ['phone', 'phoneDigits', 'lineUserId']
const WAITLIST_PII_FIELDS = ['phone', 'phoneDigits', 'lineUserId']

export function projectBookingForRead(doc, role) {
  const out = { ...doc }
  for (const f of BOOKING_SECRET_FIELDS) delete out[f] // 所有角色（含 manager）都不下發 token
  if (role === 'kitchen') for (const f of BOOKING_PII_FIELDS) delete out[f]
  return out
}

export function projectWaitlistForRead(doc, role) {
  if (role !== 'kitchen') return doc
  const out = { ...doc }
  for (const f of WAITLIST_PII_FIELDS) delete out[f]
  return out
}

// 統一入口：依集合把單一文件做讀取投影。customers 走集合層級（kitchen => []，在 index.js 處理）。
export function projectForRead(collectionName, doc, role) {
  if (collectionName === 'bookings') return projectBookingForRead(doc, role)
  if (collectionName === 'waitlist') return projectWaitlistForRead(doc, role)
  if (collectionName === 'groupReservations' && role === 'kitchen') {
    const out = { ...doc }
    delete out.guidePhone // kitchen 不需領隊聯絡電話
    return out
  }
  return doc
}

// === 寫入白名單（adminPushData）===============================================
// 伺服器權威 / 密鑰欄位：永不取自客戶端。既有單由 merge 省略保留、新單由伺服器鑄造。這是修 item 2 的核心。
export const BOOKING_SERVER_OWNED_FIELDS = [
  'manageToken', 'token',
  'phoneDigits',
  'lineUserId', 'linePushBlocked', 'lineLastNotify',
  'guestEditHistory', 'guestEditCount', 'lastGuestEditAt',
  'cancellationReason',
  'createdAt', 'createdBy',
]

// 店員可經 UI 合法寫入的欄位（僅供文件/測試參照；實際把關用下方 denylist 剝除 server-owned）。
// ⚠️ actualArrivalTime（setStatus 帶入）與 autoFlag（rollover no-show）必列入，否則同步時被靜默丟棄。
// ⚠️ status 為 client-allowed（店員設 confirmed/arrived/completed/cancelled/noshow）；
//    cancellationReason 為 server-owned（店員取消不寫它，只有客人端 guestCancelBooking 會寫）。
export const BOOKING_CLIENT_ALLOWED_FIELDS = [
  'id', 'name', 'phone', 'guests', 'date', 'timeSlot', 'notes',
  'status', 'source',
  'assignedTableId', 'extraTableIds',
  'actualArrivalTime', 'autoFlag',
  'updatedAt',
]

// 以 denylist 剝除 server-owned 欄位：保證密鑰/權威欄位絕不取自客戶端，同時不會靜默丟棄未來新增的
// 合法操作欄位（比 allowlist 更耐 schema 演進）。
export function stripServerOwnedBookingFields(clientItem = {}) {
  const out = {}
  for (const k of Object.keys(clientItem)) {
    if (BOOKING_SERVER_OWNED_FIELDS.includes(k)) continue
    out[k] = clientItem[k]
  }
  return out
}

// customers：phoneDigits 一律伺服器由 phone 推導（不取客戶端）；phone 是文件主鍵（idKey）保留。
export const CUSTOMER_SERVER_OWNED_FIELDS = ['phoneDigits']
export function stripServerOwnedCustomerFields(clientItem = {}) {
  const out = { ...clientItem }
  for (const k of CUSTOMER_SERVER_OWNED_FIELDS) delete out[k]
  return out
}

// 組裝一筆 booking 的 merge-upsert 寫入資料（取代 normalizeBookingForFirestore 對客戶端的信任）。
// 純函式：注入 now()（回傳 ISO 字串）與 mintToken()，脫離 Firestore 即可單元測試。
//   - storedDoc 為 undefined/null => 視為新單：伺服器鑄 manageToken（忽略客戶端 token）、初始化各 server 欄位。
//   - storedDoc 存在 => 既有單：省略所有 server-owned 欄位，靠 merge:true 保留 Firestore 既存值
//     （token、guestEditHistory、cancellationReason… 原封不動）。
export function buildBookingUpsertData(clientItem = {}, storedDoc, { now, mintToken } = {}) {
  const id = String(clientItem.id || '').trim()
  const isNew = !storedDoc
  const nowIso = typeof now === 'function' ? now() : new Date().toISOString()
  const safe = stripServerOwnedBookingFields(clientItem)

  const serverOwned = {}
  if (isNew) {
    // 新單合法需要 token → 伺服器鑄造；客戶端帶來的 token 一律忽略。
    serverOwned.manageToken = typeof mintToken === 'function' ? mintToken() : ''
    serverOwned.createdAt = String(clientItem.createdAt || nowIso) // 保留離線建立時間（低風險 provenance）
    serverOwned.createdBy = String(clientItem.createdBy || 'staff')
    serverOwned.guestEditHistory = []
    serverOwned.guestEditCount = 0
    serverOwned.lastGuestEditAt = null
    serverOwned.lineUserId = null
    serverOwned.cancellationReason = null
  }
  // 既有單：serverOwned 保持空 → 這些 key 不出現在寫入 payload → merge 保留 Firestore 既存值。

  const derived = {
    phoneDigits: digits(safe.phone),
    guests: Number(safe.guests) || 1,
    extraTableIds: Array.isArray(safe.extraTableIds) ? safe.extraTableIds.map(String) : [],
    updatedAt: nowIso,
  }

  // 僅新單補預設；既有單缺欄位靠 merge 保留既存值。
  const defaults = isNew
    ? { status: 'confirmed', source: 'online', notes: {}, assignedTableId: null }
    : {}

  return { ...defaults, ...safe, ...serverOwned, ...derived, id }
}
