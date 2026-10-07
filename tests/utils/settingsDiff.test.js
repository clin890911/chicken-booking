import { describe, it, expect } from 'vitest'
import { describeSettingsChanges, rebaseSettingsForm, dirtySettingsKeys } from '../../src/utils/settingsDiff'

const base = {
  openTime: '11:00',
  slotInterval: 30,
  autoReleaseEnabled: true,
  autoReleaseAfterMin: 300,
  storeName: '雞王涮涮鍋',
  seatings: [
    { id: 'lunch1', name: '午餐第一批', start: '11:00', end: '12:30' },
    { id: 'lunch2', name: '午餐第二批', start: '12:30', end: '14:30' },
  ],
  closures: { closedDates: [], closedSlots: {}, closedSeatings: {} },
  heroBanners: [{ id: 'a', title: 'A', subtitle: '' }, { id: 'b', title: 'B', subtitle: '' }],
  floorPlan: { zones: [] },
}

describe('describeSettingsChanges', () => {
  it('沒改 → 空陣列', () => {
    expect(describeSettingsChanges(base, { ...base })).toEqual([])
  })

  it('純量欄位：中文標籤＋原值→新值（含單位、開關）', () => {
    const r = describeSettingsChanges(base, { ...base, openTime: '10:30', slotInterval: 15, autoReleaseEnabled: false, autoReleaseAfterMin: 240, storeName: '' })
    const byKey = Object.fromEntries(r.map(x => [x.key, x]))
    expect(byKey.openTime).toMatchObject({ label: '營業開始時間', from: '11:00', to: '10:30' })
    expect(byKey.slotInterval).toMatchObject({ from: '30 分', to: '15 分' })
    expect(byKey.autoReleaseEnabled).toMatchObject({ label: '超時自動釋桌', from: '開啟', to: '關閉' })
    expect(byKey.autoReleaseAfterMin).toMatchObject({ from: '5 小時', to: '4 小時' })
    expect(byKey.storeName).toMatchObject({ to: '（空白）' })
  })

  it('關閉時段：逐日列出新關閉／恢復開放，場次用名稱', () => {
    const saved = { ...base, closures: { closedDates: ['2026-10-10'], closedSlots: { '2026-10-12': ['12:00'] }, closedSeatings: {} } }
    const form = { ...base, closures: { closedDates: [], closedSlots: { '2026-10-12': ['12:00', '11:30'] }, closedSeatings: { '2026-10-12': ['lunch2'] } } }
    const [c] = describeSettingsChanges(saved, form)
    expect(c.label).toBe('休店 / 關閉時段')
    expect(c.details).toEqual([
      '10/10 恢復開放：整天公休',
      '10/12 關閉：午餐第二批（整場次）、11:30',
    ])
  })

  it('場次：新增／修改／刪除', () => {
    const form = { ...base, seatings: [
      { id: 'lunch1', name: '午餐第一批', start: '11:00', end: '13:00' },
      { id: 'x', name: '晚餐', start: '17:00', end: '19:00' },
    ] }
    const [c] = describeSettingsChanges(base, form)
    expect(c.details).toEqual([
      '「午餐第一批」11:00–12:30 → 「午餐第一批」11:00–13:00',
      '新增「晚餐」17:00–19:00',
      '刪除「午餐第二批」',
    ])
  })

  it('首頁廣告：新增／刪除／順序', () => {
    const [c] = describeSettingsChanges(base, { ...base, heroBanners: [{ id: 'b', title: 'B', subtitle: '' }, { id: 'c', title: 'C' }, { id: 'a', title: 'A', subtitle: '' }] })
    expect(c.details).toEqual(['新增 1 張', '調整輪播順序'])
  })

  it('其他物件欄位與未知欄位 → 不會壞', () => {
    const r = describeSettingsChanges(base, { ...base, floorPlan: { zones: [{ id: 'z' }] }, someNewKey: 1 })
    expect(r.find(x => x.key === 'floorPlan').details).toEqual(['內容已變更'])
    expect(r.find(x => x.key === 'someNewKey').label).toBe('someNewKey')
  })
})

describe('rebaseSettingsForm', () => {
  it('沒改任何欄位 → 直接採用新的已存設定', () => {
    const next = { ...base, storeName: '新' }
    expect(rebaseSettingsForm({ ...base }, base, next)).toBe(next)
  })

  it('保留使用者改過的欄位，其餘跟上新值', () => {
    const form = { ...base, openTime: '10:00' }
    const next = { ...base, storeName: '雲端改名', floorPlan: { zones: [{ id: 'z' }] } }
    const out = rebaseSettingsForm(form, base, next)
    expect(out.openTime).toBe('10:00')
    expect(out.storeName).toBe('雲端改名')
    expect(out.floorPlan).toEqual({ zones: [{ id: 'z' }] })
    expect(dirtySettingsKeys(out, next)).toEqual(['openTime'])
  })
})
