import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { todayStr } from '../../src/utils/timeSlots'

// 同型缺口的補強：BookingCard（useBookingActions）、GroupTodayCard、WaitlistPanel「入座」
// 的按鈕權限依「實際寫入集合」判定。見 src/utils/seatingPerms.js；TableDrawer 版在 tableDrawerPermissions.test.jsx。
// 角色矩陣綁真實 PERMISSIONS。

globalThis.IS_REACT_ACT_ENVIRONMENT = true

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
const BookingCard = (await import('../../src/components/booking/BookingCard')).default
const GroupTodayCard = (await import('../../src/components/admin/ops/GroupTodayCard')).default
const WaitlistPanel = (await import('../../src/components/admin/ops/WaitlistPanel')).default

const roleCan = (role) => (p) => PERMISSIONS[role].has(p)
const canOnly = (...perms) => (p) => perms.includes(p)

let container, root
const mount = (el) => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => { root.render(el) })
}
const hasBtn = (text) => [...container.querySelectorAll('button')].some(b => b.textContent.includes(text))
beforeEach(() => { vi.clearAllMocks() })
afterEach(() => { act(() => root?.unmount()); container?.remove() })

describe('BookingCard 動作鈕權限', () => {
  const TODAY = todayStr()
  const mk = (over = {}) => ({
    id: 'B1', name: '余先生', phone: '0933111222', guests: 2, date: TODAY, timeSlot: '11:00',
    status: 'confirmed', source: 'walkin', assignedTableId: '105', extraTableIds: [], notes: {}, ...over,
  })
  const render = (booking, can) => {
    currentCan = can
    Object.assign(ctx, {
      tables: [{ number: '105', capacity: 4, floor: '1F', isActive: true, status: 'vacant', currentBookingId: null }],
      bookings: [booking], groupReservations: [], settings: {},
      seatBooking: vi.fn(), findReserveCandidates: vi.fn(() => ({ kind: 'hold', tables: [] })),
      checkoutBooking: vi.fn(), finalizeBooking: vi.fn(), cancelBooking: vi.fn(), undoCancelBooking: vi.fn(),
      setStatus: vi.fn(), clearTable: vi.fn(), clearBookingPreassign: vi.fn(),
    })
    mount(<BookingCard booking={booking} onAssign={() => {}} onMove={() => {}} />)
    act(() => { container.querySelector('summary')?.click() })
  }

  it.each(['manager', 'floor', 'host'])('%s：客人到了／改桌／編輯／No-show／取消都在', (role) => {
    render(mk(), roleCan(role))
    for (const t of ['客人到了', '改桌', '編輯', '標 No-show', '取消訂位']) expect(hasBtn(t), `${role} ${t}`).toBe(true)
  })
  it('kitchen：一顆動作鈕都沒有', () => {
    render(mk(), roleCan('kitchen'))
    for (const t of ['客人到了', '改桌', '編輯', '標 No-show', '取消訂位']) expect(hasBtn(t), t).toBe(false)
  })
  it('只有 table.update：不給客人到了／取消（會寫 bookings）', () => {
    render(mk(), canOnly('table.update'))
    expect(hasBtn('客人到了')).toBe(false)
    expect(hasBtn('取消訂位')).toBe(false)
  })
  it('只有 booking.update（寫不了 tables）：不給入座／取消／改桌／編輯，但仍可標 No-show（只改 booking）', () => {
    render(mk(), canOnly('booking.update'))
    expect(hasBtn('客人到了')).toBe(false)
    expect(hasBtn('取消訂位')).toBe(false)
    expect(hasBtn('改桌')).toBe(false)
    expect(hasBtn('編輯')).toBe(false)
    expect(hasBtn('標 No-show')).toBe(true)
  })
  it('未指派桌的今日待到：指派桌位鈕同樣依 booking＋table 權限', () => {
    render(mk({ assignedTableId: null }), roleCan('host'))
    expect(hasBtn('指派桌位')).toBe(true)
    act(() => root.unmount()); container.remove()
    render(mk({ assignedTableId: null }), roleCan('kitchen'))
    expect(hasBtn('指派桌位')).toBe(false)
  })
})

describe('GroupTodayCard 動作鈕權限', () => {
  const batch = { id: 'BT1', label: '第一梯', timeSlot: '12:30', guests: 20, tableNumbers: ['105'] }
  const group = { id: 'G1', agencyName: '某旅行社', guideName: '導', status: 'confirmed', counts: { total: 20 }, batches: [batch] }
  const render = (can) => {
    currentCan = can
    Object.assign(ctx, {
      tables: [{ number: '105', capacity: 6, floor: '1F', isActive: true, status: 'vacant', currentBookingId: null, currentRef: null }],
      seatGroupBatch: vi.fn(), checkoutGroupBatch: vi.fn(), releaseGroupBatch: vi.fn(), finalizeGroup: vi.fn(), setGroupStatus: vi.fn(),
    })
    mount(<GroupTodayCard group={group} />)
  }
  it.each(['manager', 'floor', 'host'])('%s：梯次入座＋整團完成', (role) => {
    render(roleCan(role))
    expect(hasBtn('梯次入座')).toBe(true)
    expect(hasBtn('整團完成')).toBe(true)
  })
  it('kitchen：沒有任何操作鈕（回傳單仍可看）', () => {
    render(roleCan('kitchen'))
    expect(hasBtn('梯次入座')).toBe(false)
    expect(hasBtn('整團完成')).toBe(false)
  })
  it('table.update 但無 group.update：不能入座／完成（會寫團單）', () => {
    render(canOnly('table.update', 'booking.update'))
    expect(hasBtn('梯次入座')).toBe(false)
    expect(hasBtn('整團完成')).toBe(false)
  })
})

describe('WaitlistPanel「入座」鈕權限（寫 waitlist＋bookings＋tables）', () => {
  const wait = { id: 'W1', queueNumber: 1, status: 'waiting', name: '候位王', partySize: 2, takenAt: new Date().toISOString() }
  const render = (can) => {
    currentCan = can
    Object.assign(ctx, { waitlist: [wait], skipWaitlist: vi.fn(), returnWaitlist: vi.fn(), leaveWaitlist: vi.fn(), callWaitlist: vi.fn(), addWaitlist: vi.fn() })
    mount(<WaitlistPanel onSeatWaitlist={() => {}} />)
  }
  const exact = (t) => [...container.querySelectorAll('button')].some(b => b.textContent.trim() === t)
  it.each(['manager', 'floor', 'host'])('%s：入座與叫號都在', (role) => {
    render(roleCan(role))
    expect(exact('入座')).toBe(true)
    expect(exact('叫號')).toBe(true)
  })
  it('只有 waitlist.update（寫不了 bookings／tables）：不給入座，叫號仍在（只寫 waitlist）', () => {
    render(canOnly('waitlist.update'))
    expect(exact('入座')).toBe(false)
    expect(exact('叫號')).toBe(true)
  })
})
