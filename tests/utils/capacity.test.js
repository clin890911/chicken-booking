// 測試：src/utils/capacity.js
// 客戶端訂位可用量核心引擎。涵蓋 toMinutes / occupancyMinutes / calcSlotCapacity /
// groupTableNumbers / groupOccupancyWindow / groupHeldSeats 及團體佔位扣減。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  CAPACITY_EXCLUDED_STATUSES,
  toMinutes,
  occupancyMinutes,
  calcSlotCapacity,
  groupTableNumbers,
  groupOccupancyWindow,
  groupHeldSeats,
  bookingOccupancyLabel,
  calcDayBookings,
  totalActiveSeats,
  findPreassignedBooking,
  resolveSlotOccupancy,
} from '../../src/utils/capacity'

// ---- 假資料工廠 ----
// 桌位：給 number 與 capacity，isActive 預設 true。
const mkTable = (number, capacity, isActive = true) => ({ number, capacity, isActive })

// 散客訂位：date / timeSlot / guests / status。
const mkBooking = (over = {}) => ({
  date: '2026-06-15',
  timeSlot: '18:00',
  guests: 2,
  status: 'confirmed',
  ...over,
})

// 團體：date / status / batches[{ timeSlot, tableNumbers[] }]。
const mkGroup = (over = {}) => ({
  date: '2026-06-15',
  status: 'confirmed',
  batches: [],
  ...over,
})

const DATE = '2026-06-15'

// 固定系統時間到 2026-06-15 12:00（雖然 capacity.js 未直接讀系統時間，依規格固定以保可重複）
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 5, 15, 12, 0, 0))
})
afterEach(() => {
  vi.useRealTimers()
})

// =========================================================
describe('CAPACITY_EXCLUDED_STATUSES 常數', () => {
  it('正好是 cancelled / noshow / completed 三種', () => {
    expect(CAPACITY_EXCLUDED_STATUSES).toEqual(['cancelled', 'noshow', 'completed'])
  })
})

// =========================================================
describe('toMinutes', () => {
  it('正常 HH:MM 轉分鐘', () => {
    expect(toMinutes('00:00')).toBe(0)
    expect(toMinutes('01:00')).toBe(60)
    expect(toMinutes('18:30')).toBe(18 * 60 + 30)
    expect(toMinutes('23:59')).toBe(23 * 60 + 59)
  })

  it('預設參數為 "00:00" → 0', () => {
    expect(toMinutes()).toBe(0)
    expect(toMinutes(undefined)).toBe(0)
  })

  it('非數字時間字串回傳 0（防護）', () => {
    expect(toMinutes('abc')).toBe(0)
    expect(toMinutes('ab:cd')).toBe(0)
    expect(toMinutes('')).toBe(0)
  })

  it('缺少分鐘段（無冒號）→ m 為 NaN → 0', () => {
    expect(toMinutes('10')).toBe(0)
  })

  it('小時或分鐘其一不合法 → 0', () => {
    expect(toMinutes('10:xx')).toBe(0)
    expect(toMinutes('xx:30')).toBe(0)
  })

  it('容許數字超界但仍為有限數（無上限檢查，照算）', () => {
    expect(toMinutes('25:70')).toBe(25 * 60 + 70)
  })
})

