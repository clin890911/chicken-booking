import { describe, it, expect, vi, beforeAll, beforeEach, afterEach, afterAll } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { INITIAL_TABLES } from '../../src/data/tables'
import { getSettings } from '../../src/services/settingsService'
import { todayStr } from '../../src/utils/timeSlots'
import { classifyDatasetByPermission, roleCan } from '../../functions/lib/staffAccess.js'

// === 迴歸：全新裝置（空 localStorage）第一次登入，不可把「出廠桌位＋出廠設定」推上雲端蓋掉店家資料 ===
//
// 2026-09-19 發現：修補前 bootCloud 在拉取之前先跑三支一次性遷移（migrateLocalToCloudOnce /
// migrateTableLayoutOnce / migrateTableDimsOnce），加上首拉前的差異推送沒有閘門，全新裝置上
// 店長、外場、訂位專員登入都會把出廠佈局／設定蓋回雲端（(a)–(e) 在修補前全紅）。
// 修補：三支遷移退役、bootCloud 第一個網路動作就是拉取；cloudDataService 加「首拉閘門」。
//
// 掛載真正的 BookingProvider，照正式 App 的時序走：
//   App 掛載 → refresh() 讀 tableService.listAll() → 本機種下出廠 INITIAL_TABLES
//   → Firebase 登入非同步完成（user 從 null 變成員工）→ bootCloud → pullCloud
// 雲端呼叫全部由本檔的 fake backend 接手：RBAC 直接用後端同一支
// classifyDatasetByPermission（functions/lib/staffAccess.js，純函式），寫入語意模擬
// adminPushData 的 merge-upsert（functions/index.js commitInChunks: batch.set(..., { merge: true })）。
//
// 🔒 絕不打到正式環境：
//   1. VITE_FUNCTION_BASE_URL 指到 .invalid 網域（RFC 2606 保證不可解析）；
//   2. globalThis.fetch 整份換成 guardedFetch：只接受 fake base 底下的 adminPullData / adminPushData，
//      其餘任何 URL（含 cloudfunctions.net）一律記進 leaks 並直接 throw，**且整個檔案跑完都不還原真 fetch**；
//   3. XMLHttpRequest / WebSocket 一律 throw；
//   4. 每條測試先斷言 leaks 為空。

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const h = vi.hoisted(() => ({
  auth: { current: null },
  toast: { success: () => {}, error: () => {}, warning: () => {}, info: () => {} },
}))
vi.mock('../../src/contexts/AuthContext', () => ({ useAuth: () => h.auth.current }))
vi.mock('../../src/components/ui/Toast', () => ({ useToast: () => h.toast }))

const FAKE_BASE = 'https://fake-functions.invalid'
const SYNC_COLLECTIONS = ['bookings', 'tables', 'waitlist', 'customers', 'agencies', 'guides', 'groupReservations']
const ID_KEY = { bookings: 'id', tables: 'number', waitlist: 'id', customers: 'phone', agencies: 'id', guides: 'id', groupReservations: 'id' }
const clone = (v) => JSON.parse(JSON.stringify(v))

// ---------- 網路封鎖 ----------
let activeBackend = null
const leaks = []
async function guardedFetch(url, options) {
  const u = String(url)
  if (!activeBackend || !u.startsWith(FAKE_BASE + '/')) {
    leaks.push(u)
    throw new Error(`unmocked network: ${u}`)
  }
  return activeBackend.fetchImpl(u, options)
}
const realFetch = globalThis.fetch
const realXHR = globalThis.XMLHttpRequest
const realWS = globalThis.WebSocket

