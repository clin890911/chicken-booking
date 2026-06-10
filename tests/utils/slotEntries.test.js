// 測試：訂位頁「散客 + 團體梯次」混合清單純函式。對應 src/utils/slotEntries.js。
import { describe, it, expect } from 'vitest'
import { mergeDayEntries, summarizeDayGroups } from '../../src/utils/slotEntries'

const DATE = '2026-06-09'

function mkBooking(over = {}) {
  return { id: 'b1', date: DATE, timeSlot: '11:00', guests: 2, status: 'confirmed', name: '客', ...over }
}
function mkGroup(over = {}) {
  const { batches, counts, ...rest } = over
  return {
    id: 'g1', date: DATE, status: 'confirmed', agencyName: '幸福旅行社',
    counts: { total: 0, ...(counts || {}) },
    batches: batches || [],
    ...rest,
  }
}

describe('mergeDayEntries', () => {
  it('散客與團體梯次依 timeSlot 分桶並排序', () => {
    const bookings = [
      mkBooking({ id: 'b1', timeSlot: '12:00' }),
      mkBooking({ id: 'b2', timeSlot: '11:00' }),
    ]
    const groups = [mkGroup({
      batches: [
        { id: 'bt1', label: '第一梯', timeSlot: '11:30', tableNumbers: ['101'], guests: 10 },
        { id: 'bt2', label: '第二梯', timeSlot: '13:00', tableNumbers: ['101'], guests: 8 },
      ],
    })]
    const out = mergeDayEntries(bookings, groups, DATE)
    expect(out.map(e => e.slot)).toEqual(['11:00', '11:30', '12:00', '13:00'])
    expect(out[0].bookings.map(b => b.id)).toEqual(['b2'])
    expect(out[1].groupBatches[0].batch.id).toBe('bt1')
    expect(out[2].bookings.map(b => b.id)).toEqual(['b1'])
    expect(out[3].groupBatches[0].batch.id).toBe('bt2')
  })

  it('同時段散客與團體同框', () => {
    const out = mergeDayEntries(
      [mkBooking({ timeSlot: '11:30' })],
      [mkGroup({ batches: [{ id: 'bt1', timeSlot: '11:30', tableNumbers: [], guests: 10 }] })],
      DATE,
    )
    expect(out).toHaveLength(1)
    expect(out[0].bookings).toHaveLength(1)
    expect(out[0].groupBatches).toHaveLength(1)
  })

  it('排除 cancelled 團體與他日資料；純團體時段也產生條目', () => {
    const out = mergeDayEntries(
      [mkBooking({ date: '2026-06-10' })],
      [
        mkGroup({ id: 'g1', batches: [{ id: 'bt1', timeSlot: '11:00', guests: 10 }] }),
        mkGroup({ id: 'g2', status: 'cancelled', batches: [{ id: 'bt2', timeSlot: '12:00', guests: 4 }] }),
        mkGroup({ id: 'g3', date: '2026-06-10', batches: [{ id: 'bt3', timeSlot: '13:00', guests: 4 }] }),
      ],
      DATE,
    )
    expect(out).toHaveLength(1)
    expect(out[0].slot).toBe('11:00')
    expect(out[0].bookings).toEqual([])
    expect(out[0].groupBatches[0].group.id).toBe('g1')
  })

  it('completed 團體仍可見（當天回顧用餐狀況）', () => {
    const out = mergeDayEntries([], [mkGroup({ status: 'completed', batches: [{ id: 'bt1', timeSlot: '11:00', guests: 10 }] })], DATE)
    expect(out).toHaveLength(1)
  })

  it('空輸入安全', () => {
    expect(mergeDayEntries(undefined, undefined, DATE)).toEqual([])
  })
})

describe('summarizeDayGroups', () => {
  it('排除取消、跨梯次同團只計一次', () => {
    const groups = [
      mkGroup({ id: 'g1', counts: { total: 22 }, batches: [
        { id: 'bt1', timeSlot: '11:00', guests: 12 },
        { id: 'bt2', timeSlot: '13:00', guests: 10 },
      ] }),
      mkGroup({ id: 'g2', counts: { total: 8 }, batches: [{ id: 'bt3', timeSlot: '12:00', guests: 8 }] }),
      mkGroup({ id: 'g3', status: 'cancelled', counts: { total: 99 } }),
      mkGroup({ id: 'g4', date: '2026-06-10', counts: { total: 50 } }),
    ]
    expect(summarizeDayGroups(groups, DATE)).toEqual({ groupCount: 2, guests: 30 })
  })

  it('空輸入安全', () => {
    expect(summarizeDayGroups(undefined, DATE)).toEqual({ groupCount: 0, guests: 0 })
  })
})
