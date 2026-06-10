import { describe, it, expect } from 'vitest'
import {
  slotEpochMs,
  classifyMyBooking,
  buildMyBookingsList,
  MY_BOOKINGS_LIMIT,
} from '../../functions/lib/myBookings.js'

// 「LINE 我的訂位」清單純邏輯。
// 固定基準時刻：2026-06-15 12:00 台灣時間。
const NOW = Date.parse('2026-06-15T12:00:00+08:00')

function bk(overrides = {}) {
  return { id: 'B1', date: '2026-06-20', timeSlot: '18:00', guests: 4, status: 'confirmed', ...overrides }
}

describe('slotEpochMs（自 index.js 搬入，+08:00 語義不變）', () => {
  it('台灣時間正確轉 epoch', () => {
    expect(slotEpochMs('2026-06-15', '12:00')).toBe(NOW)
  })

  it('壞輸入回 NaN，不丟例外', () => {
    expect(Number.isNaN(slotEpochMs('not-a-date', '18:00'))).toBe(true)
    expect(Number.isNaN(slotEpochMs('', ''))).toBe(true)
  })
})

describe('classifyMyBooking', () => {
  it('未來 confirmed → upcoming', () => {
    expect(classifyMyBooking(bk(), NOW).phase).toBe('upcoming')
  })

  it('進行中（時段開始 2 小時內、arrived）→ upcoming（3 小時寬限）', () => {
    expect(classifyMyBooking(bk({ date: '2026-06-15', timeSlot: '10:30', status: 'arrived' }), NOW).phase).toBe('upcoming')
  })

  it('confirmed 但時段已過寬限 → recent（過期未消化的訂位不再當作即將到來）', () => {
    expect(classifyMyBooking(bk({ date: '2026-06-15', timeSlot: '08:00' }), NOW).phase).toBe('recent')
  })

  it('3 天前 cancelled → recent', () => {
    expect(classifyMyBooking(bk({ date: '2026-06-12', status: 'cancelled' }), NOW).phase).toBe('recent')
  })

  it('20 天前 completed → drop（超過 14 天歷史窗口）', () => {
    expect(classifyMyBooking(bk({ date: '2026-05-26', status: 'completed' }), NOW).phase).toBe('drop')
  })

  it('未來 cancelled → recent（已取消即使在未來也不算 upcoming）', () => {
    expect(classifyMyBooking(bk({ status: 'cancelled' }), NOW).phase).toBe('recent')
  })

  it('NaN 日期 → drop', () => {
    expect(classifyMyBooking(bk({ date: 'bad' }), NOW).phase).toBe('drop')
  })
})

describe('buildMyBookingsList', () => {
  it('upcoming 升冪在前、recent 降冪接後，past 標註正確', () => {
    const entries = [
      { booking: bk({ id: 'U2', date: '2026-06-25' }), manageToken: 't2' },
      { booking: bk({ id: 'R1', date: '2026-06-10', status: 'cancelled' }), manageToken: 'tr1' },
      { booking: bk({ id: 'U1', date: '2026-06-16' }), manageToken: 't1' },
      { booking: bk({ id: 'R2', date: '2026-06-14', status: 'completed' }), manageToken: 'tr2' },
    ]
    const items = buildMyBookingsList(entries, { nowMs: NOW })
    expect(items.map(i => i.id)).toEqual(['U1', 'U2', 'R2', 'R1'])
    expect(items.find(i => i.id === 'U1').past).toBe(false)
    expect(items.find(i => i.id === 'R1').past).toBe(true)
  })

  it('項目欄位：dateLabel/manageToken 透傳/不含姓名電話/內部排序欄位不外洩', () => {
    const items = buildMyBookingsList(
      [{ booking: bk({ name: '王小明', phone: '0912345678' }), manageToken: 'tok' }],
      { nowMs: NOW, publicSiteUrl: 'https://example.com' },
    )
    expect(items).toHaveLength(1)
    const item = items[0]
    expect(item.dateLabel).toMatch(/^\d{1,2}\/\d{1,2} \([日一二三四五六]\)$/)
    expect(item.manageToken).toBe('tok')
    expect(item.manageUrl).toBe('https://example.com/manage/B1?token=tok')
    expect(item).not.toHaveProperty('name')
    expect(item).not.toHaveProperty('phone')
    expect(item).not.toHaveProperty('_at')
  })

  it('publicSiteUrl 未設定 → manageUrl 空字串（manageToken 仍透傳供本地路由）', () => {
    const items = buildMyBookingsList([{ booking: bk(), manageToken: 'tok' }], { nowMs: NOW })
    expect(items[0].manageUrl).toBe('')
    expect(items[0].manageToken).toBe('tok')
  })

  it(`超過 ${MY_BOOKINGS_LIMIT} 筆截斷，upcoming 優先保留`, () => {
    const entries = []
    for (let i = 1; i <= 8; i++) entries.push({ booking: bk({ id: `U${i}`, date: `2026-06-${15 + i}` }), manageToken: 't' })
    for (let i = 1; i <= 5; i++) entries.push({ booking: bk({ id: `R${i}`, date: `2026-06-${15 - i}`, status: 'cancelled' }), manageToken: 't' })
    const items = buildMyBookingsList(entries, { nowMs: NOW })
    expect(items).toHaveLength(MY_BOOKINGS_LIMIT)
    expect(items.filter(i => !i.past)).toHaveLength(8)
  })

  it('無 id / drop 的 entry 略過；空輸入回空陣列', () => {
    expect(buildMyBookingsList([{ booking: { date: '2026-06-20', timeSlot: '18:00' } }], { nowMs: NOW })).toEqual([])
    expect(buildMyBookingsList([], { nowMs: NOW })).toEqual([])
    expect(buildMyBookingsList(undefined, { nowMs: NOW })).toEqual([])
  })
})
