import { describe, it, expect, beforeEach, vi } from 'vitest'

// ⚠️ cloudDataService 的同步基準線（lastSynced / initialized / pendingDeletes）是
// **模組層級的單例**，清 localStorage 清不掉它——這正是正式環境「只有重新整理頁面
// 才會重置未推送狀態」的原因。測試必須每條都 resetModules + 動態 import，
// 否則前一條的基準線會污染下一條（曾讓本檔的斷言假性失敗）。
let applyCloudSnapshot, pushChangedData, localDataset, markLocalAsSynced, getSettings

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
  ;({ applyCloudSnapshot, pushChangedData, localDataset, markLocalAsSynced } = cloud)
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
