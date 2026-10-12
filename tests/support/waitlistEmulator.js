import { createRequire } from 'node:module'
import { resolve } from 'node:path'

export const PROJECT = 'demo-waitlist-stability'
export const HOST = '127.0.0.1:8080'
export function connectWaitlistEmulator() {
  if (process.env.FIRESTORE_EMULATOR_HOST !== HOST || process.env.GCLOUD_PROJECT !== PROJECT)
    throw new Error('Isolated test requires 127.0.0.1:8080 and demo-waitlist-stability; no production fallback')
  const require = createRequire(resolve('functions/package.json'))
  const { initializeApp, deleteApp } = require('firebase-admin/app')
  const { getFirestore } = require('firebase-admin/firestore')
  const app = initializeApp({ projectId: PROJECT }, `waitlist-test-${Date.now()}-${Math.random()}`)
  const db = getFirestore(app)
  const metrics = { transactions: 0, attempts: 0 }
  const measured = Object.create(db)
  measured.collection = db.collection.bind(db)
  measured.runTransaction = (callback, options) => {
    metrics.transactions++
    return db.runTransaction(tx => { metrics.attempts++; return callback(tx) }, options)
  }
  return { db, measured, metrics, close: () => deleteApp(app) }
}
export async function resetEmulator() {
  if (process.env.FIRESTORE_EMULATOR_HOST !== HOST || process.env.GCLOUD_PROJECT !== PROJECT) throw Error('Unsafe reset')
  const response = await fetch(`http://${HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' })
  if (!response.ok) throw Error(`Emulator reset failed ${response.status}`)
}
export async function seedEmulator(db, date) {
  await db.collection('settings').doc('main').set({ storeName: '隔離測試店', openTime: '00:00', closeTime: '23:59', diningDurationMin: 90, cleanupBufferMin: 10, maxDaysAhead: 30, slotInterval: 30, closures: { closedDates: [], closedSlots: {}, closedSeatings: {} }, seatings: [] })
  await Promise.all(Array.from({ length: 12 }, (_, i) => db.collection('tables').doc(String(101 + i)).set({ number: String(101 + i), capacity: 4, maxCapacity: 6, floor: '1F', x:120+(i%4)*140, y:120+Math.floor(i/4)*140, w:80, h:60, shape:'rect', rotation:0, status: 'vacant', isActive: true, unusableDates: [] })))
  return date
}
export function testCommand(action, id, expectedVersion = 0, payload = {}, date = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' })) {
  return { action, id, expectedVersion, payload, date, commandId: `test_${crypto.randomUUID()}` }
}
export async function invokeHandler(handler, body, headers = { authorization: 'Bearer isolated-test-token' }) {
  const response = { code: 200, status(code) { this.code = code; return this }, json(body) { this.body = body; return this } }
  await handler({ method: 'POST', headers, body }, response)
  return response
}
