// 團體桌「單桌操作」（2026-11 店主痛點：團體一次佔很多桌，一桌先吃完卻只能整梯或整團處理）
// S1 這桌離席／S2 逐桌清桌不回團保／S3 清完最後一桌收斂／S4 逐桌清桌復原／
// S5 整梯離席復原／S6 已入座換桌／S7 臨時加桌。
// 後端為 localStorage（tests/setup.js 每個測試前後自動清空）。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as seating from '../../src/services/seatingService'
import * as tableService from '../../src/services/tableService'
import * as bookingService from '../../src/services/bookingService'
import * as groupService from '../../src/services/groupReservationService'
import { buildGroupHolds } from '../../src/utils/groupLive'

const TODAY = '2026-11-01'

function mkTable(number, capacity = 6, overrides = {}) {
  return {
    number, capacity, floor: '1F', x: 100, y: 100, w: 80, h: 100,
    isActive: true, outage: null, status: 'vacant', currentBookingId: null, currentRef: null,
    seatedAt: null, mergedWith: null, blockReason: null, updatedAt: null, ...overrides,
  }
}

const t = (n) => tableService.getByNumber(n)
const batchOf = (gid, bid) => groupService.getById(gid).batches.find(b => b.id === bid)

// 單梯團：101、102、103；入座後回傳 { g, b }
function seatedGroup(tableNumbers = ['101', '102', '103'], extra = {}) {
  const g = groupService.create({
    date: TODAY, agencyName: '快樂旅行社', counts: { total: 15 },
    batches: [{ label: '第一梯', timeSlot: '11:30', tableNumbers, guests: 15 }],
    ...extra,
  })
  const b = g.batches[0].id
  expect(seating.seatGroupBatch(g.id, b).ok).toBe(true)
  return { g, b }
}

// 兩梯團：第一梯 101、102；第二梯 101、102（同桌接續）
function twoBatchGroup() {
  const g = groupService.create({
    date: TODAY, agencyName: '快樂旅行社', counts: { total: 22 },
    batches: [
      { label: '第一梯', timeSlot: '11:30', tableNumbers: ['101', '102'], guests: 12 },
      { label: '第二梯', timeSlot: '13:00', tableNumbers: ['101', '102'], guests: 10 },
    ],
  })
  const [b1, b2] = g.batches.map(b => b.id)
  seating.seatGroupBatch(g.id, b1)
  return { g, b1, b2 }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(`${TODAY}T12:00:00`))
  tableService.bulkWrite(['101', '102', '103', '104', '105', '106'].map(n => mkTable(n)))
})
afterEach(() => { vi.useRealTimers() })

// =====================================================================
describe('S1 checkoutGroupTable（這桌離席）', () => {
  it('只動這一張桌：dining→cleaning、currentRef 保留；同梯其他桌照常用餐', () => {
    const { g, b } = seatedGroup()
    const seatedAt = t('102').seatedAt
    const r = seating.checkoutGroupTable('102')
    expect(r.ok).toBe(true)
    expect(t('102').status).toBe('cleaning')
    expect(t('102').currentRef).toEqual({ type: 'group', groupId: g.id, batchId: b })
    expect(t('101').status).toBe('dining')
    expect(t('103').status).toBe('dining')
    expect(r.snapshot).toEqual({ groupId: g.id, batchId: b, tables: [{ tableNumber: '102', seatedAt }] })
    // 團單不動：沒有落 releasedAt、團仍 arrived
    expect(batchOf(g.id, b).releasedAt).toBeNull()
    expect(groupService.getById(g.id).status).toBe('arrived')
  })

  it('守門：非團體用餐中的桌（空桌／散客桌／待清桌）→ 擋，不動桌況', () => {
    seatedGroup(['101'])
    expect(seating.checkoutGroupTable('104')).toEqual({ ok: false, error: '104 不是用餐中的團體桌' })
    tableService.seatTable('105', 'BK1')
    expect(seating.checkoutGroupTable('105').ok).toBe(false)
    expect(t('105').status).toBe('dining')
    seating.checkoutGroupTable('101')
    expect(seating.checkoutGroupTable('101').ok).toBe(false) // 已是待清桌
    expect(seating.checkoutGroupTable('999')).toEqual({ ok: false, error: '桌位不存在' })
  })

  it('復原：仍待清且仍指向同團同梯 → 倒回 dining＋原入座時間', () => {
    seatedGroup()
    const seatedAt = t('102').seatedAt
    const r = seating.checkoutGroupTable('102')
    vi.setSystemTime(new Date(`${TODAY}T12:05:00`))
    const u = seating.undoGroupCheckout(r.snapshot)
    expect(u).toEqual({ ok: true, restored: ['102'], failed: [] })
    expect(t('102').status).toBe('dining')
    expect(t('102').seatedAt).toBe(seatedAt) // 不重算用餐時間
  })

  it('復原安全失敗：桌已被清掉並帶了散客 → 不硬蓋、回報 failed', () => {
    seatedGroup()
    const r = seating.checkoutGroupTable('102')
    seating.clearGroupTable('102')
    tableService.seatTable('102', 'WALKIN1')
    const u = seating.undoGroupCheckout(r.snapshot)
    expect(u.ok).toBe(false)
    expect(u.failed).toEqual(['102'])
    expect(t('102').currentBookingId).toBe('WALKIN1') // 散客還在桌上
    expect(t('102').currentRef).toBeNull()
  })
})

