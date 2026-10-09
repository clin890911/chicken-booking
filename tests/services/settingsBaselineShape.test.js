import { describe, it, expect, beforeEach, vi } from 'vitest'

// 🔴 PR #156 驗收回饋：settings 形狀演進（新增 weeklySeatings/openSeatings、場次 id 排序）後，
// 舊版落地的 lastSynced.settings 是舊形狀字串。若讀回時不重新正規化，stable(getSettings()) 永遠
// 不等於基準線 → settings 永久 dirty → 非店長裝置每次推送夾帶 settings 被拒（卡 rejected）、
// 且 applyCloudSnapshot 因 dirty 不再套用雲端 settings。
// cloudDataService 的基準線是模組單例 → 每條都 resetModules＋動態 import（模擬整頁重新載入）。

const SETTINGS_KEY = 'chicken_settings_v1'
const SYNC_KEY = 'chicken_sync_state_v1'
const originalFetch = global.fetch
let getSettings

beforeEach(async () => {
  localStorage.clear()
  vi.restoreAllMocks()
  global.fetch = originalFetch
  vi.resetModules()
  ;({ getSettings } = await import('../../src/services/settingsService'))
})

// 模擬「舊版程式」落地的狀態：settings 與基準線都是舊形狀（同一份內容）。
async function bootWithOldShape(oldClosures) {
  const old = { ...getSettings(), closures: oldClosures }
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(old))
  localStorage.setItem(SYNC_KEY, JSON.stringify({
    initialized: true, cloudPulled: true,
    lastSynced: { settings: JSON.stringify(old) },
    pendingDeletes: {},
  }))
  vi.resetModules() // 新版程式上線後整頁重新載入
  const mod = await import('../../src/services/cloudDataService')
  ;({ getSettings } = await import('../../src/services/settingsService'))
  return mod
}

// 製造一筆合法的 bookings 變更後推送；模擬非店長：後端拒絕 settings（若有夾帶）。
async function pushWithBookingChange(mod) {
  localStorage.setItem('chicken_bookings_v1', JSON.stringify([{ id: 'b1', name: '測試', guests: 2, date: '2026-10-10', timeSlot: '11:00' }]))
  let sent = null
  global.fetch = vi.fn(async (_url, options) => {
    sent = JSON.parse(options.body)
    const rejected = sent.dataset.settings ? { rejected: { writes: [], deletes: [], settings: true }, rejectedMessage: '角色「floor」無權：寫入 settings' } : {}
    return { ok: true, json: async () => ({ ok: true, ...rejected }) }
  })
  const result = await mod.pushChangedData()
  return { sent, result }
}

describe('舊版落地的 settings 基準線（形狀演進後）不可永久 dirty', () => {
  it('舊形狀（沒有新欄位）基準線配新版 getSettings：不算 dirty，非店長推送不夾帶 settings', async () => {
    const mod = await bootWithOldShape({ closedDates: [], closedSlots: {}, closedSeatings: {} })
    const { sent } = await pushWithBookingChange(mod)
    expect(sent.dataset.bookings).toHaveLength(1)
    expect(sent.dataset.settings).toBeUndefined()
    // 第二次推送：無變更 → 完全不送（不會每輪都夾帶 settings 卡 rejected）
    global.fetch = vi.fn()
    expect((await mod.pushChangedData()).skipped).toBe(true)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('舊形狀與新版正規化真的不同（closedSeatings 未排序）：讀回時重新正規化 → 仍不 dirty', async () => {
    const mod = await bootWithOldShape({ closedDates: [], closedSlots: {}, closedSeatings: { '2026-10-10': ['lunch2', 'lunch1'] } })
    expect(getSettings().closures.closedSeatings['2026-10-10']).toEqual(['lunch1', 'lunch2'])
    const { sent } = await pushWithBookingChange(mod)
    expect(sent.dataset.settings).toBeUndefined()
  })

  it('重新正規化後，雲端 settings 變更仍會被套用（不因誤判 dirty 而拒收）', async () => {
    const mod = await bootWithOldShape({ closedDates: [], closedSlots: {}, closedSeatings: { '2026-10-10': ['lunch2', 'lunch1'] } })
    const cloud = { ...getSettings(), closures: { closedDates: [], closedSlots: {}, closedSeatings: {}, weeklySeatings: { 6: ['lunch2'] } } }
    mod.applyCloudSnapshot({ settings: cloud })
    expect(getSettings().closures.weeklySeatings).toEqual({ 6: ['lunch2'] })
  })

  it('不可矯枉過正：本機真的改過 settings（相對舊基準線內容）仍要推送', async () => {
    const mod = await bootWithOldShape({ closedDates: [], closedSlots: {}, closedSeatings: {} })
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...getSettings(), openTime: '10:30' }))
    const { sent } = await pushWithBookingChange(mod)
    expect(sent.dataset.settings?.openTime).toBe('10:30')
  })

  it('尚未同步過 settings（基準線 null）維持 null，不可被補成「預設已同步」', async () => {
    localStorage.setItem(SYNC_KEY, JSON.stringify({ initialized: true, cloudPulled: true, lastSynced: { settings: null }, pendingDeletes: {} }))
    vi.resetModules()
    const mod = await import('../../src/services/cloudDataService')
    const { sent } = await pushWithBookingChange(mod)
    expect(sent.dataset.settings).toBeDefined()
  })
})
