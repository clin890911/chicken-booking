import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import { INITIAL_TABLES } from '../../src/data/tables'

// === 推送閘門：這台裝置第一次成功拉取雲端之前，一律不推送（service 層迴歸測試）===
//
// 背景（2026-09-19）：全新裝置（空 localStorage）掛載時 tableService 會種下出廠 INITIAL_TABLES、
// settings 讀到出廠值。首拉成功前基準線是空的，任何推送都會把這些出廠佔位資料當成「本機變更」，
// 以 merge-upsert 蓋掉店家排好的雲端佈局／設定（店長、外場、訂位專員都會中）。
// 修法：cloudDataService 的 cloudPulled 閘門——只有 applyCloudSnapshot 成功套用一次雲端快照才開；
// 以及首拉分支不可吞掉「首拉前在這台建立」的訂位／候位（閘門延後推送後，這是新的遺失路徑）。
// 開機時序（真 BookingProvider）的端到端版本見 tests/integration/freshDeviceCloudPush.test.jsx。
//
// 🔒 防漏網：函式網址指到 .invalid 網域；fetch 換成只認 fake base 的記錄器，其他一律 throw，
//    且整檔不還原真 fetch。模組層級同步狀態是單例 → 每條都 resetModules＋動態 import。

const FAKE_BASE = 'https://fake-functions.invalid'
const SYNC_STATE_KEY = 'chicken_sync_state_v1'
const KEY = {
  tables: 'chicken_tables_v3',
  bookings: 'chicken_bookings_v1',
  waitlist: 'chicken_waitlist_v1',
  groups: 'chicken_group_reservations_v1',
}
const DEFERRED = { ok: true, skipped: true, reason: 'awaiting-first-pull' }
const clone = (v) => JSON.parse(JSON.stringify(v))
const stable = (v) => JSON.stringify(v ?? null)

let calls = []
let leaks = []
let cloud, tableService, bookingService, waitlistService, settingsService

beforeAll(() => {
  vi.stubEnv('VITE_FUNCTION_BASE_URL', FAKE_BASE)
})

beforeEach(async () => {
  localStorage.clear()
  calls = []
  leaks = []
  globalThis.fetch = async (url, options = {}) => {
    const u = String(url)
    if (!u.startsWith(FAKE_BASE + '/')) { leaks.push(u); throw new Error(`unmocked network: ${u}`) }
    calls.push({ name: u.slice(FAKE_BASE.length + 1), body: options.body ? JSON.parse(options.body) : null })
    return { ok: true, status: 200, json: async () => ({ ok: true }) }
  }
  await loadModules()
})

// 模擬「整頁載入／重新整理」：模組層級狀態（initialized / cloudPulled / lastSynced）重新從 localStorage 復原。
async function loadModules() {
  vi.resetModules()
  cloud = await import('../../src/services/cloudDataService')
  tableService = await import('../../src/services/tableService')
  bookingService = await import('../../src/services/bookingService')
  waitlistService = await import('../../src/services/waitlistService')
  settingsService = await import('../../src/services/settingsService')
}

const persisted = () => JSON.parse(localStorage.getItem(SYNC_STATE_KEY) || 'null')
const customTables = () => clone(INITIAL_TABLES).map(t => ({ ...t, x: t.x + 7, y: t.y + 3 }))
function cloudSnapshot(overrides = {}) {
  return {
    ok: true,
    bookings: [], tables: customTables(), waitlist: [], customers: [], agencies: [], guides: [], groupReservations: [],
    settings: { ...settingsService.getSettings(), openTime: '10:30', closures: { closedDates: ['2026-09-30'], closedSlots: {}, closedSeatings: {} } },
    ...overrides,
  }
}
const newBooking = (name) => bookingService.create({ name, phone: '0912000111', guests: 2, date: '2026-09-20', timeSlot: '12:00', source: 'phone' })

