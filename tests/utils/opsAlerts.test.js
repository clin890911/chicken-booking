import { describe, it, expect } from 'vitest'
import { pickOpsAlerts, computeStoreStats, phaseLine } from '../../src/utils/opsAlerts'

const NOW = new Date(2026, 9, 10, 19, 0).getTime()
const iso = (h, m = 0) => new Date(2026, 9, 10, h, m).toISOString()
const empty = { overdue: [], soon: [], later: [] }
const settings = { diningDurationMin: 90, cleanupBufferMin: 10 }

describe('pickOpsAlerts：只列需要處理且非 0 的項目', () => {
  it('全部是 0 → 空陣列（整條提示不渲染）', () => {
    expect(pickOpsAlerts({ pulse: empty, tables: [{ number: '101', status: 'vacant' }], settings, waitlist: [{ status: 'seated' }], now: NOW })).toEqual([])
  })
  it('待清：open-table，桌號＝最早變待清的（updatedAt 最舊）', () => {
    const tables = [
      { number: '105', status: 'cleaning', updatedAt: iso(18, 50) },
      { number: '203', status: 'cleaning', updatedAt: iso(18, 20) },
    ]
    const [a] = pickOpsAlerts({ pulse: empty, tables, settings, waitlist: [], now: NOW })
    expect(a).toMatchObject({ key: 'cleaning', label: '待清', count: 2, unit: '桌', action: 'open-table', tableNumber: '203' })
  })
  it('超時：open-table，桌號＝坐最久的；剛入座不算', () => {
    const tables = [
      { number: '106', status: 'dining', seatedAt: iso(16, 30) },
      { number: '107', status: 'dining', seatedAt: iso(16, 0) },
      { number: '108', status: 'dining', seatedAt: iso(18, 40) },
    ]
    const [a] = pickOpsAlerts({ pulse: empty, tables, settings, waitlist: [], now: NOW })
    expect(a).toMatchObject({ key: 'overtime', count: 2, tableNumber: '107' })
  })
  it('將到／過時未到帶人數、點了開今日訂位；候位只算 waiting＋called', () => {
    const pulse = { overdue: [{ guests: 2 }], soon: [{ guests: 4 }, { guests: 6 }], later: [{ guests: 9 }] }
    const waitlist = [{ status: 'waiting', partySize: 4 }, { status: 'called', partySize: 3 }, { status: 'left', partySize: 8 }]
    const list = pickOpsAlerts({ pulse, tables: [], settings, waitlist, now: NOW })
    expect(list.map(a => a.key)).toEqual(['overdue', 'soon', 'waitlist'])
    expect(list[0]).toMatchObject({ count: 1, people: 2, action: 'open-upcoming' })
    expect(list[1]).toMatchObject({ count: 2, people: 10, action: 'open-upcoming' })
    expect(list[2]).toMatchObject({ count: 2, people: 7, action: 'open-waitlist' })
  })
})

describe('computeStoreStats：全店數字', () => {
  it('可入座與可坐人數走 canSeatNow（與樓層鈕同口徑）；大組併桌在席人數只算一次', () => {
    const tables = [
      { number: '101', capacity: 6, status: 'vacant', isActive: true },
      { number: '102', capacity: 4, status: 'vacant', isActive: true },
      { number: '103', capacity: 6, status: 'dining', currentBookingId: 'B', seatedAt: iso(18), isActive: true },
      { number: '104', capacity: 6, status: 'dining', currentBookingId: 'B', seatedAt: iso(18), isActive: true },
      { number: '105', capacity: 4, status: 'cleaning', isActive: true },
    ]
    const bookings = [{ id: 'B', guests: 11, status: 'arrived', assignedTableId: '103', extraTableIds: ['104'] }]
    const st = computeStoreStats({ tables, bookings, waitlist: [{ status: 'waiting', partySize: 2 }], tablePresentation: { 101: { canSeatNow: true }, 102: { canSeatNow: false } }, pulse: { overdue: [], soon: [{}], later: [] }, today: '2026-10-10' })
    expect(st).toMatchObject({ vacant: 1, vacantSeats: 6, dining: 2, occSeats: 11, cleaning: 1, waitlist: 1, waitlistPeople: 2, soon: 1 })
  })
})

