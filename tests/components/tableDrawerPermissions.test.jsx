import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'

// 桌況抽屜的動作鈕權限：依「實際寫入的集合」判定，而不是只看 table.update。
// 背景見 src/utils/seatingPerms.js。角色矩陣綁真實 PERMISSIONS（改了政策這裡會紅）。

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const TODAY = '2026-09-19'
const NOW = new Date(2026, 8, 19, 12, 20)
let currentCan = () => true
const ctx = {}
const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), action: vi.fn() }
vi.mock('../../src/contexts/BookingContext', () => ({ useBooking: () => ctx }))
vi.mock('../../src/contexts/AuthContext', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, useAuth: () => ({ can: (p) => currentCan(p) }) }
})
vi.mock('../../src/components/ui/Toast', () => ({ useToast: () => toast, useConfirm: () => vi.fn(async () => true) }))
vi.mock('../../src/contexts/HandoffContext', () => ({ useHandoff: () => ({ canWrite: false }) }))

const { PERMISSIONS } = await import('../../src/contexts/AuthContext')
const TableDrawer = (await import('../../src/components/admin/floormap/TableDrawer')).default

const roleCan = (role) => (p) => PERMISSIONS[role].has(p)
const canOnly = (...perms) => (p) => perms.includes(p)

const tbl = (over = {}) => ({ number: '105', capacity: 6, floor: '1F', isActive: true, status: 'vacant', currentBookingId: null, currentRef: null, ...over })
const bk = (over = {}) => ({ id: 'B1', name: '余先生', phone: '0912', guests: 4, date: TODAY, timeSlot: '12:30', status: 'confirmed', assignedTableId: null, extraTableIds: [], notes: {}, ...over })
const wl = { id: 'W1', name: '候位王', phone: '', partySize: 2, status: 'waiting', queueNumber: 7, takenAt: new Date(2026, 8, 19, 12, 0).toISOString() }

function setCtx({ bookings = [], waitlist = [], tables = [tbl()], groupReservations = [] } = {}) {
  Object.assign(ctx, {
    bookings, waitlist, tables, groupReservations, settings: {},
    walkInSeat: vi.fn(), assignBookingToTable: vi.fn(() => ({ ok: true })), seatBooking: vi.fn(() => ({ ok: true })),
    seatWaitlist: vi.fn(() => ({ ok: true })), releaseOverriddenAssignment: vi.fn(), undoAssignBooking: vi.fn(),
    restoreOverriddenAssignment: vi.fn(), blockTable: vi.fn(), unblockTable: vi.fn(), reseatBookingTables: vi.fn(),
    checkoutBooking: vi.fn(), finalizeBooking: vi.fn(), clearTable: vi.fn(), undoClearTable: vi.fn(), cancelBooking: vi.fn(),
    undoCancelBooking: vi.fn(), setTableOutage: vi.fn(), clearTableOutage: vi.fn(),
    seatGroupBatch: vi.fn(() => ({ ok: true })), checkoutGroupBatch: vi.fn(() => ({ ok: true })),
    releaseGroupBatch: vi.fn(() => ({ ok: true })), finalizeGroup: vi.fn(() => ({ ok: true })), seatNextBatchOnTable: vi.fn(() => ({ ok: true })),
  })
}

