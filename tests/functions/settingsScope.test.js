import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import crypto from 'node:crypto'
import {
  roleCan, classifyDatasetByPermission, settingsWriteScope, CLOSURE_SETTING_KEYS, STAFF_ROLES,
} from '../../functions/lib/staffAccess'
import { scopeClosureSettingsPush } from '../../functions/lib/settingsScope'
import { guardSettingsPush, settingsReplaceOptions, buildClosuresSettingsReport } from '../../functions/lib/settingsGuard'
import { normalizeOnlineGuardSettings } from '../../functions/lib/onlineGuards'
import { guestPolicy } from '../../functions/lib/guestReliability'
import { CLOSURE_SETTING_KEYS as FRONT_CLOSURE_KEYS, settingsWriteScope as frontScope } from '../../src/utils/settingsScope'
import { PERMISSIONS as FRONT } from '../../src/contexts/AuthContext.jsx'

// 訂位專員（host）窄權限 settings.closures：只能存 settings 的「休店／關閉」key，其餘一律沿用雲端值。
// 背景見 functions/lib/settingsScope.js。

const COLS = ['bookings', 'tables', 'waitlist', 'customers', 'agencies', 'guides', 'groupReservations']
const source = readFileSync('functions/index.js', 'utf8')

// 真的後端 normalizeStoreSettings（含 normalizeClosuresServer 等），從 functions/index.js 原始碼抽出，
// 不 import firebase runtime。
const normalizeStoreSettings = (() => {
  const start = source.indexOf('function normalizeSeatingsServer(')
  const endFn = source.indexOf('function normalizeStoreSettings(')
  const end = source.indexOf('\n}', endFn) + 2
  const body = source.slice(start, end)
  return new Function(
    'normalizeOnlineGuardSettings', 'guestPolicy', 'DEFAULT_DINING_DURATION_MIN', 'DEFAULT_CLEANUP_BUFFER_MIN',
    'DEFAULT_STORE_PHONE', 'DEFAULT_STORE_ADDRESS', 'DEFAULT_STORE_MAP_URL', 'DEFAULT_STORE_LATITUDE', 'DEFAULT_STORE_LONGITUDE',
    'DEFAULT_LINE_LOGIN_START_ENDPOINT',
    body + '\nreturn normalizeStoreSettings',
  )(normalizeOnlineGuardSettings, guestPolicy, 90, 10, '049', '地址', 'https://maps', '23', '120', '')
})()

const CLOUD = {
  openTime: '11:00',
  closeTime: '19:00',
  seatings: [{ id: 'lunch1', name: '午餐第一批', start: '11:00', end: '13:00' }, { id: 'lunch2', name: '午餐第二批', start: '13:00', end: '15:00' }],
  closures: {
    closedDates: ['2026-10-20'],
    closedSlots: { '2026-10-11': ['12:00'] },
    closedSeatings: { '2026-10-10': ['lunch2'], '2026-10-12': ['lunch1'] },
  },
  lineLoginChannelId: '2009996489',
  lineLoginCallbackUrl: 'https://linelogincallback.example',
  publicSiteUrl: 'https://chicken-booking.zeabur.app/',
  storeName: '雞王涮涮鍋',
}

describe('權限：settings.closures 前後端成對、只給 manager 與 host', () => {
  it('manager／host 有；floor／kitchen 沒有', () => {
    expect(roleCan('manager', 'settings.closures')).toBe(true)
    expect(roleCan('host', 'settings.closures')).toBe(true)
    expect(roleCan('floor', 'settings.closures')).toBe(false)
    expect(roleCan('kitchen', 'settings.closures')).toBe(false)
    for (const r of STAFF_ROLES) expect(FRONT[r].has('settings.closures'), r).toBe(roleCan(r, 'settings.closures'))
  })
  it('host 仍沒有 settings.update（不可整份覆寫 LINE／營業時間）', () => {
    expect(roleCan('host', 'settings.update')).toBe(false)
    expect(FRONT.host.has('settings.update')).toBe(false)
  })
  it('寫入範圍：manager=full、host=closures、floor/kitchen=null；前後端同口徑', () => {
    const expected = { manager: 'full', host: 'closures', floor: null, kitchen: null }
    for (const r of STAFF_ROLES) {
      expect(settingsWriteScope(r), r).toBe(expected[r])
      expect(frontScope(p => FRONT[r].has(p)), r).toBe(expected[r])
    }
  })
  it('關閉相關 key 清單前後端相同（#156 的 weeklySeatings/openSeatings 在 closures 物件內）', () => {
    expect([...FRONT_CLOSURE_KEYS]).toEqual([...CLOSURE_SETTING_KEYS])
    expect(CLOSURE_SETTING_KEYS).toContain('closures')
  })
})

