import { describe, it, expect } from 'vitest'
import { bookingTableNumbers, formatBookingTables } from '../../src/utils/bookingTables'

// 大組併桌：主桌 assignedTableId＋副桌 extraTableIds（兩者存的都是「桌號」字串，不是內部 id）。
// 顯示層一律走這支，不可只看 assignedTableId（8 位配 101＋107 時徽章只剩「101」會讓店員以為只有一張桌）。
describe('bookingTableNumbers／formatBookingTables', () => {
  it('主桌＋副桌 → 依序列出、用 " + " 串接', () => {
    const b = { assignedTableId: '101', extraTableIds: ['107'] }
    expect(bookingTableNumbers(b)).toEqual(['101', '107'])
    expect(formatBookingTables(b)).toBe('101 + 107')
  })
  it('單桌、沒有 extraTableIds 欄位 → 與舊顯示相同', () => {
    expect(formatBookingTables({ assignedTableId: '105' })).toBe('105')
    expect(formatBookingTables({ assignedTableId: '105', extraTableIds: [] })).toBe('105')
  })
  it('去重、去空、數字轉字串', () => {
    expect(formatBookingTables({ assignedTableId: '101', extraTableIds: ['101', '', null, 107] })).toBe('101 + 107')
  })
  it('未配桌 → 空字串（呼叫端自行決定要不要渲染）', () => {
    expect(formatBookingTables({ assignedTableId: null, extraTableIds: [] })).toBe('')
    expect(formatBookingTables(null)).toBe('')
  })
})
