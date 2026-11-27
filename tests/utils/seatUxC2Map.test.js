// 選客入座 C 包「地圖」（2026-11-27，docs/ux-review-seating-20261127 walkthrough #18 #20 #21）純函式：
//   建議桌目前樓層優先（排序偏好、不是硬限制）、樓層籤提示、併桌同組標示、透明擴大命中區。
import { describe, it, expect } from 'vitest'
import { preferFloorFirst, preferFloorCombo, suggestionFloorHint, FLOOR_PREF_WASTE_TOLERANCE } from '../../src/utils/floorPreference'
import { comboGroupsByTable, comboLinks, comboLabel } from '../../src/utils/comboTables'
import { pickTableAt, tableAabb, hitSizePx } from '../../src/utils/tableHitArea'

const T = (number, capacity, floor, over = {}) => ({ number, capacity, floor, x: 0, y: 0, w: 80, h: 75, ...over })

describe('preferFloorFirst：容量合適的前提下，目前樓層優先', () => {
  it('2 位：2F 4 人桌（浪費 2）原本排第一；1F 6 人桌只多浪費 2 席 → 站在 1F 時建議 1F', () => {
    const sorted = [T('207', 4, '2F'), T('101', 6, '1F')]
    expect(preferFloorFirst(sorted, 2, '1F').map(t => t.number)).toEqual(['101', '207'])
  })
  it('站在 2F（建議本來就在 2F）→ 順序不變', () => {
    const sorted = [T('207', 4, '2F'), T('101', 6, '1F')]
    expect(preferFloorFirst(sorted, 2, '2F').map(t => t.number)).toEqual(['207', '101'])
  })
  it('超過容許（多浪費 >2 席）→ 照舊建議別層（不是硬限制）', () => {
    const sorted = [T('207', 4, '2F'), T('110', 10, '1F')]
    expect(FLOOR_PREF_WASTE_TOLERANCE).toBe(2)
    expect(preferFloorFirst(sorted, 2, '1F').map(t => t.number)).toEqual(['207', '110'])
  })
  it('要擠一擠的桌不會因為同樓層插到坐得下的桌前面', () => {
    const sorted = [T('208', 6, '2F'), T('101', 4, '1F')]   // 5 位：208 坐得下、101 要擠
    expect(preferFloorFirst(sorted, 5, '1F').map(t => t.number)).toEqual(['208', '101'])
  })
  it('目前樓層多張合適的桌：維持它們原本的先後（浪費少的先）', () => {
    const sorted = [T('207', 4, '2F'), T('105', 4, '1F'), T('101', 6, '1F')]
    expect(preferFloorFirst(sorted, 3, '1F').map(t => t.number)).toEqual(['105', '101', '207'])
  })
  it('沒給樓層／空陣列 → 原樣（新陣列）', () => {
    const sorted = [T('207', 4, '2F')]
    expect(preferFloorFirst(sorted, 2, null)).toEqual(sorted)
    expect(preferFloorFirst([], 2, '1F')).toEqual([])
  })
})

describe('preferFloorCombo：併桌組合也以目前樓層優先', () => {
  const r = (floor, tableNumbers, effSeats) => ({ floor, tableNumbers, effSeats, enough: true })
  it('同桌數、座位只多 2 → 換成目前樓層', () => {
    expect(preferFloorCombo([r('1F', ['101', '102'], 10), r('2F', ['201', '203'], 12)], '2F').floor).toBe('2F')
  })
  it('目前樓層要多一張桌 → 不換', () => {
    expect(preferFloorCombo([r('1F', ['101', '102'], 10), r('2F', ['201', '203', '205'], 12)], '2F').floor).toBe('1F')
  })
  it('沒有偏好 → 第一名', () => {
    expect(preferFloorCombo([r('1F', ['101', '102'], 10)], null).floor).toBe('1F')
    expect(preferFloorCombo([], '1F')).toBeNull()
  })
})

describe('suggestionFloorHint：建議桌不在目前樓層才提示', () => {
  const tables = [T('105', 4, '1F'), T('201', 6, '2F'), T('203', 6, '2F')]
  it('建議在 2F、看著 1F → 2F', () => expect(suggestionFloorHint(['201', '203'], tables, '1F')).toBe('2F'))
  it('建議在目前樓層 → null', () => expect(suggestionFloorHint(['105'], tables, '1F')).toBeNull())
  it('沒有建議 → null', () => {
    expect(suggestionFloorHint([], tables, '1F')).toBeNull()
    expect(suggestionFloorHint([null], tables, '1F')).toBeNull()
  })
})