// =====================================================================
describe('S2 逐桌清桌後不回團保（service × buildGroupHolds）', () => {
  it('一桌先離席、清桌 → 這桌不畫回團保；同梯其他桌照常', () => {
    const { g } = seatedGroup()
    seating.checkoutGroupTable('102')
    seating.clearGroupTable('102')
    const holds = buildGroupHolds([groupService.getById(g.id)], tableService.listAll())
    expect(holds['102']?.holds || []).toEqual([])
    expect(t('102').status).toBe('vacant')
  })

  it('反向：下一梯也圈這張桌 → 清空後顯示下一梯團保', () => {
    const { g } = twoBatchGroup()
    seating.checkoutGroupTable('101')
    seating.clearGroupTable('101')
    const holds = buildGroupHolds([groupService.getById(g.id)], tableService.listAll())
    expect(holds['101'].holds.map(h => h.batch.label)).toEqual(['第二梯'])
  })
})

// =====================================================================
describe('S3 clearGroupTable（逐桌清桌收斂）', () => {
  it('清的不是本梯最後一桌 → 不落 releasedAt', () => {
    const { g, b } = seatedGroup()
    seating.checkoutGroupTable('101')
    const r = seating.clearGroupTable('101')
    expect(r).toMatchObject({ ok: true, batchReleased: false, groupCompleted: false })
    expect(batchOf(g.id, b).releasedAt).toBeNull()
  })

  it('單梯團逐桌清完最後一桌 → 落 releasedAt＋自動結團（同 releaseGroupBatch 口徑）', () => {
    const { g, b } = seatedGroup(['101', '102'])
    seating.checkoutGroupBatch(g.id, b)
    seating.clearGroupTable('101')
    const r = seating.clearGroupTable('102')
    expect(r).toMatchObject({ ok: true, batchReleased: true, groupCompleted: true })
    expect(batchOf(g.id, b).releasedAt).toBeTruthy()
    expect(groupService.getById(g.id).status).toBe('completed')
  })

  it('多梯團：第一梯最後一桌清完 → 第一梯落 releasedAt、團仍 arrived', () => {
    const g = groupService.create({
      date: TODAY, counts: { total: 20 },
      batches: [
        { label: '第一梯', timeSlot: '11:30', tableNumbers: ['101'], guests: 10 },
        { label: '第二梯', timeSlot: '13:00', tableNumbers: ['103'], guests: 10 },
      ],
    })
    const [b1, b2] = g.batches.map(b => b.id)
    seating.seatGroupBatch(g.id, b1)
    seating.checkoutGroupTable('101')
    const r = seating.clearGroupTable('101')
    expect(r).toMatchObject({ batchReleased: true, groupCompleted: false })
    expect(batchOf(g.id, b1).releasedAt).toBeTruthy()
    expect(batchOf(g.id, b2).releasedAt).toBeNull()
    expect(groupService.getById(g.id).status).toBe('arrived')
  })

  it('同梯仍有桌在用餐 → 整梯清桌釋出只清待清桌、不提早標「此梯完成」', () => {
    const { g, b } = seatedGroup()
    seating.checkoutGroupTable('101')
    seating.checkoutGroupTable('102')
    const r = seating.releaseGroupBatch(g.id, b)
    expect(r).toMatchObject({ ok: true, cleared: ['101', '102'], batchReleased: false })
    expect(t('103').status).toBe('dining')
    expect(batchOf(g.id, b).releasedAt).toBeNull()
    // 最後一桌離席＋清桌 → 收斂
    seating.checkoutGroupTable('103')
    expect(seating.clearGroupTable('103')).toMatchObject({ batchReleased: true, groupCompleted: true })
  })

  it('seatNextBatchOnTable：接走前梯最後一張桌 → 前梯落 releasedAt；不是最後一張 → 不落', () => {
    const { g, b1, b2 } = twoBatchGroup()
    seating.checkoutGroupTable('101')
    expect(seating.seatNextBatchOnTable('101', g.id, b2)).toEqual({ ok: true, prevBatchReleased: false })
    expect(batchOf(g.id, b1).releasedAt).toBeNull()  // 102 第一梯還在吃
    seating.checkoutGroupTable('102')
    expect(seating.seatNextBatchOnTable('102', g.id, b2)).toEqual({ ok: true, prevBatchReleased: true })
    expect(batchOf(g.id, b1).releasedAt).toBeTruthy()
    expect(groupService.getById(g.id).status).toBe('arrived') // 第二梯還在用餐
  })

  it('seatGroupBatch 整梯接續前梯的待清桌 → 前梯收斂落 releasedAt（之後不會被畫回團保）', () => {
    const { g, b1, b2 } = twoBatchGroup()
    seating.checkoutGroupBatch(g.id, b1)
    expect(seating.seatGroupBatch(g.id, b2).ok).toBe(true)
    expect(batchOf(g.id, b1).releasedAt).toBeTruthy()
    // 第二梯跑完 → 兩梯都釋出 → 自動結團
    seating.checkoutGroupBatch(g.id, b2)
    expect(seating.releaseGroupBatch(g.id, b2)).toMatchObject({ ok: true, groupCompleted: true })
  })

  it('守門：非團體待清桌 → 擋', () => {
    seatedGroup(['101'])
    expect(seating.clearGroupTable('101')).toEqual({ ok: false, error: '101 不是待清的團體桌' }) // 還在用餐
    expect(seating.clearGroupTable('104').ok).toBe(false)
  })
})

