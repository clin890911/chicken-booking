import crypto from 'node:crypto'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { getAuth } from 'firebase-admin/auth'
import { onRequest } from 'firebase-functions/v2/https'
import { onSchedule } from 'firebase-functions/v2/scheduler'
import { defineSecret } from 'firebase-functions/params'
import {
  notificationStateHash,
  shouldSkipDuplicatePush,
  isRetryableLineStatus,
  dayLabelServer,
  buildManageUrl,
  classifyAdminBookingChange,
} from './lib/notify.js'
import {
  normalizeOnlineGuardSettings,
  isOverAutoCloseThreshold,
  isPastSessionCutoff,
} from './lib/onlineGuards.js'
import {
  normalizeStaffEmail,
  resolveStaffRole,
  validateStaffUpsert,
} from './lib/staffAccess.js'
import { isTableUsableOnDate } from './lib/tableUsable.js'
import {
  slotEpochMs,
  buildMyBookingsList,
} from './lib/myBookings.js'

initializeApp()

const db = getFirestore()

// 員工白名單（後端唯一真相，設定於 functions/.env 的 ADMIN_EMAILS，逗號分隔）。
// 沒設定時退回單一預設管理員，避免部署後完全無法登入。
const STAFF_EMAILS = String(process.env.ADMIN_EMAILS || 'berrylin0911@gmail.com')
  .split(',')
  .map(s => s.trim().toLowerCase())
  .filter(Boolean)

// 驗證請求帶有有效的 Firebase ID Token，且 email 是有效員工。
// 員工兩個來源：(1) 環境變數白名單（固定管理員，role 一律 manager，永遠有效——
// 防 admins 集合誤刪後完全鎖死）；(2) Firestore admins 集合（後台動態新增，毋須重新部署）。
// 失敗時丟出帶 status 的錯誤，由各端點轉成 401/403。
async function requireStaff(req) {
  const header = req.get('authorization') || req.get('Authorization') || ''
  const match = header.match(/^Bearer\s+(.+)$/i)
  if (!match) throw errorWithStatus('missing-auth-token', 401)
  let decoded
  try {
    decoded = await getAuth().verifyIdToken(match[1])
  } catch {
    throw errorWithStatus('invalid-auth-token', 401)
  }
  const email = String(decoded.email || '').toLowerCase()
  if (!email) throw errorWithStatus('not-authorized', 403)
  if (STAFF_EMAILS.includes(email)) return { uid: decoded.uid, email, role: 'manager', source: 'env' }
  try {
    const snap = await db.collection('admins').doc(email).get()
    if (snap.exists && snap.data().active !== false) {
      return { uid: decoded.uid, email, role: resolveStaffRole(snap.data().role), source: 'db' }
    }
  } catch (err) {
    // 查詢失敗（非「不存在」）時保守拒絕，但留 log 供排查。
    console.error('admins lookup failed:', err)
  }
  throw errorWithStatus('not-authorized', 403)
}
const LINE_CHANNEL_ACCESS_TOKEN = defineSecret('LINE_CHANNEL_ACCESS_TOKEN')
const LINE_CHANNEL_SECRET = defineSecret('LINE_CHANNEL_SECRET')

// 內場通知用 Telegram bot（取代過去前端持有 bot token 的做法，P0-4）。
// token 與 chat id 皆以 Secret Manager 管理，不進前端 bundle。
const TELEGRAM_BOT_TOKEN = defineSecret('TELEGRAM_BOT_TOKEN')
const TELEGRAM_CHAT_ID = defineSecret('TELEGRAM_CHAT_ID')

const LINE_REPLY_URL = 'https://api.line.me/v2/bot/message/reply'
const LINE_PUSH_URL = 'https://api.line.me/v2/bot/message/push'
const DEFAULT_STORE_ADDRESS = '南投縣鹿谷鄉中正路二段377號'
const DEFAULT_STORE_MAP_URL = 'https://www.google.com/maps/search/?api=1&query=%E5%8D%97%E6%8A%95%E7%B8%A3%E9%B9%BF%E8%B0%B7%E9%84%89%E4%B8%AD%E6%AD%A3%E8%B7%AF%E4%BA%8C%E6%AE%B5377%E8%99%9F'
const DEFAULT_STORE_LATITUDE = '23.7523874'
const DEFAULT_STORE_LONGITUDE = '120.746746'
const DEFAULT_STORE_PHONE = '049-2753377'
const DEFAULT_DINING_DURATION_MIN = 90
const DEFAULT_CLEANUP_BUFFER_MIN = 10
const LINE_BIND_PUSH_DEDUPE_MS = 10 * 60 * 1000
const PUBLIC_CORS = true

const COLLECTIONS = {
  bookings: 'bookings',
  tables: 'tables',
  waitlist: 'waitlist',
  customers: 'customers',
  agencies: 'agencies',
  guides: 'guides',
  groupReservations: 'groupReservations',
}

// 差異同步集合 → 文件主鍵。adminPull/Push 以此泛型迴圈遍歷，未來加集合只改這一處
// （根治「舊後端寫死四集合、靜默丟棄新集合」造成的前端誤判已同步→資料蒸發）。
const SYNC_COLLECTION_IDKEYS = {
  bookings: 'id',
  tables: 'number',
  waitlist: 'id',
  customers: 'phone',
  agencies: 'id',
  guides: 'id',
  groupReservations: 'id',
}

export const adminPullData = onRequest({ cors: PUBLIC_CORS, invoker: 'public' }, async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'method-not-allowed' })
  try {
    await requireStaff(req)
  } catch (err) {
    return res.status(err.status || 401).json({ ok: false, error: err.message || 'unauthorized' })
  }
  try {
    const names = Object.keys(SYNC_COLLECTION_IDKEYS)
    const [lists, settingsSnap] = await Promise.all([
      Promise.all(names.map(n => listCollection(n))),
      db.collection('settings').doc('main').get(),
    ])
    const out = { ok: true, serverCollections: names }
    names.forEach((n, i) => { out[n] = lists[i] })
    // 穩定排序（與舊版輸出一致）
    if (out.bookings) out.bookings.sort(sortBookings)
    if (out.tables) out.tables.sort((a, b) => String(a.number || '').localeCompare(String(b.number || '')))
    if (out.waitlist) out.waitlist.sort((a, b) => String(a.takenAt || '').localeCompare(String(b.takenAt || '')))
    out.settings = normalizeStoreSettings(settingsSnap.exists ? settingsSnap.data() : {})
    return res.json(out)
  } catch (err) {
    console.error('adminPullData failed:', err)
    return res.status(500).json({ ok: false, error: err.message || 'admin-pull-failed' })
  }
})

export const adminPushData = onRequest({ cors: PUBLIC_CORS, invoker: 'public' }, async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method-not-allowed' })
  try {
    await requireStaff(req)
  } catch (err) {
    return res.status(err.status || 401).json({ ok: false, error: err.message || 'unauthorized' })
  }
  try {
    const { dataset = {} } = req.body || {}
    // 泛型遍歷所有同步集合做 merge-upsert（接受「部分資料集」，未帶的集合略過）。
    const ops = []
    for (const [name, idKey] of Object.entries(SYNC_COLLECTION_IDKEYS)) {
      ops.push(...upsertOps(name, dataset[name] || [], idKey))
    }
    // 差異同步的刪除路徑：前端把「本機已刪」的文件 id 放在 dataset.deletedIds，
    // 後端逐集合刪除，避免硬刪除的文件在下一輪拉取時復活（修 F-A）。
    const deletedIds = dataset.deletedIds || {}
    for (const name of Object.keys(SYNC_COLLECTION_IDKEYS)) {
      ops.push(...deleteOps(name, deletedIds[name]))
    }
    if (dataset.settings) {
      ops.push({ ref: db.collection('settings').doc('main'), data: {
        ...normalizeStoreSettings(dataset.settings),
        updatedAt: new Date().toISOString(),
      } })
    }
    ops.push({ ref: db.collection('system').doc('sync'), data: { lastAdminPushAt: new Date().toISOString() } })
    // 店員端改訂位 LINE 通知（feature flag lineNotifyOnAdminChange，預設關）：
    // 開關開啟時才在 commit「前」讀舊值（merge-upsert 不讀舊值，diff 需要 before 快照），
    // commit「成功後」才分類入列——先寫成功才通知，避免通知了卻沒寫進去。
    const notifySettings = await readSettingsForAdminNotify(dataset.settings)
    const beforeBookings = notifySettings.lineNotifyOnAdminChange === true
      ? await snapshotBookingsBefore(dataset.bookings)
      : new Map()
    // F-F：分批提交（≤450/批），避免資料量超過 Firestore 單一 batch 500 筆上限時整批失敗。
    await commitInChunks(ops)
    await notifyAdminBookingChanges(beforeBookings, dataset.bookings, notifySettings)
    return res.json({ ok: true })
  } catch (err) {
    console.error('adminPushData failed:', err)
    return res.status(500).json({ ok: false, error: err.message || 'admin-push-failed' })
  }
})

// 員工身分查詢：前端登入後用來確認「這個 Google 帳號是不是有效員工、角色為何」。
// 動態管理員（admins 集合）不在前端建置期環境變數內，必須靠這支在執行期判斷。
export const staffWhoAmI = onRequest({ cors: PUBLIC_CORS, invoker: 'public' }, async (req, res) => {
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ ok: false, error: 'method-not-allowed' })
  try {
    const staff = await requireStaff(req)
    return res.json({ ok: true, email: staff.email, role: staff.role, source: staff.source })
  } catch (err) {
    return res.status(err.status || 401).json({ ok: false, error: err.message || 'unauthorized' })
  }
})

// 管理員帳號管理（僅店長）：list / upsert / remove。
// 刻意不走 adminPushData 同步管線：admins 集合只能經過這支「後端角色硬檢查」的端點寫入，
// 避免任何已登入員工都能用開放的 push 端點自抬權限。
export const adminManageStaff = onRequest({ cors: PUBLIC_CORS, invoker: 'public' }, async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method-not-allowed' })
  let staff
  try {
    staff = await requireStaff(req)
  } catch (err) {
    return res.status(err.status || 401).json({ ok: false, error: err.message || 'unauthorized' })
  }
  if (staff.role !== 'manager') {
    return res.status(403).json({ ok: false, error: '僅店長可管理管理員帳號' })
  }
  try {
    const { action, email, role, name } = req.body || {}

    if (action === 'list') {
      const snap = await db.collection('admins').get()
      const admins = snap.docs
        .map(d => ({ email: d.id, ...d.data() }))
        .sort((a, b) => a.email.localeCompare(b.email))
      return res.json({ ok: true, envAdmins: STAFF_EMAILS, admins })
    }

    if (action === 'upsert') {
      const clean = validateStaffUpsert({ email, role, name })
      if (!clean.ok) return res.status(400).json({ ok: false, error: clean.error })
      if (STAFF_EMAILS.includes(clean.value.email)) {
        return res.status(400).json({ ok: false, error: '此帳號為固定管理員（部署白名單），毋須新增' })
      }
      const now = new Date().toISOString()
      const ref = db.collection('admins').doc(clean.value.email)
      const prev = await ref.get()
      await ref.set({
        email: clean.value.email,
        role: clean.value.role,
        name: clean.value.name,
        active: true,
        addedBy: prev.exists ? (prev.data().addedBy || staff.email) : staff.email,
        createdAt: prev.exists ? (prev.data().createdAt || now) : now,
        updatedAt: now,
      })
      return res.json({ ok: true })
    }

    if (action === 'remove') {
      const norm = normalizeStaffEmail(email)
      if (!norm) return res.status(400).json({ ok: false, error: 'email 格式不正確' })
      if (norm === staff.email) return res.status(400).json({ ok: false, error: '不能移除自己的帳號' })
      await db.collection('admins').doc(norm).delete()
      return res.json({ ok: true })
    }

    return res.status(400).json({ ok: false, error: 'unknown-action' })
  } catch (err) {
    console.error('adminManageStaff failed:', err)
    return res.status(500).json({ ok: false, error: err.message || 'manage-staff-failed' })
  }
})

