import { describe, it, expect } from 'vitest'
import { squeezeSeats, SQUEEZE_PER_TABLE } from '../../src/utils/capacity'

// 擠一擠：大客滿時散客／現場帶位每張桌可多坐 1 位（6 人桌坐 7 位）
describe('squeezeSeats', () => {
  it('每張桌多算 1 位', () => {
    expect(SQUEEZE_PER_TABLE).toBe(1)
    expect(squeezeSeats([{ capacity: 6 }])).toBe(7)
    expect(squeezeSeats([{ capacity: 4 }, { capacity: 4 }])).toBe(10)
  })

  it('容量 0／缺值的桌不加；空清單為 0', () => {
    expect(squeezeSeats([{ capacity: 0 }, {}, null])).toBe(0)
    expect(squeezeSeats([])).toBe(0)
    expect(squeezeSeats()).toBe(0)
  })

  it('字串容量照數字算', () => {
    expect(squeezeSeats([{ capacity: '6' }])).toBe(7)
  })
})
