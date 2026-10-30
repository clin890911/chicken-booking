// 訂位「今日」篩選（來源多選＋隱藏已離＋只看已到/離）：與舊版單選邏輯等價。
import { describe, it, expect } from 'vitest'
import {
  ALL_SOURCE_KEYS, defaultTodayFilter, isDefaultTodayFilter, toggleSource, selectAllSources, onlySource,
  toggleArrivedFilter, isArrivedFilter, filterTodayBookings, filterTodayGroups, summarizeTodayFilter,
} from '../../src/utils/todayFilter'
import { bookingTableNumbers } from '../../src/utils/bookingTables'

const TODAY = '2026-10-31'
const SOURCES = ['online', 'phone', 'walkin', 'group', 'line', 'guest', undefined]
const STATUSES = ['confirmed', 'reserved', 'arrived', 'completed', 'noshow', 'cancelled']
const BOOKINGS = []
SOURCES.forEach((source, i) => STATUSES.forEach((status, j) => {
  BOOKINGS.push({ id: `B${i}${j}`, name: `客${i}${j}`, phone: `0912${i}${j}`, date: j === 5 && i === 0 ? '2026-10-30' : TODAY, source, status, guests: 2, assignedTableId: j % 2 ? String(100 + i) : null })
}))
const GROUPS = [{ id: 'G1', status: 'confirmed' }, { id: 'G2', status: 'completed' }, { id: 'G3', status: 'planned' }]

// 改動前（TodayView 8a56514）的邏輯原文照搬，當等價基準
function legacyBookings(bookings, today, source, hideCompleted, query = '') {
  let list = bookings.filter(b => b.date === today && b.status !== 'cancelled')
  if (hideCompleted) list = list.filter(b => b.status !== 'completed')
  if (source !== 'all') list = list.filter(b => b.source === source)
  if (query.trim()) {
    const q = query.trim().toLowerCase()
    list = list.filter(b =>
      (b.name || '').toLowerCase().includes(q) || (b.phone || '').includes(q) ||
      bookingTableNumbers(b).some(n => n.toLowerCase().includes(q)) || (b.id || '').toLowerCase().includes(q))
  }
  return list
}
function legacyGroups(groups, source, hideCompleted) {
  if (source !== 'all' && source !== 'group') return []
  let list = groups || []
  if (hideCompleted) list = list.filter(g => g.status !== 'completed')
  return list
}
const ids = (l) => l.map(x => x.id)

describe('今日篩選：與舊版單選等價', () => {
  it('預設（全部來源＋隱藏已離）＝舊版「全部＋隱藏已離」，含 guest／無來源的訂位', () => {
    const f = defaultTodayFilter()
    expect(isDefaultTodayFilter(f)).toBe(true)
    expect(ids(filterTodayBookings(BOOKINGS, TODAY, f))).toEqual(ids(legacyBookings(BOOKINGS, TODAY, 'all', true)))
    expect(ids(filterTodayBookings(BOOKINGS, TODAY, f)).some(id => id.startsWith('B5'))).toBe(true) // guest 來源照列
    expect(ids(filterTodayGroups(GROUPS, f))).toEqual(ids(legacyGroups(GROUPS, 'all', true)))
  })

  for (const src of ALL_SOURCE_KEYS) {
    for (const hide of [true, false]) {
      it(`單選「${src}」${hide ? '＋隱藏已離' : ''} ＝ 多選只勾「${src}」`, () => {
        const f = { sources: onlySource(src), hideCompleted: hide, arrivedOnly: false }
        expect(ids(filterTodayBookings(BOOKINGS, TODAY, f))).toEqual(ids(legacyBookings(BOOKINGS, TODAY, src, hide)))
        expect(ids(filterTodayGroups(GROUPS, f))).toEqual(ids(legacyGroups(GROUPS, src, hide)))
      })
    }
  }

  it('搜尋與篩選疊加，結果同舊版', () => {
    for (const q of ['客1', '0912', '101', 'b3', '  ']) {
      expect(ids(filterTodayBookings(BOOKINGS, TODAY, defaultTodayFilter(), q))).toEqual(ids(legacyBookings(BOOKINGS, TODAY, 'all', true, q)))
    }
  })
})

