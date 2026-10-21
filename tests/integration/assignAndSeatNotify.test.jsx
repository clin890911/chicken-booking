import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { INITIAL_TABLES } from '../../src/data/tables'
import { todayStr } from '../../src/utils/timeSlots'

// 未配桌訂位「到了 · 選桌入座」：BookingContext 包裝只發一則 Telegram（客人到了），
// 不另發「桌位已指派」——對店員群組而言這是一個動作，發兩則會被誤會成兩組客人。
// 掛真正的 BookingProvider（本機模式，雲端整個 mock 掉），telegramService 全部換成 spy。

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const h = vi.hoisted(() => ({
  auth: null,
  ctx: null,
  useBooking: null,
  toast: { success: () => {}, error: () => {}, warning: () => {}, info: () => {}, action: () => {} },
}))
vi.mock('../../src/contexts/AuthContext', () => ({ useAuth: () => h.auth }))
vi.mock('../../src/components/ui/Toast', () => ({ useToast: () => h.toast, useConfirm: () => vi.fn(async () => true) }))
vi.mock('../../src/services/telegramService', async (importOriginal) => {
  const mod = await importOriginal()
  return Object.fromEntries(Object.entries(mod).map(([k, v]) => [k, typeof v === 'function' ? vi.fn(async () => {}) : v]))
})
vi.mock('../../src/services/cloudDataService', () => ({
  setAuthTokenProvider: () => {},
  pullCloudData: async () => ({}),
  applyCloudSnapshot: () => {},
  hasPulledCloud: () => true,
  pushChangedData: async () => ({ ok: true, skipped: true }),
  isSyncPersistDegraded: () => false,
  operationalRequest: async () => ({ items: [] }),
  discardRejectedChanges: () => {},
  markLocalAsSynced: () => {},
  pushCloudData: async () => ({ ok: true }),
  localDataset: () => ({}),
}))

import * as tg from '../../src/services/telegramService'

function Probe() {
  h.ctx = h.useBooking()
  return null
}

describe('選桌入座只發一則 Telegram', { timeout: 30_000 }, () => {
  let root
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
  })
  afterEach(async () => {
    await act(async () => { root?.unmount() })
    root = null
  })

  it('assignAndSeatBooking 成功 → notifyBookingArrived 一次、notifyBookingAssigned 零次', async () => {
    const tables = JSON.parse(JSON.stringify(INITIAL_TABLES))
    const t = tables.find(x => Number(x.capacity) >= 4 && x.isActive !== false)
    localStorage.setItem('chicken_tables_v3', JSON.stringify(tables))
    localStorage.setItem('chicken_bookings_v1', JSON.stringify([{ id: 'b-1', name: '林先生', phone: '0911000111',
      guests: 3, date: todayStr(), timeSlot: '18:00', status: 'confirmed', assignedTableId: null, extraTableIds: [], source: 'online' }]))

    h.auth = { user: { email: 'm@example.invalid', role: 'manager' }, getToken: async () => 't', usingFirebase: false, can: () => true }
    const { BookingProvider, useBooking } = await import('../../src/contexts/BookingContext')
    h.useBooking = useBooking
    root = createRoot(document.createElement('div'))
    await act(async () => { root.render(<BookingProvider><Probe /></BookingProvider>) })
    vi.clearAllMocks()   // 開機掃除等若有通知不計

    let r
    await act(async () => { r = h.ctx.assignAndSeatBooking('b-1', [t.number]) })

    expect(r.ok).toBe(true)
    expect(tg.notifyBookingArrived).toHaveBeenCalledTimes(1)
    expect(tg.notifyBookingArrived.mock.calls[0][0]).toMatchObject({ id: 'b-1', status: 'arrived' })
    expect(tg.notifyBookingAssigned).not.toHaveBeenCalled()
  })

  it('入座失敗（桌已被佔）→ 一則都不發', async () => {
    const tables = JSON.parse(JSON.stringify(INITIAL_TABLES))
    const t = tables.find(x => Number(x.capacity) >= 4 && x.isActive !== false)
    Object.assign(t, { status: 'dining', currentBookingId: 'b-other', seatedAt: new Date().toISOString() })
    localStorage.setItem('chicken_tables_v3', JSON.stringify(tables))
    localStorage.setItem('chicken_bookings_v1', JSON.stringify([
      { id: 'b-1', name: '林先生', phone: '0911000111', guests: 3, date: todayStr(), timeSlot: '18:00', status: 'confirmed', assignedTableId: null, extraTableIds: [], source: 'online' },
      { id: 'b-other', name: '別組', phone: '0911000222', guests: 2, date: todayStr(), timeSlot: '18:00', status: 'arrived', assignedTableId: t.number, extraTableIds: [], source: 'walkin' },
    ]))

    h.auth = { user: { email: 'm@example.invalid', role: 'manager' }, getToken: async () => 't', usingFirebase: false, can: () => true }
    const { BookingProvider, useBooking } = await import('../../src/contexts/BookingContext')
    h.useBooking = useBooking
    root = createRoot(document.createElement('div'))
    await act(async () => { root.render(<BookingProvider><Probe /></BookingProvider>) })
    vi.clearAllMocks()

    let r
    await act(async () => { r = h.ctx.assignAndSeatBooking('b-1', [t.number]) })

    expect(r.ok).toBe(false)
    expect(tg.notifyBookingArrived).not.toHaveBeenCalled()
    expect(tg.notifyBookingAssigned).not.toHaveBeenCalled()
  })
})
