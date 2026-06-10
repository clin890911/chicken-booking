import { describe, it, expect } from 'vitest'
import * as client from '../../src/utils/tableAvailability'
import * as server from '../../functions/lib/tableUsable'

// 桌位「按日期可用性」純邏輯。
// 兩個重點：(1) 維修窗判定的邊界行為 (2) 前端 src/utils/tableAvailability.js 與
// 後端 functions/lib/tableUsable.js 必須位元級一致（parity 測試掃過共同案例）。

const T = (over = {}) => ({ number: '101', capacity: 4, isActive: true, ...over })

describe('normalizeOutage', () => {
  it('合法窗保留；reason 修剪並裁切 60 字', () => {
    const o = client.normalizeOutage({ from: '2026-06-10', to: '2026-06-12', reason: '  桌面破損  ' })
    expect(o).toEqual({ from: '2026-06-10', to: '2026-06-12', reason: '桌面破損' })
    expect(client.normalizeOutage({ from: '2026-06-10', reason: 'x'.repeat(99) }).reason).toHaveLength(60)
  })
  it('to 空字串 = 無限期；to 格式壞掉降為無限期', () => {
    expect(client.normalizeOutage({ from: '2026-06-10', to: '' }).to).toBe('')
    expect(client.normalizeOutage({ from: '2026-06-10', to: 'oops' }).to).toBe('')
  })
  it('from 缺/格式壞 → null；to 早於 from → null', () => {
    expect(client.normalizeOutage(null)).toBe(null)
    expect(client.normalizeOutage({ to: '2026-06-12' })).toBe(null)
    expect(client.normalizeOutage({ from: '6/10' })).toBe(null)
    expect(client.normalizeOutage({ from: '2026-06-12', to: '2026-06-10' })).toBe(null)
  })
})

describe('isTableOutOnDate（窗口含頭含尾）', () => {
  const t = T({ outage: { from: '2026-06-10', to: '2026-06-12', reason: '維修' } })
  it('窗內（含兩端）為 out；窗外不是', () => {
    expect(client.isTableOutOnDate(t, '2026-06-09')).toBe(false)
    expect(client.isTableOutOnDate(t, '2026-06-10')).toBe(true)
    expect(client.isTableOutOnDate(t, '2026-06-11')).toBe(true)
    expect(client.isTableOutOnDate(t, '2026-06-12')).toBe(true)
    expect(client.isTableOutOnDate(t, '2026-06-13')).toBe(false)
  })
  it('無限期（to 空）：from 起永遠 out', () => {
    const t2 = T({ outage: { from: '2026-06-10', to: '' } })
    expect(client.isTableOutOnDate(t2, '2026-12-31')).toBe(true)
    expect(client.isTableOutOnDate(t2, '2026-06-09')).toBe(false)
  })
  it('無 outage / 壞日期參數 → false', () => {
    expect(client.isTableOutOnDate(T(), '2026-06-10')).toBe(false)
    expect(client.isTableOutOnDate(t, '')).toBe(false)
    expect(client.isTableOutOnDate(t, 'not-a-date')).toBe(false)
  })
})

describe('isTableUsableOnDate（isActive × outage 兩軸）', () => {
  it('永久停用 → 任何日期不可用；維修窗內不可用；isActive 缺省視為啟用（!== false 口徑）', () => {
    expect(client.isTableUsableOnDate(T({ isActive: false }), '2026-06-10')).toBe(false)
    expect(client.isTableUsableOnDate(T({ outage: { from: '2026-06-10', to: '' } }), '2026-06-10')).toBe(false)
    const noFlag = { number: '101', capacity: 4 }
    expect(client.isTableUsableOnDate(noFlag, '2026-06-10')).toBe(true)
  })
})

describe('★ 前後端 parity（同案例兩邊結果必須一致）', () => {
  const CASES = [
    [T(), '2026-06-10'],
    [T({ isActive: false }), '2026-06-10'],
    [{ number: '101', capacity: 4 }, '2026-06-10'],
    [T({ outage: { from: '2026-06-10', to: '2026-06-12' } }), '2026-06-09'],
    [T({ outage: { from: '2026-06-10', to: '2026-06-12' } }), '2026-06-10'],
    [T({ outage: { from: '2026-06-10', to: '2026-06-12' } }), '2026-06-12'],
    [T({ outage: { from: '2026-06-10', to: '2026-06-12' } }), '2026-06-13'],
    [T({ outage: { from: '2026-06-10', to: '' } }), '2027-01-01'],
    [T({ outage: { from: '2026-06-12', to: '2026-06-10' } }), '2026-06-11'],
    [T({ outage: { from: 'bad' } }), '2026-06-10'],
    [T({ outage: 'garbage' }), '2026-06-10'],
    [T({ outage: { from: '2026-06-10' } }), ''],
  ]
  it('isTableOutOnDate / isTableUsableOnDate / normalizeOutage 全案例一致', () => {
    for (const [table, date] of CASES) {
      expect(server.isTableOutOnDate(table, date)).toBe(client.isTableOutOnDate(table, date))
      expect(server.isTableUsableOnDate(table, date)).toBe(client.isTableUsableOnDate(table, date))
      expect(server.normalizeOutage(table.outage)).toEqual(client.normalizeOutage(table.outage))
    }
  })
})

describe('outageLabel（顯示文字）', () => {
  it('進行中顯示「維修至/維修中」；未來窗顯示起訖', () => {
    expect(client.outageLabel(T({ outage: { from: '2026-06-10', to: '2026-06-15' } }), '2026-06-10')).toBe('維修至 6/15')
    expect(client.outageLabel(T({ outage: { from: '2026-06-10', to: '' } }), '2026-06-10')).toBe('維修中')
    expect(client.outageLabel(T({ outage: { from: '2026-06-20', to: '2026-06-22' } }), '2026-06-10')).toBe('維修 6/20–6/22')
    expect(client.outageLabel(T(), '2026-06-10')).toBe('')
  })
})