describe('今日篩選：多選', () => {
  it('多選＝聯集；團體卡只要有勾「團體」就顯示', () => {
    const f = { sources: new Set(['online', 'line']), hideCompleted: true, arrivedOnly: false }
    const got = filterTodayBookings(BOOKINGS, TODAY, f)
    expect(new Set(got.map(b => b.source))).toEqual(new Set(['online', 'line']))
    expect(filterTodayGroups(GROUPS, f)).toEqual([])
    const g = { ...f, sources: new Set(['phone', 'group']) }
    expect(ids(filterTodayGroups(GROUPS, g))).toEqual(['G1', 'G3'])
    expect(ids(filterTodayGroups(GROUPS, { ...g, hideCompleted: false }))).toEqual(['G1', 'G2', 'G3'])
  })

  it('全部取消：最後一個取消不掉（no-op），不會變成空集合', () => {
    let s = selectAllSources()
    for (const k of ['online', 'phone', 'walkin', 'group']) s = toggleSource(s, k)
    expect([...s]).toEqual(['line'])
    const same = toggleSource(s, 'line')
    expect(same).toBe(s)
    expect([...same]).toEqual(['line'])
    expect([...toggleSource(s, 'phone')].sort()).toEqual(['line', 'phone'])
  })

  it('隱藏已離：取消勾選後已離（completed）出現', () => {
    const f = { ...defaultTodayFilter(), hideCompleted: false }
    expect(filterTodayBookings(BOOKINGS, TODAY, f).some(b => b.status === 'completed')).toBe(true)
    expect(filterTodayBookings(BOOKINGS, TODAY, defaultTodayFilter()).some(b => b.status === 'completed')).toBe(false)
  })

  it('只看已到/離：只剩 arrived＋completed、團體卡不列；再點一次回預設', () => {
    const f = toggleArrivedFilter(defaultTodayFilter())
    expect(isArrivedFilter(f)).toBe(true)
    const got = filterTodayBookings(BOOKINGS, TODAY, f)
    expect(new Set(got.map(b => b.status))).toEqual(new Set(['arrived', 'completed']))
    expect(filterTodayGroups(GROUPS, f)).toEqual([])
    expect(isDefaultTodayFilter(toggleArrivedFilter(f))).toBe(true)
  })

  it('重設＝defaultTodayFilter（每次新的 Set，不共用參考）', () => {
    const a = defaultTodayFilter(); const b = defaultTodayFilter()
    expect(a.sources).not.toBe(b.sources)
    expect(isDefaultTodayFilter({ sources: onlySource('phone'), hideCompleted: true, arrivedOnly: false })).toBe(false)
  })
})

describe('篩選鈕摘要', () => {
  it('預設顯示「篩選」、無徽章；有變更只列偏離預設的部分', () => {
    expect(summarizeTodayFilter(defaultTodayFilter())).toMatchObject({ isDefault: true, label: '篩選', count: 0 })
    expect(summarizeTodayFilter({ sources: onlySource('phone'), hideCompleted: true, arrivedOnly: false })).toMatchObject({ label: '電話', count: 1 })
    expect(summarizeTodayFilter({ sources: new Set(['line', 'online']), hideCompleted: true, arrivedOnly: false }).label).toBe('線上、LINE')
    expect(summarizeTodayFilter({ sources: new Set(['line', 'online', 'phone']), hideCompleted: true, arrivedOnly: false }).label).toBe('3 種來源')
    expect(summarizeTodayFilter({ sources: onlySource('phone'), hideCompleted: false, arrivedOnly: false })).toMatchObject({ label: '電話・含已離', count: 2 })
    expect(summarizeTodayFilter(toggleArrivedFilter(defaultTodayFilter()))).toMatchObject({ label: '已到/離', count: 1 })
    expect(summarizeTodayFilter({ sources: onlySource('phone'), hideCompleted: true, arrivedOnly: false }).aria).toBe('篩選：電話；隱藏已離')
  })
})
