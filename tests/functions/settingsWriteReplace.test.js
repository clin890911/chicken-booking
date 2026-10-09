import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import crypto from 'node:crypto'
import { guardSettingsPush, settingsReplaceOptions } from '../../functions/lib/settingsGuard'
import { classifyDatasetByPermission } from '../../functions/lib/staffAccess'
import { DEFAULT_LINE_LOGIN_START_ENDPOINT } from '../../functions/lib/lineReadiness'
import { normalizeOnlineGuardSettings } from '../../functions/lib/onlineGuards'
import { guestPolicy } from '../../functions/lib/guestReliability'

// 事故：adminPushData 以 merge:true 寫 settings/main，Firestore 對巢狀 map 逐 key 深層合併——
// 店長恢復某天開放（前端從 closures.closedSeatings 刪掉該日期 key），雲端的 key 不會被刪、下次拉取又復活。
// 已用本機 Firestore emulator 實證（merge:true 留下已刪日期、mergeFields 正確移除且保留未列出的頂層欄位）。
// 本檔鎖住：settings 寫入一律「頂層 key 整欄替換」（mergeFields），不是 merge:true。

const source = readFileSync('functions/index.js', 'utf8')
const extract = name => {
  let start = source.indexOf('function ' + name + '(')
  if (start < 0) throw Error('missing ' + name)
  if (source.slice(start - 6, start) === 'async ') start -= 6
  return source.slice(start, source.indexOf('\n}', start) + 2)
}
// 真正的 normalizeStoreSettings＋closures/floorPlan/seatings 子正規化（不初始化 Firebase）。
const normalizeStoreSettings = new Function(
  'normalizeOnlineGuardSettings', 'guestPolicy',
  'DEFAULT_DINING_DURATION_MIN', 'DEFAULT_CLEANUP_BUFFER_MIN', 'DEFAULT_LINE_LOGIN_START_ENDPOINT',
  'DEFAULT_STORE_PHONE', 'DEFAULT_STORE_ADDRESS', 'DEFAULT_STORE_MAP_URL', 'DEFAULT_STORE_LATITUDE', 'DEFAULT_STORE_LONGITUDE',
  "const FLOORPLAN_FLOORS = ['1F', '2F']; const FIXTURE_TYPES = ['label', 'rect', 'stairs']; const BG_MAX_URL_LEN = 500000\n"
  + ['normalizeSeatingsServer', 'normalizeClosuresServer', 'normalizeFloorPlanServer', 'normalizeStoreSettings'].map(extract).join('\n')
  + '\nreturn normalizeStoreSettings',
)(normalizeOnlineGuardSettings, guestPolicy, 90, 10, DEFAULT_LINE_LOGIN_START_ENDPOINT, '0000', 'addr', 'map', 1, 2)

// 依 Firestore set 語意套用一筆寫入（與 emulator 實證結果一致）：
// mergeFields → 列出的頂層欄位整個替換、其餘頂層欄位不動；merge:true → 巢狀 map 逐 key 深層合併。
const deepMerge = (a, b) => {
  if (!a || typeof a !== 'object' || Array.isArray(a) || !b || typeof b !== 'object' || Array.isArray(b)) return b
  if (!Object.keys(b).length) return b // 空 map 是葉值，會整個替換
  const out = { ...a }
  for (const [k, v] of Object.entries(b)) out[k] = deepMerge(a[k], v)
  return out
}
const applySet = (existing = {}, data, options) => {
  if (options?.mergeFields) {
    const out = { ...existing }
    for (const f of options.mergeFields) out[f] = structuredClone(data[f])
    return out
  }
  if (options?.merge) return deepMerge(existing, structuredClone(data))
  return structuredClone(data)
}