// =========================================================
describe('occupancyMinutes', () => {
  it('無設定 → 預設 90 + 10 = 100', () => {
    expect(occupancyMinutes()).toBe(100)
    expect(occupancyMinutes({})).toBe(100)
  })

  it('自訂用餐與緩衝時間相加', () => {
    expect(occupancyMinutes({ diningDurationMin: 120, cleanupBufferMin: 15 })).toBe(135)
  })

  it('只給其一，另一個用預設', () => {
    expect(occupancyMinutes({ diningDurationMin: 60 })).toBe(60 + 10)
    expect(occupancyMinutes({ cleanupBufferMin: 20 })).toBe(90 + 20)
  })

  it('0 視為 falsy → 套用預設（diningDurationMin:0 → 90）', () => {
    expect(occupancyMinutes({ diningDurationMin: 0 })).toBe(90 + 10)
    expect(occupancyMinutes({ cleanupBufferMin: 0 })).toBe(90 + 10)
    expect(occupancyMinutes({ diningDurationMin: 0, cleanupBufferMin: 0 })).toBe(100)
  })

  it('非數字字串 → Number(...) 為 NaN（falsy）→ 套用預設', () => {
    expect(occupancyMinutes({ diningDurationMin: 'oops', cleanupBufferMin: 'x' })).toBe(100)
  })

  it('數字字串可被 Number() 解析', () => {
    expect(occupancyMinutes({ diningDurationMin: '120', cleanupBufferMin: '5' })).toBe(125)
  })

  it('負值防護：結果不為負（Math.max(0, ...)）', () => {
    // -50 為 truthy，dining=-50，buffer 預設 10 → -40 → clamp 為 0
    expect(occupancyMinutes({ diningDurationMin: -50 })).toBe(0)
    // 負值相加仍小於 0
    expect(occupancyMinutes({ diningDurationMin: -100, cleanupBufferMin: -100 })).toBe(0)
  })

  it('負緩衝但用餐足以蓋過 → 仍為正', () => {
    expect(occupancyMinutes({ diningDurationMin: 120, cleanupBufferMin: -30 })).toBe(90)
  })
})

// =========================================================
describe('groupTableNumbers', () => {
  it('回傳所有梯次的相異桌號（字串化）', () => {
    const g = mkGroup({
      batches: [
        { timeSlot: '18:00', tableNumbers: ['A1', 'A2'] },
        { timeSlot: '19:30', tableNumbers: ['A3'] },
      ],
    })
    expect(groupTableNumbers(g).sort()).toEqual(['A1', 'A2', 'A3'])
  })

  it('兩梯重用同桌只算一次（去重）', () => {
    const g = mkGroup({
      batches: [
        { timeSlot: '18:00', tableNumbers: ['A1', 'A2'] },
        { timeSlot: '19:30', tableNumbers: ['A1', 'A2'] },
      ],
    })
    expect(groupTableNumbers(g).sort()).toEqual(['A1', 'A2'])
  })

  it('數字桌號被字串化', () => {
    const g = mkGroup({ batches: [{ timeSlot: '18:00', tableNumbers: [1, 2, 1] }] })
    expect(groupTableNumbers(g).sort()).toEqual(['1', '2'])
  })

  it('過濾掉 falsy 桌號（0/null/空字串/undefined）', () => {
    const g = mkGroup({ batches: [{ timeSlot: '18:00', tableNumbers: ['A1', '', null, undefined, 0] }] })
    expect(groupTableNumbers(g)).toEqual(['A1'])
  })

  it('沒有 batches / null group → 空陣列（防護）', () => {
    expect(groupTableNumbers(mkGroup({ batches: [] }))).toEqual([])
    expect(groupTableNumbers({})).toEqual([])
    expect(groupTableNumbers(null)).toEqual([])
    expect(groupTableNumbers(undefined)).toEqual([])
  })

  it('batch 缺 tableNumbers 欄位 → 視為空', () => {
    const g = mkGroup({ batches: [{ timeSlot: '18:00' }, { timeSlot: '19:00', tableNumbers: ['B1'] }] })
    expect(groupTableNumbers(g)).toEqual(['B1'])
  })
})

