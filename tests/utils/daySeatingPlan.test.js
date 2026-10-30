import {
  buildDaySeatingList, sectionSummaryText, firstUnassigned, nextUnassigned,
  assignableTables, pickTableError, evaluatePick, walkinState, heldTableNumbers,
} from '../../src/utils/daySeatingPlan'
import { suggestComboFromPool } from '../../src/services/seatingService'

const DATE = '2026-11-02'
const SETTINGS = {
  diningDurationMin: 90, cleanupBufferMin: 10,
  seatings: [
    { id: 'lunch1', name: '午餐第一批', start: '11:00', end: '12:30' },
    { id: 'lunch2', name: '午餐第二批', start: '12:30', end: '14:30' },
    { id: 'dinner1', name: '晚餐第一批', start: '17:00', end: '19:00' },
  ],
  closures: { closedDates: [], closedSlots: {}, closedSeatings: {} },
}
const T = (number, capacity, floor = '1F', extra = {}) => ({ number, capacity, floor, isActive: true, outage: null, x: 0, y: 0, w: 10, h: 10, ...extra })
const TABLES = [
  T('101', 6), T('102', 6), T('105', 4), T('106', 4), T('107', 4), T('113', 4),
  T('201', 6, '2F'), T('202', 6, '2F'),
]
const B = (id, timeSlot, guests, extra = {}) => ({ id, name: id, date: DATE, timeSlot, guests, status: 'confirmed', assignedTableId: null, extraTableIds: [], ...extra })
const seat = (id) => SETTINGS.seatings.find(s => s.id === id)

describe('buildDaySeatingList：當天全部訂位依場次分組', () => {
  const bookings = [
    B('王', '11:00', 4, { assignedTableId: '105' }),
    B('林', '11:30', 11),
    B('陳', '11:30', 2),
    B('取消', '11:30', 4, { status: 'cancelled' }),
    B('未到', '11:30', 4, { status: 'noshow' }),
    B('到了', '12:00', 2, { status: 'arrived', assignedTableId: '106' }),
    B('晚', '18:00', 3),
    { ...B('別天', '11:30', 2), date: '2026-11-03' },
  ]
  const groups = [{ id: 'G1', date: DATE, status: 'confirmed', agencyName: '山水', batches: [{ id: 'b1', label: '第一梯', timeSlot: '11:30', tableNumbers: ['201', '202'], guests: 12 }] }]
  const list = buildDaySeatingList({ bookings, groupReservations: groups, date: DATE, settings: SETTINGS })

  it('取消、未到、別天不列；團體梯次與散客同框', () => {
    const l1 = list.sections.find(s => s.seating.id === 'lunch1')
    expect(l1.items.map(i => i.name)).toEqual(['王', '林', '陳', '山水', '到了'])
    expect(l1.count).toBe(5)
    expect(l1.unassigned).toBe(2) // 只算散客
    expect(list.sections.find(s => s.seating.id === 'dinner1').items.map(i => i.name)).toEqual(['晚'])
  })
  it('每筆狀態：未配桌／已配桌（含桌號）／已到；團體帶圈桌', () => {
    const items = list.sections[0].items
    expect(items.find(i => i.name === '王')).toMatchObject({ state: 'assigned', tables: ['105'] })
    expect(items.find(i => i.name === '林').state).toBe('unassigned')
    expect(items.find(i => i.name === '到了').state).toBe('arrived')
    expect(items.find(i => i.kind === 'group')).toMatchObject({ state: 'assigned', tables: ['201', '202'], guests: 12 })
  })
  it('一行摘要', () => {
    expect(sectionSummaryText(list.sections[0])).toBe('午餐第一批 5 組・未配桌 2')
    expect(sectionSummaryText(list.sections[1])).toBe('午餐第二批 0 組・全部配好')
  })
  it('walkinState：併桌副桌也算已配桌', () => {
    expect(walkinState(B('x', '11:00', 8, { assignedTableId: null, extraTableIds: ['102'] }))).toBe('assigned')
  })
})