function harness(cloudSettings) {
  const records = new Map([['settings/main', structuredClone(cloudSettings)]])
  const setCalls = []
  const ref = path => ({ path, get: async () => ({ exists: records.has(path), data: () => structuredClone(records.get(path)) }) })
  const db = { collection: name => ({ doc: id => ref(name + '/' + id) }) }
  // 真正的 commitInChunks 原始碼，batch 以 fake 記錄 set 的 options 並依語意落地。
  const commitInChunks = new Function('db', extract('commitInChunks') + '\nreturn commitInChunks')({
    batch: () => {
      const staged = []
      return {
        set: (r, data, options) => { setCalls.push({ path: r.path, data, options }); staged.push(() => records.set(r.path, applySet(records.get(r.path), data, options))) },
        delete: r => staged.push(() => records.delete(r.path)),
        commit: async () => staged.forEach(fn => fn()),
      }
    },
  })
  const start = source.indexOf('export const adminPushData')
  const push = source.slice(start, source.indexOf('\n})', start) + 3).replace('export const', 'const')
  const adminPushData = new Function(
    'onRequest', 'db', 'requireStaff', 'errorWithStatus', 'crypto', 'PUBLIC_CORS', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'LINE_CHANNEL_ACCESS_TOKEN',
    'SYNC_COLLECTION_IDKEYS', 'classifyDatasetByPermission', 'snapshotBookingsByIds', 'COLLECTIONS', 'buildBookingUpsertData', 'createServerToken',
    'stripServerOwnedCustomerFields', 'upsertOps', 'deleteOps', 'normalizeStoreSettings', 'readSettingsForAdminNotify', 'commitInChunks',
    'notifyAdminBookingChanges', 'notifyAdminBookingTelegram', 'guardSettingsPush', 'settingsReplaceOptions', 'reportSettingsGuard', 'protectQueueUpsert',
    push + '\nreturn adminPushData',
  )((_, fn) => fn, db, async () => ({ uid: 'u1', role: 'manager', email: 'm@example.com' }), (m, s) => Object.assign(Error(m), { status: s }), crypto, true, '', '', '',
    { bookings: 'id' }, classifyDatasetByPermission, async () => new Map(), { bookings: 'bookings', waitlist: 'waitlist', customers: 'customers' }, x => x, () => '',
    x => x, () => [], () => [], normalizeStoreSettings, async () => ({}), commitInChunks,
    async () => {}, async () => {}, guardSettingsPush, settingsReplaceOptions, async () => {}, x => x)
  const call = async dataset => {
    const res = { code: 200, status(n) { this.code = n; return this }, json(b) { this.body = b; return this } }
    await adminPushData({ method: 'POST', body: { dataset, partial: true }, get: () => 'test-ua' }, res)
    return res
  }
  return { records, setCalls, call }
}

const cloud = {
  ...normalizeStoreSettings({
    closures: {
      closedDates: ['2026-10-20'],
      closedSeatings: { '2026-10-10': ['lunch', 'dinner'], '2026-10-12': ['dinner'] },
      closedSlots: { '2026-10-11': ['11:00'], '2026-10-13': ['18:00'] },
    },
  }),
  backendOnlyField: 'keep-me', // 後端專用欄位：不在 normalize 輸出中，必須不被動到
}

describe('settingsReplaceOptions', () => {
  it('回傳 mergeFields＝本次資料的全部頂層 key，不含 merge:true', () => {
    const data = { ...normalizeStoreSettings({}), updatedAt: 'x' }
    const opts = settingsReplaceOptions(data)
    expect(opts).not.toHaveProperty('merge')
    expect([...opts.mergeFields].sort()).toEqual(Object.keys(data).sort())
  })
  it('空資料或含點的 key 直接拒絕（mergeFields 會把點解析成巢狀路徑）', () => {
    expect(() => settingsReplaceOptions({})).toThrow('settings-write-empty')
    expect(() => settingsReplaceOptions({ 'a.b': 1 })).toThrow('settings-write-invalid-key')
  })
})