// =========================================================
describe('groupOccupancyWindow', () => {
  it('合併窗 = [最早梯次開始, 最晚梯次開始 + 佔位時長]', () => {
    const g = mkGroup({
      batches: [
        { timeSlot: '18:00', tableNumbers: ['A1'] },
        { timeSlot: '19:30', tableNumbers: ['A1'] },
      ],
    })
    // 最早 18:00=1080，最晚 19:30=1170，duration=100 → end=1270
    expect(groupOccupancyWindow(g, 100)).toEqual({ start: 1080, end: 1170 + 100 })
  })

  it('單一梯次：start=該梯次，end=該梯次+duration', () => {
    const g = mkGroup({ batches: [{ timeSlot: '12:00', tableNumbers: ['A1'] }] })
    expect(groupOccupancyWindow(g, 90)).toEqual({ start: 720, end: 720 + 90 })
  })

  it('梯次順序不影響結果（取 min/max）', () => {
    const g = mkGroup({
      batches: [
        { timeSlot: '20:00', tableNumbers: ['A1'] },
        { timeSlot: '17:00', tableNumbers: ['A2'] },
        { timeSlot: '18:30', tableNumbers: ['A3'] },
      ],
    })
    expect(groupOccupancyWindow(g, 60)).toEqual({ start: toMinutes('17:00'), end: toMinutes('20:00') + 60 })
  })

  it('無有效梯次（空 batches）→ null', () => {
    expect(groupOccupancyWindow(mkGroup({ batches: [] }), 100)).toBeNull()
    expect(groupOccupancyWindow({}, 100)).toBeNull()
    expect(groupOccupancyWindow(null, 100)).toBeNull()
  })

  it('梯次 timeSlot 解析為 0（含 00:00 / 無效）被過濾掉（n > 0）', () => {
    // 全部解析為 0 → 沒有有效起點 → null
    const g = mkGroup({
      batches: [
        { timeSlot: '00:00', tableNumbers: ['A1'] },
        { timeSlot: 'bad', tableNumbers: ['A2'] },
      ],
    })
    expect(groupOccupancyWindow(g, 100)).toBeNull()
  })

  it('混合有效與無效梯次：只用有效梯次計算窗', () => {
    const g = mkGroup({
      batches: [
        { timeSlot: 'bad', tableNumbers: ['A1'] }, // 0，被過濾
        { timeSlot: '18:00', tableNumbers: ['A2'] },
        { timeSlot: '19:00', tableNumbers: ['A3'] },
      ],
    })
    expect(groupOccupancyWindow(g, 50)).toEqual({ start: toMinutes('18:00'), end: toMinutes('19:00') + 50 })
  })
})

// =========================================================
describe('groupHeldSeats', () => {
  const capMap = { A1: 4, A2: 4, A3: 6, B1: 2 }

  it('= 該團相異桌號 capacity 合計（整桌保留）', () => {
    const g = mkGroup({ batches: [{ timeSlot: '18:00', tableNumbers: ['A1', 'A2', 'A3'] }] })
    expect(groupHeldSeats(g, capMap)).toBe(4 + 4 + 6)
  })

  it('兩梯重用同桌只算一次（不雙扣）', () => {
    const g = mkGroup({
      batches: [
        { timeSlot: '18:00', tableNumbers: ['A1', 'A2'] },
        { timeSlot: '19:30', tableNumbers: ['A1', 'A2'] },
      ],
    })
    expect(groupHeldSeats(g, capMap)).toBe(4 + 4)
  })

  it('未知桌號的 capacity 視為 0', () => {
    const g = mkGroup({ batches: [{ timeSlot: '18:00', tableNumbers: ['A1', 'ZZZ'] }] })
    expect(groupHeldSeats(g, capMap)).toBe(4)
  })

  it('沒有桌號 → 0', () => {
    expect(groupHeldSeats(mkGroup({ batches: [] }), capMap)).toBe(0)
    expect(groupHeldSeats({}, capMap)).toBe(0)
  })
})

// =========================================================
describe('calcSlotCapacity — 基本座位合計', () => {
  it('無任何訂位 → 滿座位（只計 isActive 桌）', () => {
    const tables = [mkTable('A1', 4), mkTable('A2', 4), mkTable('A3', 6)]
    expect(calcSlotCapacity(tables, [], DATE, '18:00')).toBe(14)
  })

  it('只計入 isActive 桌（停用桌不算）', () => {
    const tables = [mkTable('A1', 4), mkTable('A2', 4, false), mkTable('A3', 6)]
    // 4 + 6 = 10（A2 停用不計）
    expect(calcSlotCapacity(tables, [], DATE, '18:00')).toBe(10)
  })

  it('全部停用 → 0 座位', () => {
    const tables = [mkTable('A1', 4, false), mkTable('A2', 4, false)]
    expect(calcSlotCapacity(tables, [], DATE, '18:00')).toBe(0)
  })
})

