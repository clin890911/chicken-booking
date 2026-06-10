import { describe, it, expect } from 'vitest'
import {
  filterBookings, filterGroups, groupBatchRows,
  buildBookingsCSV, buildGroupsCSV, toCSV,
} from '../../src/utils/exportData'

// 匯出中心純邏輯。釘住三件事：
// 1) 過濾口徑：日期字串比較、來源/狀態、場次推導、團體 id 關聯（永不依 Name）
// 2) CSV 跳脫與 BOM 與既有 bookingService.exportCSV 同規則
// 3) 團體一梯次一列展平

const SETTINGS = {
  seatings: [
    { id: 'lunch1', name: '午餐第一批', start: '11:00', end: '12:30' },
    { id: 'dinner1', name: '晚餐第一批', start: '17:00', end: '19:00' },
  ],
}

const B = (over = {}) => ({
  id: 'B1', name: '王小明', phone: '0912345678', guests: 4,
  date: '2026-06-15', timeSlot: '11:30', source: 'online', status: 'confirmed',
  assignedTableId: '101', notes: { pet: false, child: true, mobility: false, text: '' },
  createdAt: '2026-06-01T10:00:00.000Z',
  ...over,
})

describe('filterBookings', () => {
  const list = [
    B({ id: 'B1', date: '2026-06-10', timeSlot: '11:00', source: 'online', status: 'confirmed' }),
    B({ id: 'B2', date: '2026-06-15', timeSlot: '17:30', source: 'walkin', status: 'completed' }),
    B({ id: 'B3', date: '2026-06-20', timeSlot: '12:00', source: 'phone', status: 'cancelled' }),
  ]
  it('日期區間（含端點）', () => {
    const out = filterBookings(list, { dateFrom: '2026-06-10', dateTo: '2026-06-15' })
    expect(out.map(b => b.id)).toEqual(['B1', 'B2'])
  })
  it('單邊區間：只給 dateTo', () => {
    expect(filterBookings(list, { dateTo: '2026-06-14' }).map(b => b.id)).toEqual(['B1'])
  })
  it('來源 / 狀態過濾；all = 不限', () => {
    expect(filterBookings(list, { source: 'walkin' }).map(b => b.id)).toEqual(['B2'])
    expect(filterBookings(list, { status: 'cancelled' }).map(b => b.id)).toEqual(['B3'])
    expect(filterBookings(list, { source: 'all', status: 'all' })).toHaveLength(3)
  })
  it('場次過濾：時段經 settings.seatings 推導（半開區間）', () => {
    const out = filterBookings(list, { seatingId: 'lunch1', settings: SETTINGS })
    expect(out.map(b => b.id)).toEqual(['B1', 'B3'])
    expect(filterBookings(list, { seatingId: 'dinner1', settings: SETTINGS }).map(b => b.id)).toEqual(['B2'])
  })
  it('輸出依 日期+時段 排序', () => {
    const out = filterBookings([list[2], list[0], list[1]], {})
    expect(out.map(b => b.id)).toEqual(['B1', 'B2', 'B3'])
  })
})

const G = (over = {}) => ({
  id: 'G1', date: '2026-06-15', agencyId: 'AG1', guideId: 'GD1',
  agencyName: '快樂旅行社', guideName: '陳導', guidePhone: '0922000111',
  batches: [
    { id: 'BT1', label: '第一梯', timeSlot: '11:30', tableNumbers: ['201', '202'], guests: 30, note: '' },
    { id: 'BT2', label: '第二梯', timeSlot: '17:30', tableNumbers: ['203'], guests: 12, note: '' },
  ],
  counts: { total: 42, vegetarian: 3, child: 5, mobility: 1, wheelchair: 0 },
  allergyText: '2 位海鮮過敏', tableSideNeeds: '', busInfo: '2 台', notes: '', status: 'confirmed',
  ...over,
})