describe('classifyDatasetByPermission：settings 依角色分範圍', () => {
  const settings = { ...CLOUD, openTime: '10:00' }
  it('manager：整份照舊可寫（不看 settingsChangedKeys）', () => {
    const r = classifyDatasetByPermission({ settings }, 'manager', COLS)
    expect(r.hasRejection).toBe(false)
    expect(r.settingsScope).toBe('full')
    expect(r.writable.settings).toBe(settings)
  })
  it('host 只改關閉 key：可寫、無拒絕', () => {
    const r = classifyDatasetByPermission({ settings }, 'host', COLS, { settingsChangedKeys: ['closures'] })
    expect(r.hasRejection).toBe(false)
    expect(r.settingsScope).toBe('closures')
    expect(r.settingsKeys).toEqual(['closures'])
    expect(r.writable.settings).toBe(settings)
  })
  it('host 同時改了 LINE／營業時間：關閉 key 照寫，其餘回報在 rejected.settingsKeys（不連坐、不整包拒）', () => {
    const r = classifyDatasetByPermission({ settings, bookings: [{ id: 'b1' }] }, 'host', COLS,
      { settingsChangedKeys: ['openTime', 'closures', 'lineLoginChannelId'] })
    expect(r.hasRejection).toBe(true)
    expect(r.settingsScope).toBe('closures')
    expect(r.settingsKeys).toEqual(['closures'])
    expect(r.rejected.settings).toBe(true)
    expect(r.rejected.settingsKeys).toEqual(['lineLoginChannelId', 'openTime'])
    expect(r.writable.settings).toBeDefined()
    expect(r.writable.bookings).toHaveLength(1)
    expect(r.message).toContain('只能儲存休店／關閉設定')
  })
  it('host 只改了非關閉 key：settings 整份不寫、回報被拒', () => {
    const r = classifyDatasetByPermission({ settings }, 'host', COLS, { settingsChangedKeys: ['openTime'] })
    expect(r.settingsScope).toBe(null)
    expect(r.writable.settings).toBeUndefined()
    expect(r.rejected.settings).toBe(true)
  })
  it('🔴 host 舊前端（沒表態 settingsChangedKeys）：照舊拒絕整份 settings——不可拿可能過時的本機 closures 蓋雲端', () => {
    const r = classifyDatasetByPermission({ settings }, 'host', COLS)
    expect(r.settingsScope).toBe(null)
    expect(r.writable.settings).toBeUndefined()
    expect(r.rejected).toEqual({ writes: [], deletes: [], settings: true })
  })
  it.each(['floor', 'kitchen'])('%s：即使表態只改 closures 仍被拒', (role) => {
    const r = classifyDatasetByPermission({ settings }, role, COLS, { settingsChangedKeys: ['closures'] })
    expect(r.settingsScope).toBe(null)
    expect(r.writable.settings).toBeUndefined()
    expect(r.rejected.settings).toBe(true)
  })
})

