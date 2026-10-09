// adminPushData（真 handler）× 記憶體 Firestore：休店／關閉三方合併的接線。
// 同一組情境另在本機 Firestore emulator 上跑（tests/functions/closuresMerge.emulator.test.js）。
import { beforeEach, describe, expect, it, vi } from 'vitest'
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

  it.each([
    ['duplicate-waitlist-id', [{ id: 'W1', queueVersion: 1 }, { id: 'W1', queueVersion: 1 }], 400],
    ['invalid-waitlist-id', [{ id: 'a/b', queueVersion: 1 }], 400],
  ])('候位格式錯（%s）→ 在休店合併之前就擋下，settings 不可已寫進雲端', async (error, waitlist, code) => {
    const base = normalizeStoreSettings(CLOUD)
    const r = await call('host', {
      partial: true, settingsChangedKeys: ['closures'], closuresBase: base.closures,
      dataset: { settings: { ...base, closures: { ...base.closures, closedDates: ['2026-10-20', '2026-10-29'] } }, waitlist },
    })
    expect(r.code).toBe(code)
    expect(JSON.stringify(r.body)).toContain(error)
    expect(fake.setCalls.filter(c => c.path === 'settings/main')).toHaveLength(0)
  })

  it('closuresBase 不是物件（陣列／字串）→ 視同舊前端，不走合併', async () => {
    const base = normalizeStoreSettings(CLOUD)
    for (const bad of [[], 'x', null]) {
      const r = await call('host', { partial: true, settingsChangedKeys: ['closures'], closuresBase: bad, dataset: { settings: base } })
      expect(r.body.closuresMerge).toBeUndefined()
    }
  })
})

// 驗收 M1／L2：settings 合併必須在主要寫入「之前」——合併失敗不得留下「資料已寫、通知未發」的半套。
describe('adminPushData：closures 合併與主要寫入／通知的順序', () => {
  let fake
  let call
  let reports
  let notifyChanges
  let notifyTelegram
  const base = normalizeStoreSettings({ ...CLOUD, telegramNotifyOnAdminChange: true })
  const settingsWith = closedSeatings => ({ ...base, closures: { ...base.closures, closedSeatings: { ...base.closures.closedSeatings, ...closedSeatings } } })
  beforeEach(() => {
    fake = createFakeDb({
      'settings/main': { ...CLOUD, telegramNotifyOnAdminChange: true },
      'bookings/OLD': { id: 'OLD', name: '要刪的', status: 'confirmed', date: '2026-10-12' },
    })
    reports = []
    notifyChanges = vi.fn(async () => {})
    notifyTelegram = vi.fn(async () => {})
    call = buildAdminPush(fake.db, { reports, notifyChanges, notifyTelegram })
  })

  it('(1) settings 合併失敗 → 回 500、主要資料（新增／硬刪除）都沒寫、無任何通知；重送成功後通知只發一次且帶刪除前完整舊值', async () => {
    const body = {
      partial: true, closuresBase: base.closures,
      dataset: { settings: settingsWith({ '2026-10-15': ['dinner1'] }), bookings: [{ id: 'NEW', name: '新客', status: 'confirmed', date: '2026-10-15' }], deletedIds: { bookings: ['OLD'] } },
    }
    fake.failures.tx = 1
    const fail = await call('manager', body)
    expect(fail.code).toBe(500)
    expect(fake.records.has('bookings/NEW')).toBe(false)
    expect(fake.records.has('bookings/OLD')).toBe(true)
    expect(fake.records.get('settings/main').closures.closedSeatings['2026-10-15']).toBeUndefined()
    expect(notifyChanges).not.toHaveBeenCalled()
    expect(notifyTelegram).not.toHaveBeenCalled()
    expect(reports).toHaveLength(0)

    const ok = await call('manager', body)
    expect(ok.code).toBe(200)
    expect(fake.records.has('bookings/NEW')).toBe(true)
    expect(fake.records.has('bookings/OLD')).toBe(false)
    expect(fake.records.get('settings/main').closures.closedSeatings['2026-10-15']).toEqual(['dinner1'])
    expect(notifyChanges).toHaveBeenCalledTimes(1)
    expect(notifyTelegram).toHaveBeenCalledTimes(1)
    const [beforeMap, deletedBefore] = notifyTelegram.mock.calls[0]
    expect(beforeMap.has('NEW')).toBe(false) // 重送時 before 仍是「不存在」→ 新訂位通知照常分類
    expect(deletedBefore.get('OLD')).toMatchObject({ id: 'OLD', name: '要刪的' }) // 還原 JSON 還拿得到
    expect(reports).toHaveLength(1)
  })

  it('(2) settings 已合併、主要寫入失敗 → 重送時合併結果相同（冪等），重送不重複提示衝突；通知只發一次', async () => {
    // 店長先把 10/12 改成晚餐，訂位專員（基準線仍是午餐）同日改成午餐＋午二 → 同日衝突
    expect((await call('manager', { partial: true, closuresBase: base.closures, dataset: { settings: settingsWith({ '2026-10-12': ['dinner1'] }) } })).code).toBe(200)
    notifyChanges.mockClear()
    const body = {
      partial: true, settingsChangedKeys: ['closures'], closuresBase: base.closures,
      dataset: { settings: settingsWith({ '2026-10-12': ['lunch1', 'lunch2'], '2026-10-16': ['lunch1'] }), bookings: [{ id: 'H1', name: '電話客', status: 'confirmed', date: '2026-10-16' }] },
    }
    fake.failures.batch = 1
    const fail = await call('host', body)
    expect(fail.code).toBe(500)
    expect(fake.records.has('bookings/H1')).toBe(false)
    const afterFirst = structuredClone(fake.records.get('settings/main').closures)
    expect(afterFirst.closedSeatings['2026-10-12']).toEqual(['lunch1', 'lunch2']) // 合併已寫入
    expect(notifyChanges).not.toHaveBeenCalled()

    const ok = await call('host', body)
    expect(ok.code).toBe(200)
    expect(fake.records.get('settings/main').closures).toEqual(afterFirst) // 冪等：重送結果相同
    expect(ok.body.closuresMerge.closures).toEqual(normalizeStoreSettings({ closures: afterFirst }).closures)
    // 失敗那次沒有回應（前端拿不到 conflicts），重送時雲端已等於本機 → 不再判衝突：提示不會重複出現
    expect(ok.body.closuresMerge.conflicts).toEqual([])
    expect(fake.records.has('bookings/H1')).toBe(true)
    expect(notifyChanges).toHaveBeenCalledTimes(1)
  })

  it('L2：含候位的同一包重送（queueRepeated）→ 主要寫入與通知跳過，但 settings 合併照跑且稽核照報', async () => {
    const body = {
      partial: true, closuresBase: base.closures,
      dataset: { settings: settingsWith({ '2026-10-18': ['lunch2'] }), waitlist: [{ id: 'W1', name: '候位', queueVersion: 1 }] },
    }
    expect((await call('manager', body)).code).toBe(200)
    expect(reports).toHaveLength(1)
    const again = await call('manager', body)
    expect(again.code).toBe(200)
    expect(notifyChanges).toHaveBeenCalledTimes(1) // 重送不重複通知
    expect(reports).toHaveLength(2) // settings 這次也真的寫了 → 稽核／LINE 守門告警不被跳過
    expect(again.body.closuresMerge.closures.closedSeatings['2026-10-18']).toEqual(['lunch2'])
  })
})