describe('comboGroupsByTable：併桌同組標示的口徑', () => {
  const bk = (id, name, assignedTableId, extraTableIds = [], status = 'arrived') => ({ id, name, assignedTableId, extraTableIds, status })
  const tb = (number, over = {}) => ({ number, floor: '1F', status: 'vacant', currentBookingId: null, currentRef: null, x: 0, y: 0, w: 80, h: 75, ...over })
  it('主桌＋副桌都由這筆持有（dining）→ 兩張都標同一組「王・併」', () => {
    const g = comboGroupsByTable([tb('107', { status: 'dining', currentBookingId: 'B1' }), tb('110', { status: 'dining', currentBookingId: 'B1' })],
      [bk('B1', '王先生', '107', ['110'])])
    expect(g['107']).toMatchObject({ bookingId: 'B1', label: '王・併', tableNumbers: ['107', '110'], others: ['110'] })
    expect(g['110']).toMatchObject({ bookingId: 'B1', label: '王・併', others: ['107'] })
  })
  it('單桌不標；團體桌（currentRef）不標；預配（桌仍空）不標', () => {
    const tables = [
      tb('105', { status: 'dining', currentBookingId: 'B2' }),
      tb('201', { status: 'dining', currentRef: { type: 'group', groupId: 'G', batchId: 'b' } }),
      tb('203', { status: 'dining', currentRef: { type: 'group', groupId: 'G', batchId: 'b' } }),
      tb('101'), tb('102'),
    ]
    const g = comboGroupsByTable(tables, [bk('B2', '林小姐', '105'), bk('B3', '陳先生', '101', ['102'], 'confirmed')])
    expect(g).toEqual({})
  })
  it('副桌已被釋出／換給別組 → 只剩一張由這筆持有，不標', () => {
    const g = comboGroupsByTable([tb('107', { status: 'dining', currentBookingId: 'B1' }), tb('110', { status: 'dining', currentBookingId: 'B9' })],
      [bk('B1', '王先生', '107', ['110']), bk('B9', '李先生', '110')])
    expect(g).toEqual({})
  })
  it('鎖桌（reserved）的併桌也標；通稱「現場散客」只標「併」', () => {
    const g = comboGroupsByTable([tb('101', { status: 'reserved', currentBookingId: 'B4' }), tb('102', { status: 'reserved', currentBookingId: 'B4' })],
      [bk('B4', '現場散客', '101', ['102'], 'confirmed')])
    expect(g['101'].label).toBe('併')
    expect(comboLabel('')).toBe('併')
    expect(comboLabel('Kevin')).toBe('K・併')
  })
  it('comboLinks：線會穿過別組／空桌就不畫（101＋103 中間隔著 102）', () => {
    const tables = [tb('101', { x: 0, y: 0 }), tb('102', { x: 0, y: 150 }), tb('103', { x: 0, y: 300 }), tb('105', { x: 200, y: 0 })]
    const combo = { 101: { bookingId: 'B1' }, 103: { bookingId: 'B1' }, 105: { bookingId: 'B2' } }
    expect(comboLinks(tables, combo)).toEqual([])
    const combo2 = { 101: { bookingId: 'B1' }, 105: { bookingId: 'B1' } }
    expect(comboLinks(tables, combo2).map(l => `${l.from}-${l.to}`)).toEqual(['101-105'])
  })
  it('comboLinks：同組同樓層的桌串成最短的樹（3 桌 → 2 條線）', () => {
    const tables = [tb('101', { x: 0, y: 0 }), tb('103', { x: 0, y: 300 }), tb('102', { x: 0, y: 150 })]
    const combo = Object.fromEntries(['101', '102', '103'].map(n => [n, { bookingId: 'B1' }]))
    const links = comboLinks(tables, combo)
    expect(links.map(l => `${l.from}-${l.to}`)).toEqual(['101-102', '102-103'])
  })
})

describe('pickTableAt：透明擴大命中區（視覺不變，命中區補到 44px）', () => {
  const a = T('A', 4, '1F', { x: 0, y: 0 })            // 80×75
  const b = T('B', 4, '1F', { x: 0, y: 90 })           // 與 A 上下隔 15 unit
  it('畫得夠大（≥44px）的桌不外擴：落在桌外就是沒點到', () => {
    expect(pickTableAt({ x: 40, y: -2 }, [a], 0.66)).toBeNull()       // 75×0.66＝49.5px
  })
  it('畫得太小（0.42 → 31.5px）：桌外 6px（≈14 unit）內仍算點到', () => {
    expect(pickTableAt({ x: 40, y: -14 }, [a], 0.42)).toBe('A')
    expect(pickTableAt({ x: 40, y: -18 }, [a], 0.42)).toBeNull()      // 超過 44px 的範圍
    expect(hitSizePx(a, 0.42)).toEqual({ w: 44, h: 44 })
  })
  it('夾在兩桌正中間 → 不猜（null）；偏向一邊 → 判給近的那張', () => {
    // 0.45：兩桌間 15 unit＝6.75px；距離差 <4px 算「夾在中間」
    expect(pickTableAt({ x: 40, y: 82.5 }, [a, b], 0.45)).toBeNull()
    expect(pickTableAt({ x: 40, y: 77 }, [a, b], 0.45)).toBe('A')
    expect(pickTableAt({ x: 40, y: 88 }, [a, b], 0.45)).toBe('B')
    // 0.3：整個間隙才 4.5px，任何落點都分不清 → 一律不猜
    expect(pickTableAt({ x: 40, y: 78 }, [a, b], 0.3)).toBeNull()
  })
  it('一側與鄰桌接邊（同一島）→ 命中區全部補到另一側', () => {
    const l = T('L', 4, '1F', { x: 0, y: 0 }), r = T('R', 4, '1F', { x: 80, y: 0 })   // 左右相接
    // 0.42：需要 104.8 unit，寬 80 → 不足 24.8，全部補到外側
    expect(pickTableAt({ x: -24, y: 30 }, [l, r], 0.42)).toBe('L')
    expect(pickTableAt({ x: 160 + 24, y: 30 }, [l, r], 0.42)).toBe('R')
    expect(pickTableAt({ x: -26, y: 30 }, [l, r], 0.42)).toBeNull()
  })
  it('旋轉 90° 的桌用旋轉後的外接矩形', () => {
    const r = tableAabb(T('R', 4, '1F', { x: 0, y: 0, rotation: 90 }))
    expect(Math.round(r.maxX - r.minX)).toBe(75)
    expect(Math.round(r.maxY - r.minY)).toBe(80)
  })
})
