// adminPushData（真 handler）× 記憶體 Firestore：情境 A7 兩台同時帶同一桌，第二台的推送要整包 409、雲端不被覆蓋。
import { beforeEach, describe, expect, it } from 'vitest'
import { buildAdminPush, createFakeDb } from '../helpers/adminPushHarness'

const VACANT = { number: '102', status: 'vacant', currentBookingId: null, currentRef: null, seatedAt: null }
const seatPush = (bookingId, extra = {}) => ({
  partial: true,
  dataset: {
    tables: [{ ...VACANT, status: 'dining', currentBookingId: bookingId, seatedAt: '2026-11-10T12:00:00.000Z' }],
    bookings: [{ id: bookingId, date: '2026-11-10', status: 'seated', assignedTableId: '102', ...extra }],
  },
})

describe('adminPushData：無版本桌搶桌守門（A7）', () => {
  let fake
  let call
  beforeEach(() => {
    fake = createFakeDb({ 'tables/102': VACANT })
    call = buildAdminPush(fake.db)
  })

  it('第一台帶 A 成功；第二台帶 B 同一桌 → 409 table-occupied-elsewhere（帶桌號），雲端桌與訂位都不被寫', async () => {
    expect((await call('manager', seatPush('WALKIN_A'))).code).toBe(200)
    expect(fake.records.get('tables/102').currentBookingId).toBe('WALKIN_A')
    const r = await call('manager', seatPush('WALKIN_B'))
    expect(r.code).toBe(409)
    expect(r.body).toEqual({ ok: false, error: 'table-occupied-elsewhere', tables: ['102'] })
    expect(fake.records.get('tables/102').currentBookingId).toBe('WALKIN_A')
    expect(fake.records.has('bookings/WALKIN_B')).toBe(false) // 同一交易：整包不寫，不留半套
  })

  it('同一包推送把 A 結束（完成）再帶 B（離線時清桌再帶下一組）→ 放行', async () => {
    await call('manager', seatPush('WALKIN_A'))
    const r = await call('manager', {
      partial: true,
      dataset: {
        tables: [{ ...VACANT, status: 'dining', currentBookingId: 'WALKIN_B', seatedAt: 't2' }],
        bookings: [
          { id: 'WALKIN_A', date: '2026-11-10', status: 'completed', assignedTableId: '102' },
          { id: 'WALKIN_B', date: '2026-11-10', status: 'seated', assignedTableId: '102' },
        ],
      },
    })
    expect(r.code).toBe(200)
    expect(fake.records.get('tables/102').currentBookingId).toBe('WALKIN_B')
  })

  it('A 那台自己清桌（vacant）照舊放行', async () => {
    await call('manager', seatPush('WALKIN_A'))
    const r = await call('manager', { partial: true, dataset: { tables: [VACANT] } })
    expect(r.code).toBe(200)
    expect(fake.records.get('tables/102').status).toBe('vacant')
  })

  it('一包搶兩張桌（102、105 都被別筆用餐中）→ body.tables 列出兩張；103 是空桌不列', async () => {
    fake = createFakeDb({
      'tables/102': { ...VACANT, status: 'dining', currentBookingId: 'A' },
      'tables/103': { ...VACANT, number: '103' },
      'tables/105': { ...VACANT, number: '105', status: 'dining', currentBookingId: 'C' },
    })
    call = buildAdminPush(fake.db)
    const r = await call('manager', { partial: true, dataset: {
      tables: ['102', '103', '105'].map(number => ({ ...VACANT, number, status: 'dining', currentBookingId: 'B' })),
      bookings: [{ id: 'B', date: '2026-11-10', status: 'arrived', assignedTableId: '102', extraTableIds: ['103', '105'] }],
    } })
    expect(r.code).toBe(409)
    expect(r.body.error).toBe('table-occupied-elsewhere')
    expect([...r.body.tables].sort()).toEqual(['102', '105'])
    expect(fake.records.get('tables/103').status).toBe('vacant')
  })

  it('有版本桌的版本圍欄仍回 operational-state-changed、不帶 tables', async () => {
    fake = createFakeDb({ 'tables/102': { ...VACANT, status: 'dining', currentBookingId: 'A', operationalVersion: 3 } })
    call = buildAdminPush(fake.db)
    const r = await call('manager', { partial: true, dataset: { tables: [{ ...VACANT, status: 'vacant', operationalVersion: 2 }] } })
    expect(r.code).toBe(409)
    expect(r.body).toEqual({ ok: false, error: 'operational-state-changed' })
  })
})