import { describe, it, expect } from 'vitest'
import { stageOf, diffMin } from '../../src/utils/diningStage'

describe('diningStage（用餐階段，自 TableShape 抽出共用）', () => {
  const settings = { diningDurationMin: 90, cleanupBufferMin: 10 }
  it('四階段邊界：60/90/100 分', () => {
    expect(stageOf(0, settings)).toBe('normal')
    expect(stageOf(59, settings)).toBe('normal')
    expect(stageOf(60, settings)).toBe('late')
    expect(stageOf(89, settings)).toBe('late')
    expect(stageOf(90, settings)).toBe('overtime')
    expect(stageOf(99, settings)).toBe('overtime')
    expect(stageOf(100, settings)).toBe('buffer-overtime')
  })
  it('settings 缺值用預設 90+10', () => {
    expect(stageOf(100, {})).toBe('buffer-overtime')
  })
  it('diffMin 注入 now', () => {
    const now = Date.parse('2026-06-10T12:00:00.000Z')
    expect(diffMin('2026-06-10T10:30:00.000Z', now)).toBe(90)
  })
})
