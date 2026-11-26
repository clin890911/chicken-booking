import { describe, it, expect } from 'vitest'
import { needsComboTables, pickAction, applyPick, excessTablesHint } from '../../src/utils/tablePick'
import { arriveActionFor } from '../../src/utils/arriveSeat'

// A2（2026-11-27 Barry 拍板）：現場點桌＝改選；＋再加一桌才多選；大組自動多選。
const t = (number, capacity) => ({ number, capacity })

describe('tablePick：點桌語意', () => {
  it('單選：點別張＝replace、點已選＝remove；多選：add', () => {
    expect(pickAction(['103'], '101', { multi: false })).toBe('replace')
    expect(pickAction(['103'], '103', { multi: false })).toBe('remove')
    expect(pickAction(['103'], '101', { multi: true })).toBe('add')
    expect(pickAction([], '101')).toBe('replace')
  })
  it('applyPick 冪等：同一個動作套兩次（iPad 同 tick 兩次 click）結果不變', () => {
    const once = applyPick(['103'], '101', 'add')
    expect(applyPick(once, '101', 'add')).toEqual(['103', '101'])
    expect(applyPick(applyPick(['103'], '101', 'replace'), '101', 'replace')).toEqual(['101'])
    expect(applyPick(applyPick(['103', '101'], '101', 'remove'), '101', 'remove')).toEqual(['103'])
  })
  it('needsComboTables：沒有任何單桌（擠一擠）坐得下才自動多選', () => {
    expect(needsComboTables(8, [t('A', 6), t('B', 4)])).toBe(true)
    expect(needsComboTables(7, [t('A', 6), t('B', 4)])).toBe(false) // 6 人桌擠一擠坐 7
    expect(needsComboTables(0, [])).toBe(false)
  })
  it('excessTablesHint：3 位選 2 張 6 人桌 → 提醒；8 位選 4+4 → 不提醒', () => {
    expect(excessTablesHint([t('103', 6), t('101', 6)], 3).text).toContain('3 位用了 2 桌 12 席')
    expect(excessTablesHint([t('B', 4), t('C', 4)], 8)).toBeNull()
    expect(excessTablesHint([t('B', 4)], 3)).toBeNull()
  })
})

describe('arriveSeat.arriveActionFor：三個入口共用的「客人到了」判斷（A4）', () => {
  const tables = [
    { number: '105', status: 'vacant', currentBookingId: null },
    { number: '106', status: 'dining', currentBookingId: 'WALK' },
    { number: '107', status: 'reserved', currentBookingId: 'HELD' },
  ]
  it('未配桌 → pick；預配桌空著 → seat；預配桌被別組佔 → reseat；鎖桌給本筆 → seat', () => {
    expect(arriveActionFor({ id: 'A', assignedTableId: null }, tables)).toBe('pick')
    expect(arriveActionFor({ id: 'B', assignedTableId: '105' }, tables)).toBe('seat')
    expect(arriveActionFor({ id: 'C', assignedTableId: '106' }, tables)).toBe('reseat')
    expect(arriveActionFor({ id: 'HELD', assignedTableId: '107' }, tables)).toBe('seat')
    expect(arriveActionFor({ id: 'D', assignedTableId: '105', extraTableIds: ['106'] }, tables)).toBe('reseat')
  })
})
