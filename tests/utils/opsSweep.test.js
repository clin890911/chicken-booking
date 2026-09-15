import { describe, it, expect } from 'vitest'
import {
  computeOvertimeActions, computeDayRolloverActions,
  canRunSweeps, filterSweepActionsByPermission, deferUntilCloudPulled,
  KNOWN_SWEEP_ACTIONS, SWEEP_ACTION_PERMISSION,
} from '../../src/utils/opsSweep'

const NOW = new Date(2026, 5, 10, 18, 0, 0, 0).getTime()
const TODAY = '2026-06-10'
const minAgo = (m) => new Date(NOW - m * 60000).toISOString()
const mkT = (number, overrides = {}) => ({
  number, capacity: 4, isActive: true, status: 'vacant',
  currentBookingId: null, currentRef: null, seatedAt: null, ...overrides,
})

describe('computeOvertimeActions（超時釋桌）', () => {
  const settings = { autoReleaseEnabled: true, autoReleaseAfterMin: 300 }

  it('散客桌 301 分 → finalize-booking；299 分 → 不動（邊界）', () => {
    const tables = [
      mkT('101', { status: 'dining', currentBookingId: 'B1', seatedAt: minAgo(301) }),
      mkT('102', { status: 'dining', currentBookingId: 'B2', seatedAt: minAgo(299) }),
    ]
    const acts = computeOvertimeActions({ tables, settings, now: NOW })
    expect(acts).toEqual([
      { type: 'finalize-booking', bookingId: 'B1', tableNumber: '101', minutes: 301 },
    ])
  })

  it('團體桌超時 → 只做 checkout-group-table（保留接梯），不產生 clear/complete-group', () => {
    const tables = [
      mkT('105', { status: 'dining', currentRef: { type: 'group', groupId: 'G1', batchId: 'BT1' }, seatedAt: minAgo(400) }),
    ]
    const acts = computeOvertimeActions({ tables, settings, now: NOW })
    expect(acts).toEqual([
      { type: 'checkout-group-table', tableNumber: '105', groupId: 'G1', batchId: 'BT1', minutes: 400 },
    ])
  })

  it('孤兒 dining（無 booking 無 group）→ clear-table', () => {
    const tables = [mkT('108', { status: 'dining', seatedAt: minAgo(400) })]
    const acts = computeOvertimeActions({ tables, settings, now: NOW })
    expect(acts[0].type).toBe('clear-table')
  })

  it('關閉開關 → 空；reserved/cleaning/blocked 不動；停用但用餐中的桌「照掃」（殭屍桌防線）', () => {
    const tables = [
      mkT('101', { status: 'dining', currentBookingId: 'B1', seatedAt: minAgo(400) }),
      mkT('102', { status: 'reserved' }),
      mkT('103', { status: 'cleaning' }),
      mkT('104', { status: 'blocked' }),
      // 停用/維修中但仍在用餐（同步進來的不一致狀態）：必須被掃到，否則永遠不會釋出
      mkT('105', { status: 'dining', isActive: false, seatedAt: minAgo(400) }),
    ]
    expect(computeOvertimeActions({ tables, settings: { ...settings, autoReleaseEnabled: false }, now: NOW })).toEqual([])
    const acts = computeOvertimeActions({ tables, settings, now: NOW })
    expect(acts.map(a => a.tableNumber)).toEqual(['101', '105'])
  })
})