// 讀取本次推送涉及訂位的「commit 前」狀態（每批 ≤300 筆 getAll）。失敗回空 Map（通知靜默跳過，不影響同步）。
async function snapshotBookingsBefore(bookings) {
  const map = new Map()
  try {
    const ids = (Array.isArray(bookings) ? bookings : [])
      .map(b => String(b?.id || '').trim())
      .filter(Boolean)
    if (!ids.length) return map
    for (let i = 0; i < ids.length; i += 300) {
      const refs = ids.slice(i, i + 300).map(id => db.collection(COLLECTIONS.bookings).doc(id))
      const snaps = await db.getAll(...refs)
      snaps.forEach(snap => { if (snap.exists) map.set(snap.id, snap.data()) })
    }
  } catch (err) {
    console.error('snapshotBookingsBefore failed:', err?.message)
  }
  return map
}

// 讀取通知判斷用 settings：以 Firestore 現值為底、疊上本次一併推送的 settings（若有），
// 確保「同一筆 push 裡打開開關」也立即生效。
async function readSettingsForAdminNotify(incomingSettings) {
  try {
    const snap = await db.collection('settings').doc('main').get()
    return normalizeStoreSettings({
      ...(snap.exists ? snap.data() : {}),
      ...(incomingSettings || {}),
    })
  } catch (err) {
    console.error('readSettingsForAdminNotify failed:', err?.message)
    return normalizeStoreSettings(incomingSettings || {})
  }
}

// 店員端變更 → 客人 LINE 通知：只通知「客人在意的變更」（取消、改期/時段/人數），
// 內務操作（指派桌位、入座、結帳、noshow、備註）一律靜默；見 classifyAdminBookingChange。
// 入列走 queueOnly（不立即送、不需 LINE secret），由 retryNotifications ≤2 分鐘代送；
// stateHash 防重擋雙裝置對同一變更的重複入列。錯誤只記 log，不影響同步回應。
async function notifyAdminBookingChanges(beforeMap, bookings, settings) {
  try {
    if (settings.lineNotifyOnAdminChange !== true) return
    if (!beforeMap.size || !Array.isArray(bookings) || !bookings.length) return
    for (const incoming of bookings) {
      const id = String(incoming?.id || '').trim()
      if (!id) continue
      const before = beforeMap.get(id)
      const event = classifyAdminBookingChange(before, incoming)
      if (!event) continue
      // 通知內容以 commit 後的權威文件為準（merge-upsert 後可能含 client 沒帶齊的欄位）
      const freshSnap = await db.collection(COLLECTIONS.bookings).doc(id).get()
      if (!freshSnap.exists) continue
      await notifyLineBookingChange(id, { id: freshSnap.id, ...freshSnap.data() }, event, settings, { queueOnly: true })
    }
  } catch (err) {
    console.error('notifyAdminBookingChanges failed:', err?.message)
  }
}

// 團體預排桌位的原子把關：多裝置可能在 5 秒同步空窗內把同一桌圈進不同團，純前端檢查不可靠。
// 此端點在交易內讀取同日所有團、做「梯次時間窗重疊 + 桌號相同」衝突檢查，無衝突才寫入該團單。
// 前端建/改團、變更圈桌時呼叫；衝突回 409 並附明細。
export const groupReserveTables = onRequest({ cors: PUBLIC_CORS, invoker: 'public' }, async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method-not-allowed' })
  try {
    await requireStaff(req)
  } catch (err) {
    return res.status(err.status || 401).json({ ok: false, error: err.message || 'unauthorized' })
  }
  try {
    const { group } = req.body || {}
    if (!group?.id || !group?.date) return res.status(400).json({ ok: false, error: '缺少團單 id 或日期' })

    const settingsSnap = await db.collection('settings').doc('main').get()
    const settings = normalizeStoreSettings(settingsSnap.exists ? settingsSnap.data() : {})
    const durationMin = (Number(settings.diningDurationMin) || DEFAULT_DINING_DURATION_MIN) + (Number(settings.cleanupBufferMin) || DEFAULT_CLEANUP_BUFFER_MIN)

    // 關閉的時段/場次/公休日不可圈桌（與散客一致；繞過前端也擋得住）。
    const closedBatch = (group.batches || []).find(b => (b.tableNumbers || []).length && isSlotClosedServer(settings, group.date, b.timeSlot))
    if (closedBatch) {
      return res.status(409).json({ ok: false, error: `「${closedBatch.label || closedBatch.timeSlot}」所在時段已關閉訂位，無法圈桌` })
    }

    const groupsRef = db.collection(COLLECTIONS.groupReservations)
    const saved = await db.runTransaction(async (tx) => {
      // ★ 所有 read 必須在所有 write 之前：同日「其他團」+「一般訂位已指派桌」一起讀。
      const [daySnap, bookingsSnap] = await Promise.all([
        tx.get(groupsRef.where('date', '==', group.date)),
        tx.get(db.collection(COLLECTIONS.bookings).where('date', '==', group.date)),
      ])
      const others = daySnap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(g => g.id !== group.id && !CAPACITY_EXCLUDED_STATUSES.includes(g.status))
      const assignedBookings = bookingsSnap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(b => b.assignedTableId && b.timeSlot && !CAPACITY_EXCLUDED_STATUSES.includes(b.status))

      const conflicts = []
      for (const b of group.batches || []) {
        const s = toMinutes(b.timeSlot)
        const e = s + durationMin
        const wanted = new Set((b.tableNumbers || []).map(String))
        if (!wanted.size) continue
        // 與其他團衝突
        for (const og of others) {
          for (const ob of og.batches || []) {
            const os = toMinutes(ob.timeSlot)
            const oe = os + durationMin
            if (!(s < oe && os < e)) continue // 時間窗不重疊 → 同桌可重用
            for (const n of ob.tableNumbers || []) {
              if (wanted.has(String(n))) {
                conflicts.push({ table: String(n), withGroupId: og.id, withAgency: og.agencyName || '', batch: b.label })
              }
            }
          }
        }
        // 與一般訂位已指派桌衝突
        for (const bk of assignedBookings) {
          const bs = toMinutes(bk.timeSlot)
          const be = bs + durationMin
          if (!(s < be && bs < e)) continue
          if (wanted.has(String(bk.assignedTableId))) {
            conflicts.push({ table: String(bk.assignedTableId), withBookingId: bk.id, batch: b.label })
          }
        }
      }
      if (conflicts.length) {
        const tablesList = [...new Set(conflicts.map(c => c.table))].join('、')
        throw errorWithStatus(`桌位衝突：${tablesList} 已被其他團或現場訂位佔用`, 409)
      }

      const record = { ...group, updatedAt: new Date().toISOString() }
      tx.set(groupsRef.doc(group.id), record, { merge: true })
      return record
    })

    return res.json({ ok: true, group: saved })
  } catch (err) {
    const code = err.status || 500
    if (code >= 500) console.error('groupReserveTables failed:', err)
    return res.status(code).json({ ok: false, error: err.message || 'group-reserve-failed' })
  }
})

export const guestLookupBooking = onRequest({ cors: PUBLIC_CORS, invoker: 'public' }, async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method-not-allowed' })
  try {
    await enforceRateLimit(req, 'guestLookupBooking')
    const input = req.body || {}
    const mode = String(input.mode || 'identity')
    let matches = []

    if (mode === 'code') {
      const bookingId = String(input.bookingId || '').trim()
      const phoneInput = digits(input.phone || input.phoneTail || '')
      if (!bookingId || phoneInput.length < 3) return res.status(400).json({ ok: false, error: '請輸入訂位編號與電話末碼' })
      const snap = await db.collection(COLLECTIONS.bookings).doc(bookingId).get()
      if (snap.exists) {
        const booking = { id: snap.id, ...snap.data() }
        if (phoneMatches(booking.phone, phoneInput)) matches = [booking]
      }
    } else {
      const surname = String(input.surname || '').trim()
      const phone = digits(input.phone || '')
      if (!surname || phone.length < 7) return res.status(400).json({ ok: false, error: '請輸入訂位姓氏與完整電話' })
      const snap = await db.collection(COLLECTIONS.bookings).where('phoneDigits', '==', phone).get()
      matches = snap.docs
        .map(doc => ({ id: doc.id, ...doc.data() }))
        .filter(b => String(b.name || '').trim().startsWith(surname))
    }

    const items = matches
      .sort(sortBookings)
      .map(safeBookingSummary)

    return res.json({ ok: true, items })
  } catch (err) {
    const code = err.status || 500
    if (code >= 500) console.error('guestLookupBooking failed:', err)
    return res.status(code).json({ ok: false, error: err.message || 'guest-lookup-failed' })
  }
})

// 客人端「可訂時段查詢」：只回傳每個時段的剩餘人數與公開店家設定，
// 不含任何顧客個資（取代過去客人瀏覽器全量下載整個資料庫的做法）。
export const guestGetAvailability = onRequest({ cors: PUBLIC_CORS, invoker: 'public' }, async (req, res) => {
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ ok: false, error: 'method-not-allowed' })
  try {
    const input = req.method === 'GET' ? req.query : req.body || {}
    const date = normalizeDateInput(input.date)
    const settingsSnap = await db.collection('settings').doc('main').get()
    const settings = normalizeStoreSettings(settingsSnap.exists ? settingsSnap.data() : {})

    let slots = []
    if (date) {
      const [tables, bookingsSnap, groupsSnap] = await Promise.all([
        listCollection(COLLECTIONS.tables),
        db.collection(COLLECTIONS.bookings).where('date', '==', date).get(),
        db.collection(COLLECTIONS.groupReservations).where('date', '==', date).get(),
      ])
      const bookings = bookingsSnap.docs.map(d => ({ id: d.id, ...d.data() }))
      const groupReservations = groupsSnap.docs.map(d => ({ id: d.id, ...d.data() }))
      const nowMs = Date.now()
      const totalSeats = activeTotalSeatsServer(tables, date)
      slots = generateSlotsServer(settings)
        // 濾掉「已過的時段」：今天已過的抵達時段不再顯示為可訂（其他日期的時段都在未來，不受影響）。
        .filter(time => slotEpochMs(date, time) > nowMs)
        .map(time => {
          // 團體預排佔位一併扣除（只回傳數值 remaining，絕不外洩 groupReservations 明細）。
          const remaining = calcSlotCapacityServer(tables, bookings, date, time, settings, groupReservations)
          return {
            time,
            remaining,
            // 已關閉旗標：店休/關閉、場次前截止、滿座門檻任一成立即對線上客人關閉。
            closed: isSlotClosedServer(settings, date, time)
              || isPastSessionCutoff({ nowMs, slotMs: slotEpochMs(date, time), sessionStartMs: sessionCutoffAnchorMs(settings, date, time), cutoffMin: settings.onlineSessionCutoffMin })
              || isOverAutoCloseThreshold({ totalSeats, remaining, enabled: settings.onlineAutoCloseEnabled, percent: settings.onlineAutoClosePercent }),
          }
        })
    }

    return res.json({ ok: true, date, slots, settings: publicStoreSettings(settings) })
  } catch (err) {
    console.error('guestGetAvailability failed:', err)
    return res.status(500).json({ ok: false, error: err.message || 'availability-failed' })
  }
})

