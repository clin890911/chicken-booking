// 測試：團體預排「日/月」彙總純函式。對應 src/utils/groupDaySummary.js。
// 沿用 closuresAndSeatings.test.js 慣例：module 級 SEATINGS、baseSettings(over)、固定 DATE、工廠函式。
import { describe, it, expect } from 'vitest'
import {
  activeGroupsOnDate,
  summarizeGroupDay,
  summarizeGroupMonth,
  summarizeDayPrep,
  buildArrivalTimeline,
  dayCapacityBySeating,
  buildWalkinDaySummary,
  buildGroupDaySummary,
  frequentAgencies,
} from '../../src/utils/groupDaySummary'
import { resolveSlotOccupancy } from '../../src/utils/capacity'

const SEATINGS = [
  { id: 'lunch1', name: '午餐第一批', start: '11:00', end: '12:30' },
  { id: 'lunch2', name: '午餐第二批', start: '12:30', end: '14:30' },
  { id: 'dinner1', name: '晚餐第一批', start: '17:00', end: '19:00' },
]
const baseSettings = (over = {}) => ({
  openTime: '11:00', closeTime: '19:00', slotInterval: 30,
  diningDurationMin: 90, cleanupBufferMin: 10,
  seatings: SEATINGS,
  closures: { closedDates: [], closedSlots: {}, closedSeatings: {} },
  ...over,
})
const DATE = '2026-06-09'

// totalSeats（active）= 6+6+4+6 = 22
const TABLES = [
  { number: '101', capacity: 6, floor: '1F', isActive: true },
  { number: '102', capacity: 6, floor: '1F', isActive: true },
  { number: '103', capacity: 4, floor: '1F', isActive: true },
  { number: '201', capacity: 6, floor: '2F', isActive: true },
]

function mkBatch(over = {}) {
  return { id: 'bt1', label: '第一梯', timeSlot: '11:00', tableNumbers: [], guests: 0, note: '', ...over }
}
function mkGroup(over = {}) {
  const { counts, batches, ...rest } = over
  return {
    id: 'g1', date: DATE, status: 'confirmed', agencyName: '幸福旅行社',
    guideName: '', allergyText: '', tableSideNeeds: '', busInfo: '', notes: '', spend: 0,
    ...rest,
    counts: { total: 0, vegetarian: 0, child: 0, mobility: 0, wheelchair: 0, ...(counts || {}) },
    batches: batches || [],
  }
}
function mkBooking(over = {}) {
  return { id: 'b1', date: DATE, timeSlot: '11:00', guests: 0, status: 'confirmed', assignedTableId: null, name: '客', ...over }
}

describe('activeGroupsOnDate', () => {
  it('只回該日、排除 cancelled/noshow/completed', () => {
    const groups = [
      mkGroup({ id: 'a', date: DATE, status: 'confirmed' }),
      mkGroup({ id: 'b', date: DATE, status: 'cancelled' }),
      mkGroup({ id: 'c', date: DATE, status: 'completed' }),
      mkGroup({ id: 'd', date: DATE, status: 'planned' }),
      mkGroup({ id: 'e', date: '2026-06-10', status: 'confirmed' }),
    ]
    const out = activeGroupsOnDate(groups, DATE)
    expect(out.map(g => g.id).sort()).toEqual(['a', 'd'])
  })
  it('空輸入安全', () => {
    expect(activeGroupsOnDate(undefined, DATE)).toEqual([])
  })
})