describe('smart default：預設選中最早未配桌，排完自動跳下一筆', () => {
  const bookings = [
    B('a', '11:00', 2, { assignedTableId: '105' }),
    B('b', '11:30', 2),
    B('c', '12:00', 2),
    B('d', '13:00', 2),
    B('e', '18:00', 2),
  ]
  const list = buildDaySeatingList({ bookings, date: DATE, settings: SETTINGS })
  it('firstUnassigned＝最早一筆未配桌與其場次', () => {
    expect(firstUnassigned(list)).toEqual({ seatingId: 'lunch1', bookingId: 'b' })
  })
  it('同場次往後 → 下一場次 → 全部配好回 null', () => {
    expect(nextUnassigned(list, 'b')).toEqual({ seatingId: 'lunch1', bookingId: 'c' })
    // 同場次後面沒有了 → 先回頭找同場次前面還沒配的（b），都配好才換下一場次
    expect(nextUnassigned(list, 'c')).toEqual({ seatingId: 'lunch1', bookingId: 'b' })
    const bDone = buildDaySeatingList({ bookings: bookings.map(x => x.id === 'b' ? { ...x, assignedTableId: '101' } : x), date: DATE, settings: SETTINGS })
    expect(nextUnassigned(bDone, 'c')).toEqual({ seatingId: 'lunch2', bookingId: 'd' })
    expect(nextUnassigned(list, 'e')).toEqual({ seatingId: 'lunch1', bookingId: 'b' }) // 繞回前面場次
    const one = buildDaySeatingList({ bookings: [B('z', '11:00', 2)], date: DATE, settings: SETTINGS })
    expect(nextUnassigned(one, 'z')).toBeNull()
  })
  it('都配好了 → 第一個有訂位的場次、不選人', () => {
    const done = buildDaySeatingList({ bookings: [B('x', '18:00', 2, { assignedTableId: '101' })], date: DATE, settings: SETTINGS })
    expect(firstUnassigned(done)).toEqual({ seatingId: 'dinner1', bookingId: null })
  })
})

describe('assignableTables：沿用佔用口徑的可選桌', () => {
  it('同場次已配、團保、停用／維修桌都不可選；自己的舊桌（改桌）可選', () => {
    const me = B('me', '11:30', 4, { assignedTableId: '106' })
    const bookings = [me, B('o', '11:00', 4, { assignedTableId: '105' })]
    const groups = [{ id: 'G', date: DATE, status: 'confirmed', batches: [{ id: 'x', timeSlot: '11:30', tableNumbers: ['201'] }] }]
    const tables = TABLES.map(t => t.number === '113' ? { ...t, outage: { from: DATE, to: DATE, reason: '修' } } : t.number === '102' ? { ...t, isActive: false } : t)
    const { free } = assignableTables({ tables, bookings, groupReservations: groups, date: DATE, seating: seat('lunch1'), settings: SETTINGS, booking: me })
    expect(free).toContain('106')       // 自己的舊桌
    expect(free).not.toContain('105')   // 撞桌（同場次已配）
    expect(free).not.toContain('201')   // 團保
    expect(free).not.toContain('113')   // 維修
    expect(free).not.toContain('102')   // 停用
  })
  it('跨場次：時間重疊走 assignmentWindow（13:00 的預配會擋 11:30 的訂位）', () => {
    const me = B('me', '11:30', 4)
    const bookings = [me, B('late', '13:00', 2, { assignedTableId: '107' }), B('dinner', '18:00', 2, { assignedTableId: '101' })]
    const groups = [{ id: 'G', date: DATE, status: 'confirmed', batches: [{ id: 'x', timeSlot: '12:30', tableNumbers: ['202'] }] }]
    const { free } = assignableTables({ tables: TABLES, bookings, groupReservations: groups, date: DATE, seating: seat('lunch1'), settings: SETTINGS, booking: me })
    expect(free).not.toContain('107') // 13:00–14:40 與 11:30–13:10 重疊
    expect(free).not.toContain('202') // 團體 12:30 梯次重疊
    expect(free).toContain('101')     // 晚餐不重疊
  })
  it('公休日：一張都不能選', () => {
    const me = B('me', '11:30', 4)
    const settings = { ...SETTINGS, closures: { ...SETTINGS.closures, closedDates: [DATE] } }
    expect(assignableTables({ tables: TABLES, bookings: [me], date: DATE, seating: seat('lunch1'), settings, booking: me }).free).toEqual([])
  })
})

