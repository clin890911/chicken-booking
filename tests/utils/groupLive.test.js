import { describe, it, expect } from 'vitest'
import {
  sortedBatches,
  todayActiveGroups,
  todayGroupsByState,
  batchSeated,
  batchInProgress,
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
  // 2026-11 逐桌離席：第二梯已在 102 接上、101 第一梯才吃完 → 101 清完必須能接第二梯
  //（舊行為「下一梯已在別桌入座就跳過」會讓 101 只剩「清桌完成」，第二梯在 101 永遠接不上）。
  it('下一梯已在別桌入座（逐桌接梯）→ 這桌仍可接該梯', () => {
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
    expect(nextBatchForTable(g, '101', tables, 'B1')?.id).toBe('B2')
  })
  it('這張桌本身已坐著該梯 → 跳過', () => {
    const g = {
      ...GROUP,
      batches: [
        { id: 'B1', timeSlot: '11:30', tableNumbers: ['101'] },
        { id: 'B2', timeSlot: '13:00', tableNumbers: ['101'] },
      ],
    }
    const tables = byNumber([mkTable('101', 'dining', { type: 'group', groupId: 'G1', batchId: 'B2' })])
    expect(nextBatchForTable(g, '101', tables)?.id).toBe('B1')
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

describe('releasedAt（整梯清桌釋出標記，2026-06-12 bug 防回歸）', () => {
  it('buildGroupHolds：已釋出的梯不再 hold 桌（桌況不得畫回「團保」）', () => {
    const g = {
      ...GROUP,
      status: 'arrived',
      batches: [
        { id: 'B1', label: '第一梯', timeSlot: '11:30', tableNumbers: ['101'], guests: 12, releasedAt: '2026-06-10T13:00:00.000Z' },
        { id: 'B2', label: '第二梯', timeSlot: '13:00', tableNumbers: ['102'], guests: 10 },
      ],
    }
    const holds = buildGroupHolds([g], [mkTable('101'), mkTable('102')])
    expect(holds['101']).toBeUndefined()            // 釋出梯的桌完全自由
    expect(holds['102'].holds.map(h => h.batch.id)).toEqual(['B2']) // 未消化的梯照常 hold
  })

  it('nextBatchForTable：已釋出的梯不可再被「接下一梯」選中', () => {
    const g = {
      ...GROUP,
      status: 'arrived',
      batches: [
        { id: 'B1', label: '第一梯', timeSlot: '11:30', tableNumbers: ['101'], guests: 12, releasedAt: '2026-06-10T13:00:00.000Z' },
        { id: 'B2', label: '第二梯', timeSlot: '13:00', tableNumbers: ['101'], guests: 10 },
      ],
    }
    const tables = byNumber([mkTable('101', 'cleaning')])
    // 從頭掃也只會找到未消化的 B2，不會回到已釋出的 B1
    expect(nextBatchForTable(g, '101', tables)?.id).toBe('B2')
  })
})

// S2：逐桌離席／逐桌清桌後，梯次只剩部分桌——只要還有一張桌指向它，它圈的已清空桌不可畫回團保
describe('batchInProgress／buildGroupHolds（逐桌清桌不回團保）', () => {
  const g = {
    ...GROUP,
    status: 'arrived',
    batches: [
      { id: 'B1', label: '第一梯', timeSlot: '11:30', tableNumbers: ['101', '102', '103'], guests: 15 },
      { id: 'B2', label: '第二梯', timeSlot: '13:00', tableNumbers: ['103'], guests: 5 },
    ],
  }
  const b1 = g.batches[0]
  const ref = (batchId) => ({ type: 'group', groupId: 'G1', batchId })

  it('batchInProgress：dining 或 cleaning 指向此梯都算進行中；全空才不算', () => {
    expect(batchInProgress(g, b1, byNumber([mkTable('101', 'dining', ref('B1'))]))).toBe(true)
    expect(batchInProgress(g, b1, byNumber([mkTable('101', 'cleaning', ref('B1'))]))).toBe(true)
    expect(batchInProgress(g, b1, byNumber([mkTable('101', 'dining', ref('B2'))]))).toBe(false)
    expect(batchInProgress(g, b1, byNumber([mkTable('101'), mkTable('102')]))).toBe(false)
  })

  it('第一梯 101 還在吃、102 已清空 → 102 不回團保', () => {
    const holds = buildGroupHolds([g], [mkTable('101', 'dining', ref('B1')), mkTable('102'), mkTable('103', 'cleaning', ref('B1'))])
    // 地圖「團保」只看 holds 非空（FloorMap holdLabel / 抽屜 activeHold 同口徑）
    expect(holds['102']?.holds || []).toEqual([])
  })

  it('只剩待清桌（cleaning）也算進行中 → 已清空的桌不回團保', () => {
    const holds = buildGroupHolds([g], [mkTable('101', 'cleaning', ref('B1')), mkTable('102'), mkTable('103')])
    expect(holds['102']?.holds || []).toEqual([])
    // 反向：103 第二梯也圈了，第二梯尚未開始 → 103 照常是第二梯的團保
    expect(holds['103'].holds.map(h => h.batch.id)).toEqual(['B2'])
  })

  it('反向：下一梯圈同一張桌、尚未開始 → 該桌清空後顯示下一梯團保', () => {
    const holds = buildGroupHolds([g], [mkTable('101', 'dining', ref('B1')), mkTable('102', 'dining', ref('B1')), mkTable('103')])
    expect(holds['103'].holds.map(h => h.batch.id)).toEqual(['B2'])
  })
})