// 客人端「建立訂位」：含完整輸入驗證 + Firestore 交易內的原子容量檢查，
// 確保不會超賣（兩組客人同時搶最後座位只會成立到容量上限）。
export const guestCreateBooking = onRequest({ cors: PUBLIC_CORS, invoker: 'public', secrets: [TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID] }, async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method-not-allowed' })
  try {
    await enforceRateLimit(req, 'guestCreateBooking')
    const settingsSnap = await db.collection('settings').doc('main').get()
    const settings = normalizeStoreSettings(settingsSnap.exists ? settingsSnap.data() : {})

    const clean = validateNewBooking(req.body || {}, settings)
    if (!clean.ok) return res.status(400).json({ ok: false, error: clean.error })
    const data = clean.value

    const bookingId = 'B' + Date.now().toString(36).toUpperCase() + crypto.randomBytes(2).toString('hex').toUpperCase()
    const manageToken = createServerToken()
    const now = new Date().toISOString()
    const bookingsRef = db.collection(COLLECTIONS.bookings)

    const booking = await db.runTransaction(async (tx) => {
      // ★ Firestore 交易：所有 read 必須在所有 write 之前。團體佔位讀取與既有兩個 get 並列。
      const [tablesSnap, dateSnap, groupsSnap] = await Promise.all([
        tx.get(db.collection(COLLECTIONS.tables)),
        tx.get(bookingsRef.where('date', '==', data.date)),
        tx.get(db.collection(COLLECTIONS.groupReservations).where('date', '==', data.date)),
      ])
      const tables = tablesSnap.docs.map(d => ({ id: d.id, ...d.data() }))
      const dayBookings = dateSnap.docs.map(d => ({ id: d.id, ...d.data() }))
      const dayGroups = groupsSnap.docs.map(d => ({ id: d.id, ...d.data() }))

      // 防重複：同電話 + 同日 + 同時段已有有效訂位 → 視為重複送出
      const dup = dayBookings.find(b =>
        digits(b.phone) === data.phoneDigits &&
        b.timeSlot === data.timeSlot &&
        !['cancelled', 'noshow'].includes(b.status))
      if (dup) throw errorWithStatus('您已有相同時段的訂位，無需重複預訂', 409)

      const remaining = calcSlotCapacityServer(tables, dayBookings, data.date, data.timeSlot, settings, dayGroups)
      // 滿座門檻自動關閉：已訂達總容量門檻 % 時，線上不再收（剩餘座位留給現場/電話）。
      if (isOverAutoCloseThreshold({ totalSeats: activeTotalSeatsServer(tables, data.date), remaining, enabled: settings.onlineAutoCloseEnabled, percent: settings.onlineAutoClosePercent })) {
        throw errorWithStatus('此時段線上訂位已截止（接近滿座），歡迎來電洽詢', 409)
      }
      if (remaining < data.guests) throw errorWithStatus('此時段目前已無足夠座位，請改選其他時段', 409)

      const record = {
        id: bookingId,
        name: data.name,
        phone: data.phone,
        phoneDigits: data.phoneDigits,
        guests: data.guests,
        date: data.date,
        timeSlot: data.timeSlot,
        notes: data.notes,
        source: 'online',
        status: 'confirmed',
        assignedTableId: null,
        lineUserId: null,
        manageToken,
        lastGuestEditAt: null,
        guestEditCount: 0,
        guestEditHistory: [],
        cancellationReason: null,
        createdAt: now,
        updatedAt: now,
        createdBy: 'guest',
      }
      tx.set(bookingsRef.doc(bookingId), record)
      return record
    })

    // 顧客檔 upsert（交易外，best-effort，不影響訂位成立）
    try {
      await db.collection(COLLECTIONS.customers).doc(booking.phoneDigits).set({
        phone: booking.phone,
        phoneDigits: booking.phoneDigits,
        name: booking.name,
        lastPartySize: booking.guests,
        lastSource: 'online',
        updatedAt: now,
      }, { merge: true })
    } catch (e) {
      console.warn('customer upsert skipped:', e?.message)
    }

    // 內場通知改走 outbox：寫一筆 → 立即試送，失敗由 retryNotifications 自動補送。
    await enqueueAndTrySend({
      channel: 'telegram',
      event: 'created',
      bookingId: booking.id,
      payload: { text: tgBookingMessage('🆕 <b>新線上訂位</b>', booking, { event: 'booking_created', booking }) },
    })

    return res.json({ ok: true, booking })
  } catch (err) {
    const code = err.status || 500
    if (code >= 500) console.error('guestCreateBooking failed:', err)
    return res.status(code).json({ ok: false, error: err.message || 'guest-create-failed' })
  }
})

export const guestGetBooking = onRequest({ cors: PUBLIC_CORS, invoker: 'public' }, async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method-not-allowed' })
  try {
    const { bookingId, token } = req.body || {}
    const booking = await getBookingByToken(bookingId, token)
    const settingsSnap = await db.collection('settings').doc('main').get()
    return res.json({ ok: true, booking, store: normalizeStoreSettings(settingsSnap.exists ? settingsSnap.data() : {}) })
  } catch (err) {
    const code = err.status || 500
    return res.status(code).json({ ok: false, error: err.message || 'guest-get-failed' })
  }
})

export const guestUpdateBooking = onRequest({ cors: PUBLIC_CORS, invoker: 'public', secrets: [TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, LINE_CHANNEL_ACCESS_TOKEN] }, async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method-not-allowed' })
  try {
    const { bookingId, token, patch = {} } = req.body || {}
    const booking = await getBookingByToken(bookingId, token)
    const editable = guestEditable(booking)
    if (!editable.ok) return res.status(409).json({ ok: false, error: editable.reason })

    const settingsSnap = await db.collection('settings').doc('main').get()
    const settings = normalizeStoreSettings(settingsSnap.exists ? settingsSnap.data() : {})
    const next = sanitizeGuestPatch(booking, patch)
    const structural = ['date', 'timeSlot', 'guests'].some(key => String(next[key]) !== String(booking[key]))

    const now = new Date().toISOString()
    const changedKeys = Object.keys(next).filter(key => JSON.stringify(next[key]) !== JSON.stringify(booking[key]))
    const historyEntry = {
      id: createServerToken().slice(0, 12),
      type: 'guest_update',
      at: now,
      changedKeys,
      before: pickBookingHistory(booking),
      after: pickBookingHistory({ ...booking, ...next, assignedTableId: structural ? null : booking.assignedTableId }),
    }
    const updatePatch = {
      ...next,
      ...(structural ? { assignedTableId: null } : {}),
      phoneDigits: digits(next.phone),
      lastGuestEditAt: now,
      guestEditCount: (Number(booking.guestEditCount) || 0) + 1,
      guestEditHistory: appendGuestHistory(booking.guestEditHistory, historyEntry),
      updatedAt: now,
    }

    const bookingRef = db.collection(COLLECTIONS.bookings).doc(booking.id)
    if (structural) {
      // 改期目標時段須通過與新訂位相同的線上防線。
      // （補既有缺口：過去只檢查容量，沒擋「已過 / 已關閉 / 場次截止」的目標時段。）
      if (slotEpochMs(next.date, next.timeSlot) <= Date.now()) {
        return res.status(409).json({ ok: false, error: '此時段已過，請選擇較晚的時段' })
      }
      if (isSlotClosedServer(settings, next.date, next.timeSlot)) {
        return res.status(409).json({ ok: false, error: '此時段已關閉訂位，請改選其他時段' })
      }
      if (isPastSessionCutoff({ nowMs: Date.now(), slotMs: slotEpochMs(next.date, next.timeSlot), sessionStartMs: sessionCutoffAnchorMs(settings, next.date, next.timeSlot), cutoffMin: settings.onlineSessionCutoffMin })) {
        return res.status(409).json({ ok: false, error: '此場次的線上訂位已截止，歡迎來電洽詢' })
      }
      // F-E：容量檢查與寫入放進同一交易，與 guestCreateBooking 對齊，避免兩筆並發改期
      // 同時通過容量檢查造成超賣（TOCTOU）。
      await db.runTransaction(async (tx) => {
        const [tablesSnap, dateSnap, groupsSnap] = await Promise.all([
          tx.get(db.collection(COLLECTIONS.tables)),
          tx.get(db.collection(COLLECTIONS.bookings).where('date', '==', next.date)),
          tx.get(db.collection(COLLECTIONS.groupReservations).where('date', '==', next.date)),
        ])
        const tables = tablesSnap.docs.map(d => ({ id: d.id, ...d.data() }))
        const dayBookings = dateSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter(b => b.id !== booking.id)
        const dayGroups = groupsSnap.docs.map(d => ({ id: d.id, ...d.data() }))
        const remaining = calcSlotCapacityServer(tables, dayBookings, next.date, next.timeSlot, settings, dayGroups)
        // 滿座門檻自動關閉（排除自己後計算）：與 guestCreateBooking 同一道防線。
        if (isOverAutoCloseThreshold({ totalSeats: activeTotalSeatsServer(tables, next.date), remaining, enabled: settings.onlineAutoCloseEnabled, percent: settings.onlineAutoClosePercent })) {
          throw errorWithStatus('此時段線上訂位已截止（接近滿座），歡迎來電洽詢', 409)
        }
        if (remaining < Number(next.guests || 1)) throw errorWithStatus('此時段目前已無足夠座位，請改選其他時段', 409)
        tx.set(bookingRef, updatePatch, { merge: true })
        if (booking.assignedTableId) {
          tx.set(db.collection(COLLECTIONS.tables).doc(booking.assignedTableId), {
            status: 'vacant',
            currentBookingId: null,
            seatedAt: null,
            updatedAt: now,
          }, { merge: true })
        }
      })
    } else {
      await bookingRef.set(updatePatch, { merge: true })
    }
    const updated = { ...booking, ...updatePatch }
    await enqueueAndTrySend({
      channel: 'telegram',
      event: 'updated',
      bookingId: booking.id,
      payload: {
        text: tgBookingMessage(
          `✏️ <b>客人自助修改訂位</b> · ${booking.id}`,
          updated,
          { event: 'guest_updated', booking: updated, changedKeys },
          changedKeys.length ? `變動欄位：<code>${escapeTg(changedKeys.join(', '))}</code>` : '',
        ),
      },
    })
    // LINE 通知由後端權威送出（過去靠前端 fetch 觸發，客人關頁/斷網就漏發）。
    await notifyLineBookingChange(booking.id, updated, 'updated', settings)
    return res.json({ ok: true, booking: updated })
  } catch (err) {
    const code = err.status || 500
    console.error('guestUpdateBooking failed:', err)
    return res.status(code).json({ ok: false, error: err.message || 'guest-update-failed' })
  }
})

export const guestCancelBooking = onRequest({ cors: PUBLIC_CORS, invoker: 'public', secrets: [TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, LINE_CHANNEL_ACCESS_TOKEN] }, async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method-not-allowed' })
  try {
    const { bookingId, token, reason = '' } = req.body || {}
    const booking = await getBookingByToken(bookingId, token)
    const editable = guestEditable(booking)
    if (!editable.ok) return res.status(409).json({ ok: false, error: editable.reason })

    const now = new Date().toISOString()
    const updatePatch = {
      status: 'cancelled',
      assignedTableId: null,
      cancellationReason: {
        source: 'guest',
        reason: String(reason || '').trim() || '未提供',
        at: now,
      },
      lastGuestEditAt: now,
      guestEditCount: (Number(booking.guestEditCount) || 0) + 1,
      guestEditHistory: appendGuestHistory(booking.guestEditHistory, {
        id: createServerToken().slice(0, 12),
        type: 'guest_cancel',
        at: now,
        reason: String(reason || '').trim() || '未提供',
        before: pickBookingHistory(booking),
      }),
      updatedAt: now,
    }
    const batch = db.batch()
    batch.set(db.collection(COLLECTIONS.bookings).doc(booking.id), updatePatch, { merge: true })
    if (booking.assignedTableId) {
      batch.set(db.collection(COLLECTIONS.tables).doc(booking.assignedTableId), {
        status: 'vacant',
        currentBookingId: null,
        seatedAt: null,
        updatedAt: now,
      }, { merge: true })
    }
    await batch.commit()
    const cancelled = { ...booking, ...updatePatch }
    await enqueueAndTrySend({
      channel: 'telegram',
      event: 'cancelled',
      bookingId: booking.id,
      payload: {
        text: tgBookingMessage(
          '❌ <b>客人自助取消訂位</b>',
          cancelled,
          { event: 'guest_cancelled', booking: cancelled },
          `取消原因：${escapeTg(updatePatch.cancellationReason.reason)}`,
        ),
      },
    })
    // LINE 通知由後端權威送出（同 guestUpdateBooking，不再依賴前端觸發）。
    await notifyLineBookingChange(booking.id, cancelled, 'cancelled')
    return res.json({ ok: true, booking: cancelled })
  } catch (err) {
    const code = err.status || 500
    console.error('guestCancelBooking failed:', err)
    return res.status(code).json({ ok: false, error: err.message || 'guest-cancel-failed' })
  }
})

