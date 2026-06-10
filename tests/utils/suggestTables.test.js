// 測試：團體預排「一鍵推薦桌位」貪婪選桌。對應 src/utils/suggestTables.js。
import { describe, it, expect } from 'vitest'
import { suggestTablesForBatch } from '../../src/utils/suggestTables'

const mk = (number, capacity, over = {}) => ({ number, capacity, isActive: true, floor: '1F', ...over })

const TABLES = [
  mk('101', 6), mk('102', 6), mk('103', 4),
  mk('201', 6, { floor: '2F' }), mk('202', 4, { floor: '2F' }),
]

describe('suggestTablesForBatch', () => {
  it('取最少桌湊滿人數（容量大優先）', () => {
    const r = suggestTablesForBatch({ tables: TABLES, headcount: 10 })
    // 10 人：兩張 6 人桌（101,102）= 12 席，最少桌
    expect(r.tableNumbers).toEqual(['101', '102'])
    expect(r.seats).toBe(12)
    expect(r.enough).toBe(true)
  })

  it('剛好一桌', () => {
    const r = suggestTablesForBatch({ tables: TABLES, headcount: 6 })
    expect(r.tableNumbers).toEqual(['101'])
    expect(r.seats).toBe(6)
    expect(r.enough).toBe(true)
  })

  it('避開 blockedTables', () => {
    const r = suggestTablesForBatch({ tables: TABLES, headcount: 6, blockedTables: ['101', '102', '201'] })
    // 6 人桌全被佔，退而取 4 人桌：103 + 202 = 8 席
    expect(r.tableNumbers).toContain('103')
    expect(r.enough).toBe(true)
    expect(r.tableNumbers).not.toContain('101')
  })

  it('避開停用桌', () => {
    const tables = [mk('101', 6, { isActive: false }), mk('102', 6)]
    const r = suggestTablesForBatch({ tables, headcount: 6 })
    expect(r.tableNumbers).toEqual(['102'])
  })

  it('排除已選桌（不重複納入候選）', () => {
    const r = suggestTablesForBatch({ tables: TABLES, headcount: 6, alreadySelected: ['101'] })
    expect(r.tableNumbers).not.toContain('101')
    expect(r.tableNumbers[0]).toBe('102') // 次大的 6 人桌
  })

  it('可用桌湊不滿 → enough:false 並回傳能湊到的最大集合', () => {
    const tables = [mk('101', 4), mk('102', 4)]
    const r = suggestTablesForBatch({ tables, headcount: 20 })
    expect(r.enough).toBe(false)
    expect(r.seats).toBe(8)
    expect(r.tableNumbers.sort()).toEqual(['101', '102'])
  })

  it('headcount 0 → 不選桌', () => {
    const r = suggestTablesForBatch({ tables: TABLES, headcount: 0 })
    expect(r.tableNumbers).toEqual([])
    expect(r.enough).toBe(true)
  })
})