// =====================================================================
describe('S4 undoClearGroupTable（逐桌清桌復原）', () => {
  it('一般清桌 → 倒回待清＋原 currentRef', () => {
    const { g, b } = seatedGroup()
    seating.checkoutGroupTable('101')
    const r = seating.clearGroupTable('101')
    const u = seating.undoClearGroupTable(r.snapshot)
    expect(u.ok).toBe(true)
    expect(t('101').status).toBe('cleaning')
    expect(t('101').currentRef).toEqual({ type: 'group', groupId: g.id, batchId: b })
  })

  it('清完最後一桌觸發自動結團 → 復原連團 status（回 arrived）與 releasedAt 一起倒回', () => {
    const { g, b } = seatedGroup(['101'])
    seating.checkoutGroupTable('101')
    const r = seating.clearGroupTable('101')
    expect(groupService.getById(g.id).status).toBe('completed')
    const u = seating.undoClearGroupTable(r.snapshot)
    expect(u).toMatchObject({ ok: true, groupRestored: true, batchRestored: true })
    expect(groupService.getById(g.id).status).toBe('arrived')
    // 白名單（normalizeBatch）保留顯式 null，不會讓「清掉 releasedAt」失效
    expect(batchOf(g.id, b).releasedAt).toBeNull()
    expect(t('101').status).toBe('cleaning')
    // 倒回後可再正常收斂一次
    expect(seating.clearGroupTable('101')).toMatchObject({ batchReleased: true, groupCompleted: true })
  })

  it('只落了 releasedAt（多梯團）→ 復原清掉 releasedAt、團 status 不動', () => {
    const g = groupService.create({
      date: TODAY, counts: { total: 20 },
      batches: [
        { label: '第一梯', timeSlot: '11:30', tableNumbers: ['101'], guests: 10 },
        { label: '第二梯', timeSlot: '13:00', tableNumbers: ['103'], guests: 10 },
      ],
    })
    const b1 = g.batches[0].id
    seating.seatGroupBatch(g.id, b1)
    seating.checkoutGroupTable('101')
    const r = seating.clearGroupTable('101')
    const u = seating.undoClearGroupTable(r.snapshot)
    expect(u).toMatchObject({ ok: true, groupRestored: false, batchRestored: true })
    expect(batchOf(g.id, b1).releasedAt).toBeNull()
    expect(groupService.getById(g.id).status).toBe('arrived')
  })

  it('復原安全失敗：桌已被下一組坐走 → 不硬蓋桌、也不倒團單', () => {
    const { g, b } = seatedGroup(['101'])
    seating.checkoutGroupTable('101')
    const r = seating.clearGroupTable('101')
    tableService.seatTable('101', 'WALKIN1')
    const u = seating.undoClearGroupTable(r.snapshot)
    expect(u.ok).toBe(false)
    expect(u.error).toContain('已被下一組使用')
    expect(t('101').currentBookingId).toBe('WALKIN1')
    expect(groupService.getById(g.id).status).toBe('completed')
    expect(batchOf(g.id, b).releasedAt).toBeTruthy()
  })

  it('復原安全失敗：團單之後被取消 → 不復活', () => {
    const { g } = seatedGroup()
    seating.checkoutGroupTable('101')
    const r = seating.clearGroupTable('101')
    seating.cancelGroup(g.id)
    const u = seating.undoClearGroupTable(r.snapshot)
    expect(u).toEqual({ ok: false, error: '團單狀態已變更，未復原' })
    expect(t('101').status).toBe('vacant')
  })
})