export const lineBind = onRequest({ cors: true, invoker: 'public', secrets: [LINE_CHANNEL_ACCESS_TOKEN] }, async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method-not-allowed' })
  try {
    const { booking, store, line } = req.body || {}
    if (!booking?.id || !booking?.token || !line?.userId) {
      return res.status(400).json({ ok: false, error: 'missing-required-fields' })
    }

    // 權威重讀：以 bookings 為準並驗證 manageToken（safeTokenEqual），不再整包信任 client 傳來的 booking。
    const authBooking = await getBookingByToken(booking.id, booking.token)
    // manageUrl 由後端以 publicSiteUrl 設定組成（Firestore booking 沒有此欄位；
    // 過去權威重讀後直接用 authBooking 組訊息，Flex 卡片因此缺「管理 / 修改訂位」按鈕）。
    const settingsSnap = await db.collection('settings').doc('main').get()
    const settings = normalizeStoreSettings(settingsSnap.exists ? settingsSnap.data() : {})
    const manageUrl = buildManageUrl(settings.publicSiteUrl, authBooking.id, authBooking.manageToken)

    const bindingRef = db.collection('lineBookingBindings').doc(authBooking.id)
    const bookingRef = db.collection(COLLECTIONS.bookings).doc(authBooking.id)
    const existingSnap = await bindingRef.get()
    const existing = existingSnap.exists ? existingSnap.data() : null
    const now = new Date().toISOString()
    const lastPushAt = existing?.lastBindPushAt || existing?.lastPushedAt || ''
    const lastPushMs = lastPushAt ? new Date(lastPushAt).getTime() : 0
    const recentlyPushed = existing?.lineUserId === line.userId
      && Number.isFinite(lastPushMs)
      && Date.now() - lastPushMs < LINE_BIND_PUSH_DEDUPE_MS

    // 店家資訊一律以當下 settings 為準（client 可不再傳 store；舊版前端傳了也照常容忍）。
    const nextStore = store && Object.keys(store).length ? normalizeStore(store) : storeFromSettings(settings)
    // 好友狀態：未加好友的 push 必定被 LINE 拒絕——標記 pushBlocked 並跳過首推，
    // 待 follow 事件（顧客加好友）清旗標自動補發，不再產生「重試 6 次進 dead-letter」的必死訊息。
    // 重新綁定且非 needFriend 則清除舊旗標（解除封鎖後重綁即可恢復通知）。
    const needFriend = line.friendFlag === false
    const skipPush = recentlyPushed || needFriend
    const record = {
      bookingId: authBooking.id,
      manageToken: authBooking.manageToken,
      lineUserId: line.userId,
      lineDisplayName: line.displayName || '',
      linePictureUrl: line.pictureUrl || '',
      booking: manageUrl ? { ...authBooking, manageUrl } : authBooking,
      store: nextStore,
      updatedAt: FieldValue.serverTimestamp(),
      createdAt: existing?.createdAt || FieldValue.serverTimestamp(),
      lastBindAttemptAt: now,
      ...(needFriend
        ? { pushBlocked: true, pushBlockedReason: 'not-friend', pushBlockedAt: now }
        : { pushBlocked: false, pushBlockedReason: null, pushBlockedAt: null }),
      ...(skipPush ? {} : {
        lastBindPushAt: now,
        lastPushByEvent: {
          ...(existing?.lastPushByEvent || {}),
          confirmed: { at: now, stateHash: notificationStateHash(authBooking) },
        },
      }),
    }

    const batch = db.batch()
    batch.set(bindingRef, record, { merge: true })
    batch.set(bookingRef, {
      lineUserId: line.userId,
      lineDisplayName: line.displayName || '',
      linePictureUrl: line.pictureUrl || '',
      linePushBlocked: needFriend,
      updatedAt: now,
    }, { merge: true })
    await batch.commit()
    if (!skipPush) {
      await enqueueAndTrySend({
        channel: 'line',
        event: 'created',
        bookingId: authBooking.id,
        payload: {
          to: line.userId,
          messages: buildBookingMessages(
            { ...authBooking, manageUrl, dateLabel: dayLabelServer(authBooking.date) },
            nextStore,
            'confirmed',
          ),
        },
      })
    }

    return res.json({ ok: true, skippedPush: recentlyPushed, ...(needFriend ? { needFriend: true } : {}) })
  } catch (err) {
    const code = err.status || 500
    if (code >= 500) console.error('lineBind failed:', err)
    return res.status(code).json({ ok: false, error: err.message || 'line-bind-failed' })
  }
})

export const lineWebhook = onRequest({ invoker: 'public', secrets: [LINE_CHANNEL_SECRET, LINE_CHANNEL_ACCESS_TOKEN] }, async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('method-not-allowed')
  const signature = req.get('x-line-signature') || ''
  if (!verifyLineSignature(req.rawBody, signature, lineChannelSecret())) {
    return res.status(401).send('invalid-signature')
  }

  const events = req.body?.events || []
  await Promise.all(events.map(handleLineEvent))
  return res.status(200).send('ok')
})

export const linePushBooking = onRequest({ cors: true, invoker: 'public', secrets: [LINE_CHANNEL_ACCESS_TOKEN] }, async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method-not-allowed' })
  try {
    const { bookingId, booking } = req.body || {}
    const targetBookingId = bookingId || booking?.id
    const token = booking?.token || req.body?.token || ''
    // type 收斂到已知事件集合：lastPushByEvent 以它為 key，不能讓 client 任意字串污染綁定文件。
    const type = ['confirmed', 'updated', 'cancelled'].includes(req.body?.type) ? req.body.type : 'updated'
    if (!targetBookingId) return res.status(400).json({ ok: false, error: 'missing-booking-id' })
    if (!token) return res.status(400).json({ ok: false, error: 'missing-token' })

    // 權威驗證：token 必須對應 bookings 中的 manageToken；推播統一走 notifyLineBookingChange
    // （含事件級防重與 pushBlocked 檢查），與 guestUpdate/guestCancel 後端內部路徑共用同一張防重表，
    // 舊前端 bundle 在部署共存窗口重複呼叫此端點也不會疊加訊息。
    const authBooking = await getBookingByToken(targetBookingId, token)
    const result = await notifyLineBookingChange(targetBookingId, authBooking, type)
    if (result.skipped === 'no-binding') return res.status(404).json({ ok: false, error: 'binding-not-found' })
    return res.json({ ok: true, ...(result.skipped ? { skippedPush: result.skipped } : {}) })
  } catch (err) {
    const code = err.status || 500
    if (code >= 500) console.error('linePushBooking failed:', err)
    return res.status(code).json({ ok: false, error: err.message || 'line-push-failed' })
  }
})

export const lineGetBooking = onRequest({ cors: true, invoker: 'public' }, async (req, res) => {
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ ok: false, error: 'method-not-allowed' })
  try {
    const input = req.method === 'GET' ? req.query : req.body || {}
    const bookingId = String(input.bookingId || input.id || '')
    const token = String(input.token || '')
    if (!bookingId || !token) return res.status(400).json({ ok: false, error: 'missing-required-fields' })

    const snap = await db.collection('lineBookingBindings').doc(bookingId).get()
    if (!snap.exists) {
      const booking = await getBookingByToken(bookingId, token)
      const settingsSnap = await db.collection('settings').doc('main').get()
      return res.json({
        ok: true,
        booking,
        store: normalizeStoreSettings(settingsSnap.exists ? settingsSnap.data() : {}),
        line: {},
      })
    }
    const data = snap.data()
    if (!data?.manageToken || data.manageToken !== token) {
      return res.status(403).json({ ok: false, error: 'invalid-token' })
    }

    return res.json({
      ok: true,
      booking: data.booking,
      store: normalizeStore(data.store),
      line: {
        displayName: data.lineDisplayName || '',
        pictureUrl: data.linePictureUrl || '',
      },
    })
  } catch (err) {
    console.error('lineGetBooking failed:', err)
    return res.status(500).json({ ok: false, error: err.message || 'line-get-booking-failed' })
  }
})

// 驗證 LIFF ID token：交給 LINE 官方端點驗簽章/aud/exp，回 claims（sub = 已驗明的 userId）。
// 絕不能信 client 自報的 userId——這是「列出某使用者全部訂位」端點的唯一身分依據。
// AbortController 3.5s 逾時保護，仿 lineSend。
async function verifyLineIdToken(idToken, channelId) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), NOTIFY_TIMEOUT_MS)
  try {
    const res = await fetch('https://api.line.me/oauth2/v2.1/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ id_token: idToken, client_id: channelId }).toString(),
      signal: controller.signal,
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      const desc = String(data.error_description || data.error || '')
      throw errorWithStatus(/expired/i.test(desc) ? 'expired-id-token' : 'invalid-id-token', 401)
    }
    // 防禦性複驗（LINE 已驗過簽章/aud/exp，這裡零成本重查一次）
    if (data.iss !== 'https://access.line.me'
      || String(data.aud) !== String(channelId)
      || Number(data.exp) * 1000 <= Date.now()
      || !data.sub) {
      throw errorWithStatus('invalid-id-token', 401)
    }
    return data
  } catch (err) {
    if (err.status) throw err
    throw errorWithStatus(err?.name === 'AbortError' ? 'line-verify-timeout' : 'line-verify-failed', 502)
  } finally {
    clearTimeout(timer)
  }
}

// 「LINE 我的訂位」：rich menu 連到 /line/my-bookings，LIFF 取 idToken 後打這裡。
// 驗明 LINE 身分 → 列出該使用者綁定的訂位（即將在前、近期歷史在後、上限 10）。
// 回傳不含姓名/電話；manageToken 只交給已驗明的綁定本人（信任等級同推播卡片與 guestLookup）。
export const lineMyBookings = onRequest({ cors: PUBLIC_CORS, invoker: 'public' }, async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method-not-allowed' })
  try {
    await enforceRateLimit(req, 'lineMyBookings')
    const idToken = String(req.body?.idToken || '').trim()
    if (!idToken) return res.status(400).json({ ok: false, error: 'missing-id-token' })

    const settingsSnap = await db.collection('settings').doc('main').get()
    const settings = normalizeStoreSettings(settingsSnap.exists ? settingsSnap.data() : {})
    if (!settings.lineLoginChannelId) {
      // 未設定 LINE Login channel ID → 前端優雅退回 /lookup 電話查詢
      return res.status(503).json({ ok: false, error: 'not-configured' })
    }

    const claims = await verifyLineIdToken(idToken, settings.lineLoginChannelId)
    const lineUserId = claims.sub
    await enforceRateLimit(req, 'lineMyBookingsUser', `uid:${lineUserId}`)

    const bindingsSnap = await db.collection('lineBookingBindings')
      .where('lineUserId', '==', lineUserId)
      .limit(30)
      .get()

    const entries = (await Promise.all(bindingsSnap.docs.map(async (doc) => {
      // 逐筆權威重讀：清單以 bookings 現況為準，不信 binding 內的舊快照
      const snap = await db.collection(COLLECTIONS.bookings).doc(doc.id).get()
      if (!snap.exists) return null
      const booking = { id: snap.id, ...snap.data() }
      if (booking.lineUserId && booking.lineUserId !== lineUserId) return null // 已改綁他人
      return { booking, manageToken: booking.manageToken || doc.data().manageToken || '' }
    }))).filter(Boolean)

    const items = buildMyBookingsList(entries, {
      nowMs: Date.now(),
      publicSiteUrl: settings.publicSiteUrl,
    })
    return res.json({
      ok: true,
      items,
      store: publicStoreSettings(settings),
      line: { displayName: bindingsSnap.docs[0]?.data()?.lineDisplayName || '' },
    })
  } catch (err) {
    const code = err.status || 500
    if (code >= 500) console.error('lineMyBookings failed:', err)
    return res.status(code).json({ ok: false, error: err.message || 'line-my-bookings-failed' })
  }
})

