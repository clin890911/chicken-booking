// 每週預設關閉場次（closures.weeklySeatings）＋單日開放（closures.openSeatings）。
// 涵蓋：前端 effective 計算、isSlotClosed/isSeatingClosed、前端正規化、後端 isSlotClosedServer /
// normalizeClosuresServer（從 functions/index.js 抽出真原始碼執行），以及前後端正規化輸出完全一致（含 key 順序）。
import { readFileSync } from 'node:fs'
import {
  closureDayOfWeek, effectiveClosedSeatings, weeklyClosedSeatingIds, openSeatingIdsOn, describeWeeklyClosures,
} from '../../src/utils/weeklyClosures'
import { isSlotClosed, isSeatingClosed, calcSlotCapacity } from '../../src/utils/capacity'
import { getSettings, saveSettings } from '../../src/services/settingsService'
import { describeSettingsChanges } from '../../src/utils/settingsDiff'

const SEATINGS = [
  { id: 'lunch1', name: '午餐第一批', start: '11:00', end: '12:30' },
  { id: 'lunch2', name: '午餐第二批', start: '12:30', end: '14:30' },
  { id: 'dinner1', name: '晚餐第一批', start: '17:00', end: '19:00' },
]
const SAT = '2026-10-10'
const SUN = '2026-10-11'
const MON = '2026-10-12'
const NEXT_SAT = '2026-10-17'
const closures = (extra = {}) => ({ closedDates: [], closedSlots: {}, closedSeatings: {}, weeklySeatings: {}, openSeatings: {}, ...extra })
const settings = (c) => ({ openTime: '11:00', closeTime: '19:00', slotInterval: 30, seatings: SEATINGS, closures: c })

// 後端：從 functions/index.js 抽出真函式（與 guestBackendHarness 同法）
const source = readFileSync('functions/index.js', 'utf8')
const fn = (name) => { const start = source.indexOf('function ' + name + '('); if (start < 0) throw Error('Missing ' + name); return source.slice(start, source.indexOf('\n}', start) + 2) }
const server = new Function(['toMinutes', 'seatingForSlotServer', 'closureDayOfWeekServer', 'effectiveClosedSeatingsServer', 'isSlotClosedServer', 'normalizeClosuresServer'].map(fn).join('\n')
  + '\nreturn { closureDayOfWeekServer, effectiveClosedSeatingsServer, isSlotClosedServer, normalizeClosuresServer }')()

describe('closureDayOfWeek（字串算星期，不受時區影響）', () => {
  it('已知日期', () => {
    expect(closureDayOfWeek(SAT)).toBe(6)
    expect(closureDayOfWeek(SUN)).toBe(0)
    expect(closureDayOfWeek(MON)).toBe(1)
    expect(closureDayOfWeek('2026-10-07')).toBe(3)
    expect(closureDayOfWeek('bad')).toBeNull()
    expect(closureDayOfWeek(undefined)).toBeNull()
  })
  it('不依賴本地時區的 getDay／時區位移（模擬 UTC-10 裝置）', () => {
    vi.spyOn(Date.prototype, 'getDay').mockReturnValue(5)
    vi.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(600)
    expect(closureDayOfWeek(SAT)).toBe(6)
    expect(closureDayOfWeek(SUN)).toBe(0)
    expect(server.closureDayOfWeekServer(SAT)).toBe(6)
    expect(server.closureDayOfWeekServer(SUN)).toBe(0)
  })
  it('前後端整年逐日一致', () => {
    for (let i = 0; i < 400; i++) {
      const d = new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10)
      expect(server.closureDayOfWeekServer(d)).toBe(closureDayOfWeek(d))
    }
  })
})

