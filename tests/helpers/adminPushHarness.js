// 真 adminPushData handler（從 functions/index.js 原始碼抽出）＋可注入的 Firestore（記憶體 fake 或本機 emulator）。
// 不 import functions/index.js 本身（那會載入 firebase-functions runtime／secrets）。
import { readFileSync } from 'node:fs'
import crypto from 'node:crypto'
import { classifyDatasetByPermission } from '../../functions/lib/staffAccess'
import { scopeClosureSettingsPush } from '../../functions/lib/settingsScope'
import { guardSettingsPush, settingsReplaceOptions, buildClosuresSettingsReport } from '../../functions/lib/settingsGuard'
import { commitClosuresMerge } from '../../functions/lib/closuresMergeCommit'
import { normalizeOnlineGuardSettings } from '../../functions/lib/onlineGuards'
import { guestPolicy } from '../../functions/lib/guestReliability'

const source = readFileSync('functions/index.js', 'utf8')

// 真的後端 normalizeStoreSettings（含 normalizeClosuresServer）。
export const normalizeStoreSettings = (() => {
  const start = source.indexOf('function normalizeSeatingsServer(')
  const endFn = source.indexOf('function normalizeStoreSettings(')
  const end = source.indexOf('\n}', endFn) + 2
  return new Function(
    'normalizeOnlineGuardSettings', 'guestPolicy', 'DEFAULT_DINING_DURATION_MIN', 'DEFAULT_CLEANUP_BUFFER_MIN',
    'DEFAULT_STORE_PHONE', 'DEFAULT_STORE_ADDRESS', 'DEFAULT_STORE_MAP_URL', 'DEFAULT_STORE_LATITUDE', 'DEFAULT_STORE_LONGITUDE',
    'DEFAULT_LINE_LOGIN_START_ENDPOINT',
    source.slice(start, end) + '\nreturn normalizeStoreSettings',
  )(normalizeOnlineGuardSettings, guestPolicy, 90, 10, '049', '地址', 'https://maps', '23', '120', '')
})()

const pick = name => {
  const start = source.indexOf(`function ${name}(`)
  const s = source.slice(start - 6, start) === 'async ' ? start - 6 : start
  return source.slice(s, source.indexOf('\n}', start) + 2)
}

// 回傳 call(role, body) → { code, body }。reports 收集 reportSettingsGuard 的稽核；
// notifyChanges／notifyTelegram 可注入 spy（預設 no-op）；commit 前的 bookings 快照讀 db 現值。
export function buildAdminPush(db, { reports = [], notifyChanges = async () => {}, notifyTelegram = async () => {} } = {}) {
  const pushStart = source.indexOf('export const adminPushData')
  const push = source.slice(pushStart, source.indexOf('\n})', pushStart) + 3).replace('export const', 'const')
  const body = [pick('commitInChunks'), pick('readSettingsForAdminNotify'), push].join('\n') + '\nreturn adminPushData'
  const ref = (name, id) => db.collection(name).doc(String(id))
  const snapshotBookingsByIds = async (ids = []) => {
    const out = new Map()
    for (const id of ids || []) {
      const snap = await ref('bookings', id).get()
      if (snap.exists) out.set(String(id), snap.data())
    }
    return out
  }
  const adminPushData = new Function(
    'onRequest', 'db', 'requireStaff', 'errorWithStatus', 'crypto', 'PUBLIC_CORS', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID',
    'LINE_CHANNEL_ACCESS_TOKEN', 'SYNC_COLLECTION_IDKEYS', 'classifyDatasetByPermission', 'scopeClosureSettingsPush',
    'snapshotBookingsByIds', 'COLLECTIONS', 'buildBookingUpsertData', 'createServerToken', 'stripServerOwnedCustomerFields',
    'upsertOps', 'deleteOps', 'normalizeStoreSettings', 'protectQueueUpsert', 'notifyAdminBookingChanges', 'notifyAdminBookingTelegram',
    'guardSettingsPush', 'settingsReplaceOptions', 'buildClosuresSettingsReport', 'reportSettingsGuard', 'commitClosuresMerge',
    body,
  )(
    (_, fn) => fn, db, async req => ({ uid: 'U', role: req.role }), (m, s) => Object.assign(Error(m), { status: s }), crypto, true, '', '', '',
    { bookings: 'id', tables: 'number', waitlist: 'id', customers: 'phone', agencies: 'id', guides: 'id', groupReservations: 'id' },
    classifyDatasetByPermission, scopeClosureSettingsPush,
    snapshotBookingsByIds, { bookings: 'bookings', tables: 'tables', waitlist: 'waitlist', customers: 'customers' },
    item => item, () => 'tok', item => item,
    (name, items, idKey) => (items || []).map(item => ({ ref: ref(name, item[idKey]), data: item })),
    (name, ids) => (ids || []).map(id => ({ ref: ref(name, id), delete: true })),
    normalizeStoreSettings, x => x, notifyChanges, notifyTelegram,
    guardSettingsPush, settingsReplaceOptions, buildClosuresSettingsReport, async report => { reports.push(report) }, commitClosuresMerge,
  )
  return async (role, reqBody) => {
    const res = { code: 200, status(n) { this.code = n; return this }, json(d) { this.body = d; return this } }
    await adminPushData({ method: 'POST', role, body: reqBody, get: () => 'test-ua' }, res)
    return res
  }
}