describe('summarizeGroupDay', () => {
  it('零日 → 全 0', () => {
    const s = summarizeGroupDay([], TABLES, DATE, baseSettings())
    expect(s).toMatchObject({ groupCount: 0, guests: 0, heldSeats: 0, heldTableCount: 0, overCapacityGroupOnly: false, closed: false })
    expect(s.bySeating).toEqual({})
  })

  it('單團單梯：人數、保留桌/席、bySeating', () => {
    const groups = [mkGroup({ counts: { total: 10 }, batches: [mkBatch({ timeSlot: '11:00', tableNumbers: ['101', '102'], guests: 10 })] })]
    const s = summarizeGroupDay(groups, TABLES, DATE, baseSettings())
    expect(s.groupCount).toBe(1)
    expect(s.guests).toBe(10)
    expect(s.heldTableCount).toBe(2)
    expect(s.heldSeats).toBe(12)          // 101(6)+102(6)
    expect(s.bySeating).toEqual({ lunch1: 12 })
  })

  it('多梯同桌：整天桌號去重（heldTableCount/heldSeats 不重複計）', () => {
    const groups = [mkGroup({ counts: { total: 6 }, batches: [
      mkBatch({ id: 'a', timeSlot: '11:00', tableNumbers: ['101'], guests: 6 }),
      mkBatch({ id: 'b', timeSlot: '13:00', tableNumbers: ['101'], guests: 6 }), // 同桌、lunch2
    ] })]
    const s = summarizeGroupDay(groups, TABLES, DATE, baseSettings())
    expect(s.heldTableCount).toBe(1)
    expect(s.heldSeats).toBe(6)
    expect(s.bySeating).toEqual({ lunch1: 6, lunch2: 6 }) // 兩場次各自保留同一桌
  })

  it('跨團不同桌：整天相異桌數加總', () => {
    const groups = [
      mkGroup({ id: 'g1', counts: { total: 6 }, batches: [mkBatch({ timeSlot: '11:00', tableNumbers: ['101'], guests: 6 })] }),
      mkGroup({ id: 'g2', counts: { total: 4 }, batches: [mkBatch({ timeSlot: '11:30', tableNumbers: ['103'], guests: 4 })] }),
    ]
    const s = summarizeGroupDay(groups, TABLES, DATE, baseSettings())
    expect(s.groupCount).toBe(2)
    expect(s.guests).toBe(10)
    expect(s.heldTableCount).toBe(2)
    expect(s.heldSeats).toBe(10) // 101(6)+103(4)
  })

  it('圈到停用桌：保留席以 0 計（與容量引擎同口徑，防雙重扣除），不再憑空觸發爆量', () => {
    // 舊行為（已修）：停用桌不在 totalSeats 池，卻仍按 capacity 計保留席 → 6 > 6 誤判爆量。
    const tables = [
      { number: '101', capacity: 6, floor: '1F', isActive: true },
      { number: '102', capacity: 6, floor: '1F', isActive: false }, // 停用：totalSeats 與保留席皆不計
    ]
    const groups = [mkGroup({ counts: { total: 12 }, batches: [mkBatch({ timeSlot: '11:00', tableNumbers: ['101', '102'], guests: 12 })] })]
    const s = summarizeGroupDay(groups, tables, DATE, baseSettings())
    expect(s.bySeating.lunch1).toBe(6) // 只計可用的 101
    expect(s.overCapacityGroupOnly).toBe(false) // 6 = totalSeats 6，未超過
    expect(s.totalSeats).toBe(6)
  })

  it('邊界：圈滿全部可用桌（保留席 = totalSeats）不算爆量', () => {
    // 註：保留席改與容量引擎同口徑後，「場次保留 > 全店可用」只剩跨裝置同步競態等
    // 不一致狀態才可能出現（正常操作圈不到不可用的桌）；爆量旗標保留作為最後防線。
    const tables = [
      { number: '101', capacity: 6, floor: '1F', isActive: true },
      { number: '103', capacity: 4, floor: '1F', isActive: true },
      { number: '102', capacity: 6, floor: '1F', isActive: false },
    ]
    const groups = [mkGroup({ counts: { total: 10 }, batches: [mkBatch({ timeSlot: '11:00', tableNumbers: ['101', '103'], guests: 10 })] })]
    const s = summarizeGroupDay(groups, tables, DATE, baseSettings())
    expect(s.bySeating.lunch1).toBe(10)
    expect(s.totalSeats).toBe(10)
    expect(s.overCapacityGroupOnly).toBe(false)
  })

  it('公休日 → closed:true', () => {
    const s = summarizeGroupDay([], TABLES, DATE, baseSettings({ closures: { closedDates: [DATE], closedSlots: {}, closedSeatings: {} } }))
    expect(s.closed).toBe(true)
  })

  it('時段對不到場次 → 落 __none__ 桶，仍計入整天桌/席', () => {
    const groups = [mkGroup({ counts: { total: 4 }, batches: [mkBatch({ timeSlot: '15:00', tableNumbers: ['103'], guests: 4 })] })]
    const s = summarizeGroupDay(groups, TABLES, DATE, baseSettings())
    expect(s.heldTableCount).toBe(1)
    expect(s.heldSeats).toBe(4)
    expect(s.bySeating).toHaveProperty('__none__', 4)
  })
})

