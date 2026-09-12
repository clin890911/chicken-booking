import { describe, it, expect } from 'vitest'
import { reconcileList, reconcileValue, stableKey } from '../../src/utils/stableState'

// 後台每 5 秒的雲端輪詢會把全部集合重新 parse 一遍。這支鎖住「內容沒變就不要換參考」，
// 否則所有 useMemo / React.memo 都會失效，畫面每 5 秒整棵重繪（手機上就是卡頓）。
const idOf = (b) => b.id

describe('reconcileList', () => {
  it('內容完全相同 → 回傳原本的陣列（同一參考）', () => {
    const prev = [{ id: 'a', n: 1 }, { id: 'b', n: 2 }]
    const next = [{ id: 'a', n: 1 }, { id: 'b', n: 2 }]
    expect(reconcileList(prev, next, idOf)).toBe(prev)
  })

  it('只有一筆變動 → 新陣列，但沒變的項目沿用舊物件', () => {
    const a = { id: 'a', n: 1 }
    const prev = [a, { id: 'b', n: 2 }]
    const next = [{ id: 'a', n: 1 }, { id: 'b', n: 3 }]
    const out = reconcileList(prev, next, idOf)
    expect(out).not.toBe(prev)
    expect(out[0]).toBe(a)               // 沒變 → 舊物件
    expect(out[1]).toEqual({ id: 'b', n: 3 })
    expect(out[1]).toBe(next[1])         // 變了 → 新物件
  })

  it('新增一筆 → 新陣列，既有項目沿用舊物件', () => {
    const a = { id: 'a', n: 1 }
    const out = reconcileList([a], [{ id: 'a', n: 1 }, { id: 'c', n: 9 }], idOf)
    expect(out).toHaveLength(2)
    expect(out[0]).toBe(a)
  })

  it('刪除一筆 → 新陣列（長度不同不可沿用舊陣列）', () => {
    const prev = [{ id: 'a', n: 1 }, { id: 'b', n: 2 }]
    const out = reconcileList(prev, [{ id: 'a', n: 1 }], idOf)
    expect(out).not.toBe(prev)
    expect(out).toHaveLength(1)
    expect(out[0]).toBe(prev[0])
  })

  it('順序改變 → 新陣列（排序是畫面語意的一部分），項目仍沿用舊物件', () => {
    const a = { id: 'a', n: 1 }
    const b = { id: 'b', n: 2 }
    const out = reconcileList([a, b], [{ id: 'b', n: 2 }, { id: 'a', n: 1 }], idOf)
    expect(out).not.toEqual([a, b])
    expect(out[0]).toBe(b)
    expect(out[1]).toBe(a)
  })

  it('prev 為空或非陣列 → 直接採用 next', () => {
    const next = [{ id: 'a' }]
    expect(reconcileList([], next, idOf)).toBe(next)
    expect(reconcileList(undefined, next, idOf)).toBe(next)
  })

  it('巢狀欄位（notes 物件 / extraTableIds 陣列）有差異也抓得到', () => {
    const prev = [{ id: 'a', notes: { text: 'x' }, extraTableIds: [] }]
    const same = reconcileList(prev, [{ id: 'a', notes: { text: 'x' }, extraTableIds: [] }], idOf)
    expect(same).toBe(prev)
    const diff = reconcileList(prev, [{ id: 'a', notes: { text: 'y' }, extraTableIds: [] }], idOf)
    expect(diff).not.toBe(prev)
  })
})

describe('reconcileValue', () => {
  it('物件內容相同 → 回 prev；不同 → 回 next', () => {
    const prev = { openTime: '11:00', seatings: [{ id: 'l1' }] }
    expect(reconcileValue(prev, { openTime: '11:00', seatings: [{ id: 'l1' }] })).toBe(prev)
    const next = { openTime: '12:00', seatings: [{ id: 'l1' }] }
    expect(reconcileValue(prev, next)).toBe(next)
  })

  it('null / 非物件直接回 next', () => {
    expect(reconcileValue(null, { a: 1 })).toEqual({ a: 1 })
    expect(reconcileValue({ a: 1 }, null)).toBeNull()
  })
})

describe('stableKey', () => {
  it('同一物件重複呼叫回同一字串（快取），不同內容不同字串', () => {
    const o = { a: 1 }
    expect(stableKey(o)).toBe(stableKey(o))
    expect(stableKey({ a: 1 })).toBe(stableKey(o))
    expect(stableKey({ a: 2 })).not.toBe(stableKey(o))
  })
})
