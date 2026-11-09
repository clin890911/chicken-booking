// 前端接住後端「搶桌」409（無版本桌 stealsOccupiedTable，情境 A7）：記候選→拉取採用雲端→訂位退回待到→補推成功。
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { guardOperationalSync } from '../../functions/lib/waitlistSyncGuard'
import { isRetryablePushError, shouldDeferPushErrorToast, nextPushRetryState, pushErrorKey, tableStealToast, TABLE_STEAL_TOAST_MS } from '../../src/utils/syncStatus'

const TK = 'chicken_tables_v3', BK = 'chicken_bookings_v1'
const VACANT = { number: '102', status: 'vacant', currentBookingId: null, currentRef: null, seatedAt: null, x: 10 }
const readT = () => JSON.parse(localStorage.getItem(TK))
const readB = () => JSON.parse(localStorage.getItem(BK))
const conflict = (tables = ['102']) => ({ ok: false, status: 409, json: async () => ({ ok: false, error: 'table-occupied-elsewhere', tables }) })
const okAck = () => ({ ok: true, json: async () => ({ ok: true, tableUpdates: [], bookingUpdates: [], writtenVersions: { tables: {}, bookings: {} } }) })
const bodyOf = call => JSON.parse(call[1].body).dataset
let cloud

// 本機（被拒那台）：B 王先生 帶到 102（尚未上雲）
function seatLocallyB(extra = {}) {
  localStorage.setItem(TK, JSON.stringify([{ ...VACANT, status: 'dining', currentBookingId: 'B', seatedAt: 't-b', ...extra.table }]))
  localStorage.setItem(BK, JSON.stringify([{ id: 'B', name: '王先生', date: '2026-11-10', status: 'arrived', assignedTableId: '102', extraTableIds: [], actualArrivalTime: 't-b', ...extra.booking }]))
}
const cloudA = { ...VACANT, status: 'dining', currentBookingId: 'A', seatedAt: 't-a' }
const bookingA = { id: 'A', name: '陳小姐', date: '2026-11-10', status: 'arrived', assignedTableId: '102', extraTableIds: [] }

beforeEach(async () => {
  localStorage.clear()
  vi.resetModules()
  cloud = await import('../../src/services/cloudDataService')
  cloud.applyCloudSnapshot({ tables: [VACANT], bookings: [], waitlist: [] })
})

describe('推送被搶桌 409 拒絕', () => {
  it('記進待採用集合、不推進基準線、錯誤帶專用文案（桌號＋姓氏）', async () => {
    seatLocallyB()
    global.fetch = vi.fn(async () => conflict())
    const err = await cloud.pushChangedData().catch(e => e)
    expect(err).toMatchObject({ status: 409, code: 'table-occupied-elsewhere', tables: ['102'], tableStealConflict: true })
    expect(err.waitlistConflict).toBeUndefined()
    expect(err.tableStealMessage).toBe('102 已被另一台帶位，王先生請重新帶位')
    expect(cloud.pendingTableStealCandidates()).toEqual([{ tableNumber: '102', bookingId: 'B' }])
    // 基準線沒推進：再推一次仍夾帶 102 與 B
    await cloud.pushChangedData().catch(() => {})
    const ds = bodyOf(global.fetch.mock.calls[1])
    expect(ds.tables.map(t => t.number)).toEqual(['102'])
    expect(ds.bookings.map(b => b.id)).toEqual(['B'])
    // 本機桌與訂位未被動到（不自動丟棄，等拉取確認雲端答案）
    expect(readT()[0]).toMatchObject({ status: 'dining', currentBookingId: 'B' })
  })

  it('syncStatus 分類：可補推、第一次就跳專用 toast（error、≥15 秒），不是 Wi‑Fi 錯誤', async () => {
    seatLocallyB()
    global.fetch = vi.fn(async () => conflict())
    const err = await cloud.pushChangedData().catch(e => e)
    expect(isRetryablePushError(err)).toBe(true)
    expect(shouldDeferPushErrorToast(err, nextPushRetryState(null, err, 0))).toBe(false)
    expect(pushErrorKey(err)).toBe('table-steal:102')
    const t = tableStealToast(err)
    expect(t).toEqual({ message: '102 已被另一台帶位，王先生請重新帶位', type: 'error', duration: TABLE_STEAL_TOAST_MS })
    expect(t.duration).toBeGreaterThanOrEqual(15000)
    expect(tableStealToast({ status: 409, code: 'waitlist-changed', waitlistConflict: true })).toBeNull()
  })

  it('其他 409 code（含版本圍欄／候位的 operational-state-changed）不進候選、不帶搶桌旗標', async () => {
    for (const code of ['waitlist-changed', 'operational-state-changed']) {
      seatLocallyB()
      global.fetch = vi.fn(async () => ({ ok: false, status: 409, json: async () => ({ ok: false, error: code }) }))
      const err = await cloud.pushChangedData().catch(e => e)
      expect(err.code).toBe(code)
      expect(err.tableStealConflict).toBeUndefined()
      expect(tableStealToast(err)).toBeNull()
      expect(cloud.pendingTableStealCandidates()).toEqual([])
    }
  })

  it('有 operationalVersion 的桌不列入候選（走既有版本圍欄）', async () => {
    localStorage.clear(); vi.resetModules(); cloud = await import('../../src/services/cloudDataService')
    cloud.applyCloudSnapshot({ tables: [{ ...VACANT, operationalVersion: 3 }], bookings: [], waitlist: [] })
    seatLocallyB({ table: { operationalVersion: 3 } })
    global.fetch = vi.fn(async () => conflict())
    const err = await cloud.pushChangedData().catch(e => e)
    expect(err.tableStealConflict).toBeUndefined()
    expect(cloud.pendingTableStealCandidates()).toEqual([])
  })
})