describe('summarizeGroupMonth', () => {
  it('只計當月日期；月總 = 各日 groupCount/guests 之和', () => {
    const groups = [
      mkGroup({ id: 'a', date: '2026-06-01', counts: { total: 5 }, batches: [mkBatch({ tableNumbers: ['101'] })] }),
      mkGroup({ id: 'b', date: '2026-06-01', counts: { total: 3 }, batches: [mkBatch({ tableNumbers: ['103'] })] }),
      mkGroup({ id: 'c', date: '2026-06-20', counts: { total: 8 }, batches: [mkBatch({ tableNumbers: ['201'] })] }),
      mkGroup({ id: 'd', date: '2026-07-01', counts: { total: 99 }, batches: [mkBatch({ tableNumbers: ['101'] })] }), // 不同月
      mkGroup({ id: 'e', date: '2026-06-05', status: 'cancelled', counts: { total: 50 } }),                          // 排除
    ]
    const { byDate, month } = summarizeGroupMonth(groups, TABLES, 2026, 5, baseSettings()) // month 5 = 六月
    expect(Object.keys(byDate).sort()).toEqual(['2026-06-01', '2026-06-20'])
    expect(byDate['2026-06-01'].groupCount).toBe(2)
    expect(byDate['2026-06-01'].guests).toBe(8)
    expect(month.groupCount).toBe(3)  // 2 + 1
    expect(month.guests).toBe(16)     // 8 + 8
  })

  it('當月無團 → 空 byDate、月總 0', () => {
    const { byDate, month } = summarizeGroupMonth([], TABLES, 2026, 5, baseSettings())
    expect(byDate).toEqual({})
    expect(month).toEqual({ groupCount: 0, guests: 0 })
  })
})

describe('summarizeDayPrep', () => {
  it('人數結構加總；過敏/桌邊/遊覽車依團具名；空欄位略過', () => {
    const groups = [
      mkGroup({ id: 'g1', agencyName: '幸福', counts: { total: 20, vegetarian: 3, child: 2 }, allergyText: '花生', busInfo: '車A' }),
      mkGroup({ id: 'g2', agencyName: '大來', counts: { total: 10, vegetarian: 1, wheelchair: 1 }, tableSideNeeds: '剪雞肉',
        batches: [mkBatch({ tableNumbers: ['201'] })] }),
    ]
    const p = summarizeDayPrep(groups, DATE)
    expect(p.counts).toEqual({ total: 30, vegetarian: 4, child: 2, mobility: 0, wheelchair: 1 })
    expect(p.allergies).toEqual([{ agencyName: '幸福', text: '花生' }])
    expect(p.tableSideNeeds).toEqual([{ agencyName: '大來', text: '剪雞肉' }])
    expect(p.buses).toEqual([{ agencyName: '幸福', busInfo: '車A' }])
    expect(p.groupCount).toBe(2)
  })

  it('mobilityGroups 含行動不便或輪椅的團 + 其桌號', () => {
    const groups = [
      mkGroup({ id: 'g1', agencyName: '幸福', counts: { total: 10, mobility: 2 }, batches: [mkBatch({ tableNumbers: ['101', '102'] })] }),
      mkGroup({ id: 'g2', agencyName: '大來', counts: { total: 8 } }), // 無行動需求
    ]
    const p = summarizeDayPrep(groups, DATE)
    expect(p.mobilityGroups).toEqual([{ agencyName: '幸福', tableNumbers: ['101', '102'] }])
  })

  it('零團 → 全 0、空陣列', () => {
    const p = summarizeDayPrep([], DATE)
    expect(p.counts).toEqual({ total: 0, vegetarian: 0, child: 0, mobility: 0, wheelchair: 0 })
    expect(p.allergies).toEqual([])
    expect(p.mobilityGroups).toEqual([])
  })
})

