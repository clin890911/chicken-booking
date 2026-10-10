// assignAndSeatBooking 入座失敗時的倒回分支（指派成功、入座意外失敗）
// 情境：選兩張桌併桌入座，指派那一刻其中一張被別的裝置／別筆搶先鎖走（以 mock reserveTable 模擬），
// seatBooking 的佔用守門擋下 → 必須把剛才的指派倒回：訂位回未配桌、只釋放本筆持有的桌、別筆的桌不動。
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('../../src/services/tableService', async (importOriginal) => {
  const mod = await importOriginal()
  return { ...mod, reserveTable: vi.fn(mod.reserveTable) }
})

import * as seating from '../../src/services/seatingService'
import * as tableService from '../../src/services/tableService'
import * as bookingService from '../../src/services/bookingService'

function mkTable(number, capacity, floor = '1F') {
  return {
    number, capacity, floor, x: 100, y: 100, w: 80, h: 75, fuel: null, isActive: true,
    status: 'vacant', currentBookingId: null, currentRef: null, seatedAt: null,
    mergedWith: null, blockReason: null, updatedAt: null,
  }
}

afterEach(() => { vi.mocked(tableService.reserveTable).mockReset() })

describe('assignAndSeatBooking：入座失敗 → 倒回指派', () => {
  it('副桌在指派時被別筆鎖走 → 入座失敗；指派清掉、只釋放本筆持有的桌、無殘留預配', async () => {
    const real = (await vi.importActual('../../src/services/tableService')).reserveTable
    tableService.bulkWrite([mkTable('105', 4), mkTable('106', 4)])
    const b = bookingService.create({ name: '大組', phone: '0912345678', guests: 8, date: '2026-06-15', timeSlot: '18:00', source: 'online', status: 'confirmed' })
    const other = bookingService.create({ name: '別筆', phone: '0911111111', guests: 2, date: '2026-06-15', timeSlot: '18:00', source: 'online', status: 'confirmed' })
    // 106 被別筆搶先鎖走（競態）；105 正常鎖給本筆
    vi.mocked(tableService.reserveTable).mockImplementation((n, id) => real(n, String(n) === '106' ? other.id : id))

    const r = seating.assignAndSeatBooking(b.id, ['105', '106'])

    expect(r.ok).toBe(false)
    expect(r.code).toBe('table-occupied')
    // 訂位：指派倒回未配桌、仍待到，沒有殘留預配
    expect(bookingService.getById(b.id)).toMatchObject({ status: 'confirmed', assignedTableId: null, extraTableIds: [] })
    expect(bookingService.getById(b.id).actualArrivalTime ?? null).toBeNull()
    // 本筆持有的 105 → 釋放回空桌
    expect(tableService.getByNumber('105')).toMatchObject({ status: 'vacant', currentBookingId: null })
    // 別筆持有的 106 → 不動
    expect(tableService.getByNumber('106')).toMatchObject({ status: 'reserved', currentBookingId: other.id })
  })

  it('單桌：桌在指派時被別筆鎖走 → 入座失敗；本筆回未配桌、別筆的桌不動', async () => {
    const real = (await vi.importActual('../../src/services/tableService')).reserveTable
    tableService.bulkWrite([mkTable('105', 4)])
    const b = bookingService.create({ name: '林先生', phone: '0912345678', guests: 2, date: '2026-06-15', timeSlot: '18:00', source: 'online', status: 'pending' })
    const other = bookingService.create({ name: '別筆', phone: '0911111111', guests: 2, date: '2026-06-15', timeSlot: '18:00', source: 'online', status: 'confirmed' })
    vi.mocked(tableService.reserveTable).mockImplementation((n) => real(n, other.id))

    const r = seating.assignAndSeatBooking(b.id, ['105'])

    expect(r.ok).toBe(false)
    expect(bookingService.getById(b.id)).toMatchObject({ status: 'pending', assignedTableId: null, extraTableIds: [] })
    expect(tableService.getByNumber('105')).toMatchObject({ status: 'reserved', currentBookingId: other.id })
  })
})