describe('scopeClosureSettingsPush（純函式）', () => {
  it('只套 closures；客戶端夾帶的 LINE 空值／營業時間一律被忽略、沿用雲端值', () => {
    const client = {
      ...CLOUD,
      openTime: '09:00',
      lineLoginChannelId: '',
      publicSiteUrl: '',
      closures: { ...CLOUD.closures, closedSeatings: { '2026-10-12': ['lunch1'], '2026-10-13': ['lunch2'] } },
    }
    const r = scopeClosureSettingsPush({ clientSettings: client, cloudSettings: CLOUD, role: 'host', keys: ['closures'], normalize: normalizeStoreSettings })
    expect(r.mode).toBe('closures')
    expect(r.writeFields).toEqual(['closures'])
    expect(Object.keys(r.patch)).toEqual(['closures'])
    expect(r.changed).toBe(true)
    expect(r.next.openTime).toBe('11:00')
    expect(r.next.lineLoginChannelId).toBe('2009996489')
    expect(r.next.publicSiteUrl).toBe('https://chicken-booking.zeabur.app/')
    expect(r.patch.closures.closedSeatings).toEqual({ '2026-10-12': ['lunch1'], '2026-10-13': ['lunch2'] })
  })
  it('keys 夾帶非關閉 key（例如被竄改的請求）也只會套白名單內的', () => {
    const r = scopeClosureSettingsPush({ clientSettings: { ...CLOUD, openTime: '09:00' }, cloudSettings: CLOUD, role: 'host', keys: ['openTime', 'closures'], normalize: normalizeStoreSettings })
    expect(r.writeFields).toEqual(['closures'])
    expect(r.next.openTime).toBe('11:00')
  })
  it('關閉值與雲端相同 → changed=false（免寫），但 appliedKeys 仍回報，前端才能推進基準線', () => {
    const r = scopeClosureSettingsPush({ clientSettings: CLOUD, cloudSettings: CLOUD, role: 'host', keys: ['closures'], normalize: normalizeStoreSettings })
    expect(r.changed).toBe(false)
    expect(r.appliedKeys).toEqual(['closures'])
  })
  it.each(['manager', 'floor', 'kitchen'])('%s 不走本函式（mode=denied）', (role) => {
    const r = scopeClosureSettingsPush({ clientSettings: CLOUD, cloudSettings: CLOUD, role, keys: ['closures'], normalize: normalizeStoreSettings })
    expect(r.mode).toBe('denied')
    expect(r.writeFields).toEqual([])
  })
  it('#156 每週預設關閉／本日開放欄位隨 closures 物件一起被套用（不被當成非關閉 key 剝掉）', () => {
    const client = { ...CLOUD, closures: { ...CLOUD.closures, weeklySeatings: { 6: ['lunch2'] }, openSeatings: { '2026-10-17': ['lunch2'] } } }
    const r = scopeClosureSettingsPush({ clientSettings: client, cloudSettings: CLOUD, role: 'host', keys: ['closures'], normalize: x => x })
    expect(r.patch.closures.weeklySeatings).toEqual({ 6: ['lunch2'] })
    expect(r.patch.closures.openSeatings).toEqual({ '2026-10-17': ['lunch2'] })
  })
})