async function handleLineEvent(event) {
  if (event.type === 'follow') {
    // 加好友（含解除封鎖後重新加入）：先補發先前因「非好友」被擱置的訂位資訊，再回歡迎詞。
    const uid = event.source?.userId || ''
    if (uid) await resendPendingBindPushes(uid)
    if (event.replyToken) {
      await replyLineMessage(event.replyToken, [{
        type: 'text',
        text: '歡迎加入雞王涮涮鍋！完成線上訂位後，可用官方帳號接收訂位資訊、定位與修改連結。',
      }])
    }
  }
}

// 「先綁定、後加好友」的補救閉環：follow 事件清掉該使用者所有 pushBlocked 旗標
// （成為好友後 push 已可送達），並對仍有效的未來訂位補發確認卡片。
async function resendPendingBindPushes(lineUserId) {
  try {
    const snap = await db.collection('lineBookingBindings')
      .where('lineUserId', '==', lineUserId)
      .limit(10)
      .get()
    for (const doc of snap.docs) {
      const binding = doc.data()
      if (!binding.pushBlocked) continue
      const wasNotFriend = binding.pushBlockedReason === 'not-friend'
      const now = new Date().toISOString()
      await doc.ref.set({
        pushBlocked: false,
        pushBlockedReason: null,
        pushBlockedAt: null,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true })
      await db.collection(COLLECTIONS.bookings).doc(doc.id)
        .update({ linePushBlocked: false, updatedAt: now })
        .catch(() => {})
      if (!wasNotFriend) continue // 其他拒推原因只解鎖後續通知，不主動補發舊卡片
      const bookingSnap = await db.collection(COLLECTIONS.bookings).doc(doc.id).get()
      if (!bookingSnap.exists) continue
      const booking = { id: bookingSnap.id, ...bookingSnap.data() }
      if (booking.status !== 'confirmed') continue
      if (slotEpochMs(booking.date, booking.timeSlot) <= Date.now()) continue
      await notifyLineBookingChange(booking.id, booking, 'confirmed')
    }
  } catch (err) {
    console.error('resendPendingBindPushes failed:', err?.message)
  }
}

// settings（storeName/storePhone/...）→ 訊息組裝用的 store 形狀。
// 一律以「當下」settings 為準，不用 binding.store 舊快照——店家改地址/電話後通知立即生效。
function storeFromSettings(settings = {}) {
  return normalizeStore({
    name: settings.storeName,
    address: settings.storeAddress,
    phone: settings.storePhone,
    mapUrl: settings.storeMapUrl,
    latitude: settings.storeLatitude,
    longitude: settings.storeLongitude,
    lineOfficialUrl: settings.lineOfficialUrl,
    diningDurationMin: settings.diningDurationMin,
    cleanupBufferMin: settings.cleanupBufferMin,
  })
}

// 後端權威 LINE 通知：訂位修改/取消時由端點內部直接呼叫，不再依賴前端 fetch 觸發（漏發根因）。
// - 無綁定 / 已知拒推（封鎖、非好友）→ 沉默跳過，不入列必死訊息
// - 事件級防重：同 event 同內容指紋（date|timeSlot|guests|status）90 秒內只送一次，
//   擋下「functions 先部署、舊前端仍打 linePushBooking」共存窗口的重複推播與重送疊加
//   （也擋雙店員裝置對同一變更各推一次）
// - 任何錯誤只記 log，絕不影響主回應（與 outbox 哲學一致）
// - opts.queueOnly：只入列、不立即試送——adminPushData 熱路徑用（該端點沒綁 LINE secret、
//   也不該吃 3.5 秒 timeout），由 retryNotifications 排程在 ≤2 分鐘內代送。
async function notifyLineBookingChange(bookingId, booking, event, providedSettings = null, { queueOnly = false } = {}) {
  try {
    const bindingRef = db.collection('lineBookingBindings').doc(bookingId)
    const snap = await bindingRef.get()
    if (!snap.exists) return { skipped: 'no-binding' }
    const binding = snap.data()
    if (!binding.lineUserId) return { skipped: 'no-line-user' }
    if (binding.pushBlocked) return { skipped: 'push-blocked' }

    const stateHash = notificationStateHash(booking)
    if (shouldSkipDuplicatePush(binding.lastPushByEvent, event, stateHash, Date.now())) {
      return { skipped: 'duplicate-push' }
    }

    let settings = providedSettings
    if (!settings) {
      const settingsSnap = await db.collection('settings').doc('main').get()
      settings = normalizeStoreSettings(settingsSnap.exists ? settingsSnap.data() : {})
    }
    const manageUrl = buildManageUrl(settings.publicSiteUrl, bookingId, booking.manageToken)
      || binding.booking?.manageUrl || ''

    const now = new Date().toISOString()
    await bindingRef.set({
      booking: manageUrl ? { ...booking, manageUrl } : booking,
      lastPushByEvent: { ...(binding.lastPushByEvent || {}), [event]: { at: now, stateHash } },
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true })
    const outboxDoc = {
      channel: 'line',
      event,
      bookingId,
      payload: {
        to: binding.lineUserId,
        messages: buildBookingMessages(
          { ...booking, manageUrl, dateLabel: dayLabelServer(booking.date) },
          storeFromSettings(settings),
          event,
        ),
      },
    }
    if (queueOnly) await enqueueNotification(outboxDoc)
    else await enqueueAndTrySend(outboxDoc)
    return { ok: true }
  } catch (err) {
    console.error('notifyLineBookingChange failed:', err?.message)
    return { ok: false, error: err?.message }
  }
}

function buildBookingMessages(booking, store, type) {
  const titleMap = {
    confirmed: '訂位成功',
    updated: '訂位已更新',
    cancelled: '訂位已取消',
  }
  const title = titleMap[type] || '訂位通知'
  const messages = [
    {
      type: 'flex',
      altText: `雞王涮涮鍋${title}`,
      contents: bookingBubble(booking, store, title, type),
    },
  ]
  const location = locationMessage(store)
  if (location && type !== 'cancelled') messages.push(location)
  return messages
}

function bookingBubble(booking, store, title, type) {
  const statusColor = type === 'cancelled' ? '#8A8178' : '#D72D20'
  const diningDuration = Number(store.diningDurationMin) || DEFAULT_DINING_DURATION_MIN
  const cleanupBuffer = Number(store.cleanupBufferMin) || DEFAULT_CLEANUP_BUFFER_MIN
  const actions = []
  if (booking.manageUrl) {
    actions.push({
      type: 'button',
      style: 'primary',
      color: '#D72D20',
      action: { type: 'uri', label: '管理 / 修改訂位', uri: booking.manageUrl },
    })
  }
  if (store.mapUrl) {
    actions.push({
      type: 'button',
      style: 'secondary',
      action: { type: 'uri', label: '導航到店', uri: store.mapUrl },
    })
  }
  if (store.phone) {
    actions.push({
      type: 'button',
      style: 'secondary',
      action: { type: 'uri', label: '撥電話', uri: `tel:${store.phone}` },
    })
  }

  return {
    type: 'bubble',
    header: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: statusColor,
      paddingAll: '16px',
      contents: [
        { type: 'text', text: store.name || '雞王涮涮鍋', color: '#FFFFFF', weight: 'bold', size: 'sm' },
        { type: 'text', text: title, color: '#FFFFFF', weight: 'bold', size: 'xl', margin: 'sm' },
      ],
    },
    body: {
      type: 'box',
      layout: 'vertical',
      spacing: 'md',
      contents: [
        kv('訂位編號', booking.id),
        kv('姓名', booking.name),
        kv('日期', booking.dateLabel || booking.date),
        kv('時間', booking.timeSlot),
        kv('人數', `${booking.guests} 位`),
        ...(type === 'cancelled' ? [] : [{ type: 'separator', margin: 'md' }, {
          type: 'text',
          text: `請於用餐時段前 5 分鐘抵達。用餐時間 ${diningDuration} 分鐘，店內保留 ${cleanupBuffer} 分鐘翻桌緩衝。`,
          size: 'xs',
          color: '#8A8178',
          wrap: true,
        }]),
      ],
    },
    footer: actions.length ? { type: 'box', layout: 'vertical', spacing: 'sm', contents: actions } : undefined,
  }
}

function kv(label, value) {
  return {
    type: 'box',
    layout: 'baseline',
    contents: [
      { type: 'text', text: label, size: 'sm', color: '#8A8178', flex: 2 },
      { type: 'text', text: String(value || '—'), size: 'sm', color: '#2E2520', weight: 'bold', flex: 4, wrap: true },
    ],
  }
}

function locationMessage(store) {
  const lat = Number(store.latitude)
  const lng = Number(store.longitude)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  return {
    type: 'location',
    title: store.name || '雞王涮涮鍋',
    address: store.address || store.name || '雞王涮涮鍋',
    latitude: lat,
    longitude: lng,
  }
}

function normalizeStore(store = {}) {
  return {
    name: store.name || '雞王涮涮鍋',
    address: store.address || DEFAULT_STORE_ADDRESS,
    phone: store.phone || DEFAULT_STORE_PHONE,
    mapUrl: store.mapUrl || DEFAULT_STORE_MAP_URL,
    latitude: store.latitude || DEFAULT_STORE_LATITUDE,
    longitude: store.longitude || DEFAULT_STORE_LONGITUDE,
    lineOfficialUrl: store.lineOfficialUrl || '',
    diningDurationMin: Number(store.diningDurationMin) || DEFAULT_DINING_DURATION_MIN,
    cleanupBufferMin: Number(store.cleanupBufferMin) || DEFAULT_CLEANUP_BUFFER_MIN,
  }
}

async function listCollection(name) {
  const snap = await db.collection(name).get()
  return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }))
}

// 把一個集合的 upsert 轉成寫入操作清單（供分批提交，修 F-F）。
function upsertOps(name, items = [], idKey = 'id') {
  const ops = []
  items.forEach(item => {
    const id = String(item?.[idKey] || item?.id || '').trim()
    if (!id) return
    const normalized = name === COLLECTIONS.bookings
      ? normalizeBookingForFirestore(item)
      : name === COLLECTIONS.customers
      ? { ...item, phoneDigits: digits(item.phone), updatedAt: item.updatedAt || new Date().toISOString() }
      : { ...item, updatedAt: item.updatedAt || new Date().toISOString() }
    ops.push({ ref: db.collection(name).doc(id), data: normalized })
  })
  return ops
}

function deleteOps(name, ids = []) {
  if (!Array.isArray(ids)) return []
  return ids
    .map(rawId => String(rawId || '').trim())
    .filter(Boolean)
    .map(id => ({ ref: db.collection(name).doc(id), delete: true }))
}

