import { describe, it, expect } from 'vitest'
import {
  buildGroupEditorChecks, canSaveGroup, groupSaveErrorMessage, seatingCardState,
} from '../../src/components/admin/planning/groupEditorChecks'

// 團單編輯器存檔前檢查（2026-10）：線上已關、超坐、場次超收都只黃字提醒、不擋存檔；
// 硬擋只剩基本欄位、公休日、停用/維修桌。
const base = (over = {}) => ({
  hasAgency: true, total: 12, specialErr: null,
  hasSeatings: true, seatingPicked: true, dayClosed: false,
  batchesReady: true, heldSeats: 12, seatWarnings: [],
  onlineClosedNames: [], overbookedSeatings: [], badTables: [],
  ...over,
})
const byKey = (checks, k) => checks.find(c => c.key === k)

describe('seatingCardState', () => {
  it('線上已關但有空位 → 可選、標 onlineClosed', () => {
    expect(seatingCardState({ closed: true, dayClosed: false, remainingSeats: 30 }))
      .toEqual({ dayClosed: false, onlineClosed: true, full: false, selectable: true })
  })
  it('客滿 → 仍可選（只提示）', () => {
    expect(seatingCardState({ closed: false, dayClosed: false, remainingSeats: 0 })).toMatchObject({ full: true, selectable: true })
  })
  it('公休日 → 不可選', () => {
    expect(seatingCardState({ closed: true, dayClosed: true, remainingSeats: 0 })).toMatchObject({ dayClosed: true, onlineClosed: false, selectable: false })
  })
})

describe('buildGroupEditorChecks / canSaveGroup', () => {
  it('全部填好 → 可存，沒有警示項', () => {
    const checks = buildGroupEditorChecks(base())
    expect(canSaveGroup(checks)).toBe(true)
    expect(checks.some(c => c.warn)).toBe(false)
    expect(byKey(checks, 'seats').label).toBe('席位：已圈 12 / 需 12')
  })

  it('場次線上已關 → 黃色警示、仍可存', () => {
    const checks = buildGroupEditorChecks(base({ onlineClosedNames: ['午餐第一批'] }))
    const online = byKey(checks, 'online')
    expect(online).toMatchObject({ ok: true, warn: true, bad: false })
    expect(online.label).toContain('午餐第一批')
    expect(byKey(checks, 'seating')).toMatchObject({ ok: true, bad: false })
    expect(canSaveGroup(checks)).toBe(true)
  })

  it('超坐（7 人圈 6 席）→ 席位項黃色「超坐 N 人」、仍可存', () => {
    const checks = buildGroupEditorChecks(base({
      total: 7, heldSeats: 6,
      seatWarnings: [{ key: 'total', label: '第一梯', guests: 7, seats: 6, over: 1, message: '已圈 6 席 / 需 7 席，超坐 1 人' }],
    }))
    const seats = byKey(checks, 'seats')
    expect(seats).toMatchObject({ ok: true, warn: true, bad: false })
    expect(seats.label).toBe('席位：已圈 6 / 需 7，超坐 1 人')
    expect(canSaveGroup(checks)).toBe(true)
  })

  it('多梯某梯超坐 → reason 點名該梯、仍可存', () => {
    const checks = buildGroupEditorChecks(base({
      total: 20, heldSeats: 18,
      seatWarnings: [{ key: 'b1', label: '第一梯', guests: 8, seats: 6, over: 2, message: '「第一梯」已圈 6 席 / 需 8 席，超坐 2 人' }],
    }))
    expect(byKey(checks, 'seats').reason).toMatch(/第一梯.*超坐 2 人/)
    expect(canSaveGroup(checks)).toBe(true)
  })

  it('場次總席位超收 → 黃色警示、仍可存', () => {
    const checks = buildGroupEditorChecks(base({ overbookedSeatings: [{ name: '午餐第一批', over: 4 }] }))
    expect(byKey(checks, 'overbooked')).toMatchObject({ ok: true, warn: true, bad: false })
    expect(byKey(checks, 'overbooked').label).toContain('午餐第一批 4 席')
    expect(canSaveGroup(checks)).toBe(true)
  })

  it('停用/維修桌 → 紅色、擋', () => {
    const checks = buildGroupEditorChecks(base({ badTables: ['101'] }))
    expect(byKey(checks, 'tables')).toMatchObject({ ok: false, bad: true })
    expect(canSaveGroup(checks)).toBe(false)
  })

  it('公休日 → 場次項紅色、擋（維持原狀）', () => {
    const checks = buildGroupEditorChecks(base({ dayClosed: true }))
    expect(byKey(checks, 'seating')).toMatchObject({ ok: false, bad: true })
    expect(canSaveGroup(checks)).toBe(false)
  })

  it('基本欄位未填 → 擋', () => {
    expect(canSaveGroup(buildGroupEditorChecks(base({ hasAgency: false })))).toBe(false)
    expect(canSaveGroup(buildGroupEditorChecks(base({ total: 0 })))).toBe(false)
    expect(canSaveGroup(buildGroupEditorChecks(base({ seatingPicked: false })))).toBe(false)
    expect(canSaveGroup(buildGroupEditorChecks(base({ batchesReady: false })))).toBe(false)
    expect(canSaveGroup(buildGroupEditorChecks(base({ heldSeats: 0 })))).toBe(false)
  })
})

describe('groupSaveErrorMessage', () => {
  it('後端撞桌訊息已含「桌位衝突」→ 原樣顯示（不重複前綴）', () => {
    expect(groupSaveErrorMessage({ status: 409, message: '桌位衝突：101 已被其他團或現場訂位佔用' }))
      .toBe('桌位衝突：101 已被其他團或現場訂位佔用')
  })
  it('非撞桌的 409（如公休日）→ 不標成桌位衝突', () => {
    expect(groupSaveErrorMessage({ status: 409, message: '2026-10-10 為公休日，「第一梯」無法圈桌' }))
      .toBe('無法儲存：2026-10-10 為公休日，「第一梯」無法圈桌')
  })
  it('後端停用/維修桌 409（groupReserveTables）→ 顯示後端原訊息，不標成桌位衝突', () => {
    expect(groupSaveErrorMessage({ status: 409, message: '桌位 223、225 於 11/21 停用或維修中，無法圈桌' }))
      .toBe('無法儲存：桌位 223、225 於 11/21 停用或維修中，無法圈桌')
  })
  it('409 無訊息 → 預設撞桌說明；其他錯誤 → 儲存失敗', () => {
    expect(groupSaveErrorMessage({ status: 409 })).toMatch(/^桌位衝突/)
    expect(groupSaveErrorMessage({ status: 500, message: 'boom' })).toBe('儲存失敗：boom')
    expect(groupSaveErrorMessage(null)).toBe('儲存失敗：未知錯誤')
  })
})
