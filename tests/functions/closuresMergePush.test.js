// adminPushData（真 handler）× 記憶體 Firestore：休店／關閉三方合併的接線。
// 同一組情境另在本機 Firestore emulator 上跑（tests/functions/closuresMerge.emulator.test.js）。
import { beforeEach, describe, expect, it } from 'vitest'
import { buildAdminPush, createFakeDb, normalizeStoreSettings } from '../helpers/adminPushHarness'
import { CLOUD, defineClosuresMergeScenarios } from '../helpers/closuresMergeScenarios'

describe('adminPushData：closures 三方合併（記憶體 Firestore）', () => {
  let fake
  let call
  let reports
  beforeEach(() => {
    fake = createFakeDb({ 'settings/main': CLOUD })
    reports = []
    call = buildAdminPush(fake.db, { reports })
  })
  defineClosuresMergeScenarios(() => ({ call, read: async () => fake.records.get('settings/main') }))

  it('host 合併路徑：settings 以 mergeFields:[closures, updatedAt] 寫入、稽核 closures-only 並記衝突數', async () => {
    const base = normalizeStoreSettings(CLOUD)
    const r = await call('host', {
      partial: true, settingsChangedKeys: ['closures'], closuresBase: base.closures,
      dataset: { settings: { ...base, closures: { ...base.closures, closedDates: ['2026-10-20', '2026-10-29'] } } },
    })
    expect(r.code).toBe(200)
    const sets = fake.setCalls.filter(c => c.path === 'settings/main')
    expect(sets).toHaveLength(1)
    expect(sets[0].options).toEqual({ mergeFields: ['closures', 'updatedAt'] })
    expect(reports).toHaveLength(1)
    expect(reports[0].audit.scope).toBe('closures-only')
    expect(reports[0].audit.written).toBe(true)
    expect(reports[0].audit.closuresMerge).toEqual({ conflicts: 0 })
    expect(reports[0].alert).toBeNull()
  })

  it('host 存的跟雲端合併後沒有差別 → 不寫 settings（但仍回 closuresMerge 讓前端推進基準線）', async () => {
    const base = normalizeStoreSettings(CLOUD)
    const r = await call('host', { partial: true, settingsChangedKeys: ['closures'], closuresBase: base.closures, dataset: { settings: base } })
    expect(r.code).toBe(200)
    expect(fake.setCalls.filter(c => c.path === 'settings/main')).toHaveLength(0)
    expect(r.body.closuresMerge.closures).toEqual(base.closures)
  })

  it('店長合併路徑：整欄替換全部頂層 key（含 LINE 守門），closures 換成合併結果', async () => {
    const base = normalizeStoreSettings(CLOUD)
    // 雲端先被別人加了 10/18
    fake.records.set('settings/main', { ...CLOUD, closures: { ...CLOUD.closures, closedDates: ['2026-10-18', '2026-10-20'] } })
    const r = await call('manager', { partial: true, closuresBase: base.closures, dataset: { settings: { ...base, openTime: '10:00', lineLoginChannelId: '' } } })
    expect(r.code).toBe(200)
    const set = fake.setCalls.find(c => c.path === 'settings/main')
    expect([...set.options.mergeFields].sort()).toEqual(Object.keys(set.data).sort())
    expect(set.data.closures.closedDates).toEqual(['2026-10-18', '2026-10-20'])
    // LINE 守門照舊：空值不洗掉雲端
    expect(fake.records.get('settings/main').lineLoginChannelId).toBe('2009996489')
    expect(fake.records.get('settings/main').openTime).toBe('10:00')
  })

  it('closuresBase 不是物件（陣列／字串）→ 視同舊前端，不走合併', async () => {
    const base = normalizeStoreSettings(CLOUD)
    for (const bad of [[], 'x', null]) {
      const r = await call('host', { partial: true, settingsChangedKeys: ['closures'], closuresBase: bad, dataset: { settings: base } })
      expect(r.body.closuresMerge).toBeUndefined()
    }
  })
})
