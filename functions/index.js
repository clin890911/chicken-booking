import crypto from 'node:crypto'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { getAuth } from 'firebase-admin/auth'
import { onRequest } from 'firebase-functions/v2/https'
import { defineSecret } from 'firebase-functions/params'

initializeApp()

const db = getFirestore()

// 員工白名單（後端唯一真相，設定於 functions/.env 的 ADMIN_EMAILS，逗號分隔）。
// 沒設定時退回單一預設管理員，避免部署後完全無法登入。
const STAFF_EMAILS = String(process.env.ADMIN_EMAILS || 'berrylin0911@gmail.com')
  .split(',')
  .map(s => s.trim().toLowerCase())
  .filter(Boolean)

// 驗證請求帶有有效的 Firebase ID Token，且 email 在員工白名單內。
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
  if (!email || !STAFF_EMAILS.includes(email)) throw errorWithStatus('not-authorized', 403)
  return { uid: decoded.uid, email }
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
}

export const adminPullData = onRequest({ cors: PUBLIC_CORS, invoker: 'public' }, async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'method-not-allowed' })
  try {
    await requireStaff(req)
  } catch (err) {
    return res.status(err.status || 401).json({ ok: false, error: err.message || 'unauthorized' })
  }
  try {
    const [bookings, tables, waitlist, customers, settingsSnap] = await Promise.all([
      listCollection(COLLECTIONS.bookings),
      listCollection(COLLECTIONS.tables),
      listCollection(COLLECTIONS.waitlist),
      listCollection(COLLECTIONS.customers),
      db.collection('settings').doc('main').get(),
    ])
    return res.json({
      ok: true,
      bookings: bookings.sort(sortBookings),
      tables: tables.sort((a, b) => String(a.number || '').localeCompare(String(b.number || ''))),
      waitlist: waitlist.sort((a, b) => String(a.takenAt || '').localeCompare(String(b.takenAt || ''))),
      customers,
      settings: normalizeStoreSettings(settingsSnap.exists ? settingsSnap.data() : {}),
    })
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
    const batch = db.batch()
    upsertCollectionBatch(batch, COLLECTIONS.bookings, dataset.bookings || [], 'id')
    upsertCollectionBatch(batch, COLLECTIONS.tables, dataset.tables || [], 'number')
    upsertCollectionBatch(batch, COLLECTIONS.waitlist, dataset.waitlist || [], 'id')
    upsertCollectionBatch(batch, COLLECTIONS.customers, dataset.customers || [], 'phone')
    if (dataset.settings) {
      batch.set(db.collection('settings').doc('main'), {
        ...normalizeStoreSettings(dataset.settings),
        updatedAt: new Date().toISOString(),
      }, { merge: true })
    }
    batch.set(db.collection('system').doc('sync'), {
      lastAdminPushAt: new Date().toISOString(),
    }, { merge: true })
    await batch.commit()
    return res.json({ ok: true })
  } catch (err) {
    console.error('adminPushData failed:', err)
    return res.status(500).json({ ok: false, error: err.message || 'admin-push-failed' })
  }
})

