import { describe, it, expect } from 'vitest'
import {
  groupCircledTableNumbers,
  findUnusableGroupTables,
  unusableTablesMessage,
} from '../../functions/lib/groupUnusableTables.js'
import { validateGroupForSave } from '../../src/services/groupReservationService.js'

// groupReserveTables 的「停用 / 維修桌」把關（functions/lib/groupUnusableTables.js）。
// 口徑必須與前端 validateGroupForSave 的 badTables 檢查完全一致（下方 parity 區塊釘住）。
const DATE = '2026-11-21'
const table = (number, over = {}) => ({ number, capacity: 6, isActive: true, outage: null, ...over })
const group = (batches, over = {}) => ({
  id: 'G1', date: DATE, agencyName: '測試旅行社', counts: { total: 6 },
  batches, ...over,
})
const batch = (tableNumbers, over = {}) => ({ id: 'b1', label: '第一梯', timeSlot: '11:00', guests: 6, tableNumbers, ...over })

describe('groupCircledTableNumbers', () => {
  it('跨梯次去重、保留順序、字串化、去空白與空值', () => {
    const g = group([batch([223, '225', ' ', null]), batch(['223', '301'], { id: 'b2' })])
    expect(groupCircledTableNumbers(g)).toEqual(['223', '225', '301'])
  })
  it('缺 batches / 非陣列 → 空陣列', () => {
    expect(groupCircledTableNumbers({})).toEqual([])
    expect(groupCircledTableNumbers(undefined)).toEqual([])
    expect(groupCircledTableNumbers({ batches: [{ tableNumbers: 'x' }] })).toEqual([])
  })
})

describe('findUnusableGroupTables', () => {
  it('全部可用 → 空陣列', () => {
    expect(findUnusableGroupTables({ group: group([batch(['223'])]), tables: [table('223')] })).toEqual([])
  })
  it('永久停用（isActive:false）→ 擋', () => {
    expect(findUnusableGroupTables({ group: group([batch(['223'])]), tables: [table('223', { isActive: false })] })).toEqual(['223'])
  })
  it('維修窗涵蓋當日（含頭含尾）→ 擋', () => {
    const g = group([batch(['223', '225', '227'])])
    const tables = [
      table('223', { outage: { from: DATE, to: '2026-11-30' } }), // 起日當天
      table('225', { outage: { from: '2026-11-01', to: DATE } }), // 迄日當天
      table('227', { outage: { from: '2026-11-01', to: '' } }), // 無限期
    ]
    expect(findUnusableGroupTables({ group: g, tables })).toEqual(['223', '225', '227'])
  })
  it('維修窗不涵蓋當日 / 已過期 / 格式不合法 → 不擋', () => {
    const g = group([batch(['223', '225', '227'])])
    const tables = [
      table('223', { outage: { from: '2026-11-22', to: '' } }), // 隔天才開始
      table('225', { outage: { from: '2026-11-01', to: '2026-11-20' } }), // 前一天結束
      table('227', { outage: { from: 'bad', to: '' } }), // 不合法＝沒有維修
    ]
    expect(findUnusableGroupTables({ group: g, tables })).toEqual([])
  })
  it('司領桌（isEscort）圈到維修桌也擋（與前端一致：所有梯次都檢查）', () => {
    const g = group([batch(['223']), batch(['225'], { id: 'e1', label: '司領桌', isEscort: true, guests: 0 })])
    const tables = [table('223'), table('225', { isActive: false })]
    expect(findUnusableGroupTables({ group: g, tables })).toEqual(['225'])
  })
  it('桌號在 tables 查無（已刪除）→ 不在此擋（比照前端 t && ...）', () => {
    expect(findUnusableGroupTables({ group: group([batch(['999'])]), tables: [table('223')] })).toEqual([])
  })
  it('number 型別不同（數字 vs 字串）仍對得上', () => {
    expect(findUnusableGroupTables({ group: group([batch([223])]), tables: [table('223', { isActive: false })] })).toEqual(['223'])
    expect(findUnusableGroupTables({ group: group([batch(['223'])]), tables: [table(223, { isActive: false })] })).toEqual(['223'])
  })
  it('跨梯次同一張桌只回報一次', () => {
    const g = group([batch(['223']), batch(['223'], { id: 'b2', label: '第二梯' })])
    expect(findUnusableGroupTables({ group: g, tables: [table('223', { isActive: false })] })).toEqual(['223'])
  })
  it('缺 date / 缺參數 → 空陣列（不擋）', () => {
    expect(findUnusableGroupTables({ group: group([batch(['223'])], { date: '' }), tables: [table('223', { isActive: false })] })).toEqual([])
    expect(findUnusableGroupTables()).toEqual([])
  })
})

describe('unusableTablesMessage', () => {
  it('格式：桌位 223、225 於 11/21 停用或維修中，無法圈桌', () => {
    expect(unusableTablesMessage(['223', '225'], DATE)).toBe('桌位 223、225 於 11/21 停用或維修中，無法圈桌')
    expect(unusableTablesMessage(['101'], '2026-01-05')).toBe('桌位 101 於 1/5 停用或維修中，無法圈桌')
  })
})

describe('★ 前後端 parity：後端擋 ⇔ 前端 validateGroupForSave 因停用/維修擋', () => {
  const capByNum = { '223': 6, '225': 6, '999': 6 }
  const cases = [
    ['可用', table('223')],
    ['永久停用', table('223', { isActive: false })],
    ['isActive 缺鍵（視為啟用）', { number: '223', capacity: 6 }],
    ['維修當日起', table('223', { outage: { from: DATE, to: '' } })],
    ['維修當日止', table('223', { outage: { from: '2026-11-01', to: DATE } })],
    ['維修隔日起', table('223', { outage: { from: '2026-11-22', to: '' } })],
    ['維修已過期', table('223', { outage: { from: '2026-11-01', to: '2026-11-20' } })],
    ['to < from（不合法）', table('223', { outage: { from: DATE, to: '2026-11-01' } })],
  ]
  for (const [name, t] of cases) {
    it(name, () => {
      const g = group([batch(['223'])])
      const backendBlocks = findUnusableGroupTables({ group: g, tables: [t] }).length > 0
      const frontErr = validateGroupForSave(g, capByNum, [t])
      const frontBlocksForUsability = !!frontErr && frontErr.includes('停用/維修中')
      expect(backendBlocks).toBe(frontBlocksForUsability)
    })
  }
  it('查無桌號：兩邊都不以「停用/維修」理由擋', () => {
    const g = group([batch(['999'])])
    expect(findUnusableGroupTables({ group: g, tables: [table('223')] })).toEqual([])
    const frontErr = validateGroupForSave(g, capByNum, [table('223')])
    expect(frontErr || '').not.toContain('停用/維修中')
  })
})
