// 休店／關閉三方合併的 adminPushData 情境（記憶體 fake 與本機 Firestore emulator 共用同一組情境）。
// ctx：{ call(role, body), seed(settingsDoc), read() → settings/main 原始文件 }
import { expect, it } from 'vitest'
import { normalizeStoreSettings } from './adminPushHarness'

export const CLOUD = {
  openTime: '11:00',
  closeTime: '19:00',
  seatings: [
    { id: 'lunch1', name: '午餐第一批', start: '11:00', end: '13:00' },
    { id: 'lunch2', name: '午餐第二批', start: '13:00', end: '15:00' },
    { id: 'dinner1', name: '晚餐', start: '17:00', end: '19:00' },
  ],
  closures: {
    closedDates: ['2026-10-20'],
    closedSlots: { '2026-10-11': ['12:00'] },
    closedSeatings: { '2026-10-10': ['lunch2'], '2026-10-12': ['lunch1'] },
    weeklySeatings: { 1: ['lunch1'] },
  },
  lineLoginChannelId: '2009996489',
  lineLoginCallbackUrl: 'https://linelogincallback.example',
  publicSiteUrl: 'https://chicken-booking.zeabur.app/',
  storeName: '雞王涮涮鍋',
}

// 裝置基準線＝上次拉到的雲端（正規化後）；兩台裝置都從同一份出發。
const BASE = () => normalizeStoreSettings(CLOUD)
const withClosures = (patch, extra = {}) => {
  const base = BASE()
  return { ...base, ...extra, closures: { ...base.closures, ...patch } }
}
const hostPush = (closures, { base = BASE().closures, legacy = false } = {}) => ({
  partial: true,
  settingsChangedKeys: ['closures'],
  ...(legacy ? {} : { closuresBase: base }),
  dataset: { settings: withClosures(closures) },
})
const managerPush = (closures, extra = {}, { base = BASE().closures, legacy = false } = {}) => ({
  partial: true,
  settingsChangedKeys: [...new Set(['closures', ...Object.keys(extra)])],
  ...(legacy ? {} : { closuresBase: base }),
  dataset: { settings: withClosures(closures, extra) },
})