export const guestLookupBooking = onRequest({ cors: PUBLIC_CORS, invoker: 'public' }, async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method-not-allowed' })
  try {
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
    console.error('guestLookupBooking failed:', err)
    return res.status(500).json({ ok: false, error: err.message || 'guest-lookup-failed' })
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
      const [tables, bookingsSnap] = await Promise.all([
        listCollection(COLLECTIONS.tables),
        db.collection(COLLECTIONS.bookings).where('date', '==', date).get(),
      ])
      const bookings = bookingsSnap.docs.map(d => ({ id: d.id, ...d.data() }))
      slots = generateSlotsServer(settings).map(time => ({
        time,
        remaining: calcSlotCapacityServer(tables, bookings, date, time, settings),
      }))
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
      const [tablesSnap, dateSnap] = await Promise.all([
        tx.get(db.collection(COLLECTIONS.tables)),
        tx.get(bookingsRef.where('date', '==', data.date)),
      ])
      const tables = tablesSnap.docs.map(d => ({ id: d.id, ...d.data() }))
      const dayBookings = dateSnap.docs.map(d => ({ id: d.id, ...d.data() }))

      // 防重複：同電話 + 同日 + 同時段已有有效訂位 → 視為重複送出
      const dup = dayBookings.find(b =>
        digits(b.phone) === data.phoneDigits &&
        b.timeSlot === data.timeSlot &&
        !['cancelled', 'noshow'].includes(b.status))
      if (dup) throw errorWithStatus('您已有相同時段的訂位，無需重複預訂', 409)

      const remaining = calcSlotCapacityServer(tables, dayBookings, data.date, data.timeSlot, settings)
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

    // 內場通知（best-effort，失敗不影響訂位成立）。在回應前 await，
    // 否則 Cloud Function 回應後可能被凍結導致通知未送出。
    await notifyTelegram(tgBookingMessage('🆕 <b>新線上訂位</b>', booking, { event: 'booking_created', booking }))

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

export const guestUpdateBooking = onRequest({ cors: PUBLIC_CORS, invoker: 'public', secrets: [TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID] }, async (req, res) => {
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

    if (structural) {
      const [tables, bookings] = await Promise.all([
        listCollection(COLLECTIONS.tables),
        listCollection(COLLECTIONS.bookings),
      ])
      const remaining = calcSlotCapacityServer(tables, bookings.filter(b => b.id !== booking.id), next.date, next.timeSlot, settings)
      if (remaining < Number(next.guests || 1)) return res.status(409).json({ ok: false, error: '此時段目前已無足夠座位，請改選其他時段' })
    }

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
      guestEditHistory: [...(Array.isArray(booking.guestEditHistory) ? booking.guestEditHistory : []), historyEntry],
      updatedAt: now,
    }

    const batch = db.batch()
    batch.set(db.collection(COLLECTIONS.bookings).doc(booking.id), updatePatch, { merge: true })
    if (structural && booking.assignedTableId) {
      batch.set(db.collection(COLLECTIONS.tables).doc(booking.assignedTableId), {
        status: 'vacant',
        currentBookingId: null,
        seatedAt: null,
        updatedAt: now,
      }, { merge: true })
    }
    await batch.commit()
    const updated = { ...booking, ...updatePatch }
    await notifyTelegram(tgBookingMessage(
      `✏️ <b>客人自助修改訂位</b> · ${booking.id}`,
      updated,
      { event: 'guest_updated', booking: updated, changedKeys },
      changedKeys.length ? `變動欄位：<code>${escapeTg(changedKeys.join(', '))}</code>` : '',
    ))
    return res.json({ ok: true, booking: updated })
  } catch (err) {
    const code = err.status || 500
    console.error('guestUpdateBooking failed:', err)
    return res.status(code).json({ ok: false, error: err.message || 'guest-update-failed' })
  }
})

