import { describe, it, expect, beforeEach, vi } from 'vitest'

// ⚠️ cloudDataService 的同步基準線（lastSynced / initialized / pendingDeletes）是
// **模組層級的單例**，清 localStorage 清不掉它——這正是正式環境「只有重新整理頁面
// 才會重置未推送狀態」的原因。測試必須每條都 resetModules + 動態 import，
// 否則前一條的基準線會污染下一條（曾讓本檔的斷言假性失敗）。
let applyCloudSnapshot, pushChangedData, localDataset, markLocalAsSynced, getSettings, discardRejectedChanges

// === 差異同步基準線的回歸測試 ===
//
// 這支測試守的是一個曾讓正式環境「整台裝置永遠無法同步」的 bug：
// applyCloudSnapshot 採用雲端 settings 後，把 lastSynced.settings 的基準線設成
// 雲端原始 payload 的字串，而不是「存進本機後再讀出來」的字串。
// 兩者 key 順序不同（後端 normalizeStoreSettings vs 前端 DEFAULT 的字面順序），
// JSON.stringify 永遠不相等 → settings 被誤判為永久 dirty →
// 每次 pushChangedData 都夾帶 settings → 非店長角色（無 settings.update）
// 被後端整包 403 → 該裝置的 bookings/tables 一起同步失敗、與雲端永久分歧。
//
// 因此以下測試刻意用「與前端 DEFAULT 不同 key 順序」的雲端 payload 來模擬真實後端。

const originalFetch = global.fetch

// 模擬後端回傳：key 順序刻意與前端 DEFAULT 不同（seatings/closures 提前），
// 並多帶一個前端 DEFAULT 沒有的欄位——與正式環境 normalizeStoreSettings 的行為一致。
function cloudSettingsPayload(overrides = {}) {
  const local = getSettings()
  return {
    openTime: local.openTime,
    floorPlan: local.floorPlan,
    seatings: local.seatings,
    closures: local.closures,
    closeTime: local.closeTime,
    slotInterval: local.slotInterval,
    telegramNotifyOnAdminChange: false,
    ...overrides,
  }
}

beforeEach(async () => {
  localStorage.clear()
  vi.restoreAllMocks()
  global.fetch = originalFetch
  vi.resetModules()
  const cloud = await import('../../src/services/cloudDataService')
  const settings = await import('../../src/services/settingsService')
  ;({ applyCloudSnapshot, pushChangedData, localDataset, markLocalAsSynced, discardRejectedChanges } = cloud)
  ;({ getSettings } = settings)
})

