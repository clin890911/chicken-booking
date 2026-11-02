import { describe, it, expect } from 'vitest'
import { buildTodayTimeline, completedEntries, groupBatchEntries, matchesTimelineQuery, groupStripeColor } from '../../src/utils/todayTimeline'
import { batchLiveState } from '../../src/utils/groupLive'
import { buildOpsDemo } from '../../src/dev/opsDemoSeed'

// 現場「今日」時間清單（方案 A）：散客＋團體梯次同一條時間線、同一套區段口徑。
const TODAY = '2026-11-01'
const NOW = new Date(`${TODAY}T12:00:00+08:00`).getTime()
const iso = (hhmm) => new Date(`${TODAY}T${hhmm}:00+08:00`).toISOString()

const bk = (id, timeSlot, over = {}) => ({ id, name: `客${id}`, phone: '0912000000', guests: 2, date: TODAY, timeSlot, status: 'confirmed', assignedTableId: null, extraTableIds: [], ...over })
const tbl = (number, over = {}) => ({ number, capacity: 6, floor: '1F', status: 'vacant', currentBookingId: null, currentRef: null, seatedAt: null, ...over })
const ref = (groupId, batchId) => ({ type: 'group', groupId, batchId })

const GA = {
  id: 'GA', date: TODAY, agencyName: '尖峰旅行社', guideName: '林導', guidePhone: '0911000111', status: 'arrived',
  counts: { total: 28 },
  batches: [
    { id: 'A2', label: '第二梯', timeSlot: '14:30', tableNumbers: ['210', '211'], guests: 10 },
    { id: 'A1', label: '第一梯', timeSlot: '11:20', tableNumbers: ['201', '203'], guests: 12 },
    { id: 'AE', label: '司領桌', timeSlot: '11:20', tableNumbers: ['207'], guests: 2, isEscort: true },
  ],
}
const GB = {
  id: 'GB', date: TODAY, agencyName: '山城旅遊', guideName: '陳導', guidePhone: '0922000222', status: 'confirmed',
  counts: { total: 11 },
  batches: [{ id: 'B1', label: '第一梯', timeSlot: '12:40', tableNumbers: ['101', '102'], guests: 11 }],
}
const TABLES = [
  tbl('201', { status: 'dining', currentRef: ref('GA', 'A1'), seatedAt: iso('11:20') }),
  tbl('203', { status: 'dining', currentRef: ref('GA', 'A1'), seatedAt: iso('11:21') }),
  tbl('207', { status: 'dining', currentRef: ref('GA', 'AE'), seatedAt: iso('11:20') }),
  tbl('210'), tbl('211'), tbl('101'), tbl('102'),
  tbl('105', { status: 'dining', currentBookingId: 'S1', seatedAt: iso('11:50') }),
]
const keys = (list) => list.map(e => e.key)

