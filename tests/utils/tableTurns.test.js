import { describe, it, expect } from 'vitest'
import { buildTableTurns, turnInPeriod } from '../../src/utils/tableTurns'

const TODAY = '2026-06-11'

const tables = [
  { number: '101', capacity: 6, floor: '1F', status: 'vacant', currentBookingId: null, currentRef: null, isActive: true, outage: null },
  { number: '102', capacity: 6, floor: '1F', status: 'dining', currentBookingId: 'b-seated', currentRef: null, isActive: true, outage: null },
  { number: '103', capacity: 6, floor: '1F', status: 'dining', currentRef: { groupId: 'g1', batchId: 'ba1' }, currentBookingId: null, isActive: true, outage: null },
]

describe('buildTableTurns — 散客 turns', () => {
  it('依狀態映射：completed=done、confirmed=upcoming、入座中=seated', () => {
    const bookings = [
      { id: 'b-done', date: TODAY, assignedTableId: '101', status: 'completed', timeSlot: '11:30', guests: 4, name: '林' },
      { id: 'b-up', date: TODAY, assignedTableId: '101', status: 'confirmed', timeSlot: '18:00', guests: 6, name: '王' },
      { id: 'b-seated', date: TODAY, assignedTableId: '102', status: 'arrived', timeSlot: '13:00', guests: 5, name: '陳' },
    ]
    const map = buildTableTurns(tables, bookings, [], TODAY)
    expect(map['101'].map(t => t.status)).toEqual(['done', 'upcoming']) // 依時段排序 11:30 → 18:00
    expect(map['101'][0]).toMatchObject({ kind: 'solo', time: '11:30', guests: 4, label: '林' })
    expect(map['102'][0].status).toBe('seated') // 桌 dining 且 currentBookingId 指向此筆
  })

  it('排除：他日、取消、未到、未指派桌的訂位', () => {
    const bookings = [
      { id: 'x1', date: '2026-06-10', assignedTableId: '101', status: 'confirmed', timeSlot: '12:00', guests: 2 },
      { id: 'x2', date: TODAY, assignedTableId: '101', status: 'cancelled', timeSlot: '12:00', guests: 2 },
      { id: 'x3', date: TODAY, assignedTableId: '101', status: 'noshow', timeSlot: '12:00', guests: 2 },
      { id: 'x4', date: TODAY, assignedTableId: null, status: 'confirmed', timeSlot: '12:00', guests: 2 },
    ]
    const map = buildTableTurns(tables, bookings, [], TODAY)
    expect(map['101']).toBeUndefined()
  })

  it('指向不存在桌號的訂位不產生孤兒 turn', () => {
    const bookings = [{ id: 'y1', date: TODAY, assignedTableId: '999', status: 'confirmed', timeSlot: '12:00', guests: 2 }]
    const map = buildTableTurns(tables, bookings, [], TODAY)
    expect(map['999']).toBeUndefined()
  })
})

describe('buildTableTurns — 團體 turns', () => {
  const groupBase = {
    id: 'g1', date: TODAY, agencyName: '大發旅行社',
    batches: [{ id: 'ba1', label: '第一梯', timeSlot: '11:00', tableNumbers: ['103'], guests: 6 }],
  }

  it('已圈桌未入座 = upcoming（團保）', () => {
    const map = buildTableTurns(
      [{ ...tables[0], number: '103', status: 'vacant', currentRef: null }],
      [], [{ ...groupBase, status: 'confirmed' }], TODAY)
    expect(map['103'][0]).toMatchObject({ kind: 'group', status: 'upcoming', label: '大發旅行社', batchLabel: '第一梯' })
  })

  it('桌 dining 且 currentRef 對應此梯 = seated', () => {
    const map = buildTableTurns(tables, [], [{ ...groupBase, status: 'arrived' }], TODAY)
    expect(map['103'][0].status).toBe('seated')
  })

  it('整團完成 = done', () => {
    const map = buildTableTurns(
      [{ ...tables[0], number: '103', status: 'vacant', currentRef: null }],
      [], [{ ...groupBase, status: 'completed' }], TODAY)
    expect(map['103'][0].status).toBe('done')
  })

  it('取消團不產生 turn', () => {
    const map = buildTableTurns(tables, [], [{ ...groupBase, status: 'cancelled' }], TODAY)
    expect(map['103']).toBeUndefined()
  })
})

describe('turnInPeriod — 時段篩選', () => {
  it('午餐 < 16:00、晚餐 >= 16:00、全天皆收', () => {
    const lunch = { time: '12:30' }
    const dinner = { time: '18:00' }
    expect(turnInPeriod(lunch, 'all')).toBe(true)
    expect(turnInPeriod(lunch, 'lunch')).toBe(true)
    expect(turnInPeriod(lunch, 'dinner')).toBe(false)
    expect(turnInPeriod(dinner, 'dinner')).toBe(true)
    expect(turnInPeriod(dinner, 'lunch')).toBe(false)
  })

  it('無時段者只在全天出現', () => {
    const noTime = { time: '' }
    expect(turnInPeriod(noTime, 'all')).toBe(true)
    expect(turnInPeriod(noTime, 'lunch')).toBe(false)
    expect(turnInPeriod(noTime, 'dinner')).toBe(false)
  })
})

describe('buildTableTurns — 整梯清桌釋出（releasedAt）', () => {
  it('已釋出的梯 = done（桌位痕跡清空後仍判定消化完，不回 upcoming）', () => {
    const groupReleased = {
      id: 'g1', date: TODAY, agencyName: '大發旅行社', status: 'arrived',
      batches: [{
        id: 'ba1', label: '第一梯', timeSlot: '11:00', tableNumbers: ['103'], guests: 6,
        releasedAt: '2026-06-15T13:00:00.000Z',
      }],
    }
    const map = buildTableTurns(
      [{ ...tables[0], number: '103', status: 'vacant', currentRef: null }],
      [], [groupReleased], TODAY)
    expect(map['103'][0].status).toBe('done')
  })
})
