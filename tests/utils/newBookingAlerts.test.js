import { describe, it, expect } from 'vitest'
import {
  isAlertBaselineReady, diffNewConfirmed, confirmedIdSet, buildNewBookingAlerts,
} from '../../src/utils/newBookingAlerts'

const TODAY = '2026-08-01'
const b = (id, over = {}) => ({
  id, name: '陳小姐', guests: 3, date: TODAY, timeSlot: '12:00', status: 'confirmed', ...over,
})

describe('isAlertBaselineReady', () => {
  it('本機模式：首次 refresh 灌入資料前不算備妥', () => {
    expect(isAlertBaselineReady({ usingFirebase: false, hydrated: false })).toBe(false)
    expect(isAlertBaselineReady({ usingFirebase: false, hydrated: true })).toBe(true)
  })

  // 🔴 這條守的就是截圖裡的缺陷：登入瞬間 bookings 由 [] 變成雲端全量，
  // 若在首拉完成前就開始比對，既有訂位會全被當成「新訂位」洗版。
  it('雲端模式：首次拉取成功前一律不備妥', () => {
    expect(isAlertBaselineReady({ usingFirebase: true, cloudStatus: { state: 'idle', lastSyncAt: null } })).toBe(false)
    expect(isAlertBaselineReady({ usingFirebase: true, cloudStatus: { state: 'syncing', lastSyncAt: null } })).toBe(false)
    expect(isAlertBaselineReady({ usingFirebase: true, cloudStatus: { state: 'synced', lastSyncAt: 'T' } })).toBe(true)
  })

  it('雲端模式：拉到之前就離線不算備妥（本機快照可能是空的，回線會再洗一次版）', () => {
    expect(isAlertBaselineReady({ usingFirebase: true, cloudStatus: { state: 'offline', lastSyncAt: null }, hydrated: true })).toBe(false)
  })

  it('雲端模式：已拉成功過再離線仍算備妥（基準還在）', () => {
    expect(isAlertBaselineReady({ usingFirebase: true, cloudStatus: { state: 'offline', lastSyncAt: 'T' } })).toBe(true)
  })
})

describe('diffNewConfirmed / confirmedIdSet', () => {
  it('只認新出現的 confirmed；取消／已到都不算', () => {
    const prev = confirmedIdSet([b('a'), b('x', { status: 'cancelled' })])
    expect(prev.has('a')).toBe(true)
    expect(prev.has('x')).toBe(false)
    const added = diffNewConfirmed(prev, [b('a'), b('c'), b('d', { status: 'seated' })])
    expect(added.map(x => x.id)).toEqual(['c'])
  })

  it('沒有基準（尚未建立）時一律視為無新增', () => {
    expect(diffNewConfirmed(null, [b('a')])).toEqual([])
  })
})

describe('buildNewBookingAlerts', () => {
  it('沒有新增 → 不推任何 toast', () => {
    expect(buildNewBookingAlerts([], TODAY)).toEqual([])
  })

  it('今日單筆 → 逐筆詳情（姓名／人數／時段）', () => {
    const [a] = buildNewBookingAlerts([b('a')], TODAY)
    expect(a.message).toBe('📋 新訂位：陳小姐 3 位 · 12:00')
    expect(a.duration).toBe(6000)
  })

  it('未來日單筆 → 標註日期、停留較短', () => {
    const [a] = buildNewBookingAlerts([b('a', { date: '2026-08-06', timeSlot: '12:30' })], TODAY)
    expect(a.message).toBe('🗓 未來日新訂位：陳小姐 3 位 · 2026-08-06 12:30')
    expect(a.duration).toBe(3500)
  })

  // 🔴 一次同步回來 11 筆就該是一則摘要，不是 11 則 toast 疊滿桌況圖。
  it('同一批多筆 → 合併成一則摘要，並以最早時段起算', () => {
    const alerts = buildNewBookingAlerts(
      [b('a', { timeSlot: '12:30' }), b('b2', { timeSlot: '11:30' }), b('c', { timeSlot: '12:00' })], TODAY)
    expect(alerts).toHaveLength(1)
    expect(alerts[0].message).toBe('📋 3 筆新訂位 · 11:30 起（見「今日訂位」）')
  })

  it('未來日多筆 → 一則摘要', () => {
    const alerts = buildNewBookingAlerts(
      [b('a', { date: '2026-09-10' }), b('b2', { date: '2026-08-08' })], TODAY)
    expect(alerts).toHaveLength(1)
    expect(alerts[0].message).toBe('🗓 2 筆未來日新訂位（見「訂位」頁）')
  })

  it('今日＋未來日混在同一批 → 最多兩則（各一則）', () => {
    const many = [
      ...Array.from({ length: 6 }, (_, i) => b(`t${i}`)),
      ...Array.from({ length: 5 }, (_, i) => b(`f${i}`, { date: '2026-08-08' })),
    ]
    const alerts = buildNewBookingAlerts(many, TODAY)
    expect(alerts).toHaveLength(2)
    expect(alerts[0].key).toBe('today-many')
    expect(alerts[1].key).toBe('future-many')
  })
})
