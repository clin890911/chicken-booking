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

describe('groupReservationService — 司領桌（isEscort）', () => {
  const escort = (over = {}) => ({ id: 'be', label: '司領桌', timeSlot: '11:00', tableNumbers: ['107'], guests: 2, isEscort: true, ...over })
  const guest = { id: 'b1', label: '第一梯', timeSlot: '11:00', tableNumbers: ['101', '102'], guests: 12 }

  it('旅客梯次 + 司領桌 → 通過', () => {
    expect(group.validateGroupForSave(validGroup({ batches: [guest, escort()] }), CAP)).toBeNull()
  })
  it('司領桌人數 0 不擋（只有旅客梯次需 > 0）', () => {
    expect(group.validateGroupForSave(validGroup({ batches: [guest, escort({ guests: 0 })] }), CAP)).toBeNull()
  })
  it('司領桌未圈桌 → 擋（至少圈一桌）', () => {
    expect(group.validateGroupForSave(validGroup({ batches: [guest, escort({ tableNumbers: [] })] }), CAP)).toMatch(/至少圈一桌/)
  })
  it('只有司領桌、無旅客梯次 → 擋（需旅客梯次）', () => {
    expect(group.validateGroupForSave(validGroup({ batches: [escort()] }), CAP)).toMatch(/至少新增一個梯次/)
  })
  it('司領桌不佔旅客保留席：單一旅客梯次坐得下即通過', () => {
    // 旅客 101+102=12 席、total 12；外加司領桌 107 不影響旅客保留席判定
    const g = validGroup({ counts: { total: 12 }, batches: [guest, escort()] })
    expect(group.validateGroupForSave(g, CAP)).toBeNull()
  })
  it('normalizeBatch：未帶 isEscort → false；帶 true → 保留', () => {
    const g = group.create({
      date: '2026-06-20', agencyName: 'X', counts: { total: 4 },
      batches: [
        { label: '第一梯', timeSlot: '11:00', tableNumbers: ['101'], guests: 4 },
        { label: '司領桌', timeSlot: '11:00', tableNumbers: ['107'], guests: 2, isEscort: true },
      ],
    })
    const got = group.getById(g.id)
    expect(got.batches[0].isEscort).toBe(false)
    expect(got.batches[1].isEscort).toBe(true)
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

describe('groupReservationService.purgeBlankGroups（清除殘留空白）', () => {
  it('移除空白草稿、保留有內容的團單', () => {
    group.create({}) // 空白：無旅行社、0 人、未圈桌
    group.create({}) // 第二筆空白
    group.create({ date: '2026-12-05', agencyName: '大發', counts: { total: 6 }, batches: [{ label: '第一梯', timeSlot: '11:00', tableNumbers: ['101'], guests: 6 }] })
    const removed = group.purgeBlankGroups()
    expect(removed).toBe(2)
    const left = group.listAll()
    expect(left).toHaveLength(1)
    expect(left[0].agencyName).toBe('大發')
  })

  it('全部有內容 → 不刪、回 0', () => {
    group.create({ date: '2026-12-06', agencyName: 'A', counts: { total: 4 }, batches: [{ label: '第一梯', timeSlot: '11:00', tableNumbers: ['107'], guests: 4 }] })
    expect(group.purgeBlankGroups()).toBe(0)
    expect(group.listAll()).toHaveLength(1)
  })

  it('全部空白 → 全清', () => {
    group.create({})
    group.create({})
    group.create({})
    expect(group.purgeBlankGroups()).toBe(3)
    expect(group.listAll()).toHaveLength(0)
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

describe('cloneGroupForDuplicate（複製團單為新草稿）', () => {
  const source = {
    id: 'G_SRC', date: '2026-06-09', status: 'completed', spend: 5000,
    agencyId: 'AG1', agencyName: '大發旅行社', guideId: 'GD1', guideName: '李導', guidePhone: '0912',
    counts: { total: 20, vegetarian: 3, child: 2, mobility: 1, wheelchair: 0 },
    allergyText: '花生', tableSideNeeds: '剪雞肉', busInfo: '車號 AB-123', notes: '靠窗',
    batches: [
      { id: 'b1', label: '第一梯', timeSlot: '11:00', tableNumbers: ['101', '102'], guests: 12, note: '' },
      { id: 'b2', label: '第二梯', timeSlot: '12:30', tableNumbers: ['103'], guests: 8, note: '' },
    ],
  }

  it('保留旅行社/導遊/人數/特殊需求/梯次結構與場次', () => {
    const d = group.cloneGroupForDuplicate(source)
    expect(d.agencyId).toBe('AG1')
    expect(d.guideName).toBe('李導')
    expect(d.counts).toEqual(source.counts)
    expect(d.allergyText).toBe('花生')
    expect(d.batches.map(b => b.timeSlot)).toEqual(['11:00', '12:30'])
    expect(d.batches.map(b => b.guests)).toEqual([12, 8])
  })

  it('清空 tableNumbers、重生 batch id、spend 歸零、status=planned、無 id', () => {
    const d = group.cloneGroupForDuplicate(source)
    expect(d.batches.every(b => b.tableNumbers.length === 0)).toBe(true)
    expect(d.batches.map(b => b.id)).not.toEqual(['b1', 'b2'])
    expect(d.spend).toBe(0)
    expect(d.status).toBe('planned')
    expect(d.id).toBeUndefined()
  })

  it('可改日期；未給則沿用來源日期', () => {
    expect(group.cloneGroupForDuplicate(source).date).toBe('2026-06-09')
    expect(group.cloneGroupForDuplicate(source, { date: '2026-07-01' }).date).toBe('2026-07-01')
  })

  it('來源無梯次 → 補一個預設第一梯', () => {
    const d = group.cloneGroupForDuplicate({ ...source, batches: [] })
    expect(d.batches).toHaveLength(1)
    expect(d.batches[0].tableNumbers).toEqual([])
  })

  it('null 來源 → null', () => {
    expect(group.cloneGroupForDuplicate(null)).toBeNull()
  })
})

describe('buildRescheduleDraft（團體改期：整團移到新日期）', () => {
  const source = {
    id: 'G_SRC', date: '2026-06-09', status: 'confirmed', spend: 5000,
    agencyId: 'AG1', agencyName: '大發旅行社', guideId: 'GD1', guideName: '李導', guidePhone: '0912',
    counts: { total: 20, vegetarian: 3, child: 2, mobility: 1, wheelchair: 0 },
    allergyText: '花生', tableSideNeeds: '剪雞肉', busInfo: '車號 AB-123', notes: '靠窗',
    batches: [
      { id: 'b1', label: '第一梯', timeSlot: '11:00', tableNumbers: ['101', '102'], guests: 12, note: '', isEscort: false, releasedAt: '2026-06-09T05:00:00Z' },
      { id: 'be', label: '司領桌', timeSlot: '11:00', tableNumbers: ['107'], guests: 2, note: '', isEscort: true },
    ],
  }

  it('保留同一個 id 與旅行社/導遊/人數/特殊需求/梯次結構（label/timeSlot/guests/isEscort/batch id）', () => {
    const d = group.buildRescheduleDraft(source, '2026-07-20')
    expect(d.id).toBe('G_SRC')                       // 同一份團單，非複製
    expect(d.status).toBe('confirmed')               // 狀態原封（不像複製重設 planned）
    expect(d.spend).toBe(5000)
    expect(d.agencyId).toBe('AG1')
    expect(d.guideName).toBe('李導')
    expect(d.counts).toEqual(source.counts)
    expect(d.allergyText).toBe('花生')
    expect(d.batches.map(b => b.id)).toEqual(['b1', 'be'])        // batch id 不重生
    expect(d.batches.map(b => b.timeSlot)).toEqual(['11:00', '11:00'])
    expect(d.batches.map(b => b.guests)).toEqual([12, 2])
    expect(d.batches.map(b => b.isEscort)).toEqual([false, true])
  })

  it('清空所有 tableNumbers 與 releasedAt', () => {
    const d = group.buildRescheduleDraft(source, '2026-07-20')
    expect(d.batches.every(b => b.tableNumbers.length === 0)).toBe(true)
    expect(d.batches.every(b => b.releasedAt === null)).toBe(true)
  })

  it('date = 新日期；未給 newDate → 沿用原日期', () => {
    expect(group.buildRescheduleDraft(source, '2026-07-20').date).toBe('2026-07-20')
    expect(group.buildRescheduleDraft(source).date).toBe('2026-06-09')
  })

  it('不變動來源物件（純函式）', () => {
    const before = JSON.parse(JSON.stringify(source))
    group.buildRescheduleDraft(source, '2026-07-20')
    expect(source).toEqual(before)
  })

  it('null 來源 → null', () => {
    expect(group.buildRescheduleDraft(null, '2026-07-20')).toBeNull()
  })
})

describe('groupReservationService.swapBatchTable（改派桌位：換掉梯內一張桌）', () => {
  it('只動指定梯、字串化桌號', () => {
    const g = group.create({
      date: '2026-06-15',
      counts: { total: 20 },
      batches: [
        { label: '第一梯', timeSlot: '11:30', tableNumbers: ['101', '102'], guests: 12 },
        { label: '第二梯', timeSlot: '13:00', tableNumbers: ['101'], guests: 8 },
      ],
    })
    const [b1, b2] = group.getById(g.id).batches
    const r = group.swapBatchTable(g.id, b1.id, '101', 103)
    expect(r.batches.find(b => b.id === b1.id).tableNumbers).toEqual(['103', '102'])
    // 第二梯的 101 不受影響
    expect(r.batches.find(b => b.id === b2.id).tableNumbers).toEqual(['101'])
  })
  it('團不存在回 null；fromTable 不在梯內則不變', () => {
    expect(group.swapBatchTable('NOPE', 'B', '101', '102')).toBeNull()
    const g = group.create({
      date: '2026-06-15', counts: { total: 8 },
      batches: [{ label: '第一梯', timeSlot: '11:30', tableNumbers: ['101'], guests: 8 }],
    })
    const b = group.getById(g.id).batches[0]
    const r = group.swapBatchTable(g.id, b.id, '999', '103')
    expect(r.batches[0].tableNumbers).toEqual(['101'])
  })
})

// ============================================================
// validateGroupForSave × 停用/維修桌（傳入 tables 才檢查）
// ============================================================
describe('validateGroupForSave — 圈到停用/維修桌', () => {
  const CAP = { 101: 4, 108: 6 }
  const base = {
    date: '2026-06-20',
    agencyName: '快樂旅行社',
    counts: { total: 4 },
    batches: [{ id: 'BT1', label: '第一梯', timeSlot: '12:00', tableNumbers: ['101'], guests: 4 }],
  }

  it('圈到當日維修中的桌 → 擋下並指名桌號', () => {
    const tables = [{ number: '101', capacity: 4, isActive: true, outage: { from: '2026-06-18', to: '2026-06-22', reason: '維修' } }]
    const err = group.validateGroupForSave(base, CAP, tables)
    expect(err).toContain('101')
    expect(err).toContain('停用/維修')
  })

  it('維修窗不含當日 / 桌可用 / 未傳 tables → 照常通過', () => {
    const okTables = [{ number: '101', capacity: 4, isActive: true, outage: { from: '2026-06-25', to: '2026-06-26', reason: 'x' } }]
    expect(group.validateGroupForSave(base, CAP, okTables)).toBe(null)
    expect(group.validateGroupForSave(base, CAP, [{ number: '101', capacity: 4, isActive: true }])).toBe(null)
    expect(group.validateGroupForSave(base, CAP)).toBe(null)
  })

  it('圈到永久停用的桌 → 擋下', () => {
    const tables = [{ number: '101', capacity: 4, isActive: false }]
    expect(group.validateGroupForSave(base, CAP, tables)).toContain('101')
  })
})