// =========================================================
describe('calcSlotCapacity — 散客訂位扣減', () => {
  const tables = [mkTable('A1', 4), mkTable('A2', 4), mkTable('A3', 6)] // 共 14

  it('單筆訂位扣 guests', () => {
    const bookings = [mkBooking({ guests: 3, timeSlot: '18:00' })]
    expect(calcSlotCapacity(tables, bookings, DATE, '18:00')).toBe(14 - 3)
  })

  it('多筆重疊訂位逐筆相加扣減', () => {
    const bookings = [
      mkBooking({ guests: 2, timeSlot: '18:00' }),
      mkBooking({ guests: 4, timeSlot: '18:30' }),
    ]
    // 18:00 與 18:30 在 duration=100 下都與目標 18:00 重疊
    expect(calcSlotCapacity(tables, bookings, DATE, '18:00')).toBe(14 - 6)
  })

  it('不同日期的訂位不扣', () => {
    const bookings = [mkBooking({ guests: 4, date: '2026-06-16', timeSlot: '18:00' })]
    expect(calcSlotCapacity(tables, bookings, DATE, '18:00')).toBe(14)
  })

  it('沒有 timeSlot 的訂位被忽略', () => {
    const bookings = [mkBooking({ guests: 4, timeSlot: '' }), mkBooking({ guests: 4, timeSlot: null })]
    expect(calcSlotCapacity(tables, bookings, DATE, '18:00')).toBe(14)
  })

  it('guests 非數字 → 視為 0', () => {
    const bookings = [mkBooking({ guests: 'x', timeSlot: '18:00' })]
    expect(calcSlotCapacity(tables, bookings, DATE, '18:00')).toBe(14)
  })

  it('結果不為負（超賣時 clamp 為 0）', () => {
    const bookings = [mkBooking({ guests: 100, timeSlot: '18:00' })]
    expect(calcSlotCapacity(tables, bookings, DATE, '18:00')).toBe(0)
  })
})

// =========================================================
describe('calcSlotCapacity — 排除狀態不佔位', () => {
  const tables = [mkTable('A1', 10)]

  it.each(CAPACITY_EXCLUDED_STATUSES)('狀態 %s 的訂位不扣座位', (status) => {
    const bookings = [mkBooking({ guests: 4, timeSlot: '18:00', status })]
    expect(calcSlotCapacity(tables, bookings, DATE, '18:00')).toBe(10)
  })

  it('confirmed / pending 等非排除狀態會佔位', () => {
    const bookings = [
      mkBooking({ guests: 3, timeSlot: '18:00', status: 'confirmed' }),
      mkBooking({ guests: 2, timeSlot: '18:00', status: 'pending' }),
    ]
    expect(calcSlotCapacity(tables, bookings, DATE, '18:00')).toBe(10 - 5)
  })

  it('混合排除與非排除：只扣非排除者', () => {
    const bookings = [
      mkBooking({ guests: 4, timeSlot: '18:00', status: 'cancelled' }),
      mkBooking({ guests: 3, timeSlot: '18:00', status: 'confirmed' }),
      mkBooking({ guests: 5, timeSlot: '18:00', status: 'noshow' }),
    ]
    expect(calcSlotCapacity(tables, bookings, DATE, '18:00')).toBe(10 - 3)
  })
})