// =====================================================================
describe('S5 checkoutGroupBatch 快照＋undoGroupCheckout（整梯離席復原）', () => {
  it('整梯離席回傳快照；復原把每張桌倒回 dining＋原入座時間', () => {
    const { g, b } = seatedGroup()
    const before = ['101', '102', '103'].map(n => t(n).seatedAt)
    const r = seating.checkoutGroupBatch(g.id, b)
    expect(r.tableNumbers).toEqual(['101', '102', '103'])
    expect(r.snapshot.tables.map(x => x.seatedAt)).toEqual(before)
    const u = seating.undoGroupCheckout(r.snapshot)
    expect(u).toEqual({ ok: true, restored: ['101', '102', '103'], failed: [] })
    expect(['101', '102', '103'].map(n => t(n).seatedAt)).toEqual(before)
    expect(['101', '102', '103'].every(n => t(n).status === 'dining')).toBe(true)
  })

  it('已先單桌離席的桌不進快照（復原不會把它也倒回）', () => {
    const { g, b } = seatedGroup()
    seating.checkoutGroupTable('101')
    const r = seating.checkoutGroupBatch(g.id, b)
    expect(r.tableNumbers).toEqual(['102', '103'])
    seating.undoGroupCheckout(r.snapshot)
    expect(t('101').status).toBe('cleaning')
  })

  it('部分失敗：一張已清桌、一張已接下一梯 → 只倒回其餘、failed 列出', () => {
    const g = groupService.create({
      date: TODAY, counts: { total: 22 },
      batches: [
        { label: '第一梯', timeSlot: '11:30', tableNumbers: ['101', '102', '103'], guests: 12 },
        { label: '第二梯', timeSlot: '13:00', tableNumbers: ['102'], guests: 10 },
      ],
    })
    const [b1, b2] = g.batches.map(b => b.id)
    seating.seatGroupBatch(g.id, b1)
    const r = seating.checkoutGroupBatch(g.id, b1)
    seating.clearGroupTable('101')
    seating.seatNextBatchOnTable('102', g.id, b2)
    const u = seating.undoGroupCheckout(r.snapshot)
    expect(u).toEqual({ ok: true, restored: ['103'], failed: ['101', '102'] })
    expect(t('101').status).toBe('vacant')
    expect(t('102').currentRef.batchId).toBe(b2) // 第二梯沒被抹掉
    expect(t('103').status).toBe('dining')
  })

  it('全部失敗 → ok:false', () => {
    const { g, b } = seatedGroup(['101'])
    const r = seating.checkoutGroupBatch(g.id, b)
    seating.clearGroupTable('101')
    const u = seating.undoGroupCheckout(r.snapshot)
    expect(u.ok).toBe(false)
    expect(u.failed).toEqual(['101'])
  })
})

