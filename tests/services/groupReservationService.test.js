// 團體預排 service 回歸測試：驗證（空白團單不能儲存）、空白草稿判定、桌位衝突（含一般訂位）
import * as group from '../../src/services/groupReservationService'

const CAP = { '101': 6, '102': 6, '103': 6, '107': 4, '210': 4 }

// 建一個「填好可儲存」的團單物件（不寫入 localStorage，純驗證用）
function validGroup(over = {}) {
  return {
    agencyId: 'AG1', agencyName: '大發旅行社',
    counts: { total: 12 },
    batches: [{ id: 'b1', label: '第一梯', timeSlot: '11:00', tableNumbers: ['101', '102'], guests: 12 }],
    ...over,
  }
}

describe('groupReservationService.validateGroupForSave（空白團單不能儲存）', () => {
  it('完全空白團單 → 擋下（先要求旅行社）', () => {
    const blank = { agencyName: '', counts: { total: 0 }, batches: [{ id: 'b1', label: '第一梯', timeSlot: '11:00', tableNumbers: [], guests: 0 }] }
    expect(group.validateGroupForSave(blank, CAP)).toBeTruthy()
  })

  it('沒有旅行社 → 擋下', () => {
    expect(group.validateGroupForSave(validGroup({ agencyId: null, agencyName: '' }), CAP)).toMatch(/旅行社/)
  })

  it('總人數為 0 → 擋下', () => {
    expect(group.validateGroupForSave(validGroup({ counts: { total: 0 } }), CAP)).toMatch(/總人數/)
  })

  it('某梯人數為 0 → 擋下', () => {
    const g = validGroup({ batches: [{ id: 'b1', label: '第一梯', timeSlot: '11:00', tableNumbers: ['101'], guests: 0 }] })
    expect(group.validateGroupForSave(g, CAP)).toMatch(/人數需大於 0/)
  })

  it('某梯沒有圈桌 → 擋下', () => {
    const g = validGroup({ batches: [{ id: 'b1', label: '第一梯', timeSlot: '11:00', tableNumbers: [], guests: 12 }] })
    expect(group.validateGroupForSave(g, CAP)).toMatch(/至少圈一桌/)
  })

  it('單梯人數超過該梯保留席數 → 擋下', () => {
    const g = validGroup({ counts: { total: 8 }, batches: [{ id: 'b1', label: '第一梯', timeSlot: '11:00', tableNumbers: ['107'], guests: 8 }] }) // 107=4 席
    expect(group.validateGroupForSave(g, CAP)).toMatch(/超過該梯保留席數/)
  })

  it('單梯總人數超過保留席數 → 擋下', () => {
    const g = validGroup({ counts: { total: 20 }, batches: [{ id: 'b1', label: '第一梯', timeSlot: '11:00', tableNumbers: ['101', '102'], guests: 12 }] }) // held=12, total=20
    expect(group.validateGroupForSave(g, CAP)).toMatch(/超過保留席數/)
  })

  it('填好的單梯團單 → 通過（回 null）', () => {
    expect(group.validateGroupForSave(validGroup(), CAP)).toBeNull()
  })

  it('兩段用餐（多梯）總人數大於保留席數仍允許（輪替）→ 通過', () => {
    const g = validGroup({
      counts: { total: 20 },
      batches: [
        { id: 'b1', label: '第一梯', timeSlot: '11:00', tableNumbers: ['101', '102'], guests: 12 },
        { id: 'b2', label: '第二梯', timeSlot: '12:30', tableNumbers: ['101', '102'], guests: 8 },
      ],
    })
    expect(group.validateGroupForSave(g, CAP)).toBeNull()
  })
})

describe('groupReservationService.isBlankGroup', () => {
  it('全空 → true', () => {
    expect(group.isBlankGroup({ agencyId: null, agencyName: '', counts: { total: 0 }, batches: [] })).toBe(true)
  })
  it('有旅行社 → false', () => {
    expect(group.isBlankGroup({ agencyName: '大發', counts: { total: 0 }, batches: [] })).toBe(false)
  })
  it('有總人數 → false', () => {
    expect(group.isBlankGroup({ agencyName: '', counts: { total: 5 }, batches: [] })).toBe(false)
  })
  it('有圈桌 → false', () => {
    expect(group.isBlankGroup({ agencyName: '', counts: { total: 0 }, batches: [{ tableNumbers: ['101'] }] })).toBe(false)
  })
})

describe('groupReservationService.tableConflictsForBatch（含一般訂位）', () => {
  const D = '2026-12-01'
  beforeEach(() => {
    // A 團：11:00 佔 101
    group.create({ date: D, agencyName: 'A團', status: 'confirmed', counts: { total: 6 }, batches: [{ label: '第一梯', timeSlot: '11:00', tableNumbers: ['101'], guests: 6 }] })
  })

  it('他團同時段同桌 → 衝突', () => {
    const c = group.tableConflictsForBatch({ date: D, timeSlot: '11:00', excludeGroupId: 'OTHER' })
    expect(c['101']?.type).toBe('group')
  })

  it('時間窗不重疊（18:00）→ 不衝突，可重用', () => {
    const c = group.tableConflictsForBatch({ date: D, timeSlot: '18:00', excludeGroupId: 'OTHER' })
    expect(c['101']).toBeUndefined()
  })

  it('一般訂位已指派桌、時段重疊 → 衝突（type=booking）', () => {
    const bookings = [{ id: 'B1', date: D, timeSlot: '11:30', assignedTableId: '102', status: 'confirmed' }]
    const c = group.tableConflictsForBatch({ date: D, timeSlot: '11:00', excludeGroupId: 'OTHER', bookings })
    expect(c['102']?.type).toBe('booking')
  })

  it('一般訂位已取消 → 不算衝突', () => {
    const bookings = [{ id: 'B2', date: D, timeSlot: '11:30', assignedTableId: '103', status: 'cancelled' }]
    const c = group.tableConflictsForBatch({ date: D, timeSlot: '11:00', excludeGroupId: 'OTHER', bookings })
    expect(c['103']).toBeUndefined()
  })

  it('排除本團（excludeGroupId）→ 自己不算衝突', () => {
    const a = group.listByDate(D)[0]
    const c = group.tableConflictsForBatch({ date: D, timeSlot: '11:00', excludeGroupId: a.id })
    expect(c['101']).toBeUndefined()
  })
})
