// B1 團體整梯入座的 8 秒復原（seatingService.seatGroupBatch 的 undo 快照＋undoSeatGroupBatch）。
// 只在「整梯原本都是空桌」時給快照；接走前梯待清桌的入座不給（倒回要動前梯 currentRef／releasedAt）。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as seating from '../../src/services/seatingService'
import * as tableService from '../../src/services/tableService'
import * as groupService from '../../src/services/groupReservationService'

const TODAY = '2026-11-01'
const mkTable = (number, capacity = 6, over = {}) => ({
  number, capacity, floor: '1F', x: 100, y: 100, w: 80, h: 100,
  isActive: true, outage: null, status: 'vacant', currentBookingId: null, currentRef: null,
  seatedAt: null, mergedWith: null, blockReason: null, updatedAt: null, ...over,
})
const t = (n) => tableService.getByNumber(n)
const oneBatch = (status = 'confirmed') => {
  const g = groupService.create({
    date: TODAY, agencyName: '快樂旅行社', counts: { total: 12 }, status,
    batches: [{ label: '第一梯', timeSlot: '11:30', tableNumbers: ['101', '102'], guests: 12 }],
  })
  return { g, b: g.batches[0].id }
}

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 10, 1, 11, 30))
  tableService.bulkWrite([mkTable('101'), mkTable('102'), mkTable('103'), mkTable('104')])
})
afterEach(() => { vi.useRealTimers() })

describe('seatGroupBatch 復原快照', () => {
  it('整梯原本都是空桌 → 回 undo（團、梯、桌號、入座前團狀態）', () => {
    const { g, b } = oneBatch()
    const before = groupService.getById(g.id).status
    expect(before).not.toBe('arrived')
    const r = seating.seatGroupBatch(g.id, b)
    expect(r).toMatchObject({ ok: true, tableNumbers: ['101', '102'] })
    expect(r.undo).toEqual({ groupId: g.id, batchId: b, tableNumbers: ['101', '102'], prevGroupStatus: before })
  })

  it('接走前梯的待清桌 → 不給 undo（倒回要動前梯資料，不做）', () => {
    const g = groupService.create({
      date: TODAY, agencyName: '快樂旅行社', counts: { total: 22 },
      batches: [
        { label: '第一梯', timeSlot: '11:30', tableNumbers: ['101', '102'], guests: 12 },
        { label: '第二梯', timeSlot: '13:00', tableNumbers: ['101', '102'], guests: 10 },
      ],
    })
    const [b1, b2] = g.batches.map(x => x.id)
    expect(seating.seatGroupBatch(g.id, b1).ok).toBe(true)
    expect(seating.checkoutGroupBatch(g.id, b1).ok).toBe(true)   // 101、102 待清（currentRef 仍是第一梯）
    const r = seating.seatGroupBatch(g.id, b2)
    expect(r.ok).toBe(true)
    expect(r.undo).toBeUndefined()
  })
})

describe('undoSeatGroupBatch', () => {
  it('復原：整梯桌回空桌、團狀態回入座前（已確認）', () => {
    const { g, b } = oneBatch()
    const before = groupService.getById(g.id).status
    const r = seating.seatGroupBatch(g.id, b)
    expect(groupService.getById(g.id).status).toBe('arrived')
    const u = seating.undoSeatGroupBatch(r.undo)
    expect(u).toEqual({ ok: true, tableNumbers: ['101', '102'] })
    for (const n of ['101', '102']) expect(t(n)).toMatchObject({ status: 'vacant', currentRef: null, currentBookingId: null, seatedAt: null })
    expect(groupService.getById(g.id).status).toBe(before)
  })

  it('★ 其中一桌已被換走／離席（不再是本梯用餐中）→ 安全失敗，整梯不動', () => {
    const { g, b } = oneBatch()
    const r = seating.seatGroupBatch(g.id, b)
    expect(seating.checkoutGroupTable('102').ok).toBe(true)   // 102 這桌先離席（待清）
    const u = seating.undoSeatGroupBatch(r.undo)
    expect(u.ok).toBe(false)
    expect(u.error).toContain('102')
    expect(t('101')).toMatchObject({ status: 'dining', currentRef: { groupId: g.id, batchId: b } })
    expect(t('102').status).toBe('cleaning')
    expect(groupService.getById(g.id).status).toBe('arrived')
  })

  it('★ 桌被散客佔走（currentBookingId 指向別組）→ 安全失敗、不清別人的桌', () => {
    const { g, b } = oneBatch()
    const r = seating.seatGroupBatch(g.id, b)
    tableService.setStatus('101', 'dining', { currentBookingId: 'OTHER', currentRef: null })
    const u = seating.undoSeatGroupBatch(r.undo)
    expect(u.ok).toBe(false)
    expect(t('101')).toMatchObject({ status: 'dining', currentBookingId: 'OTHER' })
    expect(t('102')).toMatchObject({ status: 'dining', currentRef: { groupId: g.id, batchId: b } })
  })

  it('別梯仍在用餐（團原本已 arrived）→ 復原只倒本梯的桌，團維持 arrived', () => {
    const g = groupService.create({
      date: TODAY, agencyName: '快樂旅行社', counts: { total: 22 },
      batches: [
        { label: '第一梯', timeSlot: '11:30', tableNumbers: ['101', '102'], guests: 12 },
        { label: '第二梯', timeSlot: '11:30', tableNumbers: ['103', '104'], guests: 10 },
      ],
    })
    const [b1, b2] = g.batches.map(x => x.id)
    expect(seating.seatGroupBatch(g.id, b1).ok).toBe(true)
    const r2 = seating.seatGroupBatch(g.id, b2)
    expect(r2.undo.prevGroupStatus).toBe('arrived')
    expect(seating.undoSeatGroupBatch(r2.undo).ok).toBe(true)
    expect(t('103').status).toBe('vacant')
    expect(t('101').status).toBe('dining')
    expect(groupService.getById(g.id).status).toBe('arrived')
  })

  it('團已整團完成／取消 → 不復原', () => {
    const { g, b } = oneBatch()
    const r = seating.seatGroupBatch(g.id, b)
    groupService.setStatus(g.id, 'cancelled')
    expect(seating.undoSeatGroupBatch(r.undo).ok).toBe(false)
  })
})
