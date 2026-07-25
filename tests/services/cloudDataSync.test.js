import { describe, it, expect, beforeEach, vi } from 'vitest'

// 差異同步的「角色感知」行為（src/services/cloudDataService.js）。
//
// 背景（現場真實事故）：後端 adminPushData 是整包驗、整包擋——dataset 只要含一個
// 該角色無權寫的集合，整次推送就回 403。訂位專員在領位台按「立即帶位」寫了 tables，
// 於是連同一批的訂位變更也一起被退，而且 tables 永遠停在 dirty →
// 之後每一次推送都 403，同步等於永久壞掉，畫面還會拿本機舊桌況蓋掉雲端最新值。
//
// 這裡釘死兩件事：
//   1) 推送前先依角色過濾集合（無權的不送，其他集合照樣上得去）；
//   2) 拉取時無權寫的集合一律以雲端為準（不保留推不上去的本機 dirty）。

const KEY_TABLES = 'chicken_tables_v3'
const KEY_BOOKINGS = 'chicken_bookings_v1'

// 每個測試都拿一份全新模組（lastSynced / initialized 是模組級狀態）。
async function freshModule() {
  vi.resetModules()
  return import('../../src/services/cloudDataService.js')
}

// 只允許 allowed 內的權限；模擬 useAuth().can
const checkerAllowing = (...allowed) => (perm) => allowed.includes(perm)

function mockFetchOk() {
  const calls = []
  globalThis.fetch = vi.fn(async (url, options) => {
    calls.push({ url, body: JSON.parse(options?.body || '{}') })
    return { ok: true, json: async () => ({ ok: true }) }
  })
  return calls
}

const table = (number, status) => ({ number, status, floor: '1F', seats: 6 })
const booking = (id, name) => ({ id, name, date: '2026-07-25', time: '18:00' })

beforeEach(() => {
  localStorage.clear()
})

describe('pushChangedData：依角色過濾集合', () => {
  it('無 table.update 的角色：桌位變更不送，同批訂位變更照樣推得上去', async () => {
    const cloud = await freshModule()
    localStorage.setItem(KEY_TABLES, JSON.stringify([table('102', 'available')]))
    localStorage.setItem(KEY_BOOKINGS, JSON.stringify([booking('b1', '王先生')]))
    cloud.markLocalAsSynced()

    // 本機同時動了桌位（帶位）與訂位
    localStorage.setItem(KEY_TABLES, JSON.stringify([table('102', 'occupied')]))
    localStorage.setItem(KEY_BOOKINGS, JSON.stringify([booking('b1', '王小姐')]))

    cloud.setPermissionChecker(checkerAllowing('booking.update'))
    const calls = mockFetchOk()
    const res = await cloud.pushChangedData()

    expect(calls).toHaveLength(1)
    const { dataset } = calls[0].body
    expect(dataset.tables).toBeUndefined()          // 無權 → 不夾帶，避免整批被 403 退回
    expect(dataset.bookings).toHaveLength(1)        // 有權的集合正常上雲
    expect(dataset.bookings[0].name).toBe('王小姐')
    expect(res.skippedCollections).toContain('tables')
  })

  it('訂位專員（有 table.update、無 settings.update）：桌位送得出去、設定不夾帶', async () => {
    const cloud = await freshModule()
    localStorage.setItem(KEY_TABLES, JSON.stringify([table('102', 'available')]))
    cloud.markLocalAsSynced()
    localStorage.setItem(KEY_TABLES, JSON.stringify([table('102', 'occupied')]))

    cloud.setPermissionChecker(checkerAllowing('table.update', 'booking.update'))
    const calls = mockFetchOk()
    await cloud.pushChangedData()

    const { dataset } = calls[0].body
    expect(dataset.tables).toHaveLength(1)
    expect(dataset.tables[0].status).toBe('occupied')
    expect(dataset.settings).toBeUndefined()
  })

  it('無權的集合「沒有本機變更」時不列入 skipped（不能無故報失敗）', async () => {
    const cloud = await freshModule()
    localStorage.setItem(KEY_TABLES, JSON.stringify([table('102', 'available')]))
    localStorage.setItem(KEY_BOOKINGS, JSON.stringify([booking('b1', '王先生')]))
    cloud.markLocalAsSynced()
    localStorage.setItem(KEY_BOOKINGS, JSON.stringify([booking('b1', '王小姐')])) // 只動訂位

    cloud.setPermissionChecker(checkerAllowing('booking.update'))
    mockFetchOk()
    const res = await cloud.pushChangedData()
    expect(res.skippedCollections).toEqual([])
  })

  it('無權改設定的角色動了設定 → 列入 skipped，供 UI 誠實回報（而非假成功）', async () => {
    const cloud = await freshModule()
    const { saveSettings } = await import('../../src/services/settingsService.js')
    cloud.markLocalAsSynced()
    saveSettings({ storeName: '雞王（改過）' })

    cloud.setPermissionChecker(checkerAllowing('booking.update', 'table.update'))
    const calls = mockFetchOk()
    const res = await cloud.pushChangedData()

    expect(res.skippedCollections).toContain('settings')
    if (calls.length) expect(calls[0].body.dataset.settings).toBeUndefined()
  })

  it('沒注入 checker（測試/舊路徑）維持原行為：所有髒集合照送', async () => {
    const cloud = await freshModule()
    localStorage.setItem(KEY_TABLES, JSON.stringify([table('102', 'available')]))
    cloud.markLocalAsSynced()
    localStorage.setItem(KEY_TABLES, JSON.stringify([table('102', 'occupied')]))

    const calls = mockFetchOk()
    await cloud.pushChangedData()
    expect(calls[0].body.dataset.tables).toHaveLength(1)
  })
})

describe('applyCloudSnapshot：無寫權的集合以雲端為準', () => {
  it('推不上去的本機桌況不再蓋掉雲端最新值（畫面不會卡在自己的舊桌況）', async () => {
    const cloud = await freshModule()
    localStorage.setItem(KEY_TABLES, JSON.stringify([table('102', 'available')]))
    cloud.markLocalAsSynced()
    localStorage.setItem(KEY_TABLES, JSON.stringify([table('102', 'occupied')])) // 本機 dirty、永遠推不上去

    cloud.setPermissionChecker(checkerAllowing('booking.update'))
    cloud.applyCloudSnapshot({ tables: [table('102', 'cleaning')] })

    const local = JSON.parse(localStorage.getItem(KEY_TABLES))
    expect(local).toHaveLength(1)
    expect(local[0].status).toBe('cleaning') // 採雲端值
  })

  it('有寫權時維持原本的合併規則：待推送的本機變更仍保留', async () => {
    const cloud = await freshModule()
    localStorage.setItem(KEY_TABLES, JSON.stringify([table('102', 'available')]))
    cloud.markLocalAsSynced()
    localStorage.setItem(KEY_TABLES, JSON.stringify([table('102', 'occupied')]))

    cloud.setPermissionChecker(checkerAllowing('table.update'))
    cloud.applyCloudSnapshot({ tables: [table('102', 'cleaning')] })

    const local = JSON.parse(localStorage.getItem(KEY_TABLES))
    expect(local[0].status).toBe('occupied') // 本機 dirty 優先，等推送
  })
})
