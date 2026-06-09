// 煙霧測試：確認 vitest 框架、jsdom、localStorage、crypto polyfill 都正常
import { describe, it, expect } from 'vitest'
import { generateTimeSlots } from '../src/utils/timeSlots'
import * as bookingService from '../src/services/bookingService'

describe('測試框架煙霧測試', () => {
  it('jsdom 提供 localStorage', () => {
    expect(typeof localStorage).toBe('object')
    localStorage.setItem('x', '1')
    expect(localStorage.getItem('x')).toBe('1')
  })

  it('window.crypto.getRandomValues 可用（createManageToken 需要）', () => {
    expect(typeof window.crypto.getRandomValues).toBe('function')
    const tok = bookingService.createManageToken()
    expect(tok).toMatch(/^[0-9a-f]{48}$/)
  })

  it('純函式 generateTimeSlots 正常', () => {
    expect(generateTimeSlots('11:00', '12:00', 30)).toEqual(['11:00', '11:30', '12:00'])
  })
})