describe('computeDayRolloverActions（換日掃除）', () => {
  const settings = { dayRolloverEnabled: true, autoNoshowOnRollover: false }

  it('昨日散客桌（arrived）→ complete-booking + clear-table；今日資料零誤殺', () => {
    const tables = [
      mkT('101', { status: 'dining', currentBookingId: 'B-old', seatedAt: '2026-06-09T19:00:00.000Z' }),
      mkT('102', { status: 'dining', currentBookingId: 'B-today', seatedAt: minAgo(60) }),
    ]
    const bookings = [
      { id: 'B-old', date: '2026-06-09', status: 'arrived' },
      { id: 'B-today', date: TODAY, status: 'arrived' },
    ]
    const acts = computeDayRolloverActions({ tables, bookings, groupReservations: [], settings, today: TODAY })
    expect(acts).toEqual([
      { type: 'complete-booking', bookingId: 'B-old', tableNumber: '101' },
      { type: 'clear-table', tableNumber: '101', reason: 'stale-day' },
    ])
  })

  it('昨日 arrived 團 → complete-group；昨日 confirmed/planned 團不動（留給人判斷）', () => {
    const groups = [
      { id: 'G-arr', date: '2026-06-09', status: 'arrived' },
      { id: 'G-conf', date: '2026-06-09', status: 'confirmed' },
      { id: 'G-plan', date: '2026-06-09', status: 'planned' },
      { id: 'G-today', date: TODAY, status: 'arrived' },
    ]
    const acts = computeDayRolloverActions({ tables: [], bookings: [], groupReservations: groups, settings, today: TODAY })
    expect(acts).toEqual([{ type: 'complete-group', groupId: 'G-arr' }])
  })

  it('昨日殘留 cleaning/reserved 桌也清；無連結資料時以 seatedAt 日期判斷', () => {
    const tables = [
      mkT('103', { status: 'cleaning', currentRef: { type: 'group', groupId: 'G1' } }),
      mkT('104', { status: 'reserved', seatedAt: '2026-06-09T12:00:00.000Z' }),
    ]
    const groups = [{ id: 'G1', date: '2026-06-09', status: 'arrived' }]
    const acts = computeDayRolloverActions({ tables, bookings: [], groupReservations: groups, settings, today: TODAY })
    expect(acts.filter(a => a.type === 'clear-table').map(a => a.tableNumber)).toEqual(['103', '104'])
  })

  it('autoNoshowOnRollover：關 → 不產生；開 → 昨日 confirmed 訂位標 noshow', () => {
    const bookings = [
      { id: 'B1', date: '2026-06-09', status: 'confirmed' },
      { id: 'B2', date: TODAY, status: 'confirmed' },
    ]
    const off = computeDayRolloverActions({ tables: [], bookings, groupReservations: [], settings, today: TODAY })
    expect(off.some(a => a.type === 'mark-noshow-auto')).toBe(false)
    const on = computeDayRolloverActions({
      tables: [], bookings, groupReservations: [],
      settings: { ...settings, autoNoshowOnRollover: true }, today: TODAY,
    })
    expect(on).toEqual([{ type: 'mark-noshow-auto', bookingId: 'B1' }])
  })

  it('dayRolloverEnabled 關 → 空', () => {
    const acts = computeDayRolloverActions({
      tables: [mkT('101', { status: 'dining', seatedAt: '2026-06-09T12:00:00.000Z' })],
      bookings: [], groupReservations: [],
      settings: { dayRolloverEnabled: false }, today: TODAY,
    })
    expect(acts).toEqual([])
  })
})