describe('applyCloudSnapshot — settings 基準線', () => {
  it('採用雲端 settings 後，不可把 settings 誤判為 dirty（key 順序不同也一樣）', async () => {
    // 首拉：以雲端為準、seed 基準線
    applyCloudSnapshot({ bookings: [], settings: cloudSettingsPayload() })

    // 後續拉取：settings 未在本機被改過 → 應採用雲端值並正確更新基準線
    applyCloudSnapshot({ bookings: [], settings: cloudSettingsPayload() })
    applyCloudSnapshot({ bookings: [], settings: cloudSettingsPayload() })

    // 沒有任何本機變更 → 推送應該完全沒東西可送（skipped），
    // 而不是因為 settings 誤判 dirty 而夾帶 settings。
    const spy = vi.fn()
    global.fetch = spy
    const result = await pushChangedData()

    expect(result.skipped).toBe(true)
    expect(spy).not.toHaveBeenCalled()
  })

  it('連續多輪拉取後，推送仍不得夾帶 settings（非店長角色會因此整包 403）', async () => {
    applyCloudSnapshot({ bookings: [], settings: cloudSettingsPayload() })
    for (let i = 0; i < 5; i++) {
      applyCloudSnapshot({ bookings: [], settings: cloudSettingsPayload() })
    }

    // 製造一筆「合法的」本機變更（bookings），確認推送會送出、但 payload 不含 settings。
    localStorage.setItem('chicken_bookings_v1', JSON.stringify([
      { id: 'b1', name: '測試', guests: 2, date: '2026-07-26', timeSlot: '16:00' },
    ]))

    let sentBody = null
    global.fetch = vi.fn(async (_url, options) => {
      sentBody = JSON.parse(options.body)
      return { ok: true, json: async () => ({ ok: true }) }
    })

    await pushChangedData()

    expect(sentBody).not.toBeNull()
    expect(sentBody.dataset.bookings).toHaveLength(1)
    // 🔴 關鍵斷言：settings 沒被本機改過，就絕不能出現在 payload 裡。
    expect(sentBody.dataset.settings).toBeUndefined()
  })

  it('settings 真的在本機被改過時，仍必須正常推送出去（不可矯枉過正）', async () => {
    applyCloudSnapshot({ bookings: [], settings: cloudSettingsPayload() })
    applyCloudSnapshot({ bookings: [], settings: cloudSettingsPayload() })

    // 本機真的改了設定
    const changed = { ...getSettings(), openTime: '10:00' }
    localStorage.setItem('chicken_settings_v1', JSON.stringify(changed))

    let sentBody = null
    global.fetch = vi.fn(async (_url, options) => {
      sentBody = JSON.parse(options.body)
      return { ok: true, json: async () => ({ ok: true }) }
    })

    await pushChangedData()

    expect(sentBody?.dataset?.settings).toBeDefined()
    expect(sentBody.dataset.settings.openTime).toBe('10:00')
  })

  // 反向守門：這條擋的是「乾脆不要同步 settings」這種偷懶解法。
  // 雲端（別台裝置或店長）真的改了設定時，本機必須採用，且基準線要跟著前進。
  it('雲端 settings 真的變更時，本機仍要採用，且之後不會被誤判為待推送', async () => {
    applyCloudSnapshot({ bookings: [], settings: cloudSettingsPayload() })
    applyCloudSnapshot({ bookings: [], settings: cloudSettingsPayload() })

    // 別台把營業開始時間改成 09:30
    applyCloudSnapshot({ bookings: [], settings: cloudSettingsPayload({ openTime: '09:30' }) })
    expect(getSettings().openTime).toBe('09:30')

    // 採用之後，這台不該反過來把它當成「本機變更」再推回去
    const spy = vi.fn()
    global.fetch = spy
    const result = await pushChangedData()
    expect(result.skipped).toBe(true)
    expect(spy).not.toHaveBeenCalled()
  })

  it('基準線本身就是本機形式：markLocalAsSynced 後推送應為 skipped', async () => {
    applyCloudSnapshot({ bookings: [], settings: cloudSettingsPayload() })
    markLocalAsSynced()

    const spy = vi.fn()
    global.fetch = spy
    const result = await pushChangedData()

    expect(result.skipped).toBe(true)
    expect(spy).not.toHaveBeenCalled()
  })

  it('localDataset().settings 與 getSettings() 同形式（基準線比對的前提）', () => {
    applyCloudSnapshot({ bookings: [], settings: cloudSettingsPayload() })
    expect(JSON.stringify(localDataset().settings)).toBe(JSON.stringify(getSettings()))
  })
})