describe('buildTodayTimeline', () => {
  it('團體梯次與散客落入同一套區段：進行中→已入座、未入座依時段；司領桌同時段也在已入座', () => {
    const bookings = [
      bk('LATE', '11:30'),                         // 過時未到（> 15 分寬限）
      bk('SOON', '12:30'),
      bk('LATER', '14:00'),
      bk('S1', '11:50', { status: 'arrived', assignedTableId: '105', actualArrivalTime: iso('11:50') }),
      bk('DONE', '11:00', { status: 'completed' }), // 已離席：不列
    ]
    const t = buildTodayTimeline(bookings, [GA, GB], TABLES, NOW, TODAY)
    expect(keys(t.overdue)).toEqual(['LATE'])
    expect(keys(t.soon)).toEqual(['SOON', 'GB:B1'])           // 12:30 散客、12:40 乙團
    expect(keys(t.later)).toEqual(['LATER', 'GA:A2'])          // 14:00 散客、14:30 甲團第二梯
    // 已入座：最近入座的排最前（S1 11:50 → 甲團 11:20 兩梯；同一時間依原順序）
    expect(keys(t.seated)).toEqual(['S1', 'GA:A1', 'GA:AE'])
    expect(t.pendingBatchCount).toBe(2)
  })

  it('梯次 entry：序號只算旅客梯（司領 seq=null）、桌況 dining／cleaning 分開計、seatedAt 取最早', () => {
    const tables = TABLES.map(x => x.number === '203' ? { ...x, status: 'cleaning', seatedAt: null } : x)
    const t = buildTodayTimeline([], [GA], tables, NOW, TODAY)
    const first = t.seated.find(e => e.key === 'GA:A1')
    expect(first).toMatchObject({ seq: 1, seqTotal: 2, isEscort: false, diningTables: ['201'], cleaningTables: ['203'], seatedAt: iso('11:20') })
    expect(t.seated.find(e => e.key === 'GA:AE')).toMatchObject({ seq: null, isEscort: true })
    expect(t.later.find(e => e.key === 'GA:A2')).toMatchObject({ seq: 2, seqTotal: 2, inProgress: false })
  })

  it('只剩待清桌的梯仍在已入座；已釋出（releasedAt）的梯不列；已完成／已取消／非今日的團不列', () => {
    const released = { ...GA, batches: GA.batches.map(b => b.id === 'A1' ? { ...b, releasedAt: iso('11:59') } : b) }
    const tables = TABLES.map(x => ['201', '203'].includes(x.number) ? tbl(x.number) : x)
    const t = buildTodayTimeline([], [released, { ...GB, status: 'completed' }, { ...GB, id: 'GC', status: 'cancelled' }, { ...GB, id: 'GD', date: '2026-11-02' }], tables, NOW, TODAY)
    expect(keys([...t.overdue, ...t.soon, ...t.later, ...t.seated]).sort()).toEqual(['GA:A2', 'GA:AE'])

    const cleaningOnly = TABLES.map(x => x.number === '201' || x.number === '203' ? { ...x, status: 'cleaning' } : x)
    expect(keys(buildTodayTimeline([], [GA], cleaningOnly, NOW, TODAY).seated)).toContain('GA:A1')
  })

  it('以桌況為準：換桌後 currentRef 指向本梯的新桌也算進桌號', () => {
    const tables = [...TABLES, tbl('205', { status: 'dining', currentRef: ref('GA', 'A1'), seatedAt: iso('11:30') })]
    const first = groupBatchEntries([GA], tables, TODAY).find(e => e.key === 'GA:A1')
    expect(first.tableNumbers).toEqual(['201', '203', '205'])
    expect(first.diningTables).toHaveLength(3)
  })

  it('團體梯過時未到（> 15 分）同散客進 overdue，依過時長短排', () => {
    const late = { ...GB, batches: [{ ...GB.batches[0], timeSlot: '11:00' }] }
    const t = buildTodayTimeline([bk('X', '11:40')], [late], [], NOW, TODAY)
    expect(keys(t.overdue)).toEqual(['GB:B1', 'X'])
  })

  it('沒有團體／桌況資料也不報錯（元件測試常不給）', () => {
    const t = buildTodayTimeline([bk('A', '12:30')], undefined, undefined, NOW, TODAY)
    expect(keys(t.soon)).toEqual(['A'])
    expect(t.pendingBatchCount).toBe(0)
  })
})

describe('matchesTimelineQuery', () => {
  const [entry] = groupBatchEntries([GB], [], TODAY)
  it.each([['山城', true], ['陳導', true], ['102', true], ['0922', true], ['尖峰', false], ['999', false]])('團體梯 %s → %s', (q, ok) => {
    expect(matchesTimelineQuery(entry, q)).toBe(ok)
  })
  it('散客沿用姓名／電話末碼／桌號', () => {
    const e = { kind: 'booking', key: 'A', booking: bk('A', '12:00', { name: '王小明', phone: '0912-345-678', assignedTableId: '105' }) }
    expect(matchesTimelineQuery(e, '王')).toBe(true)
    expect(matchesTimelineQuery(e, '5678')).toBe(true)
    expect(matchesTimelineQuery(e, '105')).toBe(true)
    expect(matchesTimelineQuery(e, '山城')).toBe(false)
  })
})

describe('groupStripeColor／batchLiveState', () => {
  it('第一團用團體保留紫，後面換色相、循環', () => {
    expect(groupStripeColor(0)).toBe('#7c3aed')
    expect(groupStripeColor(1)).not.toBe(groupStripeColor(0))
    expect(groupStripeColor(5)).toBe(groupStripeColor(0))
  })
  it('batchLiveState：released > seated > cleaning > waiting', () => {
    const m = {}
    TABLES.forEach(t => { m[t.number] = t })
    expect(batchLiveState(GA, GA.batches[1], m)).toBe('seated')
    expect(batchLiveState(GA, GA.batches[0], m)).toBe('waiting')
    expect(batchLiveState(GA, { ...GA.batches[1], releasedAt: 'x' }, m)).toBe('released')
    const c = { ...m, 201: { ...m['201'], status: 'cleaning' }, 203: { ...m['203'], status: 'cleaning' } }
    expect(batchLiveState(GA, GA.batches[1], c)).toBe('cleaning')
  })
})