describe('computeDayRolloverActions — 換日結候位（leave-waitlist-auto）', () => {
  const settings = { dayRolloverEnabled: true }
  const ROLLOVER_TODAY = '2026-09-15'
  const mkW = (id, overrides = {}) => ({ id, queueNumber: 1, name: '測試客', status: 'waiting', ...overrides })

  it('本地取號日早於 today 且 waiting/called → 挑出；今日/seated/left/缺 takenAt → 不挑', () => {
    const waitlist = [
      mkW('W1', { takenAt: new Date(2026, 8, 14, 23, 30).toISOString(), status: 'waiting', queueNumber: 3, name: '林小姐' }), // 昨日 23:30 本地
      mkW('W2', { takenAt: new Date(2026, 8, 15, 7, 30).toISOString(), status: 'waiting' }),  // 今日 07:30 本地 → 不挑
      mkW('W3', { takenAt: new Date(2026, 8, 14, 10, 0).toISOString(), status: 'seated' }),   // 昨日但已入座 → 不挑
      mkW('W4', { takenAt: new Date(2026, 8, 14, 10, 0).toISOString(), status: 'left' }),     // 昨日但已離開 → 不挑
      mkW('W5', { takenAt: new Date(2026, 8, 14, 10, 0).toISOString(), status: 'called' }),   // 昨日、called → 挑
      mkW('W6', { status: 'waiting', takenAt: undefined }),                                    // 缺 takenAt → 不挑
    ]
    const acts = computeDayRolloverActions({
      tables: [], bookings: [], groupReservations: [], waitlist, settings, today: ROLLOVER_TODAY,
    })
    expect(acts).toEqual([
      { type: 'leave-waitlist-auto', waitlistId: 'W1', queueNumber: 3, name: '林小姐' },
      { type: 'leave-waitlist-auto', waitlistId: 'W5', queueNumber: 1, name: '測試客' },
    ])
  })

  it('dayRolloverEnabled 關 → 空（含候位）', () => {
    const waitlist = [mkW('W1', { takenAt: new Date(2026, 8, 14, 10, 0).toISOString() })]
    const acts = computeDayRolloverActions({
      tables: [], bookings: [], groupReservations: [], waitlist,
      settings: { dayRolloverEnabled: false }, today: ROLLOVER_TODAY,
    })
    expect(acts).toEqual([])
  })
})

// === 掃除的權限政策 ===
// 這組測試守的是一個「使用者零操作就會壞掉」的災難：掃除是自動跑的，
// 若讓無寫入權的角色改到本機資料，後端「任一集合越權即整包 403」會讓該裝置
// 之後的每一次推送全被拒（含帶位、訂位），且不會自癒。
describe('掃除權限政策', () => {
  const permitOf = (perms) => (p) => perms.includes(p)

  const FLOOR = ['booking.update', 'table.update', 'group.update']
  const HOST = ['booking.update', 'table.update', 'group.update']
  const KITCHEN = ['booking.read', 'table.read'] // 唯讀

  it('kitchen（唯讀）不得執行掃除——否則一開機就毒殺整台裝置的同步', () => {
    expect(canRunSweeps(permitOf(KITCHEN))).toBe(false)
  })

  it('floor / host 可以執行掃除', () => {
    expect(canRunSweeps(permitOf(FLOOR))).toBe(true)
    expect(canRunSweeps(permitOf(HOST))).toBe(true)
  })

  it('缺少任一基礎權限就不跑（booking.update 或 table.update 少一個都不行）', () => {
    expect(canRunSweeps(permitOf(['table.update']))).toBe(false)
    expect(canRunSweeps(permitOf(['booking.update']))).toBe(false)
  })

  it('permit 不是函式時放行（無 AuthProvider 的測試/本機模式維持既有行為）', () => {
    expect(canRunSweeps(undefined)).toBe(true)
    expect(canRunSweeps(null)).toBe(true)
  })

  it('complete-group 需要 group.update：無權時濾掉，其餘 action 不受影響', () => {
    const actions = [
      { type: 'clear-table', tableNumber: 101 },
      { type: 'complete-group', groupId: 'g1' },
      { type: 'complete-booking', bookingId: 'b1' },
    ]
    const noGroup = filterSweepActionsByPermission(actions, permitOf(['booking.update', 'table.update']))
    expect(noGroup.map(a => a.type)).toEqual(['clear-table', 'complete-booking'])

    const withGroup = filterSweepActionsByPermission(actions, permitOf(FLOOR))
    expect(withGroup).toHaveLength(3)
  })

  it('permit 不是函式時不過濾任何 action', () => {
    const actions = [{ type: 'complete-group', groupId: 'g1' }]
    expect(filterSweepActionsByPermission(actions, undefined)).toEqual(actions)
  })

  it('leave-waitlist-auto 需要 waitlist.update：無權時濾掉，其餘 action 不受影響', () => {
    const actions = [
      { type: 'clear-table', tableNumber: 101 },
      { type: 'leave-waitlist-auto', waitlistId: 'W1' },
    ]
    const noWaitlistPerm = filterSweepActionsByPermission(actions, permitOf(['booking.update', 'table.update']))
    expect(noWaitlistPerm.map(a => a.type)).toEqual(['clear-table'])

    const withWaitlistPerm = filterSweepActionsByPermission(actions, permitOf([...FLOOR, 'waitlist.update']))
    expect(withWaitlistPerm).toHaveLength(2)
  })

  // 離線開機（20 秒 fallback）時本機候位快照可能停在昨天：別台早已入座的號在這台仍是 waiting，
  // 結成 left 整份推上雲會把 seated 蓋掉。尚未拉雲前只延後候位結號，其餘換日動作照做。
  it('尚未從雲端拉過：延後 leave-waitlist-auto，其餘 action 照常；拉過後全部放行', () => {
    const actions = [
      { type: 'clear-table', tableNumber: 101 },
      { type: 'leave-waitlist-auto', waitlistId: 'W1' },
      { type: 'complete-booking', bookingId: 'b1' },
    ]
    expect(deferUntilCloudPulled(actions, false).map(a => a.type)).toEqual(['clear-table', 'complete-booking'])
    expect(deferUntilCloudPulled(actions, true)).toEqual(actions)
  })
})