// 分批提交寫入操作，單批不超過 chunkSize（< Firestore 500 上限）。
async function commitInChunks(ops, chunkSize = 450) {
  for (let i = 0; i < ops.length; i += chunkSize) {
    const batch = db.batch()
    ops.slice(i, i + chunkSize).forEach(op => {
      if (op.delete) batch.delete(op.ref)
      else batch.set(op.ref, op.data, { merge: true })
    })
    await batch.commit()
  }
}

function normalizeBookingForFirestore(booking = {}) {
  const id = String(booking.id || '').trim()
  return {
    assignedTableId: null,
    lineUserId: null,
    manageToken: booking.manageToken || booking.token || createServerToken(),
    lastGuestEditAt: null,
    guestEditCount: 0,
    guestEditHistory: [],
    cancellationReason: null,
    status: 'confirmed',
    source: 'online',
    notes: {},
    ...booking,
    id,
    guests: Number(booking.guests) || 1,
    phoneDigits: digits(booking.phone),
    manageToken: booking.manageToken || booking.token || createServerToken(),
    updatedAt: booking.updatedAt || new Date().toISOString(),
    createdAt: booking.createdAt || new Date().toISOString(),
  }
}

// 固定場次 / 關閉設定的後端正規化（與 client settingsService 的正規化同邏輯）。
// ★ 必須在白名單內：否則 adminPushData/adminPullData 會把這兩個欄位靜默剝除，關閉功能永不生效。
function normalizeSeatingsServer(seatings) {
  if (!Array.isArray(seatings)) return []
  return seatings
    .filter(s => s && s.id && /^\d{1,2}:\d{2}$/.test(s.start || '') && /^\d{1,2}:\d{2}$/.test(s.end || ''))
    .map(s => ({ id: String(s.id), name: String(s.name || ''), start: String(s.start), end: String(s.end) }))
}
function normalizeClosuresServer(c) {
  const out = { closedDates: [], closedSlots: {}, closedSeatings: {} }
  if (!c || typeof c !== 'object') return out
  if (Array.isArray(c.closedDates)) out.closedDates = c.closedDates.filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).map(String)
  const cleanMap = (m, valRe) => {
    const o = {}
    if (m && typeof m === 'object') {
      for (const [d, arr] of Object.entries(m)) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(d) && Array.isArray(arr)) {
          const v = arr.filter(x => (valRe ? valRe.test(x) : !!x)).map(String)
          if (v.length) o[d] = v
        }
      }
    }
    return o
  }
  out.closedSlots = cleanMap(c.closedSlots, /^\d{1,2}:\d{2}$/)
  out.closedSeatings = cleanMap(c.closedSeatings, null)
  return out
}

function normalizeStoreSettings(settings = {}) {
  return {
    openTime: settings.openTime || '11:00',
    seatings: normalizeSeatingsServer(settings.seatings),
    closures: normalizeClosuresServer(settings.closures),
    closeTime: settings.closeTime || '19:00',
    slotInterval: Number(settings.slotInterval) || 30,
    maxDaysAhead: Number(settings.maxDaysAhead) || 30,
    diningDurationMin: Number(settings.diningDurationMin) || DEFAULT_DINING_DURATION_MIN,
    cleanupBufferMin: Number(settings.cleanupBufferMin) || DEFAULT_CLEANUP_BUFFER_MIN,
    // 現場自動化（自動清檯）：與前端 settingsService withDefaults 成對
    autoReleaseEnabled: settings.autoReleaseEnabled !== false,
    autoReleaseAfterMin: Math.min(720, Math.max(120, Number(settings.autoReleaseAfterMin) || 300)),
    dayRolloverEnabled: settings.dayRolloverEnabled !== false,
    autoNoshowOnRollover: settings.autoNoshowOnRollover === true,
    // 線上訂位防線：滿座門檻自動關閉 + 場次前截止（與前端 settingsService withDefaults 成對）
    ...normalizeOnlineGuardSettings(settings),
    heroBanners: Array.isArray(settings.heroBanners) ? settings.heroBanners : [],
    lineOfficialUrl: settings.lineOfficialUrl || 'https://lin.ee/8lECi4S',
    lineOfficialName: settings.lineOfficialName || '雞王涮涮鍋 LINE 官方帳號',
    lineUseLiff: settings.lineUseLiff !== false,
    lineLiffUrl: settings.lineLiffUrl || 'https://liff.line.me/2009996489-f1SCb75q',
    lineLiffId: settings.lineLiffId || '2009996489-f1SCb75q',
    lineBindEndpoint: settings.lineBindEndpoint || 'https://linebind-reaor76eyq-uc.a.run.app',
    linePushEndpoint: settings.linePushEndpoint || 'https://linepushbooking-reaor76eyq-uc.a.run.app',
    lineManageEndpoint: settings.lineManageEndpoint || 'https://linegetbooking-reaor76eyq-uc.a.run.app',
    lineMyBookingsEndpoint: settings.lineMyBookingsEndpoint || 'https://linemybookings-reaor76eyq-uc.a.run.app',
    // LINE Login channel ID（LIFF 所屬 channel，非 Messaging API channel）：
    // lineMyBookings 驗 ID token 用；未設定時該端點回 not-configured、前端退回電話查詢。
    lineLoginChannelId: String(settings.lineLoginChannelId || '').trim(),
    // 前端正式站網址：後端組 LINE 訊息「管理 / 修改訂位」按鈕連結用；未設定則該按鈕不顯示。
    publicSiteUrl: String(settings.publicSiteUrl || '').trim(),
    // 店員後台改期/取消時自動 LINE 通知客人（預設關，店內驗證後再開）。
    lineNotifyOnAdminChange: settings.lineNotifyOnAdminChange === true,
    storeName: settings.storeName || '雞王涮涮鍋',
    storePhone: settings.storePhone || DEFAULT_STORE_PHONE,
    storeAddress: settings.storeAddress || DEFAULT_STORE_ADDRESS,
    storeMapUrl: settings.storeMapUrl || DEFAULT_STORE_MAP_URL,
    storeLatitude: settings.storeLatitude || DEFAULT_STORE_LATITUDE,
    storeLongitude: settings.storeLongitude || DEFAULT_STORE_LONGITUDE,
  }
}

function sortBookings(a, b) {
  return `${a.date || ''} ${a.timeSlot || ''}`.localeCompare(`${b.date || ''} ${b.timeSlot || ''}`)
}

function safeBookingSummary(booking) {
  const editable = guestEditable(booking)
  return {
    id: booking.id,
    bookingId: booking.id,
    manageToken: booking.manageToken || '',
    date: booking.date || '',
    timeSlot: booking.timeSlot || '',
    guests: Number(booking.guests) || 1,
    status: booking.status || 'confirmed',
    editable,
    nameMasked: maskName(booking.name),
    phoneMasked: maskPhone(booking.phone),
  }
}

function maskName(name = '') {
  const s = String(name || '').trim()
  if (!s) return '訂位客人'
  if (s.length === 1) return `${s}先生/小姐`
  return `${s[0]}${'*'.repeat(Math.max(1, s.length - 1))}`
}

function maskPhone(phone = '') {
  const d = digits(phone)
  if (d.length <= 4) return '****'
  return `${d.slice(0, 3)}****${d.slice(-3)}`
}

function digits(value) {
  return String(value || '').replace(/\D/g, '')
}

function phoneMatches(phone, input) {
  const actual = digits(phone)
  const value = digits(input)
  if (value.length >= 7) return actual === value
  if (![3, 4].includes(value.length)) return false
  return actual.endsWith(value)
}

function createServerToken() {
  return crypto.randomBytes(24).toString('hex')
}

function errorWithStatus(message, status) {
  const err = new Error(message)
  err.status = status
  return err
}

// === 公開端點每-IP 節流（F-B）===
// 公開端點無 App Check，易被：(1) 對 guestLookupBooking 暴力嘗試姓氏+電話批量擷取
// manageToken；(2) 灌爆 guestCreateBooking 造成費用型 DoS。以 Firestore 交易做每-IP
// 滑動視窗計數緩解。App Check（reCAPTCHA v3）是更強的後續防線，需在 Console/前端配置。
const RATE_LIMITS = {
  guestLookupBooking: { limit: 30, windowMs: 10 * 60 * 1000 },
  guestCreateBooking: { limit: 20, windowMs: 10 * 60 * 1000 },
  lineMyBookings: { limit: 30, windowMs: 10 * 60 * 1000 },      // per-IP（驗證前先擋）
  lineMyBookingsUser: { limit: 20, windowMs: 10 * 60 * 1000 },  // per-LINE-userId（驗證後）
}

function clientIp(req) {
  const xff = String(req.get('x-forwarded-for') || '').split(',')[0].trim()
  return xff || req.ip || 'unknown'
}

// 超限時丟出 429；節流器自身錯誤時「放行」(fail-open)，避免節流機制本身造成服務中斷。
// key 可選：預設以來源 IP 計數；傳入自訂 key（如已驗證的 LINE userId）則以該身分計數。
async function enforceRateLimit(req, name, key = '') {
  const cfg = RATE_LIMITS[name]
  if (!cfg) return
  const ipHash = crypto.createHash('sha256').update(key || clientIp(req)).digest('hex').slice(0, 32)
  const ref = db.collection('rateLimits').doc(`${name}_${ipHash}`)
  const now = Date.now()
  try {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref)
      const cur = snap.exists ? snap.data() : null
      if (!cur || now - (cur.windowStart || 0) > cfg.windowMs) {
        tx.set(ref, { windowStart: now, count: 1, updatedAt: new Date(now).toISOString() })
        return
      }
      if ((cur.count || 0) >= cfg.limit) throw errorWithStatus('請求過於頻繁，請稍候再試', 429)
      tx.update(ref, { count: (cur.count || 0) + 1, updatedAt: new Date(now).toISOString() })
    })
  } catch (err) {
    if (err.status === 429) throw err
    console.warn(`rate-limit check skipped for ${name}:`, err?.message)
  }
}

// 常數時間比對管理 token，避免以回應時間差異側錄 token（timing attack）。
function safeTokenEqual(a, b) {
  const bufA = Buffer.from(String(a || ''), 'utf8')
  const bufB = Buffer.from(String(b || ''), 'utf8')
  if (bufA.length !== bufB.length) return false
  try {
    return crypto.timingSafeEqual(bufA, bufB)
  } catch {
    return false
  }
}

async function getBookingByToken(bookingId, token) {
  const id = String(bookingId || '').trim()
  if (!id || !token) throw errorWithStatus('缺少訂位編號或管理 token', 400)
  const snap = await db.collection(COLLECTIONS.bookings).doc(id).get()
  if (!snap.exists) throw errorWithStatus('找不到此訂位', 404)
  const booking = { id: snap.id, ...snap.data() }
  if (!booking.manageToken || !safeTokenEqual(booking.manageToken, token)) throw errorWithStatus('管理連結無效', 403)
  return booking
}

function guestEditable(booking, nowMs = Date.now()) {
  if (!booking) return { ok: false, reason: '找不到此訂位' }
  if (['arrived', 'completed', 'cancelled', 'noshow'].includes(booking.status)) {
    return { ok: false, reason: '此訂位狀態已無法由客人自行修改' }
  }
  if (!booking.date || !booking.timeSlot) return { ok: false, reason: '訂位資料不完整，請聯絡店家' }
  // 以店家時區（台灣 +08:00）計算用餐絕對時間，避免 UTC 伺服器把牆鐘時間誤判而差 8 小時。
  const dineAtMs = slotEpochMs(booking.date, booking.timeSlot)
  if (Number.isNaN(dineAtMs)) return { ok: false, reason: '訂位時間不正確，請聯絡店家' }
  const cutoffMs = dineAtMs - 2 * 60 * 60 * 1000
  if (nowMs >= cutoffMs) return { ok: false, reason: '用餐前 2 小時內請改以電話聯絡店家' }
  return { ok: true }
}

