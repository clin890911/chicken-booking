import { describe, it, expect } from 'vitest'
import { bookingOccupiedTables, findGroupTableConflicts } from '../../functions/lib/groupTableConflicts.js'

// groupReserveTables 交易內的撞桌把關（functions/lib/groupTableConflicts.js）。
// 重點：散客大組併桌的副桌 extraTableIds 也是佔用桌，團體不可圈走（否則同桌超賣）。

const DURATION = 120
const groupWith = (timeSlot, tableNumbers) => ({ id: 'G1', batches: [{ label: '第一梯', timeSlot, tableNumbers }] })

describe('bookingOccupiedTables', () => {
  it('主桌＋副桌、去重去空、轉字串', () => {
    expect(bookingOccupiedTables({ assignedTableId: 105, extraTableIds: ['106', 105, null, ''] })).toEqual(['105', '106'])
  })
  it('沒有 extraTableIds 或非陣列 → 只有主桌', () => {
    expect(bookingOccupiedTables({ assignedTableId: '101' })).toEqual(['101'])
    expect(bookingOccupiedTables({ assignedTableId: '101', extraTableIds: 'x' })).toEqual(['101'])
  })
  it('完全沒桌 → 空陣列', () => {
    expect(bookingOccupiedTables({})).toEqual([])
    expect(bookingOccupiedTables(null)).toEqual([])
  })
})

describe('findGroupTableConflicts', () => {
  const bigParty = { id: 'B1', timeSlot: '11:30', assignedTableId: '105', extraTableIds: ['106'] }

  it('圈到散客併桌的副桌、時段重疊 → 衝突（withBookingId）', () => {
    const c = findGroupTableConflicts({ group: groupWith('11:00', ['106']), bookings: [bigParty], durationMin: DURATION })
    expect(c).toEqual([{ table: '106', withBookingId: 'B1', batch: '第一梯' }])
  })

  it('圈到散客主桌 → 衝突（既有行為不變）', () => {
    const c = findGroupTableConflicts({ group: groupWith('11:00', ['105']), bookings: [bigParty], durationMin: DURATION })
    expect(c.map(x => x.table)).toEqual(['105'])
  })

  it('副桌但時間窗不重疊 → 可圈', () => {
    const c = findGroupTableConflicts({ group: groupWith('18:00', ['106']), bookings: [bigParty], durationMin: DURATION })
    expect(c).toEqual([])
  })

  it('邊界：前一組結束時刻剛好是下一組開始 → 不重疊', () => {
    const c = findGroupTableConflicts({ group: groupWith('13:30', ['106']), bookings: [bigParty], durationMin: DURATION })
    expect(c).toEqual([])
  })

  it('訂位無時段 → 跳過（避免 0 分窗誤判）', () => {
    const c = findGroupTableConflicts({ group: groupWith('11:00', ['106']), bookings: [{ ...bigParty, timeSlot: '' }], durationMin: DURATION })
    expect(c).toEqual([])
  })

  it('只有副桌沒有主桌的資料也照擋', () => {
    const c = findGroupTableConflicts({ group: groupWith('11:00', ['106']), bookings: [{ id: 'B2', timeSlot: '11:00', extraTableIds: ['106'] }], durationMin: DURATION })
    expect(c.map(x => x.table)).toEqual(['106'])
  })

  it('與其他團同桌同時段 → 衝突（既有行為不變）', () => {
    const other = { id: 'G2', agencyName: '甲旅行社', batches: [{ timeSlot: '11:30', tableNumbers: ['201'] }] }
    const c = findGroupTableConflicts({ group: groupWith('11:00', ['201']), otherGroups: [other], durationMin: DURATION })
    expect(c).toEqual([{ table: '201', withGroupId: 'G2', withAgency: '甲旅行社', batch: '第一梯' }])
  })

  it('未圈桌的梯次 → 不檢查', () => {
    const c = findGroupTableConflicts({ group: groupWith('11:00', []), bookings: [bigParty], durationMin: DURATION })
    expect(c).toEqual([])
  })
})