// 註冊表完整性：擋「新增了 action 種類卻忘了登記它要寫哪個集合」。
// 這正是本 repo 已經栽過兩次的坑（host 缺 table.update、floor 缺 group.update）——
// 自動跑的寫入撞上無權角色，會讓整台裝置的同步全死且不會自癒。
describe('掃除 action 註冊表完整性', () => {
  it('兩個 compute 函式吐得出來的 action 種類，必須與 KNOWN_SWEEP_ACTIONS 完全一致', () => {
    const produced = new Set()

    // 涵蓋 computeOvertimeActions 的三條分支
    computeOvertimeActions({
      tables: [
        mkT('101', { status: 'dining', currentBookingId: 'B1', seatedAt: minAgo(400) }),
        mkT('105', { status: 'dining', currentRef: { type: 'group', groupId: 'G1', batchId: 'BT1' }, seatedAt: minAgo(400) }),
        mkT('108', { status: 'dining', seatedAt: minAgo(400) }),
      ],
      settings: { autoReleaseEnabled: true, autoReleaseAfterMin: 300 },
      now: NOW,
    }).forEach(a => produced.add(a.type))

    // 涵蓋 computeDayRolloverActions 的全部分支（含 autoNoshowOnRollover 開啟、換日結候位）
    computeDayRolloverActions({
      tables: [mkT('101', { status: 'dining', currentBookingId: 'B-old', seatedAt: '2026-06-09T19:00:00.000Z' })],
      bookings: [
        { id: 'B-old', date: '2026-06-09', status: 'arrived' },
        { id: 'B-conf', date: '2026-06-09', status: 'confirmed' },
      ],
      groupReservations: [{ id: 'G-arr', date: '2026-06-09', status: 'arrived' }],
      waitlist: [{ id: 'W1', queueNumber: 1, name: '測試', status: 'waiting', takenAt: '2026-06-09T10:00:00.000Z' }],
      settings: { dayRolloverEnabled: true, autoNoshowOnRollover: true },
      today: TODAY,
    }).forEach(a => produced.add(a.type))

    expect([...produced].sort()).toEqual([...KNOWN_SWEEP_ACTIONS].sort())
  })

  it('SWEEP_ACTION_PERMISSION 的每個 key 都必須是已知的 action 種類（防止殘留過期項目）', () => {
    Object.keys(SWEEP_ACTION_PERMISSION).forEach(type => {
      expect(KNOWN_SWEEP_ACTIONS).toContain(type)
    })
  })
})