// === 真 adminPushData handler（從 functions/index.js 原始碼抽出）＋記憶體 Firestore ===
// fake 依 Firestore 語意：merge:true 會「深層合併」巢狀 map；mergeFields 只整個替換指定的頂層欄位。
describe('adminPushData（真 handler）：host 只能改關閉設定', () => {
  let records
  let setCalls
  let reports
  const clone = v => structuredClone(v)
  const isMap = v => v && typeof v === 'object' && !Array.isArray(v)
  const deepMerge = (old, next) => {
    const out = { ...(old || {}) }
    for (const [k, v] of Object.entries(next)) {
      out[k] = isMap(v) && Object.keys(v).length && isMap(old?.[k]) ? deepMerge(old[k], v) : clone(v)
    }
    return out
  }
  const ref = path => ({ path, get: async () => ({ exists: records.has(path), data: () => clone(records.get(path)) }) })
  const db = {
    collection: name => ({ doc: id => ref(`${name}/${id}`) }),
    batch: () => {
      const staged = []
      return {
        set: (r, data, opts) => { setCalls.push({ path: r.path, data, options: opts }); staged.push({ r, data, opts }) },
        delete: r => staged.push({ r, del: true }),
        commit: async () => {
          for (const { r, data, opts, del } of staged) {
            if (del) { records.delete(r.path); continue }
            if (opts?.mergeFields) {
              const cur = { ...(records.get(r.path) || {}) }
              for (const f of opts.mergeFields) cur[f] = clone(data[f])
              records.set(r.path, cur)
            } else if (opts?.merge) records.set(r.path, deepMerge(records.get(r.path), data))
            else records.set(r.path, clone(data))
          }
        },
      }
    },
  }
  let adminPushData
  const call = async (role, body) => {
    const res = { code: 200, status(n) { this.code = n; return this }, json(d) { this.body = d; return this } }
    await adminPushData({ method: 'POST', role, body }, res)
    return res
  }
  beforeEach(() => {
    records = new Map([['settings/main', clone(CLOUD)]])
    setCalls = []
    reports = []
    const pick = name => {
      const start = source.indexOf(`function ${name}(`)
      const s = source.slice(start - 6, start) === 'async ' ? start - 6 : start
      return source.slice(s, source.indexOf('\n}', start) + 2)
    }
    const pushStart = source.indexOf('export const adminPushData')
    const push = source.slice(pushStart, source.indexOf('\n})', pushStart) + 3).replace('export const', 'const')
    const body = [pick('commitInChunks'), pick('readSettingsForAdminNotify'), push].join('\n') + '\nreturn adminPushData'
    adminPushData = new Function(
      'onRequest', 'db', 'requireStaff', 'errorWithStatus', 'crypto', 'PUBLIC_CORS', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID',
      'LINE_CHANNEL_ACCESS_TOKEN', 'SYNC_COLLECTION_IDKEYS', 'classifyDatasetByPermission', 'scopeClosureSettingsPush',
      'snapshotBookingsByIds', 'COLLECTIONS', 'buildBookingUpsertData', 'createServerToken', 'stripServerOwnedCustomerFields',
      'upsertOps', 'deleteOps', 'normalizeStoreSettings', 'protectQueueUpsert', 'notifyAdminBookingChanges', 'notifyAdminBookingTelegram',
      'guardSettingsPush', 'settingsReplaceOptions', 'buildClosuresSettingsReport', 'reportSettingsGuard',
      body,
    )(
      (_, fn) => fn, db, async req => ({ uid: 'U', role: req.role }), (m, s) => Object.assign(Error(m), { status: s }), crypto, true, '', '', '',
      { bookings: 'id', tables: 'number', waitlist: 'id', customers: 'phone', agencies: 'id', guides: 'id', groupReservations: 'id' },
      classifyDatasetByPermission, scopeClosureSettingsPush,
      async () => new Map(), { bookings: 'bookings', tables: 'tables', waitlist: 'waitlist', customers: 'customers' },
      item => item, () => 'tok', item => item,
      (name, items, idKey) => (items || []).map(item => ({ ref: ref(`${name}/${item[idKey]}`), data: item })),
      (name, ids) => (ids || []).map(id => ({ ref: ref(`${name}/${id}`), delete: true })),
      normalizeStoreSettings, x => x, async () => {}, async () => {},
      guardSettingsPush, settingsReplaceOptions, buildClosuresSettingsReport, async report => { reports.push(report) },
    )
  })

  const hostClient = (closures, extra = {}) => ({ ...normalizeStoreSettings(CLOUD), ...extra, closures })

  it('host 關閉場次＋恢復某天：雲端 closures 整個替換（被移除的日期真的消失），其他設定原封不動', async () => {
    const closures = {
      closedDates: ['2026-10-20'],
      closedSlots: { '2026-10-11': ['12:00'] },
      // 移除 10-10 的關閉（恢復開放）、新增 10-13 關閉
      closedSeatings: { '2026-10-12': ['lunch1'], '2026-10-13': ['lunch2'] },
    }
    const r = await call('host', { partial: true, settingsChangedKeys: ['closures'], dataset: { settings: hostClient(closures) } })
    expect(r.code).toBe(200)
    expect(r.body.ok).toBe(true)
    expect(r.body.rejected).toBeUndefined()
    expect(r.body.settingsApplied).toEqual(['closures'])
    const saved = records.get('settings/main')
    expect(saved.closures.closedSeatings).toEqual({ '2026-10-12': ['lunch1'], '2026-10-13': ['lunch2'] })
    expect(saved.closures.closedSeatings['2026-10-10']).toBeUndefined()
    // 其他欄位：沿用雲端原始文件（沒被正規化重寫、沒多出預設值欄位）
    const { closures: _c, updatedAt, ...rest } = saved
    const { closures: _c2, ...cloudRest } = CLOUD
    expect(rest).toEqual(cloudRest)
    expect(typeof updatedAt).toBe('string')
  })

  it('host 夾帶 LINE 空值與營業時間：關閉照寫，LINE／營業時間不被洗；回應標示哪些被忽略', async () => {
    const closures = { ...CLOUD.closures, closedDates: ['2026-10-20', '2026-10-21'] }
    const client = hostClient(closures, { openTime: '09:00', lineLoginChannelId: '', publicSiteUrl: '' })
    const r = await call('host', {
      partial: true,
      settingsChangedKeys: ['closures', 'lineLoginChannelId', 'openTime', 'publicSiteUrl'],
      dataset: { settings: client, bookings: [{ id: 'B1', name: '王' }] },
    })
    expect(r.code).toBe(200)
    expect(r.body.settingsApplied).toEqual(['closures'])
    expect(r.body.rejected.settings).toBe(true)
    expect(r.body.rejected.settingsKeys).toEqual(['lineLoginChannelId', 'openTime', 'publicSiteUrl'])
    const saved = records.get('settings/main')
    expect(saved.closures.closedDates).toEqual(['2026-10-20', '2026-10-21'])
    expect(saved.openTime).toBe('11:00')
    expect(saved.lineLoginChannelId).toBe('2009996489')
    expect(saved.publicSiteUrl).toBe('https://chicken-booking.zeabur.app/')
    expect(records.get('bookings/B1')).toBeDefined() // 有權的集合不被連坐
  })

  it('host 舊前端（沒送 settingsChangedKeys）：settings 不寫入；不送 partial 時維持整包 403', async () => {
    const client = hostClient({ closedDates: [], closedSlots: {}, closedSeatings: {} })
    const legacy = await call('host', { dataset: { settings: client } })
    expect(legacy.code).toBe(403)
    const partial = await call('host', { partial: true, dataset: { settings: client } })
    expect(partial.code).toBe(200)
    expect(partial.body.rejected.settings).toBe(true)
    expect(partial.body.settingsApplied).toBeUndefined()
    expect(records.get('settings/main')).toEqual(CLOUD)
  })

  it('host 關閉值與雲端相同：不寫 settings（雲端連 updatedAt 都不動），仍回報 settingsApplied', async () => {
    const r = await call('host', { partial: true, settingsChangedKeys: ['closures'], dataset: { settings: hostClient(CLOUD.closures) } })
    expect(r.body.settingsApplied).toEqual(['closures'])
    expect(records.get('settings/main')).toEqual(CLOUD)
  })

  it.each(['floor', 'kitchen'])('%s：表態只改 closures 仍被拒、雲端不變', async (role) => {
    const r = await call(role, { partial: true, settingsChangedKeys: ['closures'], dataset: { settings: hostClient({ closedDates: [], closedSlots: {}, closedSeatings: {} }) } })
    expect(r.body.rejected.settings).toBe(true)
    expect(r.body.settingsApplied).toBeUndefined()
    expect(records.get('settings/main')).toEqual(CLOUD)
  })

  it('manager 行為不變：整份正規化後 merge 寫入（營業時間等照改），不回 settingsApplied', async () => {
    const client = { ...normalizeStoreSettings(CLOUD), openTime: '10:00' }
    const r = await call('manager', { partial: true, settingsChangedKeys: ['openTime'], dataset: { settings: client } })
    expect(r.code).toBe(200)
    expect(r.body.settingsApplied).toBeUndefined()
    expect(r.body.rejected).toBeUndefined()
    expect(records.get('settings/main').openTime).toBe('10:00')
    expect(records.get('settings/main').lineLoginChannelId).toBe('2009996489')
  })

  // === 與 PR #160（LINE 守門＋整欄替換）合併後的整合鎖 ===
  it('整合：host 推送寫入 options＝mergeFields:[closures, updatedAt]（不得 merge:true），稽核 closures-only 且無 LINE 告警', async () => {
    const closures = { ...CLOUD.closures, closedDates: ['2026-10-20', '2026-10-22'] }
    // 夾帶 LINE 空值：那些 key 被拒、不寫入，也不可觸發 LINE 告警
    const client = hostClient(closures, { lineLoginChannelId: '', publicSiteUrl: '', lineLoginCallbackUrl: '' })
    const r = await call('host', { partial: true, settingsChangedKeys: ['closures', 'lineLoginChannelId', 'publicSiteUrl', 'lineLoginCallbackUrl'], dataset: { settings: client } })
    expect(r.code).toBe(200)
    const settingsSets = setCalls.filter(c => c.path === 'settings/main')
    expect(settingsSets).toHaveLength(1)
    expect(settingsSets[0].options).toEqual({ mergeFields: ['closures', 'updatedAt'] })
    expect(settingsSets[0].options).not.toHaveProperty('merge')
    expect(Object.keys(settingsSets[0].data).sort()).toEqual(['closures', 'updatedAt'])
    expect(setCalls.find(c => c.path === 'system/sync').options).toEqual({ merge: true })
    expect(reports).toHaveLength(1)
    expect(reports[0].alert).toBeNull()
    expect(reports[0].audit).toMatchObject({
      event: 'settings_push_audit', scope: 'closures-only', role: 'host',
      appliedKeys: ['closures'], changedKeys: ['closures'], written: true, preservedFields: [], protectedChanged: [],
    })
    expect(JSON.stringify(reports[0].audit)).not.toContain('2026-10-22') // 稽核不含設定值
    expect(records.get('settings/main').lineLoginChannelId).toBe('2009996489')
  })

  it('整合：host 關閉值與雲端相同 → 不寫 settings，但仍留稽核（written:false、無告警）', async () => {
    await call('host', { partial: true, settingsChangedKeys: ['closures'], dataset: { settings: hostClient(CLOUD.closures) } })
    expect(setCalls.filter(c => c.path === 'settings/main')).toHaveLength(0)
    expect(reports).toHaveLength(1)
    expect(reports[0].alert).toBeNull()
    expect(reports[0].audit).toMatchObject({ scope: 'closures-only', written: false, changedKeys: [] })
  })

  it('整合：店長推送寫入 options＝mergeFields:全部頂層 key（含 closures／LINE／updatedAt），走 LINE 守門', async () => {
    const client = { ...normalizeStoreSettings(CLOUD), openTime: '10:00', lineLoginChannelId: '' }
    const r = await call('manager', { partial: true, dataset: { settings: client } })
    expect(r.code).toBe(200)
    const settingsSet = setCalls.find(c => c.path === 'settings/main')
    expect(settingsSet.options).not.toHaveProperty('merge')
    expect([...settingsSet.options.mergeFields].sort()).toEqual(Object.keys(settingsSet.data).sort())
    expect(settingsSet.options.mergeFields).toEqual(expect.arrayContaining(['closures', 'floorPlan', 'lineLoginChannelId', 'openTime', 'updatedAt']))
    expect(settingsSet.options.mergeFields.length).toBeGreaterThan(10)
    // LINE 守門：空值保留雲端值，並產生守門稽核（無 scope 標記＝A 原樣）＋告警
    expect(records.get('settings/main').lineLoginChannelId).toBe('2009996489')
    expect(reports).toHaveLength(1)
    expect(reports[0].audit.scope).toBeUndefined()
    expect(reports[0].audit.preservedFields).toEqual(['lineLoginChannelId'])
    expect(reports[0].alert).not.toBeNull()
  })
})