// =====================================================================
describe('S6 moveGroupTable（團體已入座換桌）', () => {
  it('成功：新桌 dining＋同 currentRef＋原入座時間、舊桌清空、梯次圈桌換掉', () => {
    const { g, b } = seatedGroup(['101', '102'])
    const seatedAt = t('101').seatedAt
    vi.setSystemTime(new Date(`${TODAY}T12:30:00`))
    const r = seating.moveGroupTable('101', '104')
    expect(r).toEqual({ ok: true, from: '101', to: '104' })
    expect(t('104')).toMatchObject({ status: 'dining', currentRef: { type: 'group', groupId: g.id, batchId: b }, seatedAt })
    expect(t('101')).toMatchObject({ status: 'vacant', currentRef: null })
    expect(batchOf(g.id, b).tableNumbers).toEqual(['104', '102'])
    // 之後整梯離席照樣找得到新桌
    expect(seating.checkoutGroupBatch(g.id, b).tableNumbers).toEqual(['104', '102'])
  })

  it('守門：目標桌非空桌／不存在／同桌', () => {
    seatedGroup(['101'])
    tableService.seatTable('104', 'BK1')
    expect(seating.moveGroupTable('101', '104').error).toContain('104 目前為')
    expect(seating.moveGroupTable('101', '999').error).toBe('桌位不存在')
    expect(seating.moveGroupTable('101', '101').ok).toBe(false)
    expect(t('101').status).toBe('dining')
  })

  it('守門：目標桌停用／今日維修', () => {
    seatedGroup(['101'])
    tableService.setActive('104', false)
    expect(seating.moveGroupTable('101', '104').error).toContain('停用/維修')
    tableService.setOutage('105', { from: TODAY, to: TODAY, reason: '修' })
    expect(seating.moveGroupTable('101', '105').error).toContain('停用/維修')
  })

  it('守門：目標桌被其他今日團體圈住、或本團其他未跑完的梯圈住', () => {
    const { g } = seatedGroup(['101'], {
      batches: [
        { label: '第一梯', timeSlot: '11:30', tableNumbers: ['101'], guests: 8 },
        { label: '第二梯', timeSlot: '13:00', tableNumbers: ['105'], guests: 8 },
      ],
    })
    groupService.create({ date: TODAY, agencyName: '別團', counts: { total: 6 },
      batches: [{ label: '第一梯', timeSlot: '18:00', tableNumbers: ['104'], guests: 6 }] })
    expect(seating.moveGroupTable('101', '104').error).toBe('104 已被其他團體保留')
    expect(seating.moveGroupTable('101', '105').error).toContain('已圈給本團 第二梯')
    expect(groupService.getById(g.id).batches[0].tableNumbers).toEqual(['101'])
  })

  it('守門：目標桌現在有重疊的散客預配 → 擋（預配不鎖桌況，客人等下就到）', () => {
    seatedGroup(['101'])
    bookingService.create({ name: '王小明', phone: '0912', guests: 4, date: TODAY, timeSlot: '12:30', status: 'confirmed', assignedTableId: '104' })
    expect(seating.moveGroupTable('101', '104').error).toContain('已預配給 王小明')
    expect(t('104').status).toBe('vacant')
  })

  it('守門：來源不是團體用餐中桌、團已結束、梯已釋出', () => {
    expect(seating.moveGroupTable('104', '105').error).toBe('104 不是用餐中的團體桌')
    const { g, b } = seatedGroup(['101', '102'])
    groupService.markBatchReleased(g.id, b)
    expect(seating.moveGroupTable('101', '104').error).toContain('此梯已清桌釋出完成')
    groupService.setStatus(g.id, 'completed')
    expect(seating.moveGroupTable('101', '104').error).toContain('此團已結束')
  })
})

