import { describe, it, expect, beforeEach, vi } from 'vitest'
import { buildAdminPush, createFakeDb, normalizeStoreSettings } from '../helpers/adminPushHarness'

// 前端同步引擎 × 真 adminPushData handler（記憶體 Firestore）：休店／關閉三方合併的端到端。
// 驗：(1) 推送帶 closuresBase＝基準線 closures；(2) 別台同時存的日期 rebase 進本機；
//     (3) 基準線只用後端回傳的實際寫入結果推進、settings 不永久 dirty；(4) 推送期間的本機新修改不被吃掉。
// cloudDataService 的基準線是模組單例 → 每條測試 resetModules + 動態 import。

let applyCloudSnapshot, pushChangedData, getSettings, saveSettings
const originalFetch = global.fetch

let fake
let call
const cloudSettings = () => normalizeStoreSettings(fake.records.get('settings/main') || {})
const pull = () => applyCloudSnapshot({ bookings: [], settings: cloudSettings() })

// 這台裝置的推送走真 handler；duringRequest 模擬「請求在路上時本機又被改」。
function routeFetch(role, { duringRequest } = {}) {
  const bodies = []
  global.fetch = vi.fn(async (_url, options) => {
    const body = JSON.parse(options.body)
    bodies.push(body)
    const res = await call(role, body)
    duringRequest?.()
    return { ok: res.code < 400, status: res.code, json: async () => res.body }
  })
  return bodies
}

// 另一台裝置（店長）直接打後端：基準線＝同一份初始雲端。
async function otherManagerSaves(mutate, base) {
  const s = structuredClone(base)
  mutate(s.closures)
  const r = await call('manager', { partial: true, closuresBase: base.closures, dataset: { settings: s } })
  expect(r.code).toBe(200)
}

const addSeating = (date, ids) => {
  const s = getSettings()
  saveSettings({ closures: { ...s.closures, closedSeatings: { ...s.closures.closedSeatings, [date]: ids } } })
}

beforeEach(async () => {
  localStorage.clear()
  vi.restoreAllMocks()
  global.fetch = originalFetch
  vi.resetModules()
  const cloud = await import('../../src/services/cloudDataService')
  const settings = await import('../../src/services/settingsService')
  ;({ applyCloudSnapshot, pushChangedData } = cloud)
  ;({ getSettings, saveSettings } = settings)
  fake = createFakeDb({
    'settings/main': {
      openTime: '11:00',
      seatings: [{ id: 'lunch1', name: '午', start: '11:00', end: '13:00' }, { id: 'dinner1', name: '晚', start: '17:00', end: '19:00' }],
      closures: { closedDates: ['2026-10-20'], closedSlots: {}, closedSeatings: { '2026-10-10': ['lunch1'] } },
      lineLoginChannelId: '2009996489',
    },
  })
  call = buildAdminPush(fake.db)
  pull()
  pull()
})