describe('buildArrivalTimeline', () => {
  it('依場次分組、場次依 start 排序、列內依時間排序', () => {
    const groups = [
      mkGroup({ id: 'g1', agencyName: '甲', batches: [
        mkBatch({ id: 'b1', timeSlot: '17:00', guests: 6, tableNumbers: ['201'] }), // dinner1
        mkBatch({ id: 'b2', timeSlot: '11:30', guests: 4, tableNumbers: ['103'] }), // lunch1
      ] }),
      mkGroup({ id: 'g2', agencyName: '乙', batches: [
        mkBatch({ id: 'b3', timeSlot: '11:00', guests: 6, tableNumbers: ['101'] }), // lunch1
      ] }),
    ]
    const tl = buildArrivalTimeline(groups, DATE, baseSettings())
    expect(tl.map(b => b.seating?.id)).toEqual(['lunch1', 'dinner1']) // lunch2 無團不出現
    expect(tl[0].rows.map(r => r.timeSlot)).toEqual(['11:00', '11:30']) // lunch1 內排序
    expect(tl[0].rows[0].group.id).toBe('g2')
    expect(tl[1].rows.map(r => r.timeSlot)).toEqual(['17:00'])
  })

  it('時段對不到場次 → 落 seating:null 桶且置末', () => {
    const groups = [
      mkGroup({ id: 'g1', batches: [mkBatch({ timeSlot: '11:00', tableNumbers: ['101'] })] }),
      mkGroup({ id: 'g2', batches: [mkBatch({ timeSlot: '15:00', tableNumbers: ['103'] })] }), // 不屬任何場次
    ]
    const tl = buildArrivalTimeline(groups, DATE, baseSettings())
    expect(tl[tl.length - 1].seating).toBeNull()
    expect(tl[tl.length - 1].rows.map(r => r.timeSlot)).toEqual(['15:00'])
  })

  it('同場次同時段 2+ 團 → collisions 計數', () => {
    const groups = [
      mkGroup({ id: 'g1', agencyName: '甲', batches: [mkBatch({ timeSlot: '11:00', guests: 6, tableNumbers: ['101'] })] }),
      mkGroup({ id: 'g2', agencyName: '乙', batches: [mkBatch({ timeSlot: '11:00', guests: 4, tableNumbers: ['103'] })] }),
      mkGroup({ id: 'g3', agencyName: '丙', batches: [mkBatch({ timeSlot: '11:30', guests: 6, tableNumbers: ['201'] })] }),
    ]
    const tl = buildArrivalTimeline(groups, DATE, baseSettings())
    const lunch1 = tl.find(b => b.seating?.id === 'lunch1')
    expect(lunch1.collisions).toEqual([{ timeSlot: '11:00', count: 2, guests: 10 }])
  })

  it('零團 → 空陣列', () => {
    expect(buildArrivalTimeline([], DATE, baseSettings())).toEqual([])
  })
})

describe('dayCapacityBySeating', () => {
  it('每場次一筆、summary 與直接呼叫 resolveSlotOccupancy 一致', () => {
    const bookings = [mkBooking({ timeSlot: '11:00', guests: 4, assignedTableId: '103' })]
    const groups = [mkGroup({ batches: [mkBatch({ timeSlot: '11:00', tableNumbers: ['101'], guests: 6 })] })]
    const out = dayCapacityBySeating(TABLES, bookings, groups, DATE, baseSettings())
    expect(out.map(x => x.seating.id)).toEqual(['lunch1', 'lunch2', 'dinner1'])
    const direct = resolveSlotOccupancy(TABLES, bookings, groups, DATE, SEATINGS[0], baseSettings()).summary
    expect(out[0].summary).toEqual(direct)
  })

  it('未設定場次 → 空陣列', () => {
    expect(dayCapacityBySeating(TABLES, [], [], DATE, baseSettings({ seatings: [] }))).toEqual([])
  })
})