export function defineClosuresMergeScenarios(getCtx) {
  it('🔴 重現：host 關 10/15（未存）、店長關 10/16 並存、host 再存 → 兩人變更都保留', async () => {
    const { call, read } = getCtx()
    const m = await call('manager', managerPush({ closedSeatings: { ...BASE().closures.closedSeatings, '2026-10-16': ['dinner1'] } }, { openTime: '10:30' }))
    expect(m.code).toBe(200)
    const h = await call('host', hostPush({ closedSeatings: { ...BASE().closures.closedSeatings, '2026-10-15': ['lunch1'] } }))
    expect(h.code).toBe(200)
    expect(h.body.settingsApplied).toEqual(['closures'])
    expect(h.body.closuresMerge.conflicts).toEqual([])
    const saved = await read()
    expect(saved.closures.closedSeatings).toEqual({
      '2026-10-10': ['lunch2'], '2026-10-12': ['lunch1'], '2026-10-15': ['lunch1'], '2026-10-16': ['dinner1'],
    })
    // 回應的 closures＝實際寫進雲端的值（前端據此推進基準線）
    expect(h.body.closuresMerge.closures).toEqual(normalizeStoreSettings(saved).closures)
    // 店長其他欄位照 #162 整欄替換；host 沒碰 LINE
    expect(saved.openTime).toBe('10:30')
    expect(saved.lineLoginChannelId).toBe('2009996489')
  })

  it('反向順序（host 先存、店長後存）→ 店長不會用舊副本蓋掉 host 的日期', async () => {
    const { call, read } = getCtx()
    await call('host', hostPush({ closedDates: ['2026-10-20', '2026-10-25'] }))
    const m = await call('manager', managerPush({ closedSlots: { '2026-10-11': ['12:00'], '2026-10-13': ['18:00'] } }, { closeTime: '20:00' }))
    expect(m.code).toBe(200)
    expect(m.body.closuresMerge.conflicts).toEqual([])
    const saved = await read()
    expect(saved.closures.closedDates).toEqual(['2026-10-20', '2026-10-25'])
    expect(saved.closures.closedSlots).toEqual({ '2026-10-11': ['12:00'], '2026-10-13': ['18:00'] })
    expect(saved.closeTime).toBe('20:00')
  })

  it('🔴 一方恢復開放、另一方沒動該日 → 恢復開放生效（不被舊副本復活）', async () => {
    const { call, read } = getCtx()
    const { '2026-10-10': _reopened, ...rest } = BASE().closures.closedSeatings
    await call('manager', managerPush({ closedSeatings: rest, closedSlots: {}, weeklySeatings: {} }))
    // host 的本機仍是舊副本（10/10、10/11、週一都還關著），只新增 10/22
    await call('host', hostPush({ closedSeatings: { ...BASE().closures.closedSeatings, '2026-10-22': ['lunch2'] } }))
    const saved = await read()
    expect(saved.closures.closedSeatings).toEqual({ '2026-10-12': ['lunch1'], '2026-10-22': ['lunch2'] })
    expect(saved.closures.closedSlots).toEqual({})
    expect(saved.closures.weeklySeatings).toBeUndefined()
  })

  it('同日衝突：兩人都改 10/12 → 存檔者勝，回應標示衝突日期', async () => {
    const { call, read } = getCtx()
    await call('manager', managerPush({ closedSeatings: { ...BASE().closures.closedSeatings, '2026-10-12': ['dinner1'] } }))
    const h = await call('host', hostPush({ closedSeatings: { ...BASE().closures.closedSeatings, '2026-10-12': ['lunch1', 'lunch2'] } }))
    expect(h.body.closuresMerge.conflicts).toEqual([{ field: 'closedSeatings', key: '2026-10-12' }])
    expect((await read()).closures.closedSeatings['2026-10-12']).toEqual(['lunch1', 'lunch2'])
  })

  it('每週預設：兩人改不同星期都保留', async () => {
    const { call, read } = getCtx()
    await call('manager', managerPush({ weeklySeatings: { 1: ['lunch1'], 6: ['dinner1'] } }))
    await call('host', hostPush({ weeklySeatings: { 1: ['lunch1'], 3: ['lunch2'] } }))
    expect((await read()).closures.weeklySeatings).toEqual({ 1: ['lunch1'], 3: ['lunch2'], 6: ['dinner1'] })
  })

  it('店長只改營業時間（closures 沒動）→ 不會用本機舊 closures 蓋掉 host 剛存的日期', async () => {
    const { call, read } = getCtx()
    await call('host', hostPush({ closedDates: ['2026-10-20', '2026-10-27'] }))
    const m = await call('manager', managerPush({}, { openTime: '10:00' }))
    expect(m.code).toBe(200)
    const saved = await read()
    expect(saved.closures.closedDates).toEqual(['2026-10-20', '2026-10-27'])
    expect(saved.openTime).toBe('10:00')
  })

  it('舊前端（不送 closuresBase）：維持 #162 整欄替換——回應沒有 closuresMerge', async () => {
    const { call, read } = getCtx()
    await call('manager', managerPush({ closedDates: ['2026-10-20', '2026-10-30'] }))
    const h = await call('host', hostPush({ closedDates: ['2026-10-20', '2026-10-31'] }, { legacy: true }))
    expect(h.code).toBe(200)
    expect(h.body.settingsApplied).toEqual(['closures'])
    expect(h.body.closuresMerge).toBeUndefined()
    // 舊行為：最後存檔者整個 closures 勝（10/30 被蓋掉）——新前端才享有合併
    expect((await read()).closures.closedDates).toEqual(['2026-10-20', '2026-10-31'])
    const legacyHostOld = await call('host', { partial: true, dataset: { settings: withClosures({ closedDates: [] }) } })
    expect(legacyHostOld.body.rejected?.settings).toBe(true) // host 沒表態 settingsChangedKeys → 照舊拒絕
  })
}