// =========================================================
describe('calcSlotCapacity — 時間窗重疊判定', () => {
  // 用大量座位避免被座位數限制干擾
  const tables = [mkTable('A1', 100)]
  // 預設 duration = 100 分鐘（90 用餐 + 10 緩衝）

  it('完全相同時段 → 重疊，扣減', () => {
    const bookings = [mkBooking({ guests: 5, timeSlot: '18:00' })]
    expect(calcSlotCapacity(tables, bookings, DATE, '18:00')).toBe(95)
  })

  it('部分重疊（訂位 17:30，duration=100 → [1050,1150)；目標 18:00 → [1080,1180)）→ 扣減', () => {
    // 1050 < 1180 且 1080 < 1150 → 重疊
    const bookings = [mkBooking({ guests: 5, timeSlot: '17:30' })]
    expect(calcSlotCapacity(tables, bookings, DATE, '18:00')).toBe(95)
  })

  it('剛好不重疊（訂位 16:00 → end=16:00+100=17:40=1060；目標 18:00=1080）→ 不扣', () => {
    // 訂位窗 [960, 1060)；目標窗 [1080, 1180)。1060 <= 1080 → 不重疊
    const bookings = [mkBooking({ guests: 5, timeSlot: '16:00' })]
    expect(calcSlotCapacity(tables, bookings, DATE, '18:00')).toBe(100)
  })

  it('邊界相接不算重疊（半開區間）：訂位 end 正好等於 target start', () => {
    // 設定 duration=120（用餐 110 + 緩衝 10），訂位 16:00 → end=16:00+120=18:00=target
    const settings = { diningDurationMin: 110, cleanupBufferMin: 10 } // duration=120
    const bookings = [mkBooking({ guests: 5, timeSlot: '16:00' })]
    // 訂位窗 [960, 1080)；目標窗 [1080, 1200)。960 < 1200 為真，但 1080 < 1080 為假 → 不重疊
    expect(calcSlotCapacity(tables, bookings, DATE, '18:00', settings)).toBe(100)
  })

  it('目標在訂位之後但仍在窗內 → 重疊', () => {
    // 訂位 17:30 → 窗 [1050, 1150)；目標 19:00=1140 → 窗 [1140, 1240)
    // 1050 < 1240 且 1140 < 1150 → 重疊
    const bookings = [mkBooking({ guests: 5, timeSlot: '17:30' })]
    expect(calcSlotCapacity(tables, bookings, DATE, '19:00')).toBe(95)
  })

  it('自訂較長 duration 會擴大重疊範圍', () => {
    // duration=200（用餐190+緩衝10）。訂位 15:00 → 窗 [900, 1100)；目標 18:00=1080 → 窗 [1080,1280)
    // 900 < 1280 且 1080 < 1100 → 重疊
    const settings = { diningDurationMin: 190, cleanupBufferMin: 10 }
    const bookings = [mkBooking({ guests: 5, timeSlot: '15:00' })]
    expect(calcSlotCapacity(tables, bookings, DATE, '18:00', settings)).toBe(95)
    // 同樣訂位在預設 duration=100 下不重疊（窗 [900,1000) vs [1080,1180)）
    expect(calcSlotCapacity(tables, bookings, DATE, '18:00')).toBe(100)
  })
})

