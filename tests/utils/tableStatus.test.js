import { describe, it, expect } from 'vitest'
import { STATUS_ZH, statusZh, assignmentKind } from '../../src/utils/tableStatus'

describe('tableStatus（桌位狀態中文對照）', () => {
  it('五種狀態皆有對照', () => {
    expect(Object.keys(STATUS_ZH).sort()).toEqual(['blocked', 'cleaning', 'dining', 'reserved', 'vacant'])
    expect(statusZh('dining')).toBe('用餐中')
    expect(statusZh('vacant')).toBe('空桌')
    expect(statusZh('cleaning')).toBe('清桌中')
    expect(statusZh('reserved')).toBe('已預訂')
    expect(statusZh('blocked')).toBe('不可用')
  })
  it('未知狀態原樣回傳', () => {
    expect(statusZh('weird')).toBe('weird')
    expect(statusZh(undefined)).toBe(undefined)
  })
})

// assignmentKind：分辨兩種「已指派」。
// 起因（2026-08 店主回報）：同時段兩筆訂位都顯示「已指派」，桌況圖上 111 是藍色、112 是綠色。
// 真正的差別是指派路徑不同——現場頁 assignBookingToTable 會 reserveTable() 鎖桌，
// 規劃頁預配只寫 booking.assignedTableId、桌況不動。
describe('assignmentKind（已指派 vs 預配）', () => {
  const table = (over = {}) => ({ number: '111', status: 'vacant', currentBookingId: null, ...over })
  const booking = (over = {}) => ({ id: 'b1', assignedTableId: '111', ...over })

  it('沒指派桌 → null', () => {
    expect(assignmentKind(booking({ assignedTableId: null }), table())).toBe(null)
    expect(assignmentKind({}, table())).toBe(null)
    expect(assignmentKind(null, table())).toBe(null)
  })

  it('現場指派（桌況 reserved 且指向這筆）→ held', () => {
    expect(assignmentKind(booking(), table({ status: 'reserved', currentBookingId: 'b1' }))).toBe('held')
  })

  it('已入座（dining 且指向這筆）仍算 held', () => {
    expect(assignmentKind(booking(), table({ status: 'dining', currentBookingId: 'b1' }))).toBe('held')
  })

  it('規劃頁預配（桌況沒動、仍是空桌）→ preassign', () => {
    expect(assignmentKind(booking(), table())).toBe('preassign')
  })

  it('桌被別筆訂位鎖走 → 這筆退回 preassign（預配已被覆蓋，不可宣稱桌位到手）', () => {
    expect(assignmentKind(booking(), table({ status: 'reserved', currentBookingId: 'b2' }))).toBe('preassign')
  })

  it('找不到對應的桌（桌號已刪/資料未同步）→ preassign，不當成鎖桌', () => {
    expect(assignmentKind(booking(), undefined)).toBe('preassign')
  })

  it('桌號型別不一致（數字 vs 字串 id）仍比得出來', () => {
    expect(assignmentKind(booking({ id: 7 }), table({ status: 'reserved', currentBookingId: '7' }))).toBe('held')
  })

  it('booking 無 id 時不會與空的 currentBookingId 誤判為 held', () => {
    expect(assignmentKind({ assignedTableId: '111' }, table({ status: 'reserved' }))).toBe('preassign')
  })
})