beforeAll(() => {
  vi.stubEnv('VITE_FUNCTION_BASE_URL', FAKE_BASE)
  vi.stubEnv('VITE_TELEGRAM_BOT_TOKEN', '')
  globalThis.fetch = guardedFetch
  if (typeof window !== 'undefined') window.fetch = guardedFetch
  globalThis.XMLHttpRequest = function BlockedXHR() { throw new Error('unmocked network: XMLHttpRequest') }
  globalThis.WebSocket = function BlockedWS() { throw new Error('unmocked network: WebSocket') }
})
afterAll(() => {
  // 刻意不還原 fetch（worker 隨檔案結束而銷毀）：避免任何殘留的非同步呼叫在還原後打到真網路。
  globalThis.XMLHttpRequest = realXHR
  globalThis.WebSocket = realWS
  void realFetch
})

// ---------- fake backend（adminPullData / adminPushData）----------
function createFakeBackend(role, cloud) {
  const state = {
    role,
    pullFails: false,
    collections: Object.fromEntries(SYNC_COLLECTIONS.map(c => [c, new Map()])),
    settings: clone(cloud.settings),
  }
  for (const c of SYNC_COLLECTIONS) {
    for (const d of cloud[c] || []) state.collections[c].set(String(d[ID_KEY[c]]), clone(d))
  }
  const log = { pulls: [], pushes: [] }
  const respond = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => clone(body) })

  async function fetchImpl(url, options = {}) {
    const name = url.slice(FAKE_BASE.length + 1)
    if (name === 'adminPullData') {
      log.pulls.push({ failed: state.pullFails })
      if (state.pullFails) throw new TypeError('Failed to fetch') // 模擬離線／冷啟動逾時
      const out = { ok: true, serverCollections: SYNC_COLLECTIONS }
      for (const c of SYNC_COLLECTIONS) out[c] = [...state.collections[c].values()]
      out.tables.sort((a, b) => String(a.number).localeCompare(String(b.number)))
      out.settings = state.settings
      if (state.role === 'kitchen') out.customers = [] // 與 adminPullData 相同：廚房不下發顧客 PII
      return respond(200, out)
    }
    if (name === 'adminPushData') {
      const { dataset = {}, partial = false } = JSON.parse(options.body || '{}')
      const { writable, rejected, hasRejection, message } =
        classifyDatasetByPermission(dataset, state.role, SYNC_COLLECTIONS)
      // 與 functions/index.js adminPushData 相同：舊（非 partial）客戶端任一越權即整包 403。
      if (hasRejection && partial !== true) {
        log.pushes.push({ status: 403, partial, dataset: clone(dataset), rejected })
        return respond(403, { ok: false, error: message })
      }
      const now = new Date().toISOString()
      for (const c of SYNC_COLLECTIONS) {
        for (const item of writable[c] || []) {
          const id = String(item?.[ID_KEY[c]] ?? item?.id ?? '').trim()
          if (!id) continue
          const prev = state.collections[c].get(id) || {}
          // batch.set(ref, data, { merge: true })：帶到的欄位覆蓋、沒帶的保留
          state.collections[c].set(id, { ...prev, ...clone(item), updatedAt: item.updatedAt || now })
        }
        for (const id of writable.deletedIds?.[c] || []) state.collections[c].delete(String(id))
      }
      if (writable.settings) {
        // settings/main：後端先 normalizeStoreSettings（白名單每個 key 都有值）再 merge:true，
        // 等同白名單內每個頂層 key 都被覆蓋。前端 settings 沒有 telegramNotifyOnAdminChange，
        // 後端正規化成 `!== false` → true（模擬這一條，其餘 key 前後端同形）。
        state.settings = {
          ...state.settings,
          ...clone(writable.settings),
          telegramNotifyOnAdminChange: writable.settings.telegramNotifyOnAdminChange !== false,
          updatedAt: now,
        }
      }
      log.pushes.push({ status: 200, partial, dataset: clone(dataset), rejected: hasRejection ? rejected : null })
      return respond(200, hasRejection ? { ok: true, rejected, rejectedMessage: message, role: state.role } : { ok: true })
    }
    leaks.push(url)
    throw new Error(`unmocked endpoint: ${url}`)
  }
  return { state, log, fetchImpl }
}

