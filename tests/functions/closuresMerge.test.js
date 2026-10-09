// 休店／關閉三方合併（functions/lib/closuresMerge.js）。前端 src/utils/closuresMerge.js 是同一份的轉出口。
import { mergeClosures, sameClosures } from '../../functions/lib/closuresMerge'
import { mergeClosures as frontMerge } from '../../src/utils/closuresMerge'

const C = (o = {}) => ({ closedDates: [], closedSlots: {}, closedSeatings: {}, ...o })

describe('mergeClosures：以日期為單位三方合併', () => {
  it('前端轉出口就是同一個函式（前後端合併口徑不會分岔）', () => {
    expect(frontMerge).toBe(mergeClosures)
  })

  it('🔴 事故重現：host 關 10/12、店長同時關 10/15 → 兩者都保留', () => {
    const base = C()
    const local = C({ closedSeatings: { '2026-10-12': ['lunch1'] } })
    const remote = C({ closedSeatings: { '2026-10-15': ['dinner1'] } })
    const r = mergeClosures(base, local, remote)
    expect(r.merged.closedSeatings).toEqual({ '2026-10-12': ['lunch1'], '2026-10-15': ['dinner1'] })
    expect(r.conflicts).toEqual([])
    expect(r.localChanged).toBe(true)
    expect(r.remoteChanged).toBe(true)
  })

  it('🔴 一方恢復開放、另一方沒動該日 → 恢復開放生效（不被舊副本復活）', () => {
    const base = C({ closedSeatings: { '2026-10-10': ['lunch1'] }, closedSlots: { '2026-10-11': ['12:00'] } })
    // 店長已恢復 10/10、10/11（雲端已移除）；host 本機仍是舊副本，另外新增 10/20
    const remote = C()
    const local = C({ closedSeatings: { '2026-10-10': ['lunch1'], '2026-10-20': ['lunch2'] }, closedSlots: { '2026-10-11': ['12:00'] } })
    const r = mergeClosures(base, local, remote)
    expect(r.merged.closedSeatings).toEqual({ '2026-10-20': ['lunch2'] })
    expect(r.merged.closedSlots).toEqual({})
    expect(r.conflicts).toEqual([])
  })

  it('存檔者自己恢復開放（刪掉日期 key）→ 從雲端移除；別人同時新增的其他日期保留', () => {
    const base = C({ closedSlots: { '2026-10-11': ['12:00'] } })
    const local = C()
    const remote = C({ closedSlots: { '2026-10-11': ['12:00'], '2026-10-12': ['18:00'] } })
    expect(mergeClosures(base, local, remote).merged.closedSlots).toEqual({ '2026-10-12': ['18:00'] })
  })

  it('同日衝突：兩邊都改且不同 → 存檔者（local）勝，並回報 conflicts', () => {
    const base = C({ closedSeatings: { '2026-10-12': ['lunch1'] } })
    const local = C({ closedSeatings: { '2026-10-12': ['lunch1', 'lunch2'] } })
    const remote = C({ closedSeatings: { '2026-10-12': ['dinner1'] } })
    const r = mergeClosures(base, local, remote)
    expect(r.merged.closedSeatings).toEqual({ '2026-10-12': ['lunch1', 'lunch2'] })
    expect(r.conflicts).toEqual([{ field: 'closedSeatings', key: '2026-10-12' }])
  })

  it('同日衝突（local 刪除、remote 修改）→ local 的刪除勝並回報', () => {
    const base = C({ closedSlots: { '2026-10-12': ['12:00'] } })
    const local = C()
    const remote = C({ closedSlots: { '2026-10-12': ['12:00', '12:30'] } })
    const r = mergeClosures(base, local, remote)
    expect(r.merged.closedSlots).toEqual({})
    expect(r.conflicts).toEqual([{ field: 'closedSlots', key: '2026-10-12' }])
  })

  it('兩邊改成同一個值（順序不同）不算衝突', () => {
    const base = C()
    const local = C({ closedSeatings: { '2026-10-12': ['b', 'a'] }, closedDates: ['2026-10-01'] })
    const remote = C({ closedSeatings: { '2026-10-12': ['a', 'b'] }, closedDates: ['2026-10-02'] })
    const r = mergeClosures(base, local, remote)
    expect(r.conflicts).toEqual([])
    expect(r.merged.closedSeatings['2026-10-12'].sort()).toEqual(['a', 'b'])
  })

  it('closedDates：元素集合三方合併（新增／移除各自套用）', () => {
    const base = { closedDates: ['2026-10-01', '2026-10-02'] }
    const local = { closedDates: ['2026-10-02', '2026-10-05'] }   // 移除 10/01、新增 10/05
    const remote = { closedDates: ['2026-10-01', '2026-10-02', '2026-10-09'] } // 別人新增 10/09
    expect(mergeClosures(base, local, remote).merged.closedDates).toEqual(['2026-10-02', '2026-10-05', '2026-10-09'])
  })

  it('closedDates：別人移除、存檔者沒動 → 移除生效', () => {
    const r = mergeClosures({ closedDates: ['2026-10-01'] }, { closedDates: ['2026-10-01'] }, { closedDates: [] })
    expect(r.merged.closedDates).toEqual([])
  })

  it('每週預設（weeklySeatings）以星期 key 為單位；本日開放（openSeatings）以日期為單位', () => {
    const base = C({ weeklySeatings: { 1: ['lunch1'] } })
    const local = C({ weeklySeatings: { 1: ['lunch1'], 6: ['dinner2'] }, openSeatings: { '2026-10-17': ['lunch2'] } })
    const remote = C({ weeklySeatings: { 3: ['lunch2'] }, openSeatings: { '2026-10-24': ['dinner1'] } }) // 別人移除週一、新增週三
    const r = mergeClosures(base, local, remote)
    expect(r.merged.weeklySeatings).toEqual({ 3: ['lunch2'], 6: ['dinner2'] })
    expect(r.merged.openSeatings).toEqual({ '2026-10-17': ['lunch2'], '2026-10-24': ['dinner1'] })
    expect(r.conflicts).toEqual([])
  })

  it('每週預設同一星期兩邊改不同 → local 勝並回報', () => {
    const r = mergeClosures(C({ weeklySeatings: { 2: ['a'] } }), C({ weeklySeatings: { 2: ['b'] } }), C({ weeklySeatings: { 2: ['c'] } }))
    expect(r.merged.weeklySeatings).toEqual({ 2: ['b'] })
    expect(r.conflicts).toEqual([{ field: 'weeklySeatings', key: '2' }])
  })

  it('空值：null／undefined／缺欄位都當空；weekly/open 為空時不輸出 key（與正規化形狀一致）', () => {
    expect(mergeClosures(null, undefined, {})).toEqual({
      merged: { closedDates: [], closedSlots: {}, closedSeatings: {} }, conflicts: [], localChanged: false, remoteChanged: false,
    })
    const r = mergeClosures(undefined, C({ closedSlots: { '2026-10-12': ['12:00'] } }), null)
    expect(r.merged).toEqual({ closedDates: [], closedSlots: { '2026-10-12': ['12:00'] }, closedSeatings: {} })
  })

  it('日期只剩一筆時恢復開放 → 該欄位變成空 map（不是 undefined、也不殘留）', () => {
    const base = C({ closedSeatings: { '2026-10-12': ['lunch1'] }, weeklySeatings: { 5: ['x'] } })
    const local = C({ weeklySeatings: { 5: ['x'] } })
    const r = mergeClosures(base, local, base)
    expect(r.merged.closedSeatings).toEqual({})
    // 每週也只剩一筆、被另一邊恢復 → 整個 key 不輸出（正規化本就不輸出空 weeklySeatings）
    const w = mergeClosures(base, C({ closedSeatings: { '2026-10-12': ['lunch1'] } }), base)
    expect(w.merged.weeklySeatings).toBeUndefined()
    expect(w.merged.closedSeatings).toEqual({ '2026-10-12': ['lunch1'] })
  })

  it('空清單等同不存在（[] 與缺 key 不算變更）', () => {
    const r = mergeClosures(C(), C({ closedSlots: { '2026-10-12': [] } }), C({ closedSlots: { '2026-10-13': ['12:00'] } }))
    expect(r.localChanged).toBe(false)
    expect(r.merged.closedSlots).toEqual({ '2026-10-13': ['12:00'] })
  })

  it('沒人同時改：結果與存檔者本機逐字相同（含 key 順序），不製造假的未儲存變更', () => {
    const base = C({ closedSeatings: { '2026-10-09': ['a'] } })
    const local = C({ closedDates: ['2026-10-30', '2026-10-01'], closedSeatings: { '2026-10-12': ['b'], '2026-10-09': ['a'] } })
    const r = mergeClosures(base, local, base)
    expect(JSON.stringify(r.merged)).toBe(JSON.stringify(local))
    expect(r.remoteChanged).toBe(false)
  })

  it('存檔者沒改 closures（例如店長只改營業時間）→ 結果＝雲端現值，不會拿舊副本蓋掉別人', () => {
    const base = C({ closedDates: ['2026-10-01'] })
    const remote = C({ closedDates: ['2026-10-01', '2026-10-08'], closedSlots: { '2026-10-12': ['12:00'] } })
    const r = mergeClosures(base, base, remote)
    expect(JSON.stringify(r.merged)).toBe(JSON.stringify(remote))
    expect(r.localChanged).toBe(false)
  })

  it('冪等：同一 base/local 對「合併後的雲端」再合併一次，結果不變且無衝突（重送安全）', () => {
    const base = C({ closedSeatings: { '2026-10-12': ['a'] } })
    const local = C({ closedSeatings: { '2026-10-12': ['b'] }, closedDates: ['2026-10-03'] })
    const remote = C({ closedSeatings: { '2026-10-12': ['c'], '2026-10-14': ['d'] } })
    const first = mergeClosures(base, local, remote)
    const again = mergeClosures(base, local, first.merged)
    expect(sameClosures(again.merged, first.merged)).toBe(true)
    expect(again.conflicts).toEqual([])
  })

  it('sameClosures：清單順序與空清單不影響等值', () => {
    expect(sameClosures(C({ closedSlots: { d: ['b', 'a'], e: [] } }), C({ closedSlots: { d: ['a', 'b'] } }))).toBe(true)
    expect(sameClosures(C({ closedDates: ['x'] }), C())).toBe(false)
  })
})
