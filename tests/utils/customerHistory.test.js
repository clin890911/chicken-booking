import { describe, it, expect } from 'vitest'
import { customerBookings } from '../../src/utils/customerHistory'

describe('customerBookings 顧客來訪記錄', () => {
  const rows = [
    { id: 'a', phone: '0912-345-678', date: '2026-05-03', timeSlot: '12:00' },
    { id: 'b', phone: '0912345678', date: '2026-06-18', timeSlot: '18:00' },
    { id: 'c', phone: '(0912) 345 678', date: '2026-06-18', timeSlot: '11:30' },
    { id: 'd', phone: '0999888777', date: '2026-06-01', timeSlot: '18:00' },
  ]

  it('依正規化電話比對（忽略空白/連字號/括號）', () => {
    const h = customerBookings(rows, '0912 345 678')
    expect(h.map(b => b.id)).toEqual(['b', 'c', 'a']) // 同一顧客三筆
  })

  it('最新在前：日期 desc，同日再比時段 desc', () => {
    const h = customerBookings(rows, '0912345678')
    expect(h.map(b => b.id)).toEqual(['b', 'c', 'a']) // 6/18 18:00 → 6/18 11:30 → 5/03
  })

  it('空電話或無相符 → 空陣列', () => {
    expect(customerBookings(rows, '')).toEqual([])
    expect(customerBookings(rows, '0000000000')).toEqual([])
    expect(customerBookings(null, '0912345678')).toEqual([])
  })
})