describe('?demo=ops 假資料：甲乙兩團落在驗收要求的區段', () => {
  it('甲團第一梯＋司領在已入座、第二梯 90 分內、乙團 90 分內；桌況 currentRef 正確', () => {
    const now = new Date(`${TODAY}T12:00:00+08:00`).getTime()
    const demo = buildOpsDemo({ now })
    const tables = Object.entries(demo.tableState).map(([number, st]) => tbl(number, st))
    const t = buildTodayTimeline(demo.bookings, demo.groups, tables, now, demo.today)
    expect(keys(t.seated)).toEqual(expect.arrayContaining(['GOPSDEMO-A:BTOPSDEMO-A1', 'GOPSDEMO-A:BTOPSDEMO-AE']))
    expect(keys(t.soon)).toEqual(expect.arrayContaining(['GOPSDEMO-A:BTOPSDEMO-A2', 'GOPSDEMO-B:BTOPSDEMO-B1']))
    expect(demo.groups.find(g => g.id === 'GOPSDEMO-A').status).toBe('arrived')
    expect(demo.groups.find(g => g.id === 'GOPSDEMO-B').status).toBe('confirmed')
    expect(demo.tableState['207']).toMatchObject({ status: 'dining', currentRef: { groupId: 'GOPSDEMO-A', batchId: 'BTOPSDEMO-AE' } })
    // 團體桌不跟散客 demo 的桌衝突
    const bookingTables = demo.bookings.map(b => b.assignedTableId).filter(Boolean)
    const groupTables = demo.groups.flatMap(g => g.batches.flatMap(b => b.tableNumbers))
    expect(groupTables.filter(n => bookingTables.includes(n))).toEqual([])
    expect(buildOpsDemo({ now, calm: true }).groups).toEqual([])
  })
})

describe('completedEntries（已完成區）', () => {
  const DONE = { ...GB, id: 'GD', agencyName: '完成旅行社', status: 'completed', batches: [{ id: 'D1', label: '第一梯', timeSlot: '10:30', tableNumbers: ['301', '302'], guests: 8, releasedAt: iso('11:50') }] }
  const PARTIAL = { ...GA, id: 'GP', batches: GA.batches.map(b => (b.id === 'A1' ? { ...b, releasedAt: iso('11:55') } : b)) }

  it('已完成的團一筆、進行中團已釋出的梯一筆，依時段排；取消與別日的團不列', () => {
    const list = completedEntries([
      PARTIAL, DONE,
      { ...DONE, id: 'GX', status: 'cancelled' },
      { ...DONE, id: 'GY', date: '2026-11-02' },
    ], TODAY)
    expect(list.map(e => [e.kind, e.key])).toEqual([['group', 'GD'], ['released', 'GP:A1']])
    expect(list[0].tableNumbers).toEqual(['301', '302'])
  })

  it('團沒結但已無未釋出的梯（全釋出或沒有梯）→ 走整張團卡，現場才按得到「整團完成」', () => {
    const allReleased = { ...GB, id: 'GR', status: 'arrived', batches: GB.batches.map(b => ({ ...b, releasedAt: iso('11:55') })) }
    const noBatches = { ...GB, id: 'GN', status: 'planned', batches: [] }
    expect(completedEntries([allReleased, noBatches], TODAY).map(e => [e.kind, e.key]).sort()).toEqual([['group', 'GN'], ['group', 'GR']])
  })

  it('邊條色不因別團完成而跳：已完成的團也佔序', () => {
    const color = (gs) => groupBatchEntries(gs, [], TODAY).find(e => e.group.id === 'GB').groupIndex
    expect(color([GA, GB])).toBe(color([{ ...GA, status: 'completed' }, GB]))
  })

  it('buildTodayTimeline：已釋出的梯離開時間線、進 done；同團未跑完的梯留在原區段', () => {
    const t = buildTodayTimeline([], [PARTIAL], [], NOW, TODAY)
    const keys = (list) => list.map(e => e.key)
    expect(keys(t.done)).toEqual(['GP:A1'])
    expect([...keys(t.overdue), ...keys(t.soon), ...keys(t.later), ...keys(t.seated)]).not.toContain('GP:A1')
    expect(keys(t.later)).toContain('GP:A2')
  })

  it('搜尋口徑通用：整團完成的筆比對旅行社／導遊／桌號', () => {
    const [e] = completedEntries([DONE], TODAY)
    expect(matchesTimelineQuery(e, '完成旅行')).toBe(true)
    expect(matchesTimelineQuery(e, '陳導')).toBe(true)
    expect(matchesTimelineQuery(e, '302')).toBe(true)
    expect(matchesTimelineQuery(e, '不存在')).toBe(false)
  })
})