describe('休店／關閉三方合併：前端同步引擎', () => {
  it('🔴 host 關 10/12、店長同時關 10/15 並存 → host 推送後雲端與本機都有兩天，且 settings 不再 dirty', async () => {
    const initial = cloudSettings()
    addSeating('2026-10-12', ['lunch1']) // host 本機（尚未推送）
    await otherManagerSaves(c => { c.closedSeatings['2026-10-15'] = ['dinner1'] }, initial)

    const bodies = routeFetch('host')
    const r = await pushChangedData()
    expect(r.ok).toBe(true)
    expect(bodies[0].settingsChangedKeys).toEqual(['closures'])
    expect(bodies[0].closuresBase).toEqual(initial.closures) // 送的是基準線，不是本機值
    const want = { '2026-10-10': ['lunch1'], '2026-10-12': ['lunch1'], '2026-10-15': ['dinner1'] }
    expect(cloudSettings().closures.closedSeatings).toEqual(want)
    expect(getSettings().closures.closedSeatings).toEqual(want) // 別台的 10/15 已 rebase 進本機

    // 基準線＝後端實際寫入結果 → 不 dirty：再推 skipped、多輪拉取後仍 skipped
    expect((await pushChangedData()).skipped).toBe(true)
    for (let i = 0; i < 3; i++) pull()
    expect((await pushChangedData()).skipped).toBe(true)
    expect(bodies).toHaveLength(1)
  })

  it('🔴 店長已恢復 10/10、host 舊副本沒動 10/10 只加 10/22 → 10/10 不復活', async () => {
    const initial = cloudSettings()
    addSeating('2026-10-22', ['dinner1'])
    await otherManagerSaves(c => { delete c.closedSeatings['2026-10-10'] }, initial)
    routeFetch('host')
    await pushChangedData()
    expect(cloudSettings().closures.closedSeatings).toEqual({ '2026-10-22': ['dinner1'] })
    expect(getSettings().closures.closedSeatings).toEqual({ '2026-10-22': ['dinner1'] })
  })

  it('同日衝突：回應帶 conflicts（存檔者勝），pushChangedData 原樣回傳給 UI 提示', async () => {
    const initial = cloudSettings()
    addSeating('2026-10-10', ['dinner1', 'lunch1'])
    await otherManagerSaves(c => { c.closedSeatings['2026-10-10'] = ['dinner1'] }, initial)
    routeFetch('host')
    const r = await pushChangedData()
    expect(r.closuresMerge.conflicts).toEqual([{ field: 'closedSeatings', key: '2026-10-10' }])
    expect(cloudSettings().closures.closedSeatings['2026-10-10']).toEqual(['dinner1', 'lunch1'])
    expect((await pushChangedData()).skipped).toBe(true)
  })

  it('推送途中本機又改了 closures → 新修改保留且仍為待推送；下一輪推送不會把別台的日期刪掉', async () => {
    const initial = cloudSettings()
    addSeating('2026-10-12', ['lunch1'])
    await otherManagerSaves(c => { c.closedDates.push('2026-10-25') }, initial)
    const bodies = routeFetch('host', { duringRequest: () => addSeating('2026-10-30', ['dinner1']) })
    await pushChangedData()
    // 本機：別台的 10/25 rebase 進來＋推送途中新加的 10/30 保留
    expect(getSettings().closures.closedDates).toEqual(['2026-10-20', '2026-10-25'])
    expect(getSettings().closures.closedSeatings['2026-10-30']).toEqual(['dinner1'])
    // 還有待推送的 10/30；第二輪的 base 已含 10/25 → 雲端 10/25 不會被當成刪除
    await pushChangedData()
    expect(bodies[1].closuresBase.closedDates).toEqual(['2026-10-20', '2026-10-25'])
    expect(cloudSettings().closures.closedDates).toEqual(['2026-10-20', '2026-10-25'])
    expect(cloudSettings().closures.closedSeatings).toEqual({ '2026-10-10': ['lunch1'], '2026-10-12': ['lunch1'], '2026-10-30': ['dinner1'] })
    expect((await pushChangedData()).skipped).toBe(true)
  })

  it('店長裝置只改營業時間 → closures 不覆蓋別台剛存的日期，基準線跟上雲端', async () => {
    const initial = cloudSettings()
    saveSettings({ openTime: '10:00' })
    // 別台 host 先存了 10/18
    const s = structuredClone(initial); s.closures.closedDates.push('2026-10-18')
    await call('host', { partial: true, settingsChangedKeys: ['closures'], closuresBase: initial.closures, dataset: { settings: s } })
    routeFetch('manager')
    const r = await pushChangedData()
    expect(r.ok).toBe(true)
    expect(cloudSettings().openTime).toBe('10:00')
    expect(cloudSettings().closures.closedDates).toEqual(['2026-10-20', '2026-10-18'])
    expect(getSettings().closures.closedDates).toEqual(['2026-10-20', '2026-10-18'])
    expect((await pushChangedData()).skipped).toBe(true)
  })

  it('後端已合併 settings 但主要寫入失敗（500）→ 基準線不推進、仍待推送；重送得到相同結果後才推進且不再 dirty', async () => {
    const initial = cloudSettings()
    addSeating('2026-10-12', ['lunch1'])
    await otherManagerSaves(c => { c.closedSeatings['2026-10-15'] = ['dinner1'] }, initial)
    const bodies = routeFetch('host')
    fake.failures.batch = 1
    await expect(pushChangedData()).rejects.toThrow()
    const cloudAfterFail = structuredClone(cloudSettings().closures)
    expect(cloudAfterFail.closedSeatings['2026-10-12']).toEqual(['lunch1']) // 合併已寫入雲端
    expect(getSettings().closures.closedSeatings['2026-10-15']).toBeUndefined() // 失敗回應不 rebase 本機
    // 基準線沒推進：重送仍帶同一份 closuresBase
    const r = await pushChangedData()
    expect(r.ok).toBe(true)
    expect(bodies[1].closuresBase).toEqual(bodies[0].closuresBase)
    expect(cloudSettings().closures).toEqual(cloudAfterFail) // 冪等
    expect(getSettings().closures.closedSeatings).toEqual({ '2026-10-10': ['lunch1'], '2026-10-12': ['lunch1'], '2026-10-15': ['dinner1'] })
    expect((await pushChangedData()).skipped).toBe(true)
  })

  it('舊後端（回應沒有 closuresMerge）→ 維持舊行為：基準線＝送出值、本機不動', async () => {
    addSeating('2026-10-12', ['lunch1'])
    global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true, waitlistUpdates: [], settingsApplied: ['closures'] }) }))
    const before = getSettings()
    await pushChangedData()
    expect(getSettings()).toEqual(before)
    expect((await pushChangedData()).skipped).toBe(true)
  })
})
