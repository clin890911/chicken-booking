import { describe, it, expect } from 'vitest'
import {
  sortedBatches,
  todayActiveGroups,
  batchSeated,
  nextBatchForTable,
  buildGroupHolds,
} from '../../src/utils/groupLive'

const mkTable = (number, status = 'vacant', currentRef = null) => ({ number, status, currentRef })
const byNumber = (tables) => {
  const m = {}
  tables.forEach(t => { m[t.number] = t })
  return m
}

const GROUP = {
  id: 'G1',
  date: '2026-06-10',
  agencyName: '快樂旅行社',
  status: 'confirmed',
  batches: [
    { id: 'B2', label: '第二梯', timeSlot: '13:00', tableNumbers: ['101', '102'], guests: 10 },
    { id: 'B1', label: '第一梯', timeSlot: '11:30', tableNumbers: ['101', '102'], guests: 12 },
  ],
}

describe('sortedBatches', () => {
  it('依時段先後排序，不動原陣列', () => {
    const sorted = sortedBatches(GROUP)
    expect(sorted.map(b => b.id)).toEqual(['B1', 'B2'])
    expect(GROUP.batches[0].id).toBe('B2')
  })
  it('時段缺失排最後、空團回空陣列', () => {
    const g = { batches: [{ id: 'X', timeSlot: '' }, { id: 'Y', timeSlot: '12:00' }] }
    expect(sortedBatches(g).map(b => b.id)).toEqual(['Y', 'X'])
    expect(sortedBatches({})).toEqual([])
  })
})

describe('todayActiveGroups', () => {
  it('只留今日、排除已取消，依最早梯次排序', () => {
    const groups = [
      { ...GROUP, id: 'A', batches: [{ id: 'b', timeSlot: '12:30', tableNumbers: [] }] },
      { ...GROUP, id: 'B' },                                  // 最早梯 11:30
      { ...GROUP, id: 'C', status: 'cancelled' },
      { ...GROUP, id: 'D', date: '2026-06-11' },
    ]
    expect(todayActiveGroups(groups, '2026-06-10').map(g => g.id)).toEqual(['B', 'A'])
  })
})

describe('batchSeated', () => {
  const batch = GROUP.batches.find(b => b.id === 'B1')
  it('桌 dining 且 currentRef 指向此梯 → 已入座', () => {
    const tables = byNumber([mkTable('101', 'dining', { type: 'group', groupId: 'G1', batchId: 'B1' })])
    expect(batchSeated(GROUP, batch, tables)).toBe(true)
  })
  it('桌 dining 但 ref 指向別梯 → 未入座', () => {
    const tables = byNumber([mkTable('101', 'dining', { type: 'group', groupId: 'G1', batchId: 'B2' })])
    expect(batchSeated(GROUP, batch, tables)).toBe(false)
  })
  it('桌非 dining（cleaning/vacant）→ 未入座', () => {
    const tables = byNumber([mkTable('101', 'cleaning', { type: 'group', groupId: 'G1', batchId: 'B1' })])
    expect(batchSeated(GROUP, batch, tables)).toBe(false)
  })
})

describe('nextBatchForTable', () => {
  it('離席後（afterBatchId=剛用完的梯）→ 找到下一個圈此桌的未入座梯', () => {
    const tables = byNumber([mkTable('101', 'cleaning', { type: 'group', groupId: 'G1', batchId: 'B1' })])
    const next = nextBatchForTable(GROUP, '101', tables, 'B1')
    expect(next?.id).toBe('B2')
  })
  it('不跳過 afterBatchId 時，第一個未入座梯（含剛用完的）會被選到 → 必須帶 afterBatchId', () => {
    const tables = byNumber([mkTable('101', 'cleaning', { type: 'group', groupId: 'G1', batchId: 'B1' })])
    expect(nextBatchForTable(GROUP, '101', tables)?.id).toBe('B1')
  })
  it('下一梯沒圈此桌 → null', () => {
    const g = {
      ...GROUP,
      batches: [
        { id: 'B1', timeSlot: '11:30', tableNumbers: ['101'] },
        { id: 'B2', timeSlot: '13:00', tableNumbers: ['105'] },
      ],
    }
    expect(nextBatchForTable(g, '101', byNumber([mkTable('101', 'cleaning')]), 'B1')).toBe(null)
  })
  it('下一梯已入座（他桌 dining 指向）→ 跳過為 null', () => {
    const g = {
      ...GROUP,
      batches: [
        { id: 'B1', timeSlot: '11:30', tableNumbers: ['101', '102'] },
        { id: 'B2', timeSlot: '13:00', tableNumbers: ['101', '102'] },
      ],
    }
    const tables = byNumber([
      mkTable('101', 'cleaning', { type: 'group', groupId: 'G1', batchId: 'B1' }),
      mkTable('102', 'dining', { type: 'group', groupId: 'G1', batchId: 'B2' }),
    ])
    expect(nextBatchForTable(g, '101', tables, 'B1')).toBe(null)
  })
  it('已完成/取消的團 → null', () => {
    expect(nextBatchForTable({ ...GROUP, status: 'completed' }, '101', {}, 'B1')).toBe(null)
    expect(nextBatchForTable({ ...GROUP, status: 'cancelled' }, '101', {}, 'B1')).toBe(null)
  })
})

describe('buildGroupHolds', () => {
  it('非 dining 的圈桌都標 hold；holds 只列未入座梯、依時段排序', () => {
    const tables = [mkTable('101'), mkTable('102')]
    const holds = buildGroupHolds([GROUP], tables)
    expect(Object.keys(holds).sort()).toEqual(['101', '102'])
    expect(holds['101'].agencyName).toBe('快樂旅行社')
    expect(holds['101'].holds.map(h => h.batch.id)).toEqual(['B1', 'B2'])
  })
  it('dining 中的桌不標 hold', () => {
    const tables = [
      mkTable('101', 'dining', { type: 'group', groupId: 'G1', batchId: 'B1' }),
      mkTable('102'),
    ]
    const holds = buildGroupHolds([GROUP], tables)
    expect(holds['101']).toBeUndefined()
    // 102 仍 vacant：第一梯已入座（101 dining 指向 B1）→ 只剩 B2 未入座
    expect(holds['102'].holds.map(h => h.batch.id)).toEqual(['B2'])
  })
  it('已完成/取消的團不產生 hold；未圈桌的梯次安全略過', () => {
    expect(buildGroupHolds([{ ...GROUP, status: 'completed' }], [mkTable('101')])).toEqual({})
    expect(buildGroupHolds([{ ...GROUP, status: 'cancelled' }], [mkTable('101')])).toEqual({})
    const g = { ...GROUP, batches: [{ id: 'B1', timeSlot: '11:30' }] }
    expect(buildGroupHolds([g], [mkTable('101')])).toEqual({})
  })
  it('圈到不存在的桌號不爆炸', () => {
    const g = { ...GROUP, batches: [{ id: 'B1', timeSlot: '11:30', tableNumbers: ['999'] }] }
    expect(buildGroupHolds([g], [mkTable('101')])).toEqual({})
  })
})