// ---------- 雲端既有資料：店家自己排過的佈局＋設定 ----------
const TODAY = todayStr()
function customCloud({ extraTable = true } = {}) {
  const defaults = getSettings() // 此時 localStorage 為空 → 出廠預設
  const tables = clone(INITIAL_TABLES).map(t => ({ ...t, x: t.x + 7, y: t.y + 3 })) // 每張桌都偏離出廠座標
  const [t0, t1, t2, t3] = tables
  Object.assign(t0, { status: 'dining', currentBookingId: 'b-live', seatedAt: new Date().toISOString() }) // 營業中有人坐
  Object.assign(t1, { zoneId: 'z-window' })                                                          // 分區
  Object.assign(t2, { isActive: false })                                                             // 永久停用
  Object.assign(t3, { outage: { from: TODAY, to: '', reason: '冷氣維修' } })                          // 維修停用
  if (extraTable) tables.push({ ...clone(INITIAL_TABLES[0]), number: '268', floor: '2F', x: 900, y: 700 }) // 店家自己加的桌
  return {
    tables,
    bookings: [{
      id: 'b-live', name: '林先生', phone: '0911000111', guests: 4, date: TODAY, timeSlot: '12:00',
      status: 'arrived', assignedTableId: t0.number, source: 'walk-in',
    }],
    settings: {
      ...defaults,
      closures: { closedDates: ['2026-09-30'], closedSlots: {}, closedSeatings: {} },
      seatings: [...defaults.seatings, { id: 'dinner2', name: '晚餐第二批', start: '19:00', end: '20:30' }],
      floorPlan: { ...defaults.floorPlan, zones: [{ id: 'z-window', name: '窗邊區', color: '#f59e0b' }] },
      lineLoginChannelId: '2009996489',
      lineLoginCallbackUrl: 'https://booking.example.invalid/line/callback',
      publicSiteUrl: 'https://booking.example.invalid',
      onlineAutoCloseEnabled: true,
      telegramNotifyOnAdminChange: false,
    },
  }
}

// ---------- 掛載 App（真 BookingProvider）----------
let mounted = null
const getToken = async () => 'fake-id-token'

async function mountApp() {
  vi.resetModules() // 模擬「新開分頁」：cloudDataService 的模組層級基準線重新載入
  const { BookingProvider, useBooking } = await import('../../src/contexts/BookingContext')
  const ref = { ctx: null }
  function Probe() { ref.ctx = useBooking(); return null }
  const root = createRoot(document.createElement('div'))
  const render = () => act(async () => { root.render(<BookingProvider><Probe /></BookingProvider>) })
  mounted = { root, ref, render }
  return mounted
}

