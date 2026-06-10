import { describe, it, expect } from 'vitest'
import { STATUS_ZH, statusZh } from '../../src/utils/tableStatus'

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