function sanitizeGuestPatch(booking, patch = {}) {
  return {
    name: String(patch.name ?? booking.name ?? '').trim(),
    phone: String(patch.phone ?? booking.phone ?? '').trim(),
    guests: Math.max(1, Math.min(12, Number(patch.guests ?? booking.guests) || 1)),
    date: String(patch.date ?? booking.date ?? '').trim(),
    timeSlot: String(patch.timeSlot ?? booking.timeSlot ?? '').trim(),
    notes: {
      pet: !!patch.notes?.pet,
      child: !!patch.notes?.child,
      mobility: !!patch.notes?.mobility,
      text: String(patch.notes?.text || '').trim(),
    },
  }
}

function pickBookingHistory(booking) {
  return {
    name: booking.name,
    phone: booking.phone,
    guests: booking.guests,
    date: booking.date,
    timeSlot: booking.timeSlot,
    notes: booking.notes || {},
    assignedTableId: booking.assignedTableId || null,
  }
}

// P1-5：guestEditHistory 內嵌在 booking 文件、只增不減，長期會逼近
// Firestore 單文件 1MB 上限。保留最近 N 筆即可（自助修改本就受次數/時間限制）。
const MAX_GUEST_EDIT_HISTORY = 20
function appendGuestHistory(existing, entry) {
  const arr = Array.isArray(existing) ? existing : []
  return [...arr, entry].slice(-MAX_GUEST_EDIT_HISTORY)
}

function toMinutes(time = '00:00') {
  const [h, m] = String(time).split(':').map(Number)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 0
  return h * 60 + m
}

function pad2(n) {
  return String(n).padStart(2, '0')
}

// 依店家設定產生抵達時段（與前端 generateTimeSlots 對齊）
function generateSlotsServer(settings = {}) {
  const start = toMinutes(settings.openTime || '11:00')
  const end = toMinutes(settings.closeTime || '19:00')
  const interval = Math.max(5, Number(settings.slotInterval) || 30)
  const out = []
  for (let cur = start; cur <= end; cur += interval) {
    out.push(`${pad2(Math.floor(cur / 60))}:${pad2(cur % 60)}`)
  }
  return out
}

// 店家時區：台灣固定 UTC+8、無日光節約。Cloud Functions 預設以 UTC 執行，
// 所有「營業時間/今天/時段是否已過」的牆鐘判斷都必須用台灣時間，否則會差 8 小時。
// （slotEpochMs 已搬至 lib/myBookings.js 統一維護，index.js 由頂部 import。）
const STORE_TZ = 'Asia/Taipei'

function todayServerStr() {
  // 以店家時區計算「今天」（YYYY-MM-DD），避免 UTC 伺服器在台灣午夜前後算錯日期。
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: STORE_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

// 驗證並正規化日期字串（YYYY-MM-DD），不合法回空字串
function normalizeDateInput(value) {
  const s = String(value || '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return ''
  const d = new Date(`${s}T00:00:00`)
  if (Number.isNaN(d.getTime())) return ''
  return s
}

// 客人端可見的店家設定子集（不外流任何顧客資料）
function publicStoreSettings(settings = {}) {
  return {
    openTime: settings.openTime,
    closeTime: settings.closeTime,
    slotInterval: settings.slotInterval,
    maxDaysAhead: settings.maxDaysAhead,
    diningDurationMin: settings.diningDurationMin,
    cleanupBufferMin: settings.cleanupBufferMin,
    // 客人端 TimeSlotPicker 需要 seatings/closures 才能把關閉的時段灰顯為「已關閉」。
    seatings: settings.seatings,
    closures: settings.closures,
    storeName: settings.storeName,
    storePhone: settings.storePhone,
    storeAddress: settings.storeAddress,
    storeMapUrl: settings.storeMapUrl,
    lineOfficialUrl: settings.lineOfficialUrl,
    lineOfficialName: settings.lineOfficialName,
  }
}

// 新訂位輸入驗證 + 清洗（後端唯一把關，繞過前端也擋得住）
function validateNewBooking(body = {}, settings = {}) {
  const name = String(body.name || '').trim()
  if (name.length < 1 || name.length > 40) return { ok: false, error: '請填寫姓名' }

  const phoneDigits = digits(body.phone)
  // 台灣手機 09 開頭 10 碼；或一般市話 8–10 碼
  const validPhone = /^09\d{8}$/.test(phoneDigits) || /^\d{8,10}$/.test(phoneDigits)
  if (!validPhone) return { ok: false, error: '電話格式不正確，請輸入正確的台灣電話號碼' }

  const guests = Number(body.guests)
  if (!Number.isInteger(guests) || guests < 1 || guests > 12) {
    return { ok: false, error: '人數需為 1–12 位，更多人數請來電' }
  }

  const date = normalizeDateInput(body.date)
  if (!date) return { ok: false, error: '日期格式不正確' }
  const today = todayServerStr()
  if (date < today) return { ok: false, error: '無法預訂過去的日期' }
  const maxAhead = Number(settings.maxDaysAhead) || 30
  const maxDate = new Date(`${today}T00:00:00`)
  maxDate.setDate(maxDate.getDate() + maxAhead)
  if (new Date(`${date}T00:00:00`) > maxDate) return { ok: false, error: '超出可預訂的日期範圍' }

  const timeSlot = String(body.timeSlot || '').trim()
  if (!generateSlotsServer(settings).includes(timeSlot)) {
    return { ok: false, error: '請選擇有效的訂位時段' }
  }
  // 後端硬擋「已過的時段」：避免繞過前端、或在時段剛過的邊界仍下訂今天已過的時間。
  if (slotEpochMs(date, timeSlot) <= Date.now()) {
    return { ok: false, error: '此時段已過，請選擇較晚的時段' }
  }
  // 後端硬擋「已關閉的時段/場次/公休日」：繞過前端也擋得住（權威層）。
  if (isSlotClosedServer(settings, date, timeSlot)) {
    return { ok: false, error: '此時段已關閉訂位，請改選其他時段' }
  }
  // 線上場次截止：場次開始前 X 分鐘起不再收線上訂位（店員後台不受此限）。
  if (isPastSessionCutoff({ nowMs: Date.now(), slotMs: slotEpochMs(date, timeSlot), sessionStartMs: sessionCutoffAnchorMs(settings, date, timeSlot), cutoffMin: settings.onlineSessionCutoffMin })) {
    return { ok: false, error: '此場次的線上訂位已截止，歡迎來電洽詢或現場候位' }
  }

  const notes = {
    pet: !!body.notes?.pet,
    child: !!body.notes?.child,
    mobility: !!body.notes?.mobility,
    text: String(body.notes?.text || '').trim().slice(0, 500),
  }

  return { ok: true, value: { name, phone: String(body.phone).trim(), phoneDigits, guests, date, timeSlot, notes } }
}

// 容量排除的狀態：與前端 utils/capacity.js 的 CAPACITY_EXCLUDED_STATUSES 必須一致。
const CAPACITY_EXCLUDED_STATUSES = ['cancelled', 'noshow', 'completed']

// 團體某日佔用的「相異桌號」（兩梯重用同桌只算一次）。
function groupTableNumbersServer(group) {
  const seen = new Set()
  ;(group?.batches || []).forEach(b => (b.tableNumbers || []).forEach(n => { if (n) seen.add(String(n)) }))
  return [...seen]
}

// 團體合併時間窗：[最早梯次開始, 最晚梯次開始 + 佔位時長]。無有效梯次回 null。
function groupOccupancyWindowServer(group, durationMin) {
  const starts = (group?.batches || [])
    .map(b => toMinutes(b.timeSlot))
    .filter(n => Number.isFinite(n) && n > 0)
  if (!starts.length) return null
  return { start: Math.min(...starts), end: Math.max(...starts) + durationMin }
}

// 團體對全店座位池的佔用 = 相異桌號 capacity 合計（整桌專屬保留，嚴格口徑）。
function groupHeldSeatsServer(group, tableCapByNumber) {
  return groupTableNumbersServer(group).reduce((sum, n) => sum + (Number(tableCapByNumber[n]) || 0), 0)
}

// === 場次 / 關閉時段（與前端 utils/timeSlots.js seatingForSlot、utils/capacity.js isSlotClosed 必須同邏輯）===
function seatingForSlotServer(settings, timeSlot) {
  const list = Array.isArray(settings?.seatings) ? settings.seatings : []
  const x = toMinutes(timeSlot)
  return list.find(s => x >= toMinutes(s.start) && x < toMinutes(s.end)) || null
}

// 某日某抵達時段是否已被店家關閉訂位：整天公休 / 該時段被關 / 其所屬場次被關，任一成立即關閉。
function isSlotClosedServer(settings = {}, date, timeSlot) {
  const c = settings?.closures || {}
  if (Array.isArray(c.closedDates) && c.closedDates.includes(date)) return true
  if (Array.isArray(c.closedSlots?.[date]) && c.closedSlots[date].includes(timeSlot)) return true
  const seating = seatingForSlotServer(settings, timeSlot)
  if (seating && Array.isArray(c.closedSeatings?.[date]) && c.closedSeatings[date].includes(seating.id)) return true
  return false
}

// 線上場次截止的錨點：時段所屬場次的開始時間（餐期）；不屬於任何場次時退回時段本身。
function sessionCutoffAnchorMs(settings, date, timeSlot) {
  const seating = seatingForSlotServer(settings, timeSlot)
  return slotEpochMs(date, seating ? seating.start : timeSlot)
}

// 某日可用桌的總座位數（啟用中且不在維修窗；與 calcSlotCapacityServer 的 totalSeats 同口徑）。
function activeTotalSeatsServer(tables, date) {
  return tables.filter(t => isTableUsableOnDate(t, date)).reduce((sum, t) => sum + (Number(t.capacity) || 0), 0)
}

// 與前端 calcSlotCapacity 位元級一致：散客逐筆 sum(guests)、團體整桌 sum(座位)。
// ★ 為何團體用「整桌座位」、booking 用「逐筆 guests」：團體預排是整桌專屬保留，
//   圈走的桌不論坐幾人都不給線上散客；兩梯重用同桌只算一次，避免雙扣。
function calcSlotCapacityServer(tables, bookings, date, timeSlot, settings = {}, groupReservations = []) {
  if (isSlotClosedServer(settings, date, timeSlot)) return 0
  const durationMin = (Number(settings.diningDurationMin) || DEFAULT_DINING_DURATION_MIN) + (Number(settings.cleanupBufferMin) || DEFAULT_CLEANUP_BUFFER_MIN)
  const targetMinutes = toMinutes(timeSlot)
  // 可用桌 = 啟用中且該日不在維修窗（與前端 calcSlotCapacity 同口徑）。
  const totalSeats = tables
    .filter(t => isTableUsableOnDate(t, date))
    .reduce((sum, t) => sum + (Number(t.capacity) || 0), 0)
  const reserved = bookings
    .filter(b => {
      if (b.date !== date || !b.timeSlot || CAPACITY_EXCLUDED_STATUSES.includes(b.status)) return false
      const start = toMinutes(b.timeSlot)
      const end = start + durationMin
      return start < targetMinutes + durationMin && targetMinutes < end
    })
    .reduce((sum, b) => sum + (Number(b.guests) || 0), 0)

  const tableCapByNumber = {}
  tables.forEach(t => { tableCapByNumber[t.number] = Number(t.capacity) || 0 })
  const groupHeld = (groupReservations || [])
    .filter(g => g.date === date && !CAPACITY_EXCLUDED_STATUSES.includes(g.status))
    .reduce((sum, g) => {
      const win = groupOccupancyWindowServer(g, durationMin)
      if (!win || !(win.start < targetMinutes + durationMin && targetMinutes < win.end)) return sum
      return sum + groupHeldSeatsServer(g, tableCapByNumber)
    }, 0)

  return Math.max(0, totalSeats - reserved - groupHeld)
}

async function replyLineMessage(replyToken, messages) {
  const res = await fetch(LINE_REPLY_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${lineChannelAccessToken()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ replyToken, messages }),
  })
  if (!res.ok) throw new Error(`LINE reply failed: ${res.status} ${await res.text()}`)
}