describe('pickTableError／evaluatePick：點桌與確認的防呆', () => {
  const me = B('林老師', '11:30', 11)
  const ctx = { tables: TABLES, date: DATE, settings: SETTINGS }
  const free = ['101', '105', '106', '201']

  it('撞桌、停用、時間重疊、跨樓層各有明確訊息', () => {
    expect(pickTableError({ ...ctx, number: '102', free, byTable: { 102: { kind: 'walkin' } } })).toMatch(/已被佔用/)
    const out = TABLES.map(t => t.number === '113' ? { ...t, outage: { from: DATE, to: '', reason: '' } } : t)
    expect(pickTableError({ ...ctx, tables: out, number: '113', free })).toMatch(/停用\/維修/)
    expect(pickTableError({ ...ctx, number: '107', free })).toMatch(/時間重疊/)
    expect(pickTableError({ ...ctx, number: '201', picked: ['101'], free })).toMatch(/同一樓層/)
    expect(pickTableError({ ...ctx, number: '105', picked: ['101'], free })).toBeNull()
  })
  it('公休日點桌也擋', () => {
    const settings = { ...SETTINGS, closures: { ...SETTINGS.closures, closedDates: [DATE] } }
    expect(pickTableError({ ...ctx, settings, number: '101', free })).toMatch(/公休/)
  })
  it('11 人：4 人桌＋6 人桌＝10 席，擠一擠上限 12 → 可確認、標超坐 1 位', () => {
    const ev = evaluatePick({ ...ctx, booking: me, picked: ['105', '101'], free })
    expect(ev).toMatchObject({ ok: true, seats: 10, maxSeats: 12, need: 11, squeezed: true, short: 0 })
  })
  it('席數擠一擠也不夠 → 擋', () => {
    const ev = evaluatePick({ ...ctx, booking: me, picked: ['105', '106'], free })
    expect(ev.ok).toBe(false)
    expect(ev.error).toMatch(/還差 1 位/)
  })
  it('確認前重驗：選的桌已不在可選集合（另一台裝置配走）→ 擋', () => {
    expect(evaluatePick({ ...ctx, booking: me, picked: ['105', '102'], free }).error).toMatch(/已不可用/)
  })
  it('跨樓層、公休、已到、未選桌都擋', () => {
    expect(evaluatePick({ ...ctx, booking: me, picked: ['101', '201'], free: ['101', '201'] }).error).toMatch(/同一樓層/)
    const closed = { ...SETTINGS, closures: { ...SETTINGS.closures, closedDates: [DATE] } }
    expect(evaluatePick({ ...ctx, settings: closed, booking: me, picked: ['101'], free }).error).toMatch(/公休/)
    expect(evaluatePick({ ...ctx, booking: { ...me, status: 'arrived' }, picked: ['101'], free }).ok).toBe(false)
    expect(evaluatePick({ ...ctx, booking: me, picked: [], free }).error).toMatch(/點地圖/)
  })
  it('剛好夠坐不標超坐', () => {
    const ev = evaluatePick({ ...ctx, booking: B('x', '11:30', 10), picked: ['105', '101'], free })
    expect(ev).toMatchObject({ ok: true, squeezed: false })
  })
})

describe('suggestComboFromPool（suggestTableCombo 的純函式核心）', () => {
  it('只從給定桌池挑；原席數夠優先，不夠才擠一擠', () => {
    expect(suggestComboFromPool([T('101', 6), T('105', 4), T('106', 4)], 4)).toMatchObject({ tableNumbers: ['105'], enough: true, squeezed: false })
    const s = suggestComboFromPool([T('101', 6), T('105', 4)], 11)
    expect(s).toMatchObject({ enough: true, squeezed: true, seats: 10, maxSeats: 12 })
    expect([...s.tableNumbers].sort()).toEqual(['101', '105'])
  })
  it('空桌池 → 不夠', () => {
    expect(suggestComboFromPool([], 4)).toMatchObject({ enough: false, tableNumbers: [] })
  })
})

describe('heldTableNumbers：今天已在現場鎖給本筆的桌（這裡不可改桌／取消配桌）', () => {
  it('reserved／dining 且 currentBookingId＝本筆才算；別人持有或空桌＝只是預配', () => {
    const b = B('甲', '11:00', 8, { assignedTableId: '101', extraTableIds: ['102'] })
    expect(heldTableNumbers(b, [T('101', 6, '1F', { status: 'reserved', currentBookingId: '甲' }), T('102', 6, '1F', { status: 'vacant' })])).toEqual(['101'])
    expect(heldTableNumbers(b, [T('101', 6, '1F', { status: 'dining', currentBookingId: '乙' }), T('102', 6)])).toEqual([])
    expect(heldTableNumbers(B('丙', '11:00', 2), TABLES)).toEqual([])
    expect(heldTableNumbers(null, TABLES)).toEqual([])
  })
})