describe('effectiveClosedSeatings', () => {
  const c = closures({ weeklySeatings: { 0: ['lunch2'], 6: ['lunch2'] } })
  it('每週預設：週六日關 lunch2，週一不關', () => {
    expect(effectiveClosedSeatings(c, SAT)).toEqual(['lunch2'])
    expect(effectiveClosedSeatings(c, SUN)).toEqual(['lunch2'])
    expect(effectiveClosedSeatings(c, MON)).toEqual([])
    expect(weeklyClosedSeatingIds(c, SAT)).toEqual(['lunch2'])
  })
  it('單日開放只抵銷該日的每週預設', () => {
    const o = { ...c, openSeatings: { [SAT]: ['lunch2'] } }
    expect(effectiveClosedSeatings(o, SAT)).toEqual([])
    expect(effectiveClosedSeatings(o, NEXT_SAT)).toEqual(['lunch2'])
    expect(openSeatingIdsOn(o, SAT)).toEqual(['lunch2'])
  })
  it('單日開放不抵銷明細 closedSeatings', () => {
    const o = { ...c, closedSeatings: { [SAT]: ['lunch2', 'dinner1'] }, openSeatings: { [SAT]: ['lunch2', 'dinner1'] } }
    expect(effectiveClosedSeatings(o, SAT).sort()).toEqual(['dinner1', 'lunch2'])
  })
  it('明細 ∪ 每週，去重', () => {
    const o = { ...c, closedSeatings: { [SAT]: ['lunch1', 'lunch2'] } }
    expect(effectiveClosedSeatings(o, SAT)).toEqual(['lunch1', 'lunch2'])
  })
  it('舊資料（沒有新欄位）照常運作', () => {
    expect(effectiveClosedSeatings({ closedDates: [], closedSlots: {}, closedSeatings: { [SAT]: ['lunch1'] } }, SAT)).toEqual(['lunch1'])
    expect(effectiveClosedSeatings(undefined, SAT)).toEqual([])
  })
  it('前後端 effective 計算一致', () => {
    const o = { ...c, closedSeatings: { [SAT]: ['dinner1'] }, openSeatings: { [SUN]: ['lunch2'] } }
    for (const d of [SAT, SUN, MON, NEXT_SAT]) expect(server.effectiveClosedSeatingsServer(o, d)).toEqual(effectiveClosedSeatings(o, d))
  })
  it('每週規則摘要合併同組星期', () => {
    expect(describeWeeklyClosures(closures({ weeklySeatings: { 0: ['lunch2'], 6: ['lunch2'], 1: ['dinner1'] } }), SEATINGS))
      .toEqual(['每週一：晚餐第一批', '每週六、日：午餐第二批'])
    expect(describeWeeklyClosures(closures(), SEATINGS)).toEqual([])
  })
})

describe('isSlotClosed / isSeatingClosed 吃每週預設（前後端同結果）', () => {
  const s = settings(closures({ weeklySeatings: { 6: ['lunch2'] }, openSeatings: { [NEXT_SAT]: ['lunch2'] } }))
  it('週六 13:00（lunch2）關、11:00（lunch1）開；週一不關；被單日開放的週六不關', () => {
    expect(isSlotClosed(s, SAT, '13:00')).toBe(true)
    expect(isSlotClosed(s, SAT, '11:00')).toBe(false)
    expect(isSlotClosed(s, MON, '13:00')).toBe(false)
    expect(isSlotClosed(s, NEXT_SAT, '13:00')).toBe(false)
    expect(isSeatingClosed(s, SAT, SEATINGS[1])).toBe(true)
    expect(isSeatingClosed(s, NEXT_SAT, SEATINGS[1])).toBe(false)
  })
  it('後端 isSlotClosedServer 同結果', () => {
    for (const [d, t] of [[SAT, '13:00'], [SAT, '11:00'], [MON, '13:00'], [NEXT_SAT, '13:00'], [SAT, '17:30']]) {
      expect(server.isSlotClosedServer(s, d, t)).toBe(isSlotClosed(s, d, t))
    }
  })
  it('只擋線上：員工模式 ignoreOnlineClosure 不受每週預設影響', () => {
    const tables = [{ id: 'T1', number: '101', capacity: 6, isActive: true }]
    expect(calcSlotCapacity(tables, [], SAT, '13:00', s)).toBe(0)
    expect(calcSlotCapacity(tables, [], SAT, '13:00', s, [], { ignoreOnlineClosure: true })).toBe(6)
  })
  it('公休 closedDates 行為不變', () => {
    const d = settings(closures({ closedDates: [MON], weeklySeatings: { 6: ['lunch2'] } }))
    expect(isSlotClosed(d, MON, '11:00')).toBe(true)
    expect(server.isSlotClosedServer(d, MON, '11:00')).toBe(true)
  })
})