// === 部分推送（partial push）===
// 後端改成「能寫的照寫、不能寫的回報」之後，前端最容易寫錯、後果也最嚴重的一步是
// 基準線的推進：被拒的集合若也被標記為已同步，那些本機變更會被當成「已上雲」，
// 下一次拉取就不再保護它們 → 直接被雲端值覆蓋 → 靜默資料遺失。
describe('部分推送：被拒的集合不得推進基準線', () => {
  const BOOKINGS = 'chicken_bookings_v1'
  const AGENCIES = 'chicken_agencies_v1'

  // 回應可帶 rejected，模擬後端把越權集合剔除後的部分成功。
  function mockPush(rejected) {
    const calls = []
    global.fetch = vi.fn(async (_url, options) => {
      calls.push(JSON.parse(options.body))
      return { ok: true, json: async () => (rejected ? { ok: true, rejected, rejectedMessage: '角色「floor」無權：寫入 agencies' } : { ok: true }) }
    })
    return calls
  }

  async function seedSyncedThenDirty() {
    applyCloudSnapshot({ bookings: [], agencies: [], settings: cloudSettingsPayload() })
    applyCloudSnapshot({ bookings: [], agencies: [], settings: cloudSettingsPayload() })
    localStorage.setItem(BOOKINGS, JSON.stringify([{ id: 'b1', name: '王先生', guests: 2 }]))
    localStorage.setItem(AGENCIES, JSON.stringify([{ id: 'a1', name: '好玩旅行社' }]))
  }

  it('推送時會表態 partial:true（否則後端維持整包 403 的舊行為）', async () => {
    await seedSyncedThenDirty()
    const calls = mockPush(null)
    await pushChangedData()
    expect(calls[0].partial).toBe(true)
  })

  it('被拒的集合下次仍會重送；有權的集合則不再重送', async () => {
    await seedSyncedThenDirty()
    const calls = mockPush({ writes: ['agencies'], deletes: [], settings: false })
    await pushChangedData()
    expect(calls[0].dataset.bookings).toHaveLength(1)
    expect(calls[0].dataset.agencies).toHaveLength(1)

    // 第二次推送：bookings 已上雲不該再送，agencies 被拒仍是待推送
    await pushChangedData()
    expect(calls).toHaveLength(2)
    expect(calls[1].dataset.bookings).toBeUndefined()
    expect(calls[1].dataset.agencies).toHaveLength(1)
  })

  it('🔴 被拒集合的本機資料不得被後續拉取靜默覆蓋（這正是資料遺失的分支）', async () => {
    await seedSyncedThenDirty()
    mockPush({ writes: ['agencies'], deletes: [], settings: false })
    await pushChangedData()

    // 雲端沒有這筆旅行社（因為推送被拒）。拉取後本機仍必須保有它。
    applyCloudSnapshot({ bookings: [{ id: 'b1', name: '王先生', guests: 2 }], agencies: [], settings: cloudSettingsPayload() })
    const local = JSON.parse(localStorage.getItem(AGENCIES))
    expect(local).toHaveLength(1)
    expect(local[0].id).toBe('a1')
  })

  it('有權的集合照常被雲端更新（部分成功不影響正常路徑）', async () => {
    await seedSyncedThenDirty()
    mockPush({ writes: ['agencies'], deletes: [], settings: false })
    await pushChangedData()

    // bookings 已成功上雲 → 別台改了名字，拉取後應採用雲端值
    applyCloudSnapshot({ bookings: [{ id: 'b1', name: '王小姐', guests: 2 }], agencies: [], settings: cloudSettingsPayload() })
    const local = JSON.parse(localStorage.getItem(BOOKINGS))
    expect(local[0].name).toBe('王小姐')
  })

  it('settings 被拒時不推進基準線，下次仍會重送', async () => {
    applyCloudSnapshot({ bookings: [], settings: cloudSettingsPayload() })
    applyCloudSnapshot({ bookings: [], settings: cloudSettingsPayload() })
    localStorage.setItem('chicken_settings_v1', JSON.stringify({ ...getSettings(), openTime: '10:00' }))

    const calls = mockPush({ writes: [], deletes: [], settings: true })
    await pushChangedData()
    expect(calls[0].dataset.settings).toBeDefined()
    await pushChangedData()
    expect(calls[1].dataset.settings).toBeDefined()
  })

  it('被拒的刪除不得被視為已完成（否則文件會在本機消失、雲端還在）', async () => {
    applyCloudSnapshot({ groupReservations: [{ id: 'g1' }], settings: cloudSettingsPayload() })
    applyCloudSnapshot({ groupReservations: [{ id: 'g1' }], settings: cloudSettingsPayload() })
    localStorage.setItem('chicken_group_reservations_v1', JSON.stringify([]))

    const calls = mockPush({ writes: [], deletes: ['groupReservations'], settings: false })
    await pushChangedData()
    expect(calls[0].deletedIds ?? calls[0].dataset.deletedIds).toEqual({ groupReservations: ['g1'] })
    await pushChangedData()
    expect(calls[1].dataset.deletedIds).toEqual({ groupReservations: ['g1'] })
  })
})