export const guestCancelBooking = onRequest({ cors: PUBLIC_CORS, invoker: 'public', secrets: [TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID] }, async (req, res) => {
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
      guestEditHistory: [
        ...(Array.isArray(booking.guestEditHistory) ? booking.guestEditHistory : []),
        {
          id: createServerToken().slice(0, 12),
          type: 'guest_cancel',
          at: now,
          reason: String(reason || '').trim() || '未提供',
          before: pickBookingHistory(booking),
        },
      ],
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
    await notifyTelegram(tgBookingMessage(
      '❌ <b>客人自助取消訂位</b>',
      cancelled,
      { event: 'guest_cancelled', booking: cancelled },
      `取消原因：${escapeTg(updatePatch.cancellationReason.reason)}`,
    ))
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

    const bindingRef = db.collection('lineBookingBindings').doc(booking.id)
    const bookingRef = db.collection(COLLECTIONS.bookings).doc(booking.id)
    const existingSnap = await bindingRef.get()
    const existing = existingSnap.exists ? existingSnap.data() : null
    const now = new Date().toISOString()
    const lastPushAt = existing?.lastBindPushAt || existing?.lastPushedAt || ''
    const lastPushMs = lastPushAt ? new Date(lastPushAt).getTime() : 0
    const recentlyPushed = existing?.lineUserId === line.userId
      && Number.isFinite(lastPushMs)
      && Date.now() - lastPushMs < LINE_BIND_PUSH_DEDUPE_MS

    const record = {
      bookingId: booking.id,
      manageToken: booking.token,
      lineUserId: line.userId,
      lineDisplayName: line.displayName || '',
      linePictureUrl: line.pictureUrl || '',
      booking,
      store: normalizeStore(store),
      updatedAt: FieldValue.serverTimestamp(),
      createdAt: existing?.createdAt || FieldValue.serverTimestamp(),
      lastBindAttemptAt: now,
      ...(recentlyPushed ? {} : { lastBindPushAt: now }),
    }

    const batch = db.batch()
    batch.set(bindingRef, record, { merge: true })
    batch.set(bookingRef, {
      lineUserId: line.userId,
      lineDisplayName: line.displayName || '',
      linePictureUrl: line.pictureUrl || '',
      updatedAt: now,
    }, { merge: true })
    await batch.commit()
    if (!recentlyPushed) {
      await pushLineMessages(line.userId, buildBookingMessages(booking, record.store, 'confirmed'))
    }

    return res.json({ ok: true, skippedPush: recentlyPushed })
  } catch (err) {
    console.error('lineBind failed:', err)
    return res.status(500).json({ ok: false, error: err.message || 'line-bind-failed' })
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
    const { bookingId, booking, store, type = 'updated' } = req.body || {}
    const targetBookingId = bookingId || booking?.id
    if (!targetBookingId) return res.status(400).json({ ok: false, error: 'missing-booking-id' })

    if (booking?.id) {
      const snap = await db.collection('lineBookingBindings').doc(booking.id).get()
      if (!snap.exists) return res.status(404).json({ ok: false, error: 'binding-not-found' })
      const existing = snap.data()
      const nextStore = normalizeStore({ ...existing.store, ...store })
      await db.collection('lineBookingBindings').doc(booking.id).set({
        booking,
        store: nextStore,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true })
      await pushLineMessages(existing.lineUserId, buildBookingMessages(booking, nextStore, type))
      return res.json({ ok: true })
    }

    const snap = await db.collection('lineBookingBindings').doc(targetBookingId).get()
    if (!snap.exists) return res.status(404).json({ ok: false, error: 'binding-not-found' })
    const data = snap.data()
    await pushLineMessages(data.lineUserId, buildBookingMessages(data.booking, data.store, type))
    return res.json({ ok: true })
  } catch (err) {
    console.error('linePushBooking failed:', err)
    return res.status(500).json({ ok: false, error: err.message || 'line-push-failed' })
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

async function handleLineEvent(event) {
  if (event.type === 'follow' && event.replyToken) {
    await replyLineMessage(event.replyToken, [{
      type: 'text',
      text: '歡迎加入雞王刷刷鍋！完成線上訂位後，可用官方帳號接收訂位資訊、定位與修改連結。',
    }])
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
      altText: `雞王刷刷鍋${title}`,
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
        { type: 'text', text: store.name || '雞王刷刷鍋', color: '#FFFFFF', weight: 'bold', size: 'sm' },
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
    title: store.name || '雞王刷刷鍋',
    address: store.address || store.name || '雞王刷刷鍋',
    latitude: lat,
    longitude: lng,
  }
}

function normalizeStore(store = {}) {
  return {
    name: store.name || '雞王刷刷鍋',
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

function upsertCollectionBatch(batch, name, items = [], idKey = 'id') {
  items.forEach(item => {
    const id = String(item?.[idKey] || item?.id || '').trim()
    if (!id) return
    const normalized = name === COLLECTIONS.bookings
      ? normalizeBookingForFirestore(item)
      : name === COLLECTIONS.customers
      ? { ...item, phoneDigits: digits(item.phone), updatedAt: item.updatedAt || new Date().toISOString() }
      : { ...item, updatedAt: item.updatedAt || new Date().toISOString() }
    batch.set(db.collection(name).doc(id), normalized, { merge: true })
  })
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

function normalizeStoreSettings(settings = {}) {
  return {
    openTime: settings.openTime || '11:00',
    closeTime: settings.closeTime || '19:00',
    slotInterval: Number(settings.slotInterval) || 30,
    maxDaysAhead: Number(settings.maxDaysAhead) || 30,
    diningDurationMin: Number(settings.diningDurationMin) || DEFAULT_DINING_DURATION_MIN,
    cleanupBufferMin: Number(settings.cleanupBufferMin) || DEFAULT_CLEANUP_BUFFER_MIN,
    heroBanners: Array.isArray(settings.heroBanners) ? settings.heroBanners : [],
    lineOfficialUrl: settings.lineOfficialUrl || 'https://lin.ee/8lECi4S',
    lineOfficialName: settings.lineOfficialName || '雞王刷刷鍋 LINE 官方帳號',
    lineUseLiff: settings.lineUseLiff !== false,
    lineLiffUrl: settings.lineLiffUrl || 'https://liff.line.me/2009996489-f1SCb75q',
    lineLiffId: settings.lineLiffId || '2009996489-f1SCb75q',
    lineBindEndpoint: settings.lineBindEndpoint || 'https://linebind-reaor76eyq-uc.a.run.app',
    linePushEndpoint: settings.linePushEndpoint || 'https://linepushbooking-reaor76eyq-uc.a.run.app',
    lineManageEndpoint: settings.lineManageEndpoint || 'https://linegetbooking-reaor76eyq-uc.a.run.app',
    storeName: settings.storeName || '雞王刷刷鍋',
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

async function getBookingByToken(bookingId, token) {
  const id = String(bookingId || '').trim()
  if (!id || !token) throw errorWithStatus('缺少訂位編號或管理 token', 400)
  const snap = await db.collection(COLLECTIONS.bookings).doc(id).get()
  if (!snap.exists) throw errorWithStatus('找不到此訂位', 404)
  const booking = { id: snap.id, ...snap.data() }
  if (!booking.manageToken || booking.manageToken !== token) throw errorWithStatus('管理連結無效', 403)
  return booking
}

function guestEditable(booking, now = new Date()) {
  if (!booking) return { ok: false, reason: '找不到此訂位' }
  if (['arrived', 'completed', 'cancelled', 'noshow'].includes(booking.status)) {
    return { ok: false, reason: '此訂位狀態已無法由客人自行修改' }
  }
  if (!booking.date || !booking.timeSlot) return { ok: false, reason: '訂位資料不完整，請聯絡店家' }
  const dineAt = new Date(`${booking.date}T${booking.timeSlot}:00`)
  if (Number.isNaN(dineAt.getTime())) return { ok: false, reason: '訂位時間不正確，請聯絡店家' }
  const cutoff = new Date(dineAt.getTime() - 2 * 60 * 60 * 1000)
  if (now >= cutoff) return { ok: false, reason: '用餐前 2 小時內請改以電話聯絡店家' }
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

function todayServerStr() {
  const d = new Date()
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
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

  const notes = {
    pet: !!body.notes?.pet,
    child: !!body.notes?.child,
    mobility: !!body.notes?.mobility,
    text: String(body.notes?.text || '').trim().slice(0, 500),
  }

  return { ok: true, value: { name, phone: String(body.phone).trim(), phoneDigits, guests, date, timeSlot, notes } }
}

function calcSlotCapacityServer(tables, bookings, date, timeSlot, settings = {}) {
  const durationMin = (Number(settings.diningDurationMin) || DEFAULT_DINING_DURATION_MIN) + (Number(settings.cleanupBufferMin) || DEFAULT_CLEANUP_BUFFER_MIN)
  const targetMinutes = toMinutes(timeSlot)
  const totalSeats = tables
    .filter(t => t.isActive !== false)
    .reduce((sum, t) => sum + (Number(t.capacity) || 0), 0)
  const reserved = bookings
    .filter(b => {
      if (b.date !== date || !b.timeSlot || ['cancelled', 'noshow', 'completed'].includes(b.status)) return false
      const start = toMinutes(b.timeSlot)
      const end = start + durationMin
      return start < targetMinutes + durationMin && targetMinutes < end
    })
    .reduce((sum, b) => sum + (Number(b.guests) || 0), 0)
  return Math.max(0, totalSeats - reserved)
}

async function pushLineMessages(to, messages) {
  const res = await fetch(LINE_PUSH_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${lineChannelAccessToken()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ to, messages }),
  })
  if (!res.ok) throw new Error(`LINE push failed: ${res.status} ${await res.text()}`)
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

// 送出 Telegram 訊息。沒設定 secret 時靜默略過；失敗只記 log，絕不影響主流程。
async function notifyTelegram(text) {
  let token = ''
  let chatId = ''
  try { token = (TELEGRAM_BOT_TOKEN.value() || '').trim() } catch { token = '' }
  try { chatId = (TELEGRAM_CHAT_ID.value() || '').trim() } catch { chatId = '' }
  if (!token || !chatId) return
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    })
    if (!res.ok) console.warn('Telegram notify failed:', res.status, await res.text())
  } catch (err) {
    console.warn('Telegram notify error:', err?.message)
  }
}
