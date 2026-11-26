import { describe, it, expect } from 'vitest'
import { stageOf, diffMin, seatedMinutes, seatedElapsedLabel } from '../../src/utils/diningStage'

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

  // 🔴 B2：剛入座的桌不可顯示「-1 分」（入座時間比畫面時鐘新）
  it('seatedAt 晚於 now：夾到 0、顯示「剛入座」，不出現負數', () => {
    const now = Date.parse('2026-06-10T12:00:00.000Z')
    const future = '2026-06-10T12:00:05.000Z'
    expect(diffMin(future, now)).toBe(-1)
    expect(seatedMinutes(future, now)).toBe(0)
    expect(seatedElapsedLabel(future, now)).toBe('剛入座')
    expect(seatedElapsedLabel(future, now)).not.toMatch(/-/)
  })
  it('未滿 1 分鐘＝剛入座；滿 1 分鐘起顯示「N 分」', () => {
    const now = Date.parse('2026-06-10T12:00:00.000Z')
    expect(seatedElapsedLabel('2026-06-10T11:59:30.000Z', now)).toBe('剛入座')
    expect(seatedElapsedLabel('2026-06-10T11:59:00.000Z', now)).toBe('1 分')
    expect(seatedElapsedLabel('2026-06-10T10:30:00.000Z', now)).toBe('90 分')
  })
})