describe('正規化：前端 normalizeClosures 與後端 normalizeClosuresServer', () => {
  const messy = {
    closedDates: ['2026-10-20'],
    closedSlots: {},
    closedSeatings: { [SAT]: ['dinner1'] },
    weeklySeatings: { 6: ['lunch2', 'lunch2', '', null], 0: ['lunch2'], 7: ['x'], foo: ['y'], 3: [], 2: 'notArray' },
    openSeatings: { [NEXT_SAT]: ['lunch2'], [SAT]: ['dinner1', { bad: 1 }], 'bad-key': ['lunch2'], [MON]: [] },
  }
  const expected = {
    closedDates: ['2026-10-20'],
    closedSlots: {},
    closedSeatings: { [SAT]: ['dinner1'] },
    weeklySeatings: { 0: ['lunch2'], 6: ['lunch2'] },
    openSeatings: { [SAT]: ['dinner1'], [NEXT_SAT]: ['lunch2'] },
  }
  beforeEach(() => localStorage.clear())

  it('前端保留合法新欄位、清掉非法 key／空陣列／重複', () => {
    saveSettings({ ...getSettings(), closures: messy })
    expect(getSettings().closures).toEqual(expected)
  })
  it('後端同樣輸出', () => {
    expect(server.normalizeClosuresServer(messy)).toEqual(expected)
  })
  it('前後端輸出序列化完全相同（含 key 順序：openSeatings 依日期升冪）', () => {
    saveSettings({ ...getSettings(), closures: messy })
    const front = JSON.stringify(getSettings().closures)
    expect(JSON.stringify(server.normalizeClosuresServer(messy))).toBe(front)
    expect(Object.keys(getSettings().closures)).toEqual(['closedDates', 'closedSlots', 'closedSeatings', 'weeklySeatings', 'openSeatings'])
    expect(Object.keys(getSettings().closures.openSeatings)).toEqual([SAT, NEXT_SAT])
  })
  it('後端輸出再丟回前端正規化是冪等的（基準線不會永久 dirty）', () => {
    const cloud = server.normalizeClosuresServer(messy)
    saveSettings({ ...getSettings(), closures: cloud })
    expect(JSON.stringify(getSettings().closures)).toBe(JSON.stringify(cloud))
    expect(JSON.stringify(server.normalizeClosuresServer(getSettings().closures))).toBe(JSON.stringify(cloud))
  })
  it('舊資料沒有新欄位／新欄位為空 → 前後端都不輸出這兩個 key（與舊版形狀逐字相同）', () => {
    const old = { closedDates: [], closedSlots: {}, closedSeatings: {} }
    saveSettings({ ...getSettings(), closures: old })
    expect(JSON.stringify(getSettings().closures)).toBe(JSON.stringify(old))
    expect(JSON.stringify(server.normalizeClosuresServer(old))).toBe(JSON.stringify(old))
    const empties = { ...old, weeklySeatings: { 6: [] }, openSeatings: { [SAT]: [] } }
    expect(JSON.stringify(server.normalizeClosuresServer(empties))).toBe(JSON.stringify(old))
    saveSettings({ ...getSettings(), closures: empties })
    expect(JSON.stringify(getSettings().closures)).toBe(JSON.stringify(old))
    expect(server.normalizeClosuresServer(undefined)).toEqual(old)
  })
  it('場次 id 前後端都去重＋排序（含既有 closedSeatings）', () => {
    const c = { closedDates: [], closedSlots: {}, closedSeatings: { [SAT]: ['lunch2', 'lunch1', 'lunch2'] }, weeklySeatings: { 6: ['lunch2', 'dinner1'] }, openSeatings: { [SAT]: ['lunch2', 'dinner1'] } }
    const want = { closedDates: [], closedSlots: {}, closedSeatings: { [SAT]: ['lunch1', 'lunch2'] }, weeklySeatings: { 6: ['dinner1', 'lunch2'] }, openSeatings: { [SAT]: ['dinner1', 'lunch2'] } }
    saveSettings({ ...getSettings(), closures: c })
    expect(JSON.stringify(getSettings().closures)).toBe(JSON.stringify(want))
    expect(JSON.stringify(server.normalizeClosuresServer(c))).toBe(JSON.stringify(want))
  })
})

describe('設定變更明細（儲存前確認）', () => {
  it('列出每週預設與單日開放的變更', () => {
    const base = { seatings: SEATINGS, closures: closures() }
    const form = { seatings: SEATINGS, closures: closures({ weeklySeatings: { 6: ['lunch2'] }, openSeatings: { [SAT]: ['lunch2'] } }) }
    const [c] = describeSettingsChanges(base, form)
    expect(c.details).toEqual(['每週六預設關閉：午餐第二批', '10/10 本日特別開放：午餐第二批'])
    const [r] = describeSettingsChanges(form, base)
    expect(r.details).toEqual(['每週六取消預設關閉：午餐第二批', '10/10 恢復每週預設關閉：午餐第二批'])
  })
})