// =====================================================================
describe('S7 addGroupBatchTable（團體臨時加桌）', () => {
  it('成功：圈桌追加、該桌立即 dining（入座時間＝現在）指向該梯', () => {
    const { g, b } = seatedGroup(['101'])
    vi.setSystemTime(new Date(`${TODAY}T12:40:00`))
    const r = seating.addGroupBatchTable(g.id, b, '104')
    expect(r).toEqual({ ok: true, tableNumber: '104' })
    expect(t('104')).toMatchObject({ status: 'dining', currentRef: { type: 'group', groupId: g.id, batchId: b } })
    expect(new Date(t('104').seatedAt).getTime()).toBe(new Date(`${TODAY}T12:40:00`).getTime())
    expect(batchOf(g.id, b).tableNumbers).toEqual(['101', '104'])
    // 加的桌也算進收斂：兩張都清完才落 releasedAt
    seating.checkoutGroupBatch(g.id, b)
    expect(seating.clearGroupTable('101').batchReleased).toBe(false)
    expect(seating.clearGroupTable('104').batchReleased).toBe(true)
  })

  it('守門：梯次尚未入座／已在圈桌內／目標非空桌／被其他團圈住', () => {
    const g0 = groupService.create({ date: TODAY, counts: { total: 6 },
      batches: [{ label: '第一梯', timeSlot: '11:30', tableNumbers: ['103'], guests: 6 }] })
    expect(seating.addGroupBatchTable(g0.id, g0.batches[0].id, '104').error).toBe('此梯尚未入座，請先梯次入座')
    const { g, b } = seatedGroup(['101'])
    expect(seating.addGroupBatchTable(g.id, b, '101').error).toContain('101 目前為') // 自己用餐中的桌
    tableService.seatTable('105', 'BK1')
    expect(seating.addGroupBatchTable(g.id, b, '105').error).toContain('105 目前為')
    expect(seating.addGroupBatchTable(g.id, b, '103').error).toBe('103 已被其他團體保留')
    expect(batchOf(g.id, b).tableNumbers).toEqual(['101'])
  })

  it('守門：團已結束／梯已釋出／團單不存在', () => {
    expect(seating.addGroupBatchTable('NOPE', 'X', '104').error).toBe('團單不存在')
    const { g, b } = seatedGroup(['101'])
    groupService.markBatchReleased(g.id, b)
    expect(seating.addGroupBatchTable(g.id, b, '104').error).toContain('此梯已清桌釋出完成')
    seating.finalizeGroup(g.id)
    expect(seating.addGroupBatchTable(g.id, b, '104').error).toContain('此團已結束')
    expect(t('104').status).toBe('vacant')
  })
})

// =====================================================================
describe('不變量：自動清檯對團體桌只做 checkoutTable', () => {
  it('checkout-group-table 只把桌轉待清、不清桌、不落 releasedAt、不結團', () => {
    const { g, b } = seatedGroup(['101'])
    seating.executeSweepActions([{ type: 'checkout-group-table', tableNumber: '101', groupId: g.id, batchId: b, minutes: 400 }])
    expect(t('101').status).toBe('cleaning')
    expect(batchOf(g.id, b).releasedAt).toBeNull()
    expect(groupService.getById(g.id).status).toBe('arrived')
  })
})

