import crypto from 'node:crypto'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { onRequest } from 'firebase-functions/v2/https'
import { defineSecret } from 'firebase-functions/params'

initializeApp()

const db = getFirestore()
const LINE_CHANNEL_ACCESS_TOKEN = defineSecret('LINE_CHANNEL_ACCESS_TOKEN')
const LINE_CHANNEL_SECRET = defineSecret('LINE_CHANNEL_SECRET')

const LINE_REPLY_URL = 'https://api.line.me/v2/bot/message/reply'
const LINE_PUSH_URL = 'https://api.line.me/v2/bot/message/push'

export const lineBind = onRequest({ cors: true, invoker: 'public', secrets: [LINE_CHANNEL_ACCESS_TOKEN] }, async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method-not-allowed' })
  try {
    const { booking, store, line } = req.body || {}
    if (!booking?.id || !booking?.token || !line?.userId) {
      return res.status(400).json({ ok: false, error: 'missing-required-fields' })
    }

    const record = {
      bookingId: booking.id,
      manageToken: booking.token,
      lineUserId: line.userId,
      lineDisplayName: line.displayName || '',
      linePictureUrl: line.pictureUrl || '',
      booking,
      store: normalizeStore(store),
      updatedAt: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
    }

    await db.collection('lineBookingBindings').doc(booking.id).set(record, { merge: true })
    await pushLineMessages(line.userId, buildBookingMessages(booking, record.store, 'confirmed'))

    return res.json({ ok: true })
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
          text: '請於用餐時段前 5 分鐘抵達，逾時 15 分鐘訂位將釋出。',
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
    address: store.address || '',
    phone: store.phone || '',
    mapUrl: store.mapUrl || '',
    latitude: store.latitude || '',
    longitude: store.longitude || '',
    lineOfficialUrl: store.lineOfficialUrl || '',
  }
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
