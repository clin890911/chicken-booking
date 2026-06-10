import { describe, it, expect } from 'vitest'
import {
  sortedBatches,
  todayActiveGroups,
  todayGroupsByState,
  batchSeated,
  nextBatchForTable,
  buildGroupHolds,
  reseatCandidateTables,
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
  it('只留今日、排除已取消與已完成，依最早梯次排序', () => {
    const groups = [
      { ...GROUP, id: 'A', batches: [{ id: 'b', timeSlot: '12:30', tableNumbers: [] }] },
      { ...GROUP, id: 'B' },                                  // 最早梯 11:30
      { ...GROUP, id: 'C', status: 'cancelled' },
      { ...GROUP, id: 'D', date: '2026-06-11' },
      { ...GROUP, id: 'E', status: 'completed' },             // 已完成不得再列入可操作清單
    ]
    expect(todayActiveGroups(groups, '2026-06-10').map(g => g.id)).toEqual(['B', 'A'])
  })
})

describe('todayGroupsByState（側欄渲染口徑）', () => {
  it('active 與 completed 分開、各依最早梯次排序、排除 cancelled', () => {
    const groups = [
      { ...GROUP, id: 'A', batches: [{ id: 'b', timeSlot: '12:30', tableNumbers: [] }] },
      { ...GROUP, id: 'B' },
      { ...GROUP, id: 'C', status: 'cancelled' },
      { ...GROUP, id: 'E', status: 'completed' },
      { ...GROUP, id: 'F', status: 'completed', batches: [{ id: 'b', timeSlot: '10:00', tableNumbers: [] }] },
    ]
    const r = todayGroupsByState(groups, '2026-06-10')
    expect(r.active.map(g => g.id)).toEqual(['B', 'A'])
    expect(r.completed.map(g => g.id)).toEqual(['F', 'E'])
  })
  it('空清單回兩個空陣列', () => {
    expect(todayGroupsByState([], '2026-06-10')).toEqual({ active: [], completed: [] })
  })
})

describe('reseatCandidateTables（改派桌位候選）', () => {
  const mkT = (number, { status = 'vacant', isActive = true, capacity = 4, floor = '1F' } = {}) =>
    ({ number, status, isActive, capacity, floor })
  const group = { id: 'G1' }
  const batch = { id: 'B1', tableNumbers: ['101', '102'] }
  const fromTable = mkT('101', { capacity: 6, floor: '1F' })

  it('只留啟用中空桌，排除本梯已圈桌與他團 hold；本團 hold 可選', () => {
    const tables = [
      mkT('102'),                          // 本梯已圈 → 排除
      mkT('103', { status: 'dining' }),    // 非空桌 → 排除
      mkT('104', { isActive: false }),     // 停用 → 排除
      mkT('105'),                          // 他團 hold → 排除
      mkT('106'),                          // 本團 hold → 可選
      mkT('107'),                          // 一般空桌 → 可選
    ]
    const holds = {
      105: { holds: [{ group: { id: 'G2' } }] },
      106: { holds: [{ group: { id: 'G1' } }] },
    }
    const r = reseatCandidateTables({ tables, holds, group, batch, fromTable })
    expect(r.map(t => t.number).sort()).toEqual(['106', '107'])
  })

  it('排序：容量最接近原桌 → 同樓層優先 → 桌號', () => {
    const tables = [
      mkT('201', { capacity: 6, floor: '2F' }), // 容量同 6 但異樓層
      mkT('110', { capacity: 4, floor: '1F' }), // 容量差 2
      mkT('103', { capacity: 6, floor: '1F' }), // 容量同 6、同樓層 → 第一
    ]
    const r = reseatCandidateTables({ tables, holds: {}, group, batch, fromTable })
    expect(r.map(t => t.number)).toEqual(['103', '201', '110'])
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