describe('① 閘門未開：不發請求、不動基準線與 pendingDeletes', () => {
  it('全新裝置：出廠桌＋首拉前新建的訂位，pushChangedData 一律延後、不發任何請求', async () => {
    tableService.listAll() // BookingContext.refresh() 在新裝置上會種下出廠桌
    newBooking('王先生')

    expect(await cloud.pushChangedData()).toEqual(DEFERRED)
    expect(await cloud.pushChangedData()).toEqual(DEFERRED)

    expect(calls).toEqual([])
    expect(leaks).toEqual([])
    expect(cloud.hasPulledCloud()).toBe(false)
    // 延後時只落地「尚未首拉」標記，基準線與 pendingDeletes 都是空的（沒有被推進、也沒記待刪）
    const st = persisted()
    expect(st).toMatchObject({ initialized: false, cloudPulled: false })
    expect(Object.values(st.lastSynced).filter(v => v && Object.keys(v).length)).toEqual([])
    expect(Object.values(st.pendingDeletes).flat()).toEqual([])
  })

  it('全新裝置：pushCloudData（設定頁「上傳本機資料」走這支）partial 與非 partial 都不發請求', async () => {
    tableService.listAll()
    expect(await cloud.pushCloudData(undefined, { partial: true })).toEqual(DEFERRED)
    expect(await cloud.pushCloudData()).toEqual(DEFERRED)
    expect(await cloud.pushCloudData({ tables: clone(INITIAL_TABLES) })).toEqual(DEFERRED)
    expect(calls).toEqual([])
    expect(leaks).toEqual([])
  })

  it('舊裝置升級（落地狀態有 initialized、沒有 cloudPulled）：本機修改＋刪除都不推，基準線與 pendingDeletes 原封不動', async () => {
    const b1 = { id: 'b1', name: '林先生', guests: 2 }
    const g1 = { id: 'g1', agencyName: '好玩旅行社' }
    const legacyState = {
      initialized: true,
      lastSynced: { bookings: { b1: stable(b1) }, groupReservations: { g1: stable(g1) } },
      pendingDeletes: {},
    }
    localStorage.setItem(SYNC_STATE_KEY, JSON.stringify(legacyState))
    localStorage.setItem(KEY.bookings, JSON.stringify([{ ...b1, guests: 4 }])) // 本機改了人數
    localStorage.setItem(KEY.groups, JSON.stringify([]))                       // 本機刪了團
    await loadModules()

    expect(cloud.hasPulledCloud()).toBe(false)
    expect(await cloud.pushChangedData()).toEqual(DEFERRED)
    expect(calls).toEqual([])

    // discardRejectedChanges({}) 什麼都不放棄、只把記憶體中的同步狀態原樣落地——用來觀察閘門有沒有偷動它。
    cloud.discardRejectedChanges({})
    const st = persisted()
    expect(st.lastSynced.bookings).toEqual({ b1: stable(b1) })
    expect(st.lastSynced.groupReservations).toEqual({ g1: stable(g1) })
    expect(st.pendingDeletes.groupReservations).toEqual([])
    expect(st.cloudPulled).toBe(false)
  })
})

describe('② 只有 applyCloudSnapshot 能開閘', () => {
  it('本機有資料（hasAnyLocalData 推論成已初始化）也不開閘；markLocalAsSynced／discardRejectedChanges 也不開；applyCloudSnapshot 才開', async () => {
    localStorage.setItem(KEY.tables, JSON.stringify(INITIAL_TABLES))
    localStorage.setItem(KEY.bookings, JSON.stringify([{ id: 'b1', name: '林先生' }]))
    await loadModules() // 無落地狀態、本機有資料 → 走 hasAnyLocalData seed

    expect(cloud.hasPulledCloud()).toBe(false)
    cloud.markLocalAsSynced()
    cloud.discardRejectedChanges({ writes: ['bookings'], settings: true })
    expect(cloud.hasPulledCloud()).toBe(false)
    expect(await cloud.pushChangedData()).toEqual(DEFERRED)
    expect(calls).toEqual([])

    cloud.applyCloudSnapshot(cloudSnapshot())
    expect(cloud.hasPulledCloud()).toBe(true)
    expect(persisted().cloudPulled).toBe(true)
  })

  it('舊版落地狀態（有 initialized、無 cloudPulled）→ 開機後閘門關；成功拉取一次後開，重新整理後仍開', async () => {
    localStorage.setItem(SYNC_STATE_KEY, JSON.stringify({ initialized: true, lastSynced: {}, pendingDeletes: {} }))
    localStorage.setItem(KEY.tables, JSON.stringify(customTables()))
    await loadModules()
    expect(cloud.hasPulledCloud()).toBe(false)

    cloud.applyCloudSnapshot(cloudSnapshot()) // 已 initialized → diff-merge 分支也要開閘
    expect(cloud.hasPulledCloud()).toBe(true)

    await loadModules() // 整頁重新整理
    expect(cloud.hasPulledCloud()).toBe(true)
  })

  it('套用雲端快照中途寫入失敗（例如 localStorage 滿）→ 不算成功，閘門維持關閉', async () => {
    tableService.listAll()
    const original = localStorage.setItem.bind(localStorage)
    const spy = vi.spyOn(localStorage, 'setItem').mockImplementation((k, v) => {
      if (k === KEY.bookings) throw new Error('QuotaExceededError（模擬）')
      return original(k, v)
    })
    expect(() => cloud.applyCloudSnapshot(cloudSnapshot({ bookings: [{ id: 'c1', name: '雲端客' }] }))).toThrow()
    spy.mockRestore()

    expect(cloud.hasPulledCloud()).toBe(false)
    expect(await cloud.pushChangedData()).toEqual(DEFERRED)
    expect(calls).toEqual([])
  })
})