// 記憶體 Firestore：mergeFields＝列出的頂層欄位整個替換；merge:true＝深層合併；runTransaction 同步執行（無並行）。
// failures：{ tx, batch } 為「接下來要失敗幾次」的計數（模擬 settings 合併 transaction／主要寫入 batch 失敗）。
export function createFakeDb(initial = {}) {
  const failures = { tx: 0, batch: 0 }
  const records = new Map(Object.entries(initial).map(([k, v]) => [k, structuredClone(v)]))
  const setCalls = []
  const isMap = v => v && typeof v === 'object' && !Array.isArray(v)
  const deepMerge = (old, next) => {
    const out = { ...(old || {}) }
    for (const [k, v] of Object.entries(next)) out[k] = isMap(v) && Object.keys(v).length && isMap(old?.[k]) ? deepMerge(old[k], v) : structuredClone(v)
    return out
  }
  const apply = (path, data, opts) => {
    setCalls.push({ path, data: structuredClone(data), options: opts })
    if (opts?.mergeFields) {
      const cur = { ...(records.get(path) || {}) }
      for (const f of opts.mergeFields) cur[f] = structuredClone(data[f])
      records.set(path, cur)
    } else if (opts?.merge) records.set(path, deepMerge(records.get(path), data))
    else records.set(path, structuredClone(data))
  }
  const snap = path => ({ exists: records.has(path), data: () => structuredClone(records.get(path)) })
  const ref = path => ({ path, get: async () => snap(path), collection: name => ({ doc: id => ref(`${path}/${name}/${id}`) }) })
  const db = {
    collection: name => ({ doc: id => ref(`${name}/${id}`) }),
    batch: () => {
      const staged = []
      return {
        set: (r, data, opts) => staged.push(() => apply(r.path, data, opts)),
        delete: r => staged.push(() => records.delete(r.path)),
        commit: async () => {
          if (failures.batch > 0) { failures.batch--; throw new Error('injected-batch-failure') }
          staged.forEach(fn => fn())
        },
      }
    },
    runTransaction: async fn => {
      if (failures.tx > 0) { failures.tx--; throw new Error('injected-transaction-failure') }
      const staged = []
      const result = await fn({
        get: async r => snap(r.path),
        set: (r, data, opts) => staged.push(() => apply(r.path, data, opts)),
        delete: r => staged.push(() => records.delete(r.path)),
      })
      staged.forEach(f => f())
      return result
    },
  }
  return { db, records, setCalls, failures }
}