// =====================================================================
// 審查回饋（2026-11-01）
describe('審查回饋：整梯入座不可蓋掉同團別梯仍在用餐的桌', () => {
  it('第一梯 102 逐桌清完、101 仍用餐 → 第二梯整梯入座被擋（101 走改派），第一梯不被抹掉也不誤收斂', () => {
    const { g, b1, b2 } = twoBatchGroup()
    seating.checkoutGroupTable('102')
    seating.clearGroupTable('102')
    const r = seating.seatGroupBatch(g.id, b2)
    expect(r.ok).toBe(false)
    expect(r.blocked).toEqual([{ tableNumber: '101', status: 'dining' }])
    expect(t('101').currentRef.batchId).toBe(b1)
    expect(t('102').status).toBe('vacant')       // all-or-nothing：102 也沒先坐下
    expect(batchOf(g.id, b1).releasedAt).toBeNull()
  })

  it('本梯自己已坐著的桌：重按入座仍放行（冪等）', () => {
    const { g, b } = seatedGroup(['101', '102'])
    expect(seating.seatGroupBatch(g.id, b).ok).toBe(true)
  })

  it('跨團：B 團整梯入座接走 A 團待清桌 → A 團該梯收斂（落 releasedAt＋單梯自動結團）', () => {
    const { g: ga, b: ba } = seatedGroup(['101'])
    seating.checkoutGroupTable('101')
    const gb = groupService.create({ date: TODAY, agencyName: 'B', counts: { total: 6 },
      batches: [{ label: '第一梯', timeSlot: '14:00', tableNumbers: ['101'], guests: 6 }] })
    expect(seating.seatGroupBatch(gb.id, gb.batches[0].id).ok).toBe(true)
    expect(t('101').currentRef.groupId).toBe(gb.id)
    expect(batchOf(ga.id, ba).releasedAt).toBeTruthy()
    expect(groupService.getById(ga.id).status).toBe('completed')
    expect(groupService.getById(gb.id).status).toBe('arrived')
  })

  it('跨團：seatNextBatchOnTable 接走別團待清桌 → 原團該梯同樣收斂', () => {
    const { g: ga, b: ba } = seatedGroup(['101'])
    seating.checkoutGroupTable('101')
    const gb = groupService.create({ date: TODAY, agencyName: 'B', counts: { total: 6 },
      batches: [{ label: '第一梯', timeSlot: '14:00', tableNumbers: ['101'], guests: 6 }] })
    expect(seating.seatNextBatchOnTable('101', gb.id, gb.batches[0].id)).toEqual({ ok: true, prevBatchReleased: true })
    expect(batchOf(ga.id, ba).releasedAt).toBeTruthy()
  })
})

describe('審查回饋：逐桌清桌復原時本梯已被別次清桌收斂 → 安全失敗', () => {
  it('先清 101（未收斂）、再清 102（收斂）→ 回頭復原 101 不可指回已釋出梯', () => {
    const { g, b1 } = twoBatchGroup()
    seating.checkoutGroupBatch(g.id, b1)
    const r1 = seating.clearGroupTable('101')
    expect(seating.clearGroupTable('102').batchReleased).toBe(true)
    const u = seating.undoClearGroupTable(r1.snapshot)
    expect(u.ok).toBe(false)
    expect(u.error).toContain('已全部清完')
    expect(t('101').status).toBe('vacant')
    expect(batchOf(g.id, b1).releasedAt).toBeTruthy()
  })
})

describe('審查回饋：moveGroupTable 比對進模式當下的團／梯', () => {
  it('from 桌已改坐別梯 → 安全失敗、不搬', () => {
    const { g, b1, b2 } = twoBatchGroup()
    seating.checkoutGroupTable('101')
    seating.seatNextBatchOnTable('101', g.id, b2)       // 101 現在是第二梯
    const r = seating.moveGroupTable('101', '104', { groupId: g.id, batchId: b1 })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('桌況已變更')
    expect(t('101').currentRef.batchId).toBe(b2)
    expect(t('104').status).toBe('vacant')
  })
  it('團／梯相符 → 照常換桌', () => {
    const { g, b } = seatedGroup(['101'])
    expect(seating.moveGroupTable('101', '104', { groupId: g.id, batchId: b }).ok).toBe(true)
  })
})
