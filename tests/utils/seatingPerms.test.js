import { describe, it, expect } from 'vitest'
import { seatingPerms, ACTION_WRITES, COLLECTION_PERM } from '../../src/utils/seatingPerms.js'
import { PERMISSIONS as FRONT } from '../../src/contexts/AuthContext.jsx'
import { PERMISSIONS as BACK, canWriteCollection, STAFF_ROLES } from '../../functions/lib/staffAccess.js'

// 前端按鈕權限門（seatingPerms）必須與後端 adminPushData 的集合權限一致：
// 按鈕放行 ⇒ 該動作寫的每個集合後端都收；否則就是「按得下去、雲端沒寫進去」的靜默不一致。
const canOf = (role) => (perm) => FRONT[role].has(perm)

describe('seatingPerms：前端放行必須蘊含後端收得下', () => {
  it('前後端 PERMISSIONS 角色集合與權限字串逐角色相同（成對維護）', () => {
    expect(Object.keys(FRONT).sort()).toEqual([...STAFF_ROLES].sort())
    for (const role of STAFF_ROLES) {
      expect([...FRONT[role]].sort()).toEqual([...BACK[role]].sort())
    }
  })

  it('COLLECTION_PERM 與後端 canWriteCollection 逐角色一致', () => {
    for (const role of STAFF_ROLES) {
      for (const [col, perm] of Object.entries(COLLECTION_PERM)) {
        expect(canWriteCollection(role, col), `${role}/${col}`).toBe(FRONT[role].has(perm))
      }
    }
  })

  it('每個角色、每個動作群組：flag 為 true ⇒ 所寫集合後端全部可寫', () => {
    const flagOf = { clearTable: 'table', seatBooking: 'seat', walkIn: 'walkIn', seatWaitlist: 'waitlistSeat', groupWrite: 'group' }
    for (const role of STAFF_ROLES) {
      const perms = seatingPerms(canOf(role))
      for (const [action, cols] of Object.entries(ACTION_WRITES)) {
        if (perms[flagOf[action]]) {
          cols.forEach(col => expect(canWriteCollection(role, col), `${role} ${action}→${col}`).toBe(true))
        }
      }
    }
  })

  it('既有角色政策不變：manager/floor/host 現場動作全開、kitchen 全關；host 無 block', () => {
    for (const role of ['manager', 'floor', 'host']) {
      const p = seatingPerms(canOf(role))
      expect({ table: p.table, seat: p.seat, walkIn: p.walkIn, waitlistSeat: p.waitlistSeat, group: p.group })
        .toEqual({ table: true, seat: true, walkIn: true, waitlistSeat: true, group: true })
    }
    expect(seatingPerms(canOf('manager')).block).toBe(true)
    expect(seatingPerms(canOf('floor')).block).toBe(true)
    expect(seatingPerms(canOf('host')).block).toBe(false)
    expect(Object.values(seatingPerms(canOf('kitchen'))).every(v => v === false)).toBe(true)
  })

  it('只有 table.update 的角色（假想自訂角色）：只能清桌，不能碰訂位／候位／團單', () => {
    const p = seatingPerms(perm => perm === 'table.update')
    expect(p).toMatchObject({ table: true, seat: false, walkIn: false, waitlistSeat: false, group: false, block: false })
  })

  it('有 table.update＋booking.update 但無 waitlist.update：訂位入座可、候位入座不可', () => {
    const p = seatingPerms(perm => ['table.update', 'booking.update'].includes(perm))
    expect(p).toMatchObject({ seat: true, walkIn: true, waitlistSeat: false, group: false })
  })

  it('can 缺席／回 undefined 一律當無權', () => {
    expect(Object.values(seatingPerms(undefined)).every(v => v === false)).toBe(true)
    expect(Object.values(seatingPerms(() => undefined)).every(v => v === false)).toBe(true)
  })
})
