import { describe, it, expect } from 'vitest'
import { resolveSuggestedTables, SUGGESTION_CHANGED_MSG } from '../../src/utils/suggestionApply'

// 「用建議桌」：整組都仍可選才選；少一張就一張都不選（不只選一部分）
describe('resolveSuggestedTables', () => {
  it('整組都在可選集合 → 全部選', () => {
    expect(resolveSuggestedTables(['201', '202'], ['201', '202', '203'])).toEqual({ ok: true, tables: ['201', '202'] })
    expect(resolveSuggestedTables([105], new Set(['105']))).toEqual({ ok: true, tables: ['105'] })
  })

  it('併桌建議少了一張（被帶走／進維修）→ 不選任何桌，回「建議桌已變動」', () => {
    expect(resolveSuggestedTables(['201', '202'], ['201'])).toEqual({ ok: false, error: SUGGESTION_CHANGED_MSG })
    expect(SUGGESTION_CHANGED_MSG).toBe('建議桌已變動，請自行選桌')
  })

  it('單桌建議已不可選、或沒有建議 → 不選', () => {
    expect(resolveSuggestedTables(['105'], ['106']).ok).toBe(false)
    expect(resolveSuggestedTables([], ['105']).ok).toBe(false)
    expect(resolveSuggestedTables(null, null).ok).toBe(false)
  })

  it('桌號數字／字串混用、重複 → 正規化去重', () => {
    expect(resolveSuggestedTables([201, '201', '202'], ['201', 202])).toEqual({ ok: true, tables: ['201', '202'] })
  })
})