function lineChannelAccessToken() {
  return LINE_CHANNEL_ACCESS_TOKEN.value().trim()
}

function lineChannelSecret() {
  return LINE_CHANNEL_SECRET.value().trim()
}

function verifyLineSignature(rawBody, signature, secret) {
  const hmac = crypto.createHmac('sha256', secret)
  hmac.update(rawBody)
  const expected = hmac.digest('base64')
  const received = Buffer.from(signature)
  const expectedBuffer = Buffer.from(expected)
  if (received.length !== expectedBuffer.length) return false
  return crypto.timingSafeEqual(received, expectedBuffer)
}

// ============== Telegram 內場通知（P0-4：bot token 不再進前端）==============
function escapeTg(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

const TG_SOURCE_LABEL = {
  online: '🌐 線上',
  phone: '📞 電話',
  walkin: '🚶 現場',
  group: '👥 團體',
  line: '💚 LINE',
}

// 組裝一則訂位通知：標題 + 訂位摘要（+ 可選補充行）+ 完整 JSON 備份
function tgBookingMessage(title, booking, payload, extraLine = '') {
  const lines = [
    title,
    `📅 ${booking.date} ${booking.timeSlot}`,
    `👤 ${escapeTg(booking.name)}  ${booking.guests} 位`,
    `📱 <code>${escapeTg(booking.phone)}</code>`,
  ]
  if (booking.assignedTableId) lines.push(`🪑 ${escapeTg(booking.assignedTableId)}`)
  if (TG_SOURCE_LABEL[booking.source]) lines.push(TG_SOURCE_LABEL[booking.source])
  if (booking.notes?.text) lines.push(`📝 ${escapeTg(booking.notes.text)}`)
  const flags = []
  if (booking.notes?.pet) flags.push('🐾 寵物')
  if (booking.notes?.child) flags.push('👶 兒童')
  if (booking.notes?.mobility) flags.push('♿ 行動不便')
  if (flags.length) lines.push(flags.join(' · '))
  if (extraLine) lines.push(extraLine)
  const json = JSON.stringify(payload, null, 0)
  return `${lines.join('\n')}\n\n<pre>${escapeTg(json)}</pre>`
}

// ============== 通知 outbox（可靠送達：先寫一筆 → 立即試送 → 失敗排程重試）==============
// 退避序列：第 1 次失敗等 1 分鐘、再 5/15/30/60/120 分鐘；用完 6 次轉 dead-letter。
const NOTIFICATION_BACKOFF_MS = [60_000, 5 * 60_000, 15 * 60_000, 30 * 60_000, 60 * 60_000, 120 * 60_000]
const NOTIFICATION_MAX_ATTEMPTS = 6
const NOTIFY_TIMEOUT_MS = 3500

// 送 Telegram（AbortController 逾時保護），回 { ok, error }
async function tgSend(text) {
  let token = ''
  let chatId = ''
  try { token = (TELEGRAM_BOT_TOKEN.value() || '').trim() } catch { token = '' }
  try { chatId = (TELEGRAM_CHAT_ID.value() || '').trim() } catch { chatId = '' }
  if (!token || !chatId) return { ok: false, error: 'telegram-not-configured' }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), NOTIFY_TIMEOUT_MS)
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }),
      signal: controller.signal,
    })
    if (!res.ok) return { ok: false, error: `telegram-${res.status}: ${(await res.text()).slice(0, 300)}` }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err?.name === 'AbortError' ? 'telegram-timeout' : (err?.message || 'telegram-error') }
  } finally {
    clearTimeout(timer)
  }
}

// 送 LINE push（AbortController 逾時保護），回 { ok, error, retryable?, httpStatus? }。
// retryable === false（4xx 非 429：封鎖/非好友/壞請求）時重試也不會好，由 sendOutboxDoc 立即 dead-letter。
// line-not-configured 維持可重試：呼叫端點可能沒綁 secret，但 retryNotifications 排程有，補送會成功。
async function lineSend(to, messages) {
  if (!to || !Array.isArray(messages) || !messages.length) {
    return { ok: false, error: 'line-bad-payload', retryable: false }
  }
  let token = ''
  try { token = lineChannelAccessToken() } catch { token = '' }
  if (!token) return { ok: false, error: 'line-not-configured' }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), NOTIFY_TIMEOUT_MS)
  try {
    const res = await fetch(LINE_PUSH_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ to, messages }),
      signal: controller.signal,
    })
    if (!res.ok) {
      return {
        ok: false,
        error: `line-${res.status}: ${(await res.text()).slice(0, 300)}`,
        retryable: isRetryableLineStatus(res.status),
        httpStatus: res.status,
      }
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err?.name === 'AbortError' ? 'line-timeout' : (err?.message || 'line-error') }
  } finally {
    clearTimeout(timer)
  }
}

// 依 channel 實際送出一筆 outbox payload
async function deliverNotification(data) {
  if (data.channel === 'telegram') return tgSend(data.payload?.text || '')
  if (data.channel === 'line') return lineSend(data.payload?.to, data.payload?.messages || [])
  return { ok: false, error: `unknown-channel-${data.channel}` }
}

// 寫一筆 pending outbox 文件，回 { ref, record }
async function enqueueNotification(doc) {
  const now = new Date().toISOString()
  const ref = db.collection('notifications').doc()
  const record = {
    channel: doc.channel,
    event: doc.event || 'unknown',
    status: 'pending',
    payload: doc.payload || {},
    bookingId: doc.bookingId || null,
    attempts: 0,
    maxAttempts: NOTIFICATION_MAX_ATTEMPTS,
    nextAttemptAt: now,
    lastError: null,
    createdAt: now,
    sentAt: null,
  }
  await ref.set(record)
  return { ref, record }
}

// 嘗試送出一筆 outbox 文件並更新狀態（成功→sent；失敗→排程重試或 dead-letter）。
// retryable === false（LINE 4xx 非 429）不消耗重試額度直接 dead-letter，
// 並標記綁定 pushBlocked——後續通知不再對已封鎖/非好友的對象入列必死訊息。
async function sendOutboxDoc(ref, data) {
  const result = await deliverNotification(data)
  const now = new Date().toISOString()
  if (result.ok) {
    await ref.set({ status: 'sent', sentAt: now, lastError: null, nextAttemptAt: null }, { merge: true })
    await mirrorLineNotifyStatus(data, { event: data.event || 'unknown', status: 'sent', at: now })
    return result
  }
  const attempts = (Number(data.attempts) || 0) + 1
  const maxAttempts = Number(data.maxAttempts) || NOTIFICATION_MAX_ATTEMPTS
  if (attempts >= maxAttempts || result.retryable === false) {
    await ref.set({
      status: 'failed',
      attempts,
      lastError: result.error,
      nextAttemptAt: null,
      failedAt: now,
      ...(result.retryable === false ? { nonRetryable: true } : {}),
    }, { merge: true })
    console.error('NOTIFICATION_DEAD_LETTER', { id: ref.id, channel: data.channel, event: data.event, error: result.error })
    await mirrorLineNotifyStatus(data, { event: data.event || 'unknown', status: 'failed', at: now, error: String(result.error || '').slice(0, 200) })
    if (data.channel === 'line' && data.bookingId && Number(result.httpStatus) >= 400 && Number(result.httpStatus) < 500) {
      await markLinePushBlocked(data.bookingId, result.error, now)
    }
  } else {
    const backoff = NOTIFICATION_BACKOFF_MS[Math.min(attempts - 1, NOTIFICATION_BACKOFF_MS.length - 1)]
    const nextAttemptAt = new Date(Date.now() + backoff).toISOString()
    await ref.set({ status: 'pending', attempts, lastError: result.error, nextAttemptAt }, { merge: true })
    await mirrorLineNotifyStatus(data, { event: data.event || 'unknown', status: 'pending', at: now, error: String(result.error || '').slice(0, 200) })
  }
  return result
}

// 把 LINE 通知的最新送達狀態鏡像到 booking 文件（lineLastNotify），
// 經 adminPullData 既有差異同步管線自然流到店員端顯示「已送達/重試中/失敗」。
// 用 update：booking 已刪除就靜默跳過，不憑空創檔。
async function mirrorLineNotifyStatus(data, payload) {
  if (data.channel !== 'line' || !data.bookingId) return
  await db.collection(COLLECTIONS.bookings).doc(data.bookingId)
    .update({ lineLastNotify: payload, updatedAt: payload.at })
    .catch(() => {})
}

// LINE 拒推（封鎖/非好友/無效 user）→ 標記綁定與訂位鏡像旗標。
// 用 update（文件不存在即失敗吞掉）而非 set merge，避免替已刪除的訂位憑空創出殘檔。
async function markLinePushBlocked(bookingId, reason, now) {
  const patch = { pushBlocked: true, pushBlockedReason: String(reason || '').slice(0, 200), pushBlockedAt: now }
  await db.collection('lineBookingBindings').doc(bookingId).update(patch).catch(() => {})
  await db.collection(COLLECTIONS.bookings).doc(bookingId).update({ linePushBlocked: true, updatedAt: now }).catch(() => {})
}

// 寫入 + 立即試送（主流程呼叫；逾時由 AbortController 保護，失敗交給排程重試，絕不影響主流程）
async function enqueueAndTrySend(doc) {
  try {
    const { ref, record } = await enqueueNotification(doc)
    await sendOutboxDoc(ref, record)
  } catch (err) {
    console.error('enqueueAndTrySend failed:', err?.message)
  }
}

// 每 2 分鐘補送 pending 通知（在程式碼內過濾 nextAttemptAt，避免複合索引）
export const retryNotifications = onSchedule(
  {
    schedule: 'every 2 minutes',
    timeZone: 'Asia/Taipei',
    secrets: [TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, LINE_CHANNEL_ACCESS_TOKEN],
  },
  async () => {
    const nowMs = Date.now()
    const snap = await db.collection('notifications').where('status', '==', 'pending').limit(100).get()
    const due = snap.docs.filter(d => {
      const at = d.data().nextAttemptAt
      return !at || new Date(at).getTime() <= nowMs
    })
    for (const d of due) {
      await sendOutboxDoc(d.ref, d.data())
    }
    if (due.length) console.log(`retryNotifications: processed ${due.length} pending notifications`)
  },
)

// 每日 09:00（台北）自我檢測：發測試 Telegram + 彙報 dead-letter 數量
export const notificationHeartbeat = onSchedule(
  {
    schedule: '0 9 * * *',
    timeZone: 'Asia/Taipei',
    secrets: [TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID],
  },
  async () => {
    const failedSnap = await db.collection('notifications').where('status', '==', 'failed').limit(50).get()
    const failedCount = failedSnap.size
    const lines = [
      '💓 <b>通知系統每日健康檢查</b>',
      `🕘 ${new Date().toISOString()}`,
      failedCount
        ? `⚠️ 有 <b>${failedCount}</b> 筆通知重試用盡（dead-letter），請至 notifications 檢查`
        : '✅ 無 dead-letter，通知管線正常',
    ]
    const result = await tgSend(lines.join('\n'))
    if (!result.ok) console.error('NOTIFICATION_HEARTBEAT_FAILED', result.error)
  },
)