describe('phaseLine：一天節奏單句（移到摘要分頁）', () => {
  it('營業中帶場次名與剩餘訂位', () => {
    const s = { seatings: [{ name: '晚餐', start: '17:00', end: '21:00' }] }
    expect(phaseLine({ settings: s, now: NOW, pulse: { soon: [{}], later: [{}, {}] }, groups: [] })).toBe('晚餐 · 今日還有 3 組訂位')
  })
})

describe('seatableNowTables：「可入座／可坐」唯一口徑', () => {
  it('有桌況字典走 canSeatNow；可依樓層篩；兩層相加＝全店 computeStoreStats.vacant', async () => {
    const { seatableNowTables, isSeatableNow } = await import('../../src/utils/opsAlerts')
    const { buildOpsTablePresentation } = await import('../../src/utils/opsTablePresentation')
    const { INITIAL_TABLES } = await import('../../src/data/tables')
    // 用出廠 52 桌，混入各種狀態：用餐、待清、停用、維修、時段衝突（30 分內有下一組）
    const tables = INITIAL_TABLES.map((t, i) => ({ ...t,
      status: i % 7 === 0 ? 'dining' : i % 11 === 0 ? 'cleaning' : 'vacant',
      isActive: i % 13 !== 5,
      seatedAt: i % 7 === 0 ? iso(18) : undefined,
    }))
    const bookings = tables.filter((t, i) => t.status === 'vacant' && i % 5 === 0)
      .map((t, i) => ({ id: `N${i}`, guests: 2, status: 'confirmed', date: '2026-10-10', timeSlot: '19:15', assignedTableId: t.number }))
    const presentation = buildOpsTablePresentation({ tables, bookings, settings, date: '2026-10-10', now: NOW })
    const floors = [...new Set(tables.map(t => t.floor))]
    expect(floors.sort()).toEqual(['1F', '2F']) // 樓層只有兩層，相加才會等於全店
    const f1 = seatableNowTables(tables, presentation, { floor: '1F' }).length
    const f2 = seatableNowTables(tables, presentation, { floor: '2F' }).length
    const st = computeStoreStats({ tables, bookings, waitlist: [], tablePresentation: presentation, pulse: empty, today: '2026-10-10' })
    expect(f1 + f2).toBe(st.vacant)
    expect(st.vacant).toBeGreaterThan(0)
    // 時段衝突的空桌不算
    const conflict = tables.find(t => t.number === bookings[0].assignedTableId)
    expect(isSeatableNow(conflict, presentation)).toBe(false)
  })
  it('沒有桌況字典：退回 vacant 且今日可用', async () => {
    const { seatableNowTables } = await import('../../src/utils/opsAlerts')
    const tables = [{ number: '1', status: 'vacant', isActive: true }, { number: '2', status: 'vacant', isActive: false }, { number: '3', status: 'dining', isActive: true }]
    expect(seatableNowTables(tables, null, { today: '2026-10-10' }).map(t => t.number)).toEqual(['1'])
  })
})

describe('pickOpsAlerts：無障礙名稱', () => {
  it('aria-label 先講幾件、再講點了去哪', () => {
    const tables = [{ number: '107', status: 'dining', seatedAt: iso(16, 0) }, { number: '203', status: 'cleaning', updatedAt: iso(18) }]
    const list = pickOpsAlerts({ pulse: { overdue: [], soon: [{ guests: 2 }], later: [] }, tables, settings, waitlist: [{ status: 'waiting', partySize: 2 }], now: NOW })
    expect(list.map(a => a.ariaLabel)).toEqual([
      '超時 1 桌，點擊開啟 107',
      '將到 1 組（90 分內），點擊開啟今日訂位',
      '待清 1 桌，點擊開啟 203',
      '候位 1 組，點擊開啟候位',
    ])
  })
})