describe('TableDrawer 動作鈕權限（依實際寫入集合）', () => {
  let container, root
  const mount = (props) => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => { root.render(<TableDrawer table={props.table} booking={props.booking ?? null} preassign={props.preassign ?? null} groupHold={props.groupHold ?? null} onClose={() => {}} onStartMove={() => {}} mode={{}} />) })
  }
  const has = (text) => [...document.querySelectorAll('button')].some(b => b.textContent.includes(text))

  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); vi.clearAllMocks() })
  afterEach(() => { act(() => root?.unmount()); container?.remove(); vi.useRealTimers() })

  describe('空桌：候選名單（過去完全沒有權限檢查）', () => {
    const run = (can) => {
      currentCan = can
      const t = tbl()
      setCtx({ bookings: [bk()], waitlist: [wl], tables: [t] })
      mount({ table: t })
    }
    it('kitchen：看不到任何入座／預訂鈕，也沒有候選名單', () => {
      run(roleCan('kitchen'))
      expect(has('入座')).toBe(false)
      expect(has('預訂')).toBe(false)
      expect(document.body.textContent).not.toContain('可入座 105')
    })
    it.each(['manager', 'floor', 'host'])('%s：訂位入座／預訂、候位入座、散客直接入座都在', (role) => {
      run(roleCan(role))
      expect(document.body.textContent).toContain('余先生')
      expect(document.body.textContent).toContain('候位王')
      expect(has('預訂')).toBe(true)
      expect(has('散客直接入座')).toBe(true)
    })
    it('有 table+booking、無 waitlist.update：只出訂位列，候位列隱藏', () => {
      run(canOnly('table.read', 'table.update', 'booking.read', 'booking.update'))
      expect(document.body.textContent).toContain('余先生')
      expect(document.body.textContent).not.toContain('候位王')
    })
    it('只有 table.update：沒有候選名單、沒有散客入座，仍可設不可用以外的桌況動作', () => {
      run(canOnly('table.update'))
      expect(document.body.textContent).not.toContain('可入座 105')
      expect(has('散客直接入座')).toBe(false)
    })
    it('host 無 table.block：沒有「設不可用／維修停用」（既有政策不變）', () => {
      run(roleCan('host'))
      expect(has('設不可用')).toBe(false)
      expect(has('維修停用')).toBe(false)
    })
    it('manager 有 table.block：有「設不可用／維修停用」', () => {
      run(roleCan('manager'))
      expect(has('設不可用')).toBe(true)
      expect(has('維修停用')).toBe(true)
    })
  })

  describe('已預訂（reserved）：入座／改桌／取消訂位會寫 bookings', () => {
    const run = (can) => {
      currentCan = can
      const b = bk({ assignedTableId: '105' })
      const t = tbl({ status: 'reserved', currentBookingId: 'B1' })
      setCtx({ bookings: [b], tables: [t] })
      mount({ table: t, booking: b })
    }
    it.each(['manager', 'floor', 'host'])('%s：三顆鈕都在', (role) => {
      run(roleCan(role))
      expect(has('客人到了 — 入座')).toBe(true)
      expect(has('改桌')).toBe(true)
      expect(has('取消訂位')).toBe(true)
    })
    it('只有 table.update（寫不了 bookings）：一顆都不給', () => {
      run(canOnly('table.update'))
      expect(has('客人到了 — 入座')).toBe(false)
      expect(has('改桌')).toBe(false)
      expect(has('取消訂位')).toBe(false)
    })
    it('kitchen：一顆都沒有', () => {
      run(roleCan('kitchen'))
      expect(has('入座')).toBe(false)
      expect(has('取消訂位')).toBe(false)
    })
  })

  describe('用餐中（dining）：離席／釋出／換桌會寫 bookings', () => {
    const run = (can) => {
      currentCan = can
      const b = bk({ status: 'arrived', assignedTableId: '105' })
      const t = tbl({ status: 'dining', currentBookingId: 'B1', seatedAt: new Date(2026, 8, 19, 12, 0).toISOString() })
      setCtx({ bookings: [b], tables: [t] })
      mount({ table: t, booking: b })
    }
    it('floor：離席、直接釋出、換桌都在', () => {
      run(roleCan('floor'))
      expect(has('客人已離席')).toBe(true)
      expect(has('直接釋出')).toBe(true)
      expect(has('換桌')).toBe(true)
    })
    it('只有 table.update：不給離席／釋出／換桌', () => {
      run(canOnly('table.update'))
      expect(has('客人已離席')).toBe(false)
      expect(has('直接釋出')).toBe(false)
      expect(has('換桌')).toBe(false)
    })
  })

  describe('待清桌／孤兒桌：只寫 tables，只需 table.update', () => {
    it('只有 table.update 仍可「清桌完成」', () => {
      currentCan = canOnly('table.update')
      const t = tbl({ status: 'cleaning' })
      setCtx({ tables: [t] })
      mount({ table: t })
      expect(has('清桌完成')).toBe(true)
    })
    it('只有 table.update 仍可「強制釋出為空桌」（孤兒桌）', () => {
      currentCan = canOnly('table.update')
      const t = tbl({ status: 'dining', currentBookingId: 'GONE' })
      setCtx({ tables: [t] })
      mount({ table: t })
      expect(has('強制釋出為空桌')).toBe(true)
    })
    it('kitchen：沒有清桌完成', () => {
      currentCan = roleCan('kitchen')
      const t = tbl({ status: 'cleaning' })
      setCtx({ tables: [t] })
      mount({ table: t })
      expect(has('清桌完成')).toBe(false)
    })
  })

  describe('預配客人到了（寫 bookings＋tables）', () => {
    const run = (can) => {
      currentCan = can
      const p = bk({ assignedTableId: '105' })
      const t = tbl()
      setCtx({ bookings: [p], tables: [t] })
      mount({ table: t, preassign: p })
    }
    it('host：有「到了，入座」', () => { run(roleCan('host')); expect(has('到了，入座 105')).toBe(true) })
    it('只有 table.update：沒有', () => { run(canOnly('table.update')); expect(has('到了，入座 105')).toBe(false) })
  })

  describe('團體桌：梯次入座等會寫 groupReservations', () => {
    const group = { id: 'G1', agencyName: '某旅行社', guideName: '導', status: 'confirmed', counts: { total: 20 }, batches: [] }
    const batch = { id: 'BT1', label: '第一梯', timeSlot: '12:30', guests: 20, tableNumbers: ['105'] }
    const holdProps = { holds: [{ group, batch }] }
    const run = (can) => {
      currentCan = can
      const t = tbl()
      setCtx({ tables: [t], groupReservations: [group] })
      mount({ table: t, groupHold: holdProps })
    }
    it.each(['manager', 'floor', 'host'])('%s：梯次入座＋散客覆蓋都在', (role) => {
      run(roleCan(role))
      expect(has('第一梯 入座')).toBe(true)
      expect(has('覆蓋團體預留')).toBe(true)
    })
    it('table.update＋booking.update 但無 group.update：沒有梯次入座，散客覆蓋仍在', () => {
      run(canOnly('table.update', 'booking.update'))
      expect(has('第一梯 入座')).toBe(false)
      expect(has('覆蓋團體預留')).toBe(true)
    })
    it('table.update＋group.update 但無 booking.update：有梯次入座，沒有散客覆蓋', () => {
      run(canOnly('table.update', 'group.update'))
      expect(has('第一梯 入座')).toBe(true)
      expect(has('覆蓋團體預留')).toBe(false)
    })
    it('kitchen：都沒有', () => {
      run(roleCan('kitchen'))
      expect(has('第一梯 入座')).toBe(false)
      expect(has('覆蓋團體預留')).toBe(false)
    })

    it('團體 dining：只有 table.update 可「此梯離席」（只寫 tables），不給「整團完成」（寫團單）', () => {
      currentCan = canOnly('table.update')
      const t = tbl({ status: 'dining', currentRef: { type: 'group', groupId: 'G1', batchId: 'BT1' } })
      setCtx({ tables: [t], groupReservations: [{ ...group, batches: [batch] }] })
      mount({ table: t })
      expect(has('此梯離席')).toBe(true)
      expect(has('整團完成')).toBe(false)
    })
    it('團體 dining：floor 兩顆都在', () => {
      currentCan = roleCan('floor')
      const t = tbl({ status: 'dining', currentRef: { type: 'group', groupId: 'G1', batchId: 'BT1' } })
      setCtx({ tables: [t], groupReservations: [{ ...group, batches: [batch] }] })
      mount({ table: t })
      expect(has('此梯離席')).toBe(true)
      expect(has('整團完成')).toBe(true)
    })
  })
})