describe('discardRejectedChanges（使用者主動放棄）', () => {
  const AGENCIES = 'chicken_agencies_v1'

  it('放棄之後，下一次拉取就以雲端為準（本機新增的被丟棄）', async () => {
    applyCloudSnapshot({ agencies: [], settings: cloudSettingsPayload() })
    applyCloudSnapshot({ agencies: [], settings: cloudSettingsPayload() })
    localStorage.setItem(AGENCIES, JSON.stringify([{ id: 'a1', name: '好玩旅行社' }]))

    global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, rejected: { writes: ['agencies'], deletes: [], settings: false }, rejectedMessage: 'x' }) }))
    await pushChangedData()

    // 放棄前：拉取仍保護本機
    applyCloudSnapshot({ agencies: [], settings: cloudSettingsPayload() })
    expect(JSON.parse(localStorage.getItem(AGENCIES))).toHaveLength(1)

    // 放棄後：拉取以雲端為準
    discardRejectedChanges({ writes: ['agencies'] })
    applyCloudSnapshot({ agencies: [], settings: cloudSettingsPayload() })
    expect(JSON.parse(localStorage.getItem(AGENCIES))).toHaveLength(0)
  })

  it('放棄「被拒的刪除」後，文件會從雲端回到本機，且不再重送刪除', async () => {
    applyCloudSnapshot({ groupReservations: [{ id: 'g1' }], settings: cloudSettingsPayload() })
    applyCloudSnapshot({ groupReservations: [{ id: 'g1' }], settings: cloudSettingsPayload() })
    localStorage.setItem('chicken_group_reservations_v1', JSON.stringify([])) // 本機刪掉

    global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, rejected: { writes: [], deletes: ['groupReservations'], settings: false }, rejectedMessage: 'x' }) }))
    await pushChangedData()

    // 放棄前：pendingDeletes 擋著，雲端的文件不會被帶回本機
    applyCloudSnapshot({ groupReservations: [{ id: 'g1' }], settings: cloudSettingsPayload() })
    expect(JSON.parse(localStorage.getItem('chicken_group_reservations_v1'))).toHaveLength(0)

    // 放棄後：下一次拉取把文件從雲端帶回來
    discardRejectedChanges({ deletes: ['groupReservations'] })
    applyCloudSnapshot({ groupReservations: [{ id: 'g1' }], settings: cloudSettingsPayload() })
    expect(JSON.parse(localStorage.getItem('chicken_group_reservations_v1'))).toHaveLength(1)

    // 且不再重送刪除
    const r = await pushChangedData()
    expect(r.skipped).toBe(true)
  })

  it('放棄後不再重送該集合', async () => {
    applyCloudSnapshot({ agencies: [], settings: cloudSettingsPayload() })
    applyCloudSnapshot({ agencies: [], settings: cloudSettingsPayload() })
    localStorage.setItem(AGENCIES, JSON.stringify([{ id: 'a1', name: '好玩旅行社' }]))

    const calls = []
    global.fetch = vi.fn(async (_u, o) => {
      calls.push(JSON.parse(o.body))
      return { ok: true, json: async () => ({ ok: true, rejected: { writes: ['agencies'], deletes: [], settings: false }, rejectedMessage: 'x' }) }
    })
    await pushChangedData()
    expect(calls[0].dataset.agencies).toHaveLength(1)

    discardRejectedChanges({ writes: ['agencies'] })
    const r = await pushChangedData()
    expect(r.skipped).toBe(true)
  })
})
