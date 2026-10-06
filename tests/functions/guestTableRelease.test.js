// 客人自助改期/取消：主桌＋併桌副桌都要釋放，且只釋放仍由本筆持有的桌（不可覆寫別組）。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import crypto from 'node:crypto'
import { heldTableIdsToRelease } from '../../functions/lib/bookingTableRelease'
import { guestBackendHarness } from '../helpers/guestBackendHarness'

describe('heldTableIdsToRelease（純函式）', () => {
  const booking = { id: 'B1', assignedTableId: 'A1', extraTableIds: ['A2', 'A3'] }
  it('主桌＋副桌中仍由本筆持有者都要放', () => {
    const docs = [
      { id: 'A1', exists: true, currentBookingId: 'B1' },
      { id: 'A2', exists: true, currentBookingId: 'B1' },
      { id: 'A3', exists: true, currentBookingId: 'B1' },
    ]
    expect(heldTableIdsToRelease(booking, docs)).toEqual(['A1', 'A2', 'A3'])
  })
  it('別組持有／預配空桌／不存在的桌一律不放', () => {
    const docs = [
      { id: 'A1', exists: true, currentBookingId: 'OTHER' },
      { id: 'A2', exists: true, currentBookingId: null },
      { id: 'A3', exists: false },
      { id: 'Z9', exists: true, currentBookingId: 'B1' }, // 不屬於這筆的桌，就算指向本筆也不在此處理
    ]
    expect(heldTableIdsToRelease(booking, docs)).toEqual([])
  })
  it('只有副桌仍由本筆持有 → 只放副桌', () => {
    const docs = [
      { id: 'A1', exists: true, currentBookingId: 'OTHER' },
      { id: 'A2', exists: true, currentBookingId: 'B1' },
    ]
    expect(heldTableIdsToRelease(booking, docs)).toEqual(['A2'])
  })
})

describe('guestUpdateBooking / guestCancelBooking 交易釋桌（真 handler）', () => {
  let h
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 9, 5, 12)); h = guestBackendHarness() })
  afterEach(() => vi.useRealTimers())

  async function seedComboBooking() {
    const created = await h.call('guestCreateBooking', {
      submissionKey: crypto.randomBytes(32).toString('hex'),
      name: '假資料', phone: '0900000000', date: '2026-10-05', timeSlot: '18:00', guests: 8, notes: {},
    })
    expect(created.code).toBe(200)
    const b = created.body.booking
    h.records.set('bookings/' + b.id, { ...h.records.get('bookings/' + b.id), assignedTableId: 'A1', extraTableIds: ['A2', 'A3'] })
    h.records.set('tables/A1', { number: 'A1', capacity: 4, isActive: true, status: 'reserved', currentBookingId: b.id })
    h.records.set('tables/A2', { number: 'A2', capacity: 4, isActive: true, status: 'reserved', currentBookingId: b.id })
    h.records.set('tables/A3', { number: 'A3', capacity: 4, isActive: true, status: 'dining', currentBookingId: 'OTHER' })
    return b
  }

  it('改人數（結構性）→ 主桌＋副桌都釋放、清 extraTableIds；別組接手的副桌不動', async () => {
    const b = await seedComboBooking()
    const r = await h.call('guestUpdateBooking', { bookingId: b.id, token: b.manageToken, patch: { guests: 6 } })
    expect(r.code).toBe(200)
    const saved = h.records.get('bookings/' + b.id)
    expect(saved.assignedTableId).toBeNull()
    expect(saved.extraTableIds).toEqual([])
    expect(h.records.get('tables/A1')).toMatchObject({ status: 'vacant', currentBookingId: null })
    expect(h.records.get('tables/A2')).toMatchObject({ status: 'vacant', currentBookingId: null })
    expect(h.records.get('tables/A3')).toMatchObject({ status: 'dining', currentBookingId: 'OTHER' })
  })

  it('非結構性修改（只改備註）→ 不解除、不動桌', async () => {
    const b = await seedComboBooking()
    const r = await h.call('guestUpdateBooking', { bookingId: b.id, token: b.manageToken, patch: { notes: { text: '改備註' } } })
    expect(r.code).toBe(200)
    expect(h.records.get('bookings/' + b.id).extraTableIds).toEqual(['A2', 'A3'])
    expect(h.records.get('tables/A2')).toMatchObject({ status: 'reserved', currentBookingId: b.id })
  })

  it('主桌已被別組接手 → 改期不可覆寫主桌（過去無條件寫 vacant）', async () => {
    const b = await seedComboBooking()
    h.records.set('tables/A1', { number: 'A1', capacity: 4, isActive: true, status: 'dining', currentBookingId: 'OTHER' })
    const r = await h.call('guestUpdateBooking', { bookingId: b.id, token: b.manageToken, patch: { guests: 6 } })
    expect(r.code).toBe(200)
    expect(h.records.get('tables/A1')).toMatchObject({ status: 'dining', currentBookingId: 'OTHER' })
    expect(h.records.get('tables/A2')).toMatchObject({ status: 'vacant', currentBookingId: null })
  })

  it('客人取消 → 主桌＋副桌釋放、清 extraTableIds；別組的桌不動', async () => {
    const b = await seedComboBooking()
    const r = await h.call('guestCancelBooking', { bookingId: b.id, token: b.manageToken })
    expect(r.code).toBe(200)
    const saved = h.records.get('bookings/' + b.id)
    expect(saved.status).toBe('cancelled')
    expect(saved.assignedTableId).toBeNull()
    expect(saved.extraTableIds).toEqual([])
    expect(h.records.get('tables/A1')).toMatchObject({ status: 'vacant', currentBookingId: null })
    expect(h.records.get('tables/A2')).toMatchObject({ status: 'vacant', currentBookingId: null })
    expect(h.records.get('tables/A3')).toMatchObject({ status: 'dining', currentBookingId: 'OTHER' })
  })
})