// =========================================================
describe('calcSlotCapacity — 團體佔位扣減', () => {
  // 6 桌共 28 座位
  const tables = [
    mkTable('A1', 4), mkTable('A2', 4), mkTable('A3', 6),
    mkTable('B1', 4), mkTable('B2', 4), mkTable('B3', 6),
  ]
  const totalSeats = 4 + 4 + 6 + 4 + 4 + 6 // 28

  it('團體整桌保留：扣該團相異桌號 capacity 合計（圈大桌坐少人也照整桌扣）', () => {
    const groups = [
      mkGroup({
        batches: [{ timeSlot: '18:00', tableNumbers: ['A1', 'A3'] }], // 4 + 6 = 10
      }),
    ]
    expect(calcSlotCapacity(tables, [], DATE, '18:00', {}, groups)).toBe(totalSeats - 10)
  })

  it('兩梯重用同桌只算一次（避免雙扣）', () => {
    const groups = [
      mkGroup({
        batches: [
          { timeSlot: '18:00', tableNumbers: ['A1', 'A2'] },
          { timeSlot: '19:30', tableNumbers: ['A1', 'A2'] },
        ],
      }),
    ]
    // 相異桌號 A1,A2 → 4+4=8，只扣一次
    expect(calcSlotCapacity(tables, [], DATE, '18:00', {}, groups)).toBe(totalSeats - 8)
  })

  it('合併窗未涵蓋目標時段 → 不扣', () => {
    // 團體 12:00 一梯，合併窗 [720, 820)；目標 18:00=1080 → 不重疊
    const groups = [mkGroup({ batches: [{ timeSlot: '12:00', tableNumbers: ['A1', 'A2'] }] })]
    expect(calcSlotCapacity(tables, [], DATE, '18:00', {}, groups)).toBe(totalSeats)
  })

  it('合併窗涵蓋目標時段 → 扣（兩梯橫跨）', () => {
    // 梯次 17:00 與 19:00，合併窗 [1020, 1140+? ] duration=100 → [1020, 1240)
    // 目標 18:00=1080 落在窗內 → 扣
    const groups = [
      mkGroup({
        batches: [
          { timeSlot: '17:00', tableNumbers: ['A1'] },
          { timeSlot: '19:00', tableNumbers: ['A2'] },
        ],
      }),
    ]
    expect(calcSlotCapacity(tables, [], DATE, '18:00', {}, groups)).toBe(totalSeats - (4 + 4))
  })

  it.each(CAPACITY_EXCLUDED_STATUSES)('排除狀態 %s 的團體不佔位', (status) => {
    const groups = [
      mkGroup({ status, batches: [{ timeSlot: '18:00', tableNumbers: ['A1', 'A2', 'A3'] }] }),
    ]
    expect(calcSlotCapacity(tables, [], DATE, '18:00', {}, groups)).toBe(totalSeats)
  })

  it('不同日期的團體不扣', () => {
    const groups = [
      mkGroup({ date: '2026-06-16', batches: [{ timeSlot: '18:00', tableNumbers: ['A1', 'A2'] }] }),
    ]
    expect(calcSlotCapacity(tables, [], DATE, '18:00', {}, groups)).toBe(totalSeats)
  })

  it('散客 + 團體同時扣減', () => {
    const bookings = [mkBooking({ guests: 3, timeSlot: '18:00' })]
    const groups = [mkGroup({ batches: [{ timeSlot: '18:00', tableNumbers: ['A1'] }] })] // 扣 4
    expect(calcSlotCapacity(tables, bookings, DATE, '18:00', {}, groups)).toBe(totalSeats - 3 - 4)
  })

  it('多團各自扣減', () => {
    const groups = [
      mkGroup({ batches: [{ timeSlot: '18:00', tableNumbers: ['A1'] }] }), // 4
      mkGroup({ batches: [{ timeSlot: '18:00', tableNumbers: ['B3'] }] }), // 6
    ]
    expect(calcSlotCapacity(tables, [], DATE, '18:00', {}, groups)).toBe(totalSeats - 4 - 6)
  })

  it('團體 + 散客超賣 → clamp 為 0（不為負）', () => {
    const smallTables = [mkTable('A1', 4)]
    const bookings = [mkBooking({ guests: 4, timeSlot: '18:00' })]
    const groups = [mkGroup({ batches: [{ timeSlot: '18:00', tableNumbers: ['A1'] }] })] // 扣 4
    // 4 - 4 - 4 = -4 → 0
    expect(calcSlotCapacity(smallTables, bookings, DATE, '18:00', {}, groups)).toBe(0)
  })

  it('未傳 groupReservations 參數 → 不報錯，等同無團體', () => {
    const bookings = [mkBooking({ guests: 2, timeSlot: '18:00' })]
    expect(calcSlotCapacity(tables, bookings, DATE, '18:00', {})).toBe(totalSeats - 2)
  })

  it('groupReservations 為 null → 防護，不報錯', () => {
    expect(calcSlotCapacity(tables, [], DATE, '18:00', {}, null)).toBe(totalSeats)
  })

  it('團體保留「停用桌」不雙重扣除：該桌已不在 totalSeats 池，保留席以 0 計', () => {
    // 舊行為（已修）：A2 停用，totalSeats 不含 A2，但團體保留 A2 仍按 capacity 扣 → 憑空少 4 位。
    const tbls = [mkTable('A1', 4), mkTable('A2', 4, false), mkTable('A3', 6)] // active 共 10
    const groups = [mkGroup({ batches: [{ timeSlot: '18:00', tableNumbers: ['A2'] }] })]
    expect(calcSlotCapacity(tbls, [], DATE, '18:00', {}, groups)).toBe(10)
  })

  it('團體保留「維修中的桌」同樣不雙重扣除（窗外日期照常扣）', () => {
    const outA2 = { ...mkTable('A2', 4), outage: { from: DATE, to: DATE, reason: '維修' } }
    const tbls = [mkTable('A1', 4), outA2, mkTable('A3', 6)]
    const groups = [mkGroup({ batches: [{ timeSlot: '18:00', tableNumbers: ['A2'] }] })]
    // 維修日：totalSeats 10（不含 A2）、保留席 0 → 10
    expect(calcSlotCapacity(tbls, [], DATE, '18:00', {}, groups)).toBe(10)
    // 窗外日期：totalSeats 14、保留 A2(4) → 10
    const groups2 = [mkGroup({ date: '2026-06-20', batches: [{ timeSlot: '18:00', tableNumbers: ['A2'] }] })]
    expect(calcSlotCapacity(tbls, [], '2026-06-20', '18:00', {}, groups2)).toBe(10)
  })
})

