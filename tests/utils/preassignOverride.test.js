import { describe, it, expect, vi } from 'vitest'
import { conflictLine, releaseOverlappingPreassigns, restoreReleasedPreassigns, restoreNote } from '../../src/utils/preassignOverride'
import { preassignConflicts, assignmentWindow } from '../../src/utils/capacity'
import * as seating from '../../src/services/seatingService'
import * as tableService from '../../src/services/tableService'
import * as bookingService from '../../src/services/bookingService'

// 覆蓋預配（2026-09 驗收後定案）：只在「被覆蓋那筆的用餐區間」與「新佔用區間」重疊時解除；
// 不重疊就保留，警示據實；復原把被解除的預配還回去（只在那筆仍未配桌時）。
// 下半部用真的 seatingService（不只 mock），驗「解除 → 復原」整條走得通。

const yu = (over = {}) => ({ id: 'Y', name: '余先生', guests: 2, timeSlot: '11:00', status: 'confirmed', ...over })

describe('conflictLine：警示據實', () => {
  it('重疊 → 「11:00 余先生的預配將解除」', () => {
    expect(conflictLine('105', { booking: yu(), overlaps: true, willRelease: true }, '帶位'))
      .toBe('105 已於排位規劃預留給 余先生（2 位 · 11:00）。用餐時段重疊：帶位後 11:00 余先生 的預配將解除，需重新指派。')
  })
  it('不重疊 → 「20:30 余先生的預配會保留」', () => {
    expect(conflictLine('105', { booking: yu({ timeSlot: '20:30' }), overlaps: false, willRelease: false }, '帶位'))
      .toBe('105 已於排位規劃預留給 余先生（2 位 · 20:30）。用餐時段不重疊：20:30 余先生 的預配會保留。')
  })
})

describe('releaseOverlappingPreassigns（注入 mock）', () => {
  const deps = (release = vi.fn(() => ({ ok: true, tableNumbers: ['105'], released: [] }))) => ({
    releaseOverriddenAssignment: release, toast: { info: vi.fn() },
  })

  it('只解除 willRelease 的那筆；toast「余先生原本的預配 105 已解除，請重新指派」；回傳復原快照', () => {
    const d = deps()
    const snaps = releaseOverlappingPreassigns([
      { booking: yu(), overlaps: true, willRelease: true },
      { booking: yu({ id: 'L', name: '林小姐', timeSlot: '20:30' }), overlaps: false, willRelease: false },
    ], d)
    expect(d.releaseOverriddenAssignment).toHaveBeenCalledTimes(1)
    expect(d.releaseOverriddenAssignment).toHaveBeenCalledWith('Y')
    expect(d.toast.info).toHaveBeenCalledWith('余先生原本的預配 105 已解除，請重新指派', { duration: 8000 })
    expect(snaps).toEqual([{ bookingId: 'Y', name: '余先生', tableNumbers: ['105'], released: [] }])
  })

  it('同一筆只解除一次（併桌帶位兩張桌指向同一筆）；解除失敗不謊稱', () => {
    const d = deps()
    releaseOverlappingPreassigns([{ booking: yu(), willRelease: true }, { booking: yu(), willRelease: true }], d)
    expect(d.releaseOverriddenAssignment).toHaveBeenCalledTimes(1)
    const f = deps(vi.fn(() => ({ ok: false })))
    expect(releaseOverlappingPreassigns([{ booking: yu(), willRelease: true }], f)).toEqual([])
    expect(f.toast.info).not.toHaveBeenCalled()
  })
})

describe('解除 → 復原（真的 service）', () => {
  const D = '2026-06-15'
  const mkT = (number) => ({ number, capacity: 4, floor: '1F', isActive: true, status: 'vacant', currentBookingId: null, currentRef: null })
  const realDeps = () => ({
    releaseOverriddenAssignment: seating.releaseOverriddenAssignment,
    restoreOverriddenAssignment: seating.restoreOverriddenAssignment,
    toast: { info: vi.fn() },
  })

  it('12:20 帶位：12:30 的預配重疊→解除，復原後回來；20:30 的預配不重疊→全程保留', () => {
    tableService.bulkWrite([mkT('105'), mkT('106')])
    const noon = bookingService.create({ name: '午客', phone: '', guests: 2, date: D, timeSlot: '12:30', status: 'confirmed' })
    const eve = bookingService.create({ name: '晚客', phone: '', guests: 2, date: D, timeSlot: '20:30', status: 'confirmed' })
    bookingService.assignTable(noon.id, '105')
    bookingService.assignTable(eve.id, '106')
    const window = assignmentWindow({ mode: 'now', now: new Date(2026, 5, 15, 12, 20) })
    const conflicts = ['105', '106'].flatMap(n => preassignConflicts(bookingService.listAll(), n, { date: D, window }))

    const d = realDeps()
    const walk = seating.walkInSeatMulti(['105', '106'], { name: '散客', guests: 6 })
    expect(walk.ok).toBe(true)
    const snaps = releaseOverlappingPreassigns(conflicts, d)
    expect(bookingService.getById(noon.id).assignedTableId).toBeNull()
    expect(bookingService.getById(eve.id).assignedTableId).toBe('106')

    // 帶位「復原」＝取消 walk-in，再把被解除的預配寫回
    seating.cancelBooking(walk.booking.id)
    const res = restoreReleasedPreassigns(snaps, d)
    expect(res.restored.map(s => s.bookingId)).toEqual([noon.id])
    expect(bookingService.getById(noon.id).assignedTableId).toBe('105')
    expect(restoreNote(res)).toBe('（午客 的預配 105 已還原）')
  })
})

describe('restoreNote：據實', () => {
  it('還原不了 → 「L 的預配 105 無法還原：105 目前由 T3 使用，請重新指派」', () => {
    expect(restoreNote({ failed: [{ name: 'L', tableNumbers: ['105'], error: '105 目前由 T3 使用' }] }))
      .toBe('（L 的預配 105 無法還原：105 目前由 T3 使用，請重新指派）')
  })
  it('還原了但原本鎖著的桌被佔、沒鎖回 → 講清楚維持預配', () => {
    expect(restoreNote({ restored: [{ name: '大組', tableNumbers: ['101', '108'], notRelocked: ['108'] }] }))
      .toBe('（大組 的預配 101 + 108 已還原（108 已被佔用，未鎖回、維持預配））')
  })
  it('restoreReleasedPreassigns 把 service 的錯誤帶進 failed', () => {
    const res = restoreReleasedPreassigns([{ bookingId: 'L', name: 'L', tableNumbers: ['105'] }],
      { restoreOverriddenAssignment: () => ({ ok: false, code: 'table-taken', error: '105 目前由 T3 使用' }) })
    expect(res.failed[0].error).toBe('105 目前由 T3 使用')
    expect(restoreNote(res)).toContain('無法還原：105 目前由 T3 使用，請重新指派')
  })
})
