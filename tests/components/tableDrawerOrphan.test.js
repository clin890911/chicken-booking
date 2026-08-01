// TableDrawer 的「孤兒桌」判定：桌況說有人（已預訂／用餐中）卻找不到對應訂位。
// 抽成純函式方便單測（不必掛載整個 TableDrawer，那需要 BookingProvider/AuthProvider/
// ToastProvider/ConfirmProvider 才能跑，不划算，見 tests/components/bookingCardNoshow.test.js
// 的 markNoshow 同一套手法）。
//
// 為什麼這個判定值得鎖：TableDrawer 下方 reserved/dining 兩段動作鈕的渲染條件都要 booking
// （`table.status === 'reserved' && booking`），孤兒桌會讓抽屜變成「一顆鈕都沒有」——
// vacant/cleaning/blocked 的分支也全都不成立——桌就一直佔著可訂容量，只能等換日掃除。
// 反過來，團體桌的出口在 GroupTableSection 內是通的，誤判成孤兒會多長一顆「強制釋出」，
// 讓店員把整梯團體的桌收掉，比原本的問題更糟。兩個方向都要鎖住。
import { describe, it, expect } from 'vitest'
import { isOrphanTable } from '../../src/components/admin/floormap/TableDrawer.jsx'

const booking = { id: 'BK1', name: '王小明' }
const groupRef = { id: 'G1', agencyName: '好玩旅行社' }

describe('isOrphanTable（孤兒桌判定）', () => {
  it('reserved 但查無訂位 → 是孤兒（抽屜會零出口）', () => {
    expect(isOrphanTable({ status: 'reserved', currentBookingId: 'GONE' }, null, null)).toBe(true)
  })

  it('dining 但查無訂位 → 是孤兒', () => {
    expect(isOrphanTable({ status: 'dining', currentBookingId: 'GONE' }, null, null)).toBe(true)
  })

  it('reserved 且找得到訂位 → 不是孤兒（常規動作鈕會出現）', () => {
    expect(isOrphanTable({ status: 'reserved' }, booking, null)).toBe(false)
  })

  it('dining 且找得到訂位 → 不是孤兒', () => {
    expect(isOrphanTable({ status: 'dining' }, booking, null)).toBe(false)
  })

  it('★ 團體桌（currentRef 指向存在的團）不算孤兒——出口在 GroupTableSection，誤判會讓店員把整梯的桌收掉', () => {
    expect(isOrphanTable({ status: 'dining', currentBookingId: null }, null, groupRef)).toBe(false)
    expect(isOrphanTable({ status: 'reserved', currentBookingId: null }, null, groupRef)).toBe(false)
  })

  it('vacant / cleaning / blocked 都不算孤兒（這些狀態本來就有自己的動作鈕）', () => {
    expect(isOrphanTable({ status: 'vacant' }, null, null)).toBe(false)
    expect(isOrphanTable({ status: 'cleaning' }, null, null)).toBe(false)
    expect(isOrphanTable({ status: 'blocked' }, null, null)).toBe(false)
  })

  it('沒有桌（抽屜未選桌）→ false，不炸', () => {
    expect(isOrphanTable(null, null, null)).toBe(false)
    expect(isOrphanTable(undefined, null, null)).toBe(false)
  })
})