// =========================================================
describe('calcSlotCapacity — 狀態轉移 / 資料隔離', () => {
  const tables = [mkTable('A1', 10)]

  it('同一筆訂位狀態由 confirmed → cancelled 後不再佔位', () => {
    const b = mkBooking({ guests: 4, timeSlot: '18:00', status: 'confirmed' })
    expect(calcSlotCapacity(tables, [b], DATE, '18:00')).toBe(10 - 4)
    const cancelled = { ...b, status: 'cancelled' }
    expect(calcSlotCapacity(tables, [cancelled], DATE, '18:00')).toBe(10)
  })

  it('不會變更傳入的 tables/bookings/groups（無副作用）', () => {
    const tbls = [mkTable('A1', 4), mkTable('A2', 6)]
    const bookings = [mkBooking({ guests: 3, timeSlot: '18:00' })]
    const groups = [mkGroup({ batches: [{ timeSlot: '18:00', tableNumbers: ['A1'] }] })]
    const tblsSnap = JSON.stringify(tbls)
    const bookingsSnap = JSON.stringify(bookings)
    const groupsSnap = JSON.stringify(groups)
    calcSlotCapacity(tbls, bookings, DATE, '18:00', {}, groups)
    expect(JSON.stringify(tbls)).toBe(tblsSnap)
    expect(JSON.stringify(bookings)).toBe(bookingsSnap)
    expect(JSON.stringify(groups)).toBe(groupsSnap)
  })
})

// =========================================================
describe('bookingOccupancyLabel', () => {
  it('預設文案使用 90 / 10', () => {
    expect(bookingOccupancyLabel()).toBe('用餐 90 分鐘，保留 10 分鐘清桌緩衝')
    expect(bookingOccupancyLabel({})).toBe('用餐 90 分鐘，保留 10 分鐘清桌緩衝')
  })

  it('自訂用餐 / 緩衝反映於文案', () => {
    expect(bookingOccupancyLabel({ diningDurationMin: 120, cleanupBufferMin: 15 }))
      .toBe('用餐 120 分鐘，保留 15 分鐘清桌緩衝')
  })

  it('0 為 falsy → 套用預設（與 occupancyMinutes 一致）', () => {
    expect(bookingOccupancyLabel({ diningDurationMin: 0, cleanupBufferMin: 0 }))
      .toBe('用餐 90 分鐘，保留 10 分鐘清桌緩衝')
  })
})

// =========================================================
describe('calcDayBookings', () => {
  it('回傳指定日期且非 cancelled 的訂位', () => {
    const bookings = [
      mkBooking({ date: DATE, status: 'confirmed', guests: 1 }),
      mkBooking({ date: DATE, status: 'cancelled', guests: 2 }),
      mkBooking({ date: '2026-06-16', status: 'confirmed', guests: 3 }),
    ]
    const res = calcDayBookings(bookings, DATE)
    expect(res).toHaveLength(1)
    expect(res[0].guests).toBe(1)
  })

  it('noshow / completed 仍會被列入（只排除 cancelled）', () => {
    const bookings = [
      mkBooking({ date: DATE, status: 'noshow' }),
      mkBooking({ date: DATE, status: 'completed' }),
    ]
    expect(calcDayBookings(bookings, DATE)).toHaveLength(2)
  })

  it('空清單 → 空陣列', () => {
    expect(calcDayBookings([], DATE)).toEqual([])
  })
})

// =========================================================
describe('totalActiveSeats', () => {
  it('只加總 isActive 桌的 capacity', () => {
    const tables = [mkTable('A1', 4), mkTable('A2', 6, false), mkTable('A3', 2)]
    expect(totalActiveSeats(tables)).toBe(6)
  })

  it('空清單 → 0', () => {
    expect(totalActiveSeats([])).toBe(0)
  })

  it('全部停用 → 0', () => {
    expect(totalActiveSeats([mkTable('A1', 4, false)])).toBe(0)
  })
})