describe('下一次拉取自癒', () => {
  it('雲端該桌被別筆用餐中 → 本機改採雲端、基準線=雲端、B 退回待到清桌號；之後推送不再夾帶 102', async () => {
    seatLocallyB()
    // 本機佈局草稿（非關鍵欄位）要保留
    localStorage.setItem(TK, JSON.stringify([{ ...readT()[0], x: 99 }]))
    global.fetch = vi.fn(async () => conflict())
    await cloud.pushChangedData().catch(() => {})
    const applied = cloud.applyCloudSnapshot({ tables: [cloudA], bookings: [bookingA], waitlist: [] })
    expect(applied.tableStealsResolved).toEqual([{ tableNumber: '102', bookingId: 'B', name: '王先生', kind: 'evict' }])
    expect(readT()[0]).toMatchObject({ status: 'dining', currentBookingId: 'A', seatedAt: 't-a', x: 99 })
    const b = readB().find(x => x.id === 'B')
    expect(b).toMatchObject({ status: 'confirmed', assignedTableId: null, extraTableIds: [], actualArrivalTime: null, name: '王先生' })
    expect(readB().find(x => x.id === 'A')).toMatchObject({ status: 'arrived', assignedTableId: '102' })
    expect(cloud.pendingTableStealCandidates()).toEqual([])
    // 後端真守門：之後推送只帶 B（與佈局草稿），不再 409
    let remote = { ...cloudA }
    global.fetch = vi.fn(async (_u, opts) => {
      const ds = JSON.parse(opts.body).dataset
      for (const t of ds.tables || []) remote = { ...remote, ...guardOperationalSync({ ref: { path: 'tables/102' }, data: t }, remote).data }
      return okAck()
    })
    await cloud.pushChangedData()
    const ds = bodyOf(global.fetch.mock.calls[0])
    expect(ds.bookings.map(x => x.id)).toEqual(['B'])
    expect((ds.tables || []).every(t => t.currentBookingId === 'A' && t.status === 'dining')).toBe(true)
    expect(remote.currentBookingId).toBe('A')
    expect((await cloud.pushChangedData()).skipped).toBe(true)
  })

  it('雲端該桌其實仍空（不是搶桌）→ 本機帶位保留 dirty、訂位不動', async () => {
    seatLocallyB()
    global.fetch = vi.fn(async () => conflict())
    await cloud.pushChangedData().catch(() => {})
    const applied = cloud.applyCloudSnapshot({ tables: [VACANT], bookings: [], waitlist: [] })
    expect(applied.tableStealsResolved).toBeUndefined()
    expect(readT()[0]).toMatchObject({ status: 'dining', currentBookingId: 'B' })
    expect(readB()[0]).toMatchObject({ status: 'arrived', assignedTableId: '102' })
    expect(cloud.pendingTableStealCandidates()).toEqual([])
  })

  it('拉取前店員已自己改動該桌（例如清桌）→ 不採用雲端、不動訂位', async () => {
    seatLocallyB()
    global.fetch = vi.fn(async () => conflict())
    await cloud.pushChangedData().catch(() => {})
    localStorage.setItem(TK, JSON.stringify([{ ...VACANT, status: 'cleaning' }]))
    const applied = cloud.applyCloudSnapshot({ tables: [cloudA], bookings: [bookingA], waitlist: [] })
    expect(applied.tableStealsResolved).toBeUndefined()
    expect(readT()[0].status).toBe('cleaning')
    expect(readB().find(x => x.id === 'B').status).toBe('arrived')
  })

  it('大組：102 被搶、103 本機也由 B 用餐中但雲端沒收到 → 103 改採雲端（空桌）、B 退回待到', async () => {
    localStorage.clear(); vi.resetModules(); cloud = await import('../../src/services/cloudDataService')
    const V103 = { ...VACANT, number: '103' }
    cloud.applyCloudSnapshot({ tables: [VACANT, V103], bookings: [], waitlist: [] })
    localStorage.setItem(TK, JSON.stringify([
      { ...VACANT, status: 'dining', currentBookingId: 'B', seatedAt: 't' },
      { ...V103, status: 'dining', currentBookingId: 'B', seatedAt: 't' },
    ]))
    localStorage.setItem(BK, JSON.stringify([{ id: 'B', name: '王先生', status: 'arrived', assignedTableId: '102', extraTableIds: ['103'] }]))
    global.fetch = vi.fn(async () => conflict())
    const err = await cloud.pushChangedData().catch(e => e)
    // 後端 body.tables 只列 102 → 候選與文案只列 102（103 沒被搶）
    expect(err.tableStealMessage).toBe('102 已被另一台帶位，王先生請重新帶位')
    expect(cloud.pendingTableStealCandidates()).toEqual([{ tableNumber: '102', bookingId: 'B' }])
    const applied = cloud.applyCloudSnapshot({ tables: [cloudA, V103], bookings: [bookingA], waitlist: [] })
    expect(applied.tableStealsResolved).toEqual([{ tableNumber: '102', bookingId: 'B', name: '王先生', kind: 'evict' }])
    const t = Object.fromEntries(readT().map(x => [x.number, x]))
    expect(t['102']).toMatchObject({ currentBookingId: 'A' })
    expect(t['103']).toMatchObject({ status: 'vacant', currentBookingId: null })
    expect(readB().find(x => x.id === 'B')).toMatchObject({ status: 'confirmed', assignedTableId: null, extraTableIds: [] })
    global.fetch = vi.fn(async () => okAck())
    await cloud.pushChangedData()
    expect(bodyOf(global.fetch.mock.calls[0]).tables).toBeUndefined()
  })

  it('大組加桌：B 已同步坐 103，加 102 時 102 被另一台帶給 A → 103 不動、B 只拿掉 102（主桌升 103）、仍用餐中', async () => {
    localStorage.clear(); vi.resetModules(); cloud = await import('../../src/services/cloudDataService')
    const B103 = { ...VACANT, number: '103', status: 'dining', currentBookingId: 'B', seatedAt: 't0' }
    const bookingB = { id: 'B', name: '王先生', status: 'arrived', assignedTableId: '103', extraTableIds: [], actualArrivalTime: 't0' }
    cloud.applyCloudSnapshot({ tables: [VACANT, B103], bookings: [bookingB], waitlist: [] })
    // 本機加 102 並把主桌改成 102（主桌被搶的分支）
    localStorage.setItem(TK, JSON.stringify([{ ...VACANT, status: 'dining', currentBookingId: 'B', seatedAt: 't1' }, B103]))
    localStorage.setItem(BK, JSON.stringify([{ ...bookingB, assignedTableId: '102', extraTableIds: ['103'] }]))
    global.fetch = vi.fn(async () => conflict())
    const err = await cloud.pushChangedData().catch(e => e)
    expect(err.tableStealMessage).toBe('102 已被另一台帶位，王先生這組請改用其他桌')
    const applied = cloud.applyCloudSnapshot({ tables: [cloudA, B103], bookings: [bookingA, bookingB], waitlist: [] })
    expect(applied.tableStealsResolved).toEqual([{ tableNumber: '102', bookingId: 'B', name: '王先生', kind: 'trim' }])
    const t = Object.fromEntries(readT().map(x => [x.number, x]))
    expect(t['102']).toMatchObject({ status: 'dining', currentBookingId: 'A' })
    expect(t['103']).toMatchObject({ status: 'dining', currentBookingId: 'B' })
    expect(readB().find(x => x.id === 'B')).toMatchObject({ status: 'arrived', assignedTableId: '103', extraTableIds: [], actualArrivalTime: 't0' })
    global.fetch = vi.fn(async () => okAck())
    expect((await cloud.pushChangedData()).skipped).toBe(true) // B 回到與雲端一致，102／103 都不再待推
  })

  it('大組預配 101＋102（雲端 reserved Y），102 被另一台帶給 A，本機讓 Y 入座兩桌 → evict：101 回 reserved Y、Y confirmed 帶 101', async () => {
    localStorage.clear(); vi.resetModules(); cloud = await import('../../src/services/cloudDataService')
    const R101 = { ...VACANT, number: '101', status: 'reserved', currentBookingId: 'Y' }
    const R102 = { ...VACANT, status: 'reserved', currentBookingId: 'Y' }
    const bookingY = { id: 'Y', name: '林小姐', status: 'confirmed', assignedTableId: '101', extraTableIds: ['102'], actualArrivalTime: null }
    cloud.applyCloudSnapshot({ tables: [R101, R102], bookings: [bookingY], waitlist: [] })
    // 本機（舊快照）：Y 到店入座 101＋102
    localStorage.setItem(TK, JSON.stringify([{ ...R101, status: 'dining', seatedAt: 't' }, { ...R102, status: 'dining', seatedAt: 't' }]))
    localStorage.setItem(BK, JSON.stringify([{ ...bookingY, status: 'arrived', actualArrivalTime: 't' }]))
    global.fetch = vi.fn(async () => conflict())
    const err = await cloud.pushChangedData().catch(e => e)
    expect(err.tableStealMessage).toBe('102 已被另一台帶位，林小姐請重新帶位')
    // 雲端：A 台已在 102 帶入 X（覆蓋預配）；101 仍 reserved Y
    const X102 = { ...VACANT, status: 'dining', currentBookingId: 'X', seatedAt: 't-x' }
    const applied = cloud.applyCloudSnapshot({ tables: [R101, X102], bookings: [bookingY, { id: 'X', name: '陳', status: 'arrived', assignedTableId: '102' }], waitlist: [] })
    expect(applied.tableStealsResolved).toEqual([{ tableNumber: '102', bookingId: 'Y', name: '林小姐', kind: 'evict' }])
    const t = Object.fromEntries(readT().map(x => [x.number, x]))
    expect(t['101']).toEqual(R101)
    expect(t['102']).toMatchObject({ status: 'dining', currentBookingId: 'X' })
    expect(readB().find(x => x.id === 'Y')).toMatchObject({ status: 'confirmed', assignedTableId: '101', extraTableIds: [], actualArrivalTime: null })
    global.fetch = vi.fn(async () => okAck())
    const r = await cloud.pushChangedData()
    if (!r.skipped) {
      const ds = bodyOf(global.fetch.mock.calls[0])
      expect(ds.tables).toBeUndefined()
      expect(ds.bookings.map(b => b.id)).toEqual(['Y'])
    }
  })

  it('本機訂位過時（不 dirty、仍 arrived）但雲端 Y 已完成：只改了 102 佈局被擋 → adopt，不把雲端完成的 Y 清掉', async () => {
    localStorage.clear(); vi.resetModules(); cloud = await import('../../src/services/cloudDataService')
    const Y102 = { ...VACANT, status: 'dining', currentBookingId: 'Y', seatedAt: 't' }
    const bookingY = { id: 'Y', name: '林小姐', status: 'arrived', assignedTableId: '102', extraTableIds: [], actualArrivalTime: 't' }
    cloud.applyCloudSnapshot({ tables: [Y102], bookings: [bookingY], waitlist: [] })
    localStorage.setItem(TK, JSON.stringify([{ ...Y102, x: 77 }]))   // 只改佈局
    global.fetch = vi.fn(async () => conflict())
    await cloud.pushChangedData().catch(() => {})
    const completedY = { ...bookingY, status: 'completed' }
    const applied = cloud.applyCloudSnapshot({ tables: [cloudA], bookings: [completedY, bookingA], waitlist: [] })
    expect(applied.tableStealsResolved[0].kind).toBe('adopt')
    expect(readT()[0]).toMatchObject({ status: 'dining', currentBookingId: 'A', x: 77 })
    expect(readB().find(x => x.id === 'Y')).toEqual(completedY)
    global.fetch = vi.fn(async () => okAck())
    await cloud.pushChangedData()
    const ds = bodyOf(global.fetch.mock.calls[0])
    expect(ds.bookings).toBeUndefined()
    expect(ds.tables.every(x => x.currentBookingId === 'A')).toBe(true)   // 只剩佈局草稿
  })

  it('預配被擋：本機把 Y 預配（reserved）到雲端正在用餐的 102 → 改採雲端、Y 只拿掉 102、狀態不變', async () => {
    localStorage.setItem(TK, JSON.stringify([{ ...VACANT, status: 'reserved', currentBookingId: 'Y' }]))
    localStorage.setItem(BK, JSON.stringify([{ id: 'Y', name: '林小姐', status: 'confirmed', assignedTableId: '102', extraTableIds: [] }]))
    global.fetch = vi.fn(async () => conflict())
    const err = await cloud.pushChangedData().catch(e => e)
    expect(err).toMatchObject({ tableStealConflict: true })
    expect(err.tableStealMessage).toBe('102 已被另一台帶位，林小姐的預配已取消，請改配其他桌')
    expect(cloud.pendingTableStealCandidates()).toEqual([{ tableNumber: '102', bookingId: 'Y' }])
    const applied = cloud.applyCloudSnapshot({ tables: [cloudA], bookings: [bookingA], waitlist: [] })
    expect(applied.tableStealsResolved[0].kind).toBe('preassign')
    expect(readT()[0]).toMatchObject({ status: 'dining', currentBookingId: 'A' })
    expect(readB().find(x => x.id === 'Y')).toMatchObject({ status: 'confirmed', assignedTableId: null, extraTableIds: [] })
    global.fetch = vi.fn(async () => okAck())
    await cloud.pushChangedData()
    const ds = bodyOf(global.fetch.mock.calls[0])
    expect(ds.tables).toBeUndefined()
    expect(ds.bookings.map(b => b.id)).toEqual(['Y'])
  })

  it('結帳後才推（cleaning 保留 currentBookingId=Y、Y 已完成）被擋 → 改採雲端桌、Y 訂位不動、不再夾帶 102', async () => {
    localStorage.setItem(TK, JSON.stringify([{ ...VACANT, status: 'cleaning', currentBookingId: 'Y' }]))
    localStorage.setItem(BK, JSON.stringify([{ id: 'Y', name: '林小姐', status: 'completed', assignedTableId: '102', extraTableIds: [] }]))
    global.fetch = vi.fn(async () => conflict())
    const err = await cloud.pushChangedData().catch(e => e)
    expect(err.tableStealMessage).toBe('102 已被另一台帶位，已改用最新桌況')
    const applied = cloud.applyCloudSnapshot({ tables: [cloudA], bookings: [bookingA], waitlist: [] })
    expect(applied.tableStealsResolved[0].kind).toBe('adopt')
    expect(readT()[0]).toMatchObject({ status: 'dining', currentBookingId: 'A' })
    expect(readB().find(x => x.id === 'Y')).toMatchObject({ status: 'completed', assignedTableId: '102' })
    global.fetch = vi.fn(async () => okAck())
    await cloud.pushChangedData()
    expect(bodyOf(global.fetch.mock.calls[0]).tables).toBeUndefined()
  })
})