describe('filterGroups', () => {
  const list = [
    G({ id: 'G1', date: '2026-06-10', agencyId: 'AG1', guideId: 'GD1' }),
    G({ id: 'G2', date: '2026-06-15', agencyId: 'AG2', guideId: 'GD2', status: 'planned' }),
  ]
  it('旅行社 / 導遊用 id 過濾（不依 Name 快照）', () => {
    expect(filterGroups(list, { agencyId: 'AG2' }).map(g => g.id)).toEqual(['G2'])
    expect(filterGroups(list, { guideId: 'GD1' }).map(g => g.id)).toEqual(['G1'])
    // Name 一樣但 id 不同 → 不會誤中
    const sameName = [G({ id: 'G3', agencyId: 'AG9', agencyName: '快樂旅行社' })]
    expect(filterGroups(sameName, { agencyId: 'AG1' })).toHaveLength(0)
  })
  it('狀態與日期過濾', () => {
    expect(filterGroups(list, { status: 'planned' }).map(g => g.id)).toEqual(['G2'])
    expect(filterGroups(list, { dateFrom: '2026-06-11' }).map(g => g.id)).toEqual(['G2'])
  })
  it('場次過濾：任一梯次屬於該場次即命中', () => {
    const out = filterGroups(list, { seatingId: 'dinner1', settings: SETTINGS })
    expect(out.map(g => g.id)).toEqual(['G1', 'G2'])
    const lunchOnly = [G({ id: 'G4', batches: [{ id: 'x', timeSlot: '11:00', tableNumbers: [], guests: 10 }] })]
    expect(filterGroups(lunchOnly, { seatingId: 'dinner1', settings: SETTINGS })).toHaveLength(0)
  })
})

describe('groupBatchRows / buildGroupsCSV', () => {
  it('一梯次一列，依 日期+時段 排序', () => {
    const rows = groupBatchRows([G()], SETTINGS)
    expect(rows).toHaveLength(2)
    expect(rows[0].batch.label).toBe('第一梯')
    expect(rows[0].seatingId).toBe('lunch1')
    expect(rows[1].seatingId).toBe('dinner1')
  })
  it('無梯次的團單仍輸出一列（團級資料不消失）', () => {
    expect(groupBatchRows([G({ batches: [] })], SETTINGS)).toHaveLength(1)
  })
  it('CSV 內容：桌號以空白相連、場次取名稱、狀態轉中文', () => {
    const csv = buildGroupsCSV([G()], SETTINGS)
    const lines = csv.split('\n')
    expect(lines[0]).toContain('團單編號')
    expect(lines[1]).toContain('201 202')
    expect(lines[1]).toContain('午餐第一批')
    expect(lines[1]).toContain('已確認')
    expect(lines[1]).toContain('快樂旅行社')
    expect(lines[1]).toContain('陳導')
  })
})

describe('buildBookingsCSV / toCSV', () => {
  it('BOM 開頭 + 標題列 + 中文來源/狀態 + 場次', () => {
    const csv = buildBookingsCSV([B()], SETTINGS)
    expect(csv.charCodeAt(0)).toBe(0xFEFF)
    const lines = csv.split('\n')
    expect(lines[0]).toContain('訂位編號')
    expect(lines[1]).toContain('線上')
    expect(lines[1]).toContain('已確認')
    expect(lines[1]).toContain('午餐第一批')
  })
  it('跳脫規則與既有 exportCSV 一致：逗號/引號/換行包雙引號、引號加倍', () => {
    const csv = toCSV(['a'], [['x,y'], ['he said "hi"'], ['line1\nline2']])
    const body = csv.slice(1) // 去 BOM
    expect(body).toContain('"x,y"')
    expect(body).toContain('"he said ""hi"""')
    expect(body).toContain('"line1\nline2"')
  })
  it('未知來源/狀態原樣輸出（不會變 undefined）', () => {
    const csv = buildBookingsCSV([B({ source: 'guest', status: 'weird' })], SETTINGS)
    const lines = csv.split('\n')
    expect(lines[1]).toContain('guest')
    expect(lines[1]).toContain('weird')
    expect(lines[1]).not.toContain('undefined')
  })
})