// findPreassignedBooking：現場「指派桌」防呆用 —— 找出已把某桌預先配走的別筆散客訂位。
describe('findPreassignedBooking — 預先配桌衝突偵測', () => {
  it('某桌已被別筆 booking 預配 → 回傳該筆', () => {
    const bookings = [
      mkBooking({ id: 'A', name: '阿明', assignedTableId: '101', date: DATE }),
      mkBooking({ id: 'B', name: '小華', assignedTableId: '102', date: DATE }),
    ]
    const hit = findPreassignedBooking(bookings, '101', { date: DATE, excludeBookingId: 'B' })
    expect(hit?.id).toBe('A')
    expect(hit?.name).toBe('阿明')
  })

  it('沒有任何 booking 配到此桌 → null', () => {
    const bookings = [mkBooking({ id: 'A', assignedTableId: '102', date: DATE })]
    expect(findPreassignedBooking(bookings, '101', { date: DATE })).toBeNull()
  })

  it('預配的就是正在指派的這筆（id 相同）→ null（不自我示警，正常流程不受影響）', () => {
    const bookings = [mkBooking({ id: 'A', assignedTableId: '101', date: DATE })]
    expect(findPreassignedBooking(bookings, '101', { date: DATE, excludeBookingId: 'A' })).toBeNull()
  })

  it('已取消／未到／已完成的預配不算（不再佔位）', () => {
    for (const status of CAPACITY_EXCLUDED_STATUSES) {
      const bookings = [mkBooking({ id: 'A', assignedTableId: '101', date: DATE, status })]
      expect(findPreassignedBooking(bookings, '101', { date: DATE })).toBeNull()
    }
  })

  it('限定同日：不同日的預配不誤報', () => {
    const bookings = [mkBooking({ id: 'A', assignedTableId: '101', date: '2026-06-16' })]
    expect(findPreassignedBooking(bookings, '101', { date: DATE })).toBeNull()
    // 不傳 date → 不限日，仍找得到
    expect(findPreassignedBooking(bookings, '101', {})?.id).toBe('A')
  })

  it('桌號型別寬鬆比對（數字 vs 字串）', () => {
    const bookings = [mkBooking({ id: 'A', assignedTableId: 101, date: DATE })]
    expect(findPreassignedBooking(bookings, '101', { date: DATE })?.id).toBe('A')
  })

  it('tableNumber 為空 / 無預配欄位 → null（防呆不誤觸）', () => {
    expect(findPreassignedBooking([mkBooking({ id: 'A', assignedTableId: '101' })], null, {})).toBeNull()
    expect(findPreassignedBooking([mkBooking({ id: 'A', assignedTableId: null })], '101', {})).toBeNull()
    expect(findPreassignedBooking(undefined, '101', {})).toBeNull()
  })
})

// ============================================================
// 維修停用（outage）× 容量：該日在維修窗內的桌不計入 totalSeats
// （與後端 calcSlotCapacityServer 同口徑；窗外日期不受影響）
// ============================================================
describe('calcSlotCapacity — 維修停用（按日期）', () => {
  const outTable = { ...mkTable('101', 4), outage: { from: '2026-06-15', to: '2026-06-16', reason: '維修' } }
  const tables = [outTable, mkTable('102', 6)]

  it('維修窗內：該桌座位不計入', () => {
    expect(calcSlotCapacity(tables, [], DATE, '18:00', {}, [])).toBe(6)
  })

  it('維修窗外（隔週同桌）：照常計入', () => {
    expect(calcSlotCapacity(tables, [], '2026-06-20', '18:00', {}, [])).toBe(10)
  })

  it('resolveSlotOccupancy：維修桌不計入 totalSeats / totalTables', () => {
    const seating = { id: 'dinner1', name: '晚餐', start: '17:00', end: '19:00' }
    const settings = { seatings: [seating] }
    const r = resolveSlotOccupancy(tables, [], [], DATE, seating, settings)
    expect(r.summary.totalSeats).toBe(6)
    expect(r.summary.totalTables).toBe(1)
    const r2 = resolveSlotOccupancy(tables, [], [], '2026-06-20', seating, settings)
    expect(r2.summary.totalSeats).toBe(10)
  })
})