describe('buildGroupDaySummary', () => {
  it('彙整基本欄位', () => {
    const groups = [mkGroup({ counts: { total: 10 }, batches: [mkBatch({ timeSlot: '11:00', tableNumbers: ['101'], guests: 10 })] })]
    const out = buildGroupDaySummary({ groupReservations: groups, bookings: [], tables: TABLES, date: DATE, settings: baseSettings() })
    expect(out).toMatchObject({ date: DATE, groupCount: 1, guests: 10, heldTableCount: 1, heldSeats: 6, closed: false })
    expect(out.seatings.map(s => s.seating.id)).toEqual(['lunch1', 'lunch2', 'dinner1'])
  })

  it('含 walkins 散客彙總（給當日總覽散客區塊）', () => {
    const bookings = [
      mkBooking({ id: 'b1', timeSlot: '11:30', guests: 4 }),
      mkBooking({ id: 'b2', timeSlot: '17:00', guests: 2, assignedTableId: '201' }),
    ]
    const out = buildGroupDaySummary({ groupReservations: [], bookings, tables: TABLES, date: DATE, settings: baseSettings() })
    expect(out.walkins).toMatchObject({ count: 2, guests: 6, unassignedCount: 1, unassignedGuests: 4 })
    expect(out.walkins.bySeating.map(x => x.seating.id)).toEqual(['lunch1', 'dinner1'])
  })

  it('warning: overcapacity（團客保留席 + 散客人數 > 全店座位）', () => {
    const groups = [mkGroup({ counts: { total: 12 }, batches: [mkBatch({ timeSlot: '11:00', tableNumbers: ['101', '102'], guests: 12 })] })] // 12 席
    const bookings = [mkBooking({ timeSlot: '11:00', guests: 12, assignedTableId: null })] // 散客 12 人
    const out = buildGroupDaySummary({ groupReservations: groups, bookings, tables: TABLES, date: DATE, settings: baseSettings() })
    const oc = out.warnings.find(w => w.type === 'overcapacity')
    expect(oc).toMatchObject({ seatingId: 'lunch1', totalSeats: 22, used: 24, over: 2 })
  })

  it('warning: collision（同場次同時段多團）', () => {
    const groups = [
      mkGroup({ id: 'g1', agencyName: '甲', counts: { total: 6 }, batches: [mkBatch({ timeSlot: '11:00', guests: 6, tableNumbers: ['101'] })] }),
      mkGroup({ id: 'g2', agencyName: '乙', counts: { total: 4 }, batches: [mkBatch({ timeSlot: '11:00', guests: 4, tableNumbers: ['103'] })] }),
    ]
    const out = buildGroupDaySummary({ groupReservations: groups, bookings: [], tables: TABLES, date: DATE, settings: baseSettings() })
    const col = out.warnings.find(w => w.type === 'collision')
    expect(col).toMatchObject({ seatingId: 'lunch1', timeSlot: '11:00', count: 2, guests: 10 })
  })

  it('warning: unscheduled（梯次對不到場次；有設定場次時才提醒）', () => {
    const groups = [mkGroup({ counts: { total: 4 }, batches: [mkBatch({ timeSlot: '15:00', guests: 4, tableNumbers: ['103'] })] })]
    const out = buildGroupDaySummary({ groupReservations: groups, bookings: [], tables: TABLES, date: DATE, settings: baseSettings() })
    const un = out.warnings.find(w => w.type === 'unscheduled')
    expect(un).toMatchObject({ type: 'unscheduled', count: 1 })
    expect(un.rows[0]).toMatchObject({ timeSlot: '15:00', guests: 4 })
  })

  it('未設定任何場次 → 不發 unscheduled 警示', () => {
    const groups = [mkGroup({ counts: { total: 4 }, batches: [mkBatch({ timeSlot: '11:00', guests: 4, tableNumbers: ['101'] })] })]
    const out = buildGroupDaySummary({ groupReservations: groups, bookings: [], tables: TABLES, date: DATE, settings: baseSettings({ seatings: [] }) })
    expect(out.warnings.find(w => w.type === 'unscheduled')).toBeUndefined()
  })

  it('關閉場次不觸發 overcapacity', () => {
    const groups = [mkGroup({ counts: { total: 12 }, batches: [mkBatch({ timeSlot: '11:00', tableNumbers: ['101', '102'], guests: 12 })] })]
    const bookings = [mkBooking({ timeSlot: '11:00', guests: 12 })]
    const settings = baseSettings({ closures: { closedDates: [], closedSlots: {}, closedSeatings: { [DATE]: ['lunch1'] } } })
    const out = buildGroupDaySummary({ groupReservations: groups, bookings, tables: TABLES, date: DATE, settings })
    expect(out.warnings.find(w => w.type === 'overcapacity')).toBeUndefined()
  })
})