async function waitUntil(pred, label, timeoutMs = 4000) {
  const start = Date.now()
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timeout: ${label}`)
    await act(async () => { await new Promise(r => setTimeout(r, 10)) })
  }
  await act(async () => { await new Promise(r => setTimeout(r, 30)) }) // 讓尾端 microtask/effect 收乾淨
}

// App 掛載（尚未登入）→ 登入完成成為 role → 等 bootCloud 跑完
async function bootAs(backend, role) {
  activeBackend = backend
  const app = await mountApp()
  h.auth.current = { user: null, getToken, usingFirebase: true, can: () => false }
  await app.render()
  const email = `${role}@example.invalid`
  h.auth.current = {
    user: { email, displayName: role, role, roleLabel: role },
    getToken, usingFirebase: true, can: (p) => roleCan(role, p),
  }
  const pullsBefore = backend.log.pulls.length
  await app.render()
  // bootCloud 一開始把 cloudStatus 設成 'syncing'，最後一步 pullCloud 成功→'synced'、失敗→'offline'。
  // 中間三支 migrate 都不動 cloudStatus，所以「離開 syncing」＝ bootCloud 整段跑完。
  // （fake backend 全走 microtask，async act 通常已把整段 boot 跑完；waitUntil 只是保險。）
  await waitUntil(
    () => backend.log.pulls.length > pullsBefore && app.ref.ctx.cloudStatus.state !== 'syncing',
    'bootCloud')
  return app
}

const sleep = (ms) => act(async () => { await new Promise(r => setTimeout(r, ms)) })

async function unmountApp() {
  if (!mounted) return
  const { root } = mounted
  mounted = null
  await act(async () => { root.unmount() })
}

// ---------- 證據整理 ----------
const LIVE_AND_LAYOUT_FIELDS = ['floor', 'x', 'y', 'w', 'h', 'capacity', 'rotation', 'zoneId', 'isActive', 'outage', 'status', 'currentBookingId', 'seatedAt']

// 依 payload 形狀標記來源（修補前的三支遷移已刪除，保留形狀標籤方便辨識回歸）。
function sourceOf(p) {
  if (p.partial) return 'bookings' in p.dataset && 'settings' in p.dataset && 'guides' in p.dataset
    ? '整包 localDataset（partial：設定頁手動上傳）'
    : 'pushChangedData（partial:true）'
  return 'bookings' in p.dataset
    ? '整包 localDataset、非 partial（舊 migrateLocalToCloudOnce 形狀）'
    : '只含 tables、非 partial（舊 migrateTable*Once 形狀）'
}

// 每一筆「被後端接受」的推送，逐一列出它蓋掉了雲端哪些既有值。
function damageReport(log, before) {
  const out = []
  for (const p of log.pushes) {
    if (p.status !== 200) continue
    const ds = p.dataset
    const tablesWritten = !(p.rejected?.writes || []).includes('tables')
    const overwrittenTables = tablesWritten
      ? (ds.tables || []).filter(t => {
          const b = before.tables.find(x => x.number === t.number)
          return b && LIVE_AND_LAYOUT_FIELDS.some(f => JSON.stringify(t[f] ?? null) !== JSON.stringify(b[f] ?? null))
        }).map(t => t.number)
      : []
    const deletedTables = (p.rejected?.deletes || []).includes('tables') ? [] : (ds.deletedIds?.tables || [])
    const overwrittenSettings = ds.settings && !p.rejected?.settings
      ? Object.keys(before.settings).filter(k => k in ds.settings && JSON.stringify(ds.settings[k]) !== JSON.stringify(before.settings[k]))
      : []
    if (overwrittenTables.length || deletedTables.length || overwrittenSettings.length) {
      out.push({ source: sourceOf(p), overwrittenTableCount: overwrittenTables.length, deletedTables, overwrittenSettings })
    }
  }
  return out
}

// 雲端終態摘要（只挑會被出廠值蓋掉的欄位）
function cloudSummary(stateOrCloud) {
  const tables = stateOrCloud.collections
    ? [...stateOrCloud.collections.tables.values()]
    : stateOrCloud.tables
  const settings = stateOrCloud.settings
  const byNo = (n) => tables.find(t => t.number === n) || null
  const [n0, n1, n2, n3] = INITIAL_TABLES.map(t => t.number)
  return {
    [`${n0}.x/y`]: byNo(n0) && [byNo(n0).x, byNo(n0).y],
    [`${n0}.status`]: byNo(n0)?.status,
    [`${n1}.zoneId`]: byNo(n1)?.zoneId,
    [`${n2}.isActive`]: byNo(n2)?.isActive,
    [`${n3}.outage`]: byNo(n3)?.outage?.reason ?? null,
    'table 268 存在': !!byNo('268'),
    'settings.closures.closedDates': settings.closures?.closedDates,
    'settings.seatings 數量': settings.seatings?.length,
    'settings.floorPlan.zones': (settings.floorPlan?.zones || []).map(z => z.id),
    'settings.lineLoginChannelId': settings.lineLoginChannelId,
    'settings.publicSiteUrl': settings.publicSiteUrl,
    'settings.onlineAutoCloseEnabled': settings.onlineAutoCloseEnabled,
    'settings.telegramNotifyOnAdminChange': settings.telegramNotifyOnAdminChange,
  }
}

function pushTrace(log) {
  return log.pushes.map(p => ({
    status: p.status,
    source: sourceOf(p),
    keys: Object.keys(p.dataset),
    tables: (p.dataset.tables || []).length,
  }))
}

beforeEach(() => {
  leaks.length = 0
  activeBackend = null
})
afterEach(async () => {
  await unmountApp()
  activeBackend = null
})

// =====================================================================================
describe('全新裝置第一次登入：不可把出廠桌位／出廠設定推上雲端蓋掉店家資料', () => {
  it('(a) 店長 manager＋首拉正常成功', async () => {
    const cloud = customCloud({ extraTable: true })
    const be = createFakeBackend('manager', cloud)
    await bootAs(be, 'manager')

    expect(leaks).toEqual([])
    // 證據：推送序列（方便在失敗訊息裡看出是哪一支推了什麼）
    console.info('[(a) manager/pull OK] push trace:', JSON.stringify(pushTrace(be.log)))
    expect({
      damagingPushes: damageReport(be.log, cloud),
      cloudAfter: cloudSummary(be.state),
    }).toEqual({
      damagingPushes: [],
      cloudAfter: cloudSummary(cloud),
    })
  })

  it('(b) 店長 manager＋首拉失敗（離線／冷啟動）', async () => {
    const cloud = customCloud({ extraTable: true })
    const be = createFakeBackend('manager', cloud)
    be.state.pullFails = true
    await bootAs(be, 'manager')

    expect(leaks).toEqual([])
    console.info('[(b) manager/pull FAIL] push trace:', JSON.stringify(pushTrace(be.log)))
    expect({
      damagingPushes: damageReport(be.log, cloud),
      cloudAfter: cloudSummary(be.state),
    }).toEqual({
      damagingPushes: [],
      cloudAfter: cloudSummary(cloud),
    })
  })

  it('(c) 外場 floor＋首拉正常成功（雲端桌號皆在出廠集合內）：非店長一樣會把佈局洗回出廠', async () => {
    const cloud = customCloud({ extraTable: false })
    const be = createFakeBackend('floor', cloud)
    await bootAs(be, 'floor')

    expect(leaks).toEqual([])
    console.info('[(c) floor/pull OK] push trace:', JSON.stringify(pushTrace(be.log)))
    expect({
      damagingPushes: damageReport(be.log, cloud),
      cloudAfter: cloudSummary(be.state),
    }).toEqual({
      damagingPushes: [],
      cloudAfter: cloudSummary(cloud),
    })
  })

  it('(d) 外場 floor＋首拉失敗，接著做任何一個與桌位無關的操作（抽候位號）', async () => {
    const cloud = customCloud({ extraTable: true })
    const be = createFakeBackend('floor', cloud)
    be.state.pullFails = true
    const app = await bootAs(be, 'floor')

    await act(async () => { app.ref.ctx.addWaitlist({ name: '陳先生', partySize: 2 }) })
    await sleep(400) // > syncCloudSoon 的 250ms 防抖：修補前這裡會送出含 52 張出廠桌的推送

    expect(leaks).toEqual([])
    console.info('[(d) floor/pull FAIL + addWaitlist] push trace:', JSON.stringify(pushTrace(be.log)))
    expect({
      damagingPushes: damageReport(be.log, cloud),
      cloudAfter: cloudSummary(be.state),
    }).toEqual({
      damagingPushes: [],
      cloudAfter: cloudSummary(cloud),
    })
  })

  // 修補前：外場裝置的 migrateLocalToCloudOnce 永遠因 settings 被 403、旗標設不起來，日後店長在這台登入
  // 就把「上次關 app 時」的過時本機快照整包蓋回雲端，倒回別台之後的變更。
  it('(e) 同家族：外場裝置日後由店長登入 → 不可用過時的本機快照蓋回雲端（先拉再說）', async () => {
    const cloud = customCloud({ extraTable: true })
    const be = createFakeBackend('floor', cloud)
    await bootAs(be, 'floor')
    await unmountApp()
    expect(localStorage.getItem('chicken_firestore_migrated_v1')).toBeNull() // 舊旗標：修補前 403 設不起來，修補後不再使用

    // 隔天：另一台裝置（店長 iPad）把 1 號桌挪走、加了一天公休
    const n0 = INITIAL_TABLES[0].number
    const t = be.state.collections.tables.get(n0)
    be.state.collections.tables.set(n0, { ...t, x: 999, y: 555 })
    be.state.settings = { ...be.state.settings, closures: { ...be.state.settings.closures, closedDates: ['2026-09-30', '2026-10-01'] } }
    const cloudNow = { tables: [...be.state.collections.tables.values()].map(clone), settings: clone(be.state.settings) }

    // 店長在這台外場裝置登入（重新整理＝新 session）
    be.state.role = 'manager'
    be.log.pushes.length = 0
    await bootAs(be, 'manager')

    expect(leaks).toEqual([])
    console.info('[(e) floor→manager stale device] push trace:', JSON.stringify(pushTrace(be.log)))
    expect({
      damagingPushes: damageReport(be.log, cloudNow),
      cloudAfter: cloudSummary(be.state),
    }).toEqual({
      damagingPushes: [],
      cloudAfter: cloudSummary(cloudNow),
    })
  })

  it('（對照組）已同步過的舊裝置：本機＝雲端（殘留舊遷移旗標無作用）→ 開機不推任何東西', async () => {
    const cloud = customCloud({ extraTable: true })
    // 模擬「這台之前已正常同步過」：本機資料＝雲端；舊版三支一次性遷移的旗標殘留在 localStorage（不必清）
    localStorage.setItem('chicken_tables_v3', JSON.stringify(cloud.tables))
    localStorage.setItem('chicken_bookings_v1', JSON.stringify(cloud.bookings))
    localStorage.setItem('chicken_settings_v1', JSON.stringify(cloud.settings))
    localStorage.setItem('chicken_firestore_migrated_v1', '1')
    localStorage.setItem('chicken_table_layout_version', 'kingchicken-2026-06')
    localStorage.setItem('chicken_table_dims_version', 'wide-6p-2026-06')
    const be = createFakeBackend('manager', cloud)
    await bootAs(be, 'manager')

    expect(leaks).toEqual([])
    expect(be.log.pulls.length).toBeGreaterThanOrEqual(1)
    expect(pushTrace(be.log)).toEqual([])
    expect({
      damagingPushes: damageReport(be.log, cloud),
      cloudAfter: cloudSummary(be.state),
    }).toEqual({
      damagingPushes: [],
      cloudAfter: cloudSummary(cloud),
    })
  })
})

// =====================================================================================
describe('⑥ 四個角色各跑一次全新裝置情境（首拉成功）', () => {
  it.each(['manager', 'floor', 'host', 'kitchen'])('%s：開機零推送、雲端不變、本機採雲端佈局', async (role) => {
    const cloud = customCloud({ extraTable: role === 'manager' }) // 非店長用「無自加桌」：修補前 (c) 路徑最容易中
    const be = createFakeBackend(role, cloud)
    const app = await bootAs(be, role)

    expect(leaks).toEqual([])
    expect(app.ref.ctx.cloudStatus.state).toBe('synced')
    expect(pushTrace(be.log)).toEqual([]) // 首拉開閘後的主動補推：沒有待推資料 → 不發請求
    expect(cloudSummary(be.state)).toEqual(cloudSummary(cloud))
    // 本機（這台裝置的畫面）也是雲端佈局，不是出廠佔位桌
    const n0 = INITIAL_TABLES[0].number
    expect(app.ref.ctx.tables.find(t => t.number === n0)?.x).toBe(INITIAL_TABLES[0].x + 7)
  })
})

describe('⑦ 首拉失敗 → 期間建立的資料不推 → 回線拉取成功 → 自動推上（只推新資料）', () => {
  it.each(['manager', 'floor'])('%s', async (role) => {
    const cloud = customCloud({ extraTable: true })
    const be = createFakeBackend(role, cloud)
    be.state.pullFails = true
    const app = await bootAs(be, role)
    expect(app.ref.ctx.cloudStatus.state).toBe('offline')

    await act(async () => { app.ref.ctx.addWaitlist({ name: '陳先生', partySize: 2 }) })
    await sleep(400)
    expect(be.log.pushes).toEqual([])                            // 閘門未開：一個請求都沒發
    expect(app.ref.ctx.cloudStatus.state).toBe('offline')       // 不因延後推送被改成 synced / rejected

    // 回線：瀏覽器 online 事件 → pullCloud → 首拉成功開閘 → 主動補推（不等店員下一個動作）
    be.state.pullFails = false
    await act(async () => { window.dispatchEvent(new Event('online')) })
    await waitUntil(() => be.log.pushes.length > 0, 'first-pull auto push')
    await sleep(50)

    expect(leaks).toEqual([])
    expect(pushTrace(be.log)).toEqual([
      { status: 200, source: 'pushChangedData（partial:true）', keys: ['waitlist'], tables: 0 },
    ])
    expect([...be.state.collections.waitlist.values()].map(w => w.name)).toEqual(['陳先生'])
    expect(damageReport(be.log, cloud)).toEqual([])
    expect(cloudSummary(be.state)).toEqual(cloudSummary(cloud))
    expect(app.ref.ctx.cloudStatus.state).toBe('synced')
    expect(app.ref.ctx.waitlist.map(w => w.name)).toEqual(['陳先生']) // 首拉沒有把它洗掉
  })
})

describe('① 閘門未開：設定頁手動上傳／立即同步不發請求、給看得懂的提示、不動同步狀態', () => {
  it('店長＋首拉失敗：手動上傳被拒並提示；立即同步回 ok:false；回線首拉後手動上傳改用 partial 推送', async () => {
    const cloud = customCloud({ extraTable: true })
    const be = createFakeBackend('manager', cloud)
    be.state.pullFails = true
    const app = await bootAs(be, 'manager')
    expect(app.ref.ctx.cloudStatus.state).toBe('offline')

    let err = null
    await act(async () => { await app.ref.ctx.migrateLocalToCloud().catch(e => { err = e }) })
    expect(err?.message).toBe('尚未從雲端取得資料，請稍候再試')

    let flush = null
    await act(async () => { flush = await app.ref.ctx.flushCloudNow() })
    expect(flush).toMatchObject({ ok: false, deferred: true, error: '尚未從雲端取得資料，請稍候再試' })

    expect(be.log.pushes).toEqual([])
    expect(app.ref.ctx.cloudStatus.state).toBe('offline')

    // 首拉成功之後，手動上傳照常可用，且改用 partial（整包本機＝剛拉下來的雲端資料，不含出廠值）
    be.state.pullFails = false
    await act(async () => { window.dispatchEvent(new Event('online')) })
    await waitUntil(() => app.ref.ctx.cloudStatus.state === 'synced', 'first pull')
    await sleep(300) // 讓首拉後的主動補推（沒有待推 → 不發請求）跑完
    await act(async () => { await app.ref.ctx.migrateLocalToCloud() })

    expect(leaks).toEqual([])
    const manual = be.log.pushes.filter(p => sourceOf(p) === '整包 localDataset（partial：設定頁手動上傳）')
    expect(manual).toHaveLength(1)
    expect(manual[0]).toMatchObject({ status: 200, partial: true })
    expect(cloudSummary(be.state)).toEqual(cloudSummary(cloud))
    expect(app.ref.ctx.cloudStatus.state).toBe('synced')
  })
})