describe('adminPushData 寫 settings/main：頂層 key 整欄替換，不是深層合併', () => {
  it('set 的 options 是 mergeFields 且涵蓋所有寫入的頂層 key、不含 merge:true；其他文件仍走 merge', async () => {
    const h = harness(cloud)
    const res = await h.call({ settings: { ...cloud, openTime: '11:30' } })
    expect(res.code).toBe(200)
    const settingsSet = h.setCalls.find(c => c.path === 'settings/main')
    expect(settingsSet.options).not.toHaveProperty('merge')
    expect([...settingsSet.options.mergeFields].sort()).toEqual(Object.keys(settingsSet.data).sort())
    expect(settingsSet.options.mergeFields).toEqual(expect.arrayContaining(['closures', 'floorPlan', 'updatedAt']))
    expect(h.setCalls.find(c => c.path === 'system/sync').options).toEqual({ merge: true })
  })

  it('從 closedSeatings／closedSlots 移除日期後，寫入資料不含該日期，雲端也不再復活', async () => {
    const h = harness(cloud)
    const local = structuredClone(cloud)
    delete local.backendOnlyField
    delete local.closures.closedSeatings['2026-10-10'] // 店長恢復 10/10 整天開放
    delete local.closures.closedSlots['2026-10-11']
    const res = await h.call({ settings: local })
    expect(res.code).toBe(200)
    const written = h.setCalls.find(c => c.path === 'settings/main').data
    expect(written.closures.closedSeatings).toEqual({ '2026-10-12': ['dinner'] })
    expect(written.closures.closedSlots).toEqual({ '2026-10-13': ['18:00'] })
    const stored = h.records.get('settings/main')
    expect(stored.closures.closedSeatings).not.toHaveProperty('2026-10-10')
    expect(stored.closures.closedSlots).not.toHaveProperty('2026-10-11')
    expect(stored.closures.closedDates).toEqual(['2026-10-20'])
    expect(stored.backendOnlyField).toBe('keep-me') // 未寫入的頂層欄位保持不動
  })

  it('含候位的 transaction 提交路徑同樣尊重 op.options（不可寫死 merge:true）', () => {
    const start = source.indexOf('export const adminPushData')
    const body = source.slice(start, source.indexOf('\n})', start))
    expect(body).toContain('tx.set(op.ref,op.data,op.options||{merge:true})')
    expect(body).toContain('options: settingsReplaceOptions(settingsData)')
  })

  it('對照：若用 merge:true，同樣的寫入會讓已刪日期復活（本修正要擋的行為）', () => {
    const next = normalizeStoreSettings({ closures: { closedSeatings: { '2026-10-12': ['dinner'] } } })
    expect(applySet(cloud, next, { merge: true }).closures.closedSeatings).toHaveProperty('2026-10-10')
    expect(applySet(cloud, next, settingsReplaceOptions(next)).closures.closedSeatings).not.toHaveProperty('2026-10-10')
  })

  it('與 LINE 守門相容：寫入的是守門後的值（空 LINE 欄位保留雲端值），同時整欄替換 closures', async () => {
    const line = { ...cloud, lineLoginChannelId: '1234567890', lineLoginCallbackUrl: 'https://cb.example/cb', publicSiteUrl: 'https://site.example/' }
    const h = harness(line)
    const local = { ...structuredClone(line), lineLoginChannelId: '', lineLoginCallbackUrl: '', publicSiteUrl: '' }
    delete local.backendOnlyField
    delete local.closures.closedSeatings['2026-10-10']
    await h.call({ settings: local })
    const stored = h.records.get('settings/main')
    expect(stored.lineLoginChannelId).toBe('1234567890')
    expect(stored.lineLoginCallbackUrl).toBe('https://cb.example/cb')
    expect(stored.publicSiteUrl).toBe('https://site.example/')
    expect(stored.closures.closedSeatings).not.toHaveProperty('2026-10-10')
  })
})