describe('buildWalkinDaySummary', () => {
  it('依場次分桶、rows 依 timeSlot 排序', () => {
    const bookings = [
      mkBooking({ id: 'b1', timeSlot: '11:30', guests: 4, name: '甲' }),
      mkBooking({ id: 'b2', timeSlot: '11:00', guests: 2, name: '乙' }),
      mkBooking({ id: 'b3', timeSlot: '17:30', guests: 3, name: '丙' }),
    ]
    const out = buildWalkinDaySummary(bookings, DATE, baseSettings())
    expect(out).toMatchObject({ count: 3, guests: 9, unassignedCount: 3, unassignedGuests: 9 })
    expect(out.bySeating.map(x => x.seating.id)).toEqual(['lunch1', 'dinner1'])
    expect(out.bySeating[0].rows.map(r => r.booking.name)).toEqual(['乙', '甲'])
    expect(out.unscheduled).toEqual([])
  })

  it('排除 cancelled/noshow/completed 與他日訂位', () => {
    const bookings = [
      mkBooking({ id: 'b1', guests: 2 }),
      mkBooking({ id: 'b2', guests: 4, status: 'cancelled' }),
      mkBooking({ id: 'b3', guests: 4, status: 'noshow' }),
      mkBooking({ id: 'b4', guests: 4, status: 'completed' }),
      mkBooking({ id: 'b5', guests: 4, date: '2026-06-10' }),
    ]
    const out = buildWalkinDaySummary(bookings, DATE, baseSettings())
    expect(out).toMatchObject({ count: 1, guests: 2 })
    expect(out.bySeating[0].rows).toHaveLength(1)
  })

  it('已配桌不列入 unassigned 統計、row 帶 assignedTableId', () => {
    const bookings = [
      mkBooking({ id: 'b1', guests: 4, assignedTableId: '101' }),
      mkBooking({ id: 'b2', timeSlot: '11:30', guests: 2 }),
    ]
    const out = buildWalkinDaySummary(bookings, DATE, baseSettings())
    expect(out).toMatchObject({ count: 2, guests: 6, unassignedCount: 1, unassignedGuests: 2 })
    expect(out.bySeating[0].rows[0].assignedTableId).toBe('101')
  })

  it('時段對不到場次 → 進 unscheduled 桶', () => {
    const bookings = [mkBooking({ id: 'b1', timeSlot: '15:00', guests: 4 })]
    const out = buildWalkinDaySummary(bookings, DATE, baseSettings())
    expect(out.bySeating).toEqual([])
    expect(out.unscheduled).toHaveLength(1)
    expect(out.unscheduled[0]).toMatchObject({ timeSlot: '15:00', guests: 4 })
  })

  it('空輸入安全', () => {
    expect(buildWalkinDaySummary(undefined, DATE, baseSettings()))
      .toMatchObject({ count: 0, guests: 0, unassignedCount: 0, unassignedGuests: 0, bySeating: [], unscheduled: [] })
  })
})

describe('frequentAgencies', () => {
  const AGENCIES = [
    { id: 'AG1', name: '甲旅行社' },
    { id: 'AG2', name: '乙旅行社' },
    { id: 'AG3', name: '丙旅行社（已封存）', archived: true },
  ]
  const groups = [
    mkGroup({ id: 'g1', agencyId: 'AG1', date: '2026-06-01' }),
    mkGroup({ id: 'g2', agencyId: 'AG1', date: '2026-06-02' }),
    mkGroup({ id: 'g3', agencyId: 'AG2', date: '2026-06-03' }),
    mkGroup({ id: 'g4', agencyId: 'AG1', date: '2026-06-04', status: 'cancelled' }), // 取消不計
    mkGroup({ id: 'g5', agencyId: 'AG3', date: '2026-06-05' }),                       // 封存不列
    mkGroup({ id: 'g6', agencyId: null, date: '2026-06-06' }),                        // 無 agencyId 略過
  ]

  it('依團數排序取前 N、過濾封存、排除取消', () => {
    const r = frequentAgencies(groups, AGENCIES, { limit: 5 })
    expect(r.map(a => a.id)).toEqual(['AG1', 'AG2']) // AG1=2團、AG2=1團；AG3 封存、null 略過
  })

  it('sinceDate 過濾較舊團', () => {
    const r = frequentAgencies(groups, AGENCIES, { sinceDate: '2026-06-03' })
    // 只算 06-03 起：AG2(g3) 1 團；AG1 的 g1/g2 在之前、g4 取消 → AG1 不入
    expect(r.map(a => a.id)).toEqual(['AG2'])
  })

  it('limit 限制數量', () => {
    const r = frequentAgencies(groups, AGENCIES, { limit: 1 })
    expect(r).toHaveLength(1)
    expect(r[0].id).toBe('AG1')
  })

  it('無資料 → 空陣列', () => {
    expect(frequentAgencies([], AGENCIES)).toEqual([])
  })
})
