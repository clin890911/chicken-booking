import { describe, it, expect, beforeEach, vi } from 'vitest'

// 訂位專員（host，只有 settings.closures）改休店／關閉 → 推送 → 拉回後，settings 不可永久 dirty。
// 背景（sync-baseline-keyorder）：非店長裝置 settings 永久 dirty 曾讓整店推不上雲；
// 部分推送不變量：只有真的寫進雲端的才可推進基準線。
// cloudDataService 的基準線是模組單例 → 每條測試 resetModules + 動態 import。

let applyCloudSnapshot, pushChangedData, getSettings, saveSettings, discardRejectedChanges

const originalFetch = global.fetch

// 模擬後端回傳的雲端 settings：key 順序刻意與前端 DEFAULT 不同、並多帶前端沒有的欄位（同正式環境）。
function cloudForm(s) {
  const { closures, seatings, openTime, floorPlan, ...rest } = s
  return { openTime, floorPlan, seatings, closures, telegramNotifyOnAdminChange: true, ...rest }
}

// 模擬「部署後的 adminPushData」對 host 的行為：只套 settingsChangedKeys ∩ ['closures']，其餘忽略並回報。
function mockHostBackend(cloud) {
  const calls = []
  global.fetch = vi.fn(async (_url, options) => {
    const body = JSON.parse(options.body)
    calls.push(body)
    const out = { ok: true, waitlistUpdates: [] }
    if (body.dataset.settings) {
      const keys = body.settingsChangedKeys
      if (!Array.isArray(keys)) {
        Object.assign(out, { rejected: { writes: [], deletes: [], settings: true }, rejectedMessage: '角色「host」無權：變更設定' })
      } else {
        const applied = keys.filter(k => k === 'closures')
        const ignored = keys.filter(k => k !== 'closures')
        if (applied.length) { cloud.closures = structuredClone(body.dataset.settings.closures); out.settingsApplied = applied }
        if (ignored.length) Object.assign(out, { rejected: { writes: [], deletes: [], settings: true, settingsKeys: ignored }, rejectedMessage: '角色「host」無權：變更設定' })
      }
    }
    return { ok: true, json: async () => out }
  })
  return calls
}

const closeLunch2 = () => {
  const s = getSettings()
  saveSettings({ closures: { ...s.closures, closedSeatings: { '2026-10-10': ['lunch2'] } } })
}

beforeEach(async () => {
  localStorage.clear()
  vi.restoreAllMocks()
  global.fetch = originalFetch
  vi.resetModules()
  const cloud = await import('../../src/services/cloudDataService')
  const settings = await import('../../src/services/settingsService')
  ;({ applyCloudSnapshot, pushChangedData, discardRejectedChanges } = cloud)
  ;({ getSettings, saveSettings } = settings)
})

describe('host 改休店／關閉的同步基準線', () => {
  let cloud
  beforeEach(() => {
    cloud = cloudForm(getSettings())
    applyCloudSnapshot({ bookings: [], settings: structuredClone(cloud) })
    applyCloudSnapshot({ bookings: [], settings: structuredClone(cloud) })
  })

  it('host 沒改任何東西：多輪拉取後推送 skipped、完全不打 API（不推 settings）', async () => {
    for (let i = 0; i < 3; i++) applyCloudSnapshot({ bookings: [], settings: structuredClone(cloud) })
    const calls = mockHostBackend(cloud)
    const r = await pushChangedData()
    expect(r.skipped).toBe(true)
    expect(calls).toHaveLength(0)
  })

  it('host 改關閉 → 推送只表態 closures → 拉回後 settings 不再 dirty、之後不再推 settings', async () => {
    closeLunch2()
    const calls = mockHostBackend(cloud)
    const r = await pushChangedData()
    expect(r.ok).toBe(true)
    expect(calls[0].settingsChangedKeys).toEqual(['closures'])
    expect(calls[0].dataset.settings.closures.closedSeatings).toEqual({ '2026-10-10': ['lunch2'] })

    // 雲端已有新 closures；多輪拉回（雲端形式 key 順序不同）後仍不可被判 dirty
    for (let i = 0; i < 3; i++) applyCloudSnapshot({ bookings: [], settings: structuredClone(cloud) })
    expect(getSettings().closures.closedSeatings).toEqual({ '2026-10-10': ['lunch2'] })
    const again = await pushChangedData()
    expect(again.skipped).toBe(true)
    expect(calls).toHaveLength(1)
  })

  it('推送成功後，別台改了雲端 closures → 本機會採用（沒被誤判 dirty 而拒收雲端）', async () => {
    closeLunch2()
    mockHostBackend(cloud)
    await pushChangedData()
    cloud.closures = { ...cloud.closures, closedSeatings: {}, closedDates: ['2026-10-31'] }
    applyCloudSnapshot({ bookings: [], settings: structuredClone(cloud) })
    expect(getSettings().closures.closedDates).toEqual(['2026-10-31'])
    expect(getSettings().closures.closedSeatings).toEqual({})
  })

  it('同時有不能存的 key（openTime）：只推進 closures 的基準線；下次只重送 openTime、closures 不再算變更', async () => {
    closeLunch2()
    saveSettings({ openTime: '09:30' })
    const calls = mockHostBackend(cloud)
    const r = await pushChangedData()
    expect(calls[0].settingsChangedKeys).toEqual(['closures', 'openTime'])
    expect(r.rejected.settings).toBe(true)

    await pushChangedData()
    expect(calls).toHaveLength(2)
    expect(calls[1].settingsChangedKeys).toEqual(['openTime'])
    expect(cloud.openTime).toBe('11:00') // 後端忽略非關閉 key

    // 店家選擇放棄被拒的變更 → 以雲端為準、不再 dirty
    discardRejectedChanges({ settings: true })
    applyCloudSnapshot({ bookings: [], settings: structuredClone(cloud) })
    expect(getSettings().openTime).toBe('11:00')
    expect(getSettings().closures.closedSeatings).toEqual({ '2026-10-10': ['lunch2'] })
    const after = await pushChangedData()
    expect(after.skipped).toBe(true)
  })

  it('🔴 後端還沒部署（舊後端：整份 settings 被拒、沒有 settingsApplied）→ 不推進基準線，下次仍重送 closures', async () => {
    closeLunch2()
    const calls = []
    global.fetch = vi.fn(async (_url, options) => {
      calls.push(JSON.parse(options.body))
      return { ok: true, json: async () => ({ ok: true, rejected: { writes: [], deletes: [], settings: true }, rejectedMessage: '角色「host」無權：變更設定' }) }
    })
    await pushChangedData()
    await pushChangedData()
    expect(calls).toHaveLength(2)
    expect(calls[1].settingsChangedKeys).toEqual(['closures'])
    // 被拒的本機 closures 不得被下一次拉取靜默覆蓋（仍是 dirty、受保護）
    applyCloudSnapshot({ bookings: [], settings: structuredClone(cloud) })
    expect(getSettings().closures.closedSeatings).toEqual({ '2026-10-10': ['lunch2'] })
  })
})