describe('③ 首拉前在這台新建的資料：首拉後仍在本機，開閘後被推上雲端', () => {
  it('訂位＋候位：首拉保留、只推這兩筆（不推出廠桌、不推設定）', async () => {
    tableService.listAll()
    const b = newBooking('王先生')
    const w = waitlistService.create({ name: '陳小姐', partySize: 3 })
    expect(await cloud.pushChangedData()).toEqual(DEFERRED)

    const cloudB = { id: 'cloud-b', name: '雲端既有訂位', guests: 2, date: '2026-09-20', timeSlot: '17:00' }
    cloud.applyCloudSnapshot(cloudSnapshot({ bookings: [cloudB] }))

    const localBookings = JSON.parse(localStorage.getItem(KEY.bookings))
    expect(localBookings.map(x => x.id).sort()).toEqual([b.id, 'cloud-b'].sort())
    expect(JSON.parse(localStorage.getItem(KEY.waitlist)).map(x => x.id)).toEqual([w.id])

    await cloud.pushChangedData()
    expect(calls).toHaveLength(1)
    const { dataset, partial } = calls[0].body
    expect(partial).toBe(true)
    // bookingService.create 會順手建立顧客檔（同一支電話）——那也是首拉前在這台新建的，一起推。
    expect(Object.keys(dataset).sort()).toEqual(['bookings', 'customers', 'waitlist'])
    expect(dataset.bookings.map(x => x.id)).toEqual([b.id])
    expect(dataset.waitlist.map(x => x.id)).toEqual([w.id])
    expect(dataset.customers.map(x => x.phone)).toEqual(['0912000111'])

    // 推送成功後基準線前進：不重送
    expect((await cloud.pushChangedData()).skipped).toBe(true)
    expect(calls).toHaveLength(1)
  })

  it('首拉前新建候位後整頁重新整理（仍未首拉）→ 回線首拉後候位仍在，且被推上去', async () => {
    tableService.listAll()
    const w = waitlistService.create({ name: '陳小姐', partySize: 3 })
    expect(await cloud.pushChangedData()).toEqual(DEFERRED) // 延後時落地「尚未首拉」標記

    await loadModules() // 整頁重新整理：本機有資料，但不可被 seed 成「已同步」
    expect(cloud.hasPulledCloud()).toBe(false)

    cloud.applyCloudSnapshot(cloudSnapshot())
    expect(JSON.parse(localStorage.getItem(KEY.waitlist)).map(x => x.id)).toEqual([w.id])
    await cloud.pushChangedData()
    expect(calls).toHaveLength(1)
    expect(Object.keys(calls[0].body.dataset)).toEqual(['waitlist'])
    expect(calls[0].body.dataset.waitlist.map(x => x.id)).toEqual([w.id])
  })

  it('雲端已有同 id 的文件 → 雲端為準、不當成本機新建（不推）', async () => {
    localStorage.setItem(KEY.bookings, JSON.stringify([]))
    tableService.listAll()
    const b = newBooking('王先生')
    const localCustomers = Object.values(JSON.parse(localStorage.getItem('chicken_customers_v1') || '{}'))
    cloud.applyCloudSnapshot(cloudSnapshot({ bookings: [{ ...b, name: '王先生（雲端版）' }], customers: localCustomers }))

    expect(JSON.parse(localStorage.getItem(KEY.bookings))).toEqual([{ ...b, name: '王先生（雲端版）' }])
    expect((await cloud.pushChangedData()).skipped).toBe(true)
    expect(calls).toEqual([])
  })
})

describe('④ 雲端 tables 非空：首拉丟掉本機出廠桌、以雲端為準，不推任何桌', () => {
  it('雲端桌集合與出廠不同（有自加 268、少了 113）→ 本機＝雲端整包，推送 skipped', async () => {
    tableService.listAll()
    const cloudTables = customTables().filter(t => t.number !== '113')
    cloudTables.push({ ...clone(INITIAL_TABLES[0]), number: '268', floor: '2F', x: 900, y: 700 })

    cloud.applyCloudSnapshot(cloudSnapshot({ tables: cloudTables }))

    expect(JSON.parse(localStorage.getItem(KEY.tables))).toEqual(cloudTables)
    expect(settingsService.getSettings().openTime).toBe('10:30') // settings 也以雲端為準
    expect((await cloud.pushChangedData()).skipped).toBe(true)
    expect(calls).toEqual([])
  })
})

describe('⑤ 雲端 tables 為空／沒帶 settings：維持現行行為', () => {
  it('雲端 tables 為空 → 保留本機出廠桌、視為已同步、不推', async () => {
    tableService.listAll()
    cloud.applyCloudSnapshot(cloudSnapshot({ tables: [] }))

    expect(JSON.parse(localStorage.getItem(KEY.tables))).toEqual(INITIAL_TABLES)
    expect(cloud.hasPulledCloud()).toBe(true)
    expect((await cloud.pushChangedData()).skipped).toBe(true)
    expect(calls).toEqual([])
  })

  it('雲端回應沒帶 settings → 本機設定記為已同步、不推', async () => {
    tableService.listAll()
    const snap = cloudSnapshot()
    delete snap.settings
    cloud.applyCloudSnapshot(snap)

    expect((await cloud.pushChangedData()).skipped).toBe(true)
    expect(calls).toEqual([])
  })
})
