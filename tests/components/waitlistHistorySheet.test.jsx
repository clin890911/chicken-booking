import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'

// 候位歷史與統計（2026-09）。
// 背景：店主看到四格統計全是 0、列表「全部」卻有 4 筆，問「這是當天的還是所有歷史？」——
// 統計只算今天，列表卻是全部歷史且只顯示時分、看不出日期。
// 改成列表預設「今日」（與統計同範圍），以前的紀錄收進「歷史」依日期分組；日期一律用本地（台灣）日。

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let bookingCtx = { waitlist: [] }
vi.mock('../../src/contexts/BookingContext', () => ({ useBooking: () => bookingCtx }))

const mod = await import('../../src/components/admin/ops/WaitlistHistorySheet')
const WaitlistHistorySheet = mod.default
const { splitWaitlist, localDateOf, dateLabel } = mod

// 固定時鐘：2026-09-15（二）14:00 本地時間。takenAt 一律由本地時間轉 ISO，測試與機器時區無關。
const NOW = new Date(2026, 8, 15, 14, 0, 0)
const TODAY = '2026-09-15'
const at = (m, d, h, min) => new Date(2026, m - 1, d, h, min).toISOString()
const wait = (id, takenAt, status, extra = {}) => ({ id, takenAt, status, queueNumber: id, name: `客${id}`, partySize: 2, ...extra })

const WAITLIST = [
  wait(1, at(9, 14, 10, 9), 'seated', { assignedTableNumber: '102' }),
  wait(2, at(9, 14, 13, 40), 'left'),
  wait(3, at(9, 12, 12, 0), 'called'),        // 前幾天沒結掉的號
  wait(4, at(9, 15, 11, 5), 'seated'),
  wait(5, at(9, 15, 12, 30), 'waiting'),
  wait(6, undefined, 'left'),                  // 舊資料缺 takenAt
]

describe('splitWaitlist：今日 / 活躍中 / 歷史', () => {
  it('今日只收本地今天的號，新→舊', () => {
    const { today } = splitWaitlist(WAITLIST, TODAY)
    expect(today.map(w => w.id)).toEqual([5, 4])
  })

  it('歷史只收今天以前，依日期新→舊分組，日期不明排最後', () => {
    const { history } = splitWaitlist(WAITLIST, TODAY)
    expect(history.map(g => g.date)).toEqual(['2026-09-14', '2026-09-12', ''])
    expect(history[0].items.map(w => w.id)).toEqual([2, 1])
  })

  it('活躍中不分日期（前幾天沒結掉的號也要看得到）', () => {
    const { active } = splitWaitlist(WAITLIST, TODAY)
    expect(active.map(w => w.id)).toEqual([5, 3])
  })

  it('日期用本地日，不是 UTC 日（台灣早上 7:30 取號仍算當天）', () => {
    expect(localDateOf(at(9, 15, 7, 30))).toBe(TODAY)
    expect(localDateOf(undefined)).toBe('')
    expect(localDateOf('not-a-date')).toBe('')
  })

  it('dateLabel 帶星期', () => {
    expect(dateLabel('2026-09-14')).toBe('9/14（一）')
    expect(dateLabel('')).toBe('日期不明')
  })
})

describe('WaitlistHistorySheet 呈現', () => {
  let container, root

  const render = () => act(() => { root.render(<WaitlistHistorySheet open onClose={() => {}} />) })
  const text = () => document.body.textContent
  const clickTab = (label) => {
    const btn = [...document.body.querySelectorAll('button')].find(b => b.textContent.startsWith(label))
    act(() => { btn.click() })
  }

  beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(NOW)
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    bookingCtx = { waitlist: WAITLIST }
  })
  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.useRealTimers()
  })

  it('預設「今日」：統計與列表同範圍，看不到昨天的號', () => {
    render()
    expect(text()).toContain('今日統計 · 9/15（二）')
    expect(text()).toContain('客5')
    expect(text()).toContain('客4')
    expect(text()).not.toContain('客1')
    expect(text()).not.toContain('客2')
  })

  it('「歷史」依日期分組並標出組數', () => {
    render()
    clickTab('歷史')
    expect(text()).toContain('9/14（一） · 2 組')
    expect(text()).toContain('9/12（六） · 1 組')
    expect(text()).toContain('日期不明 · 1 組')
    expect(text()).not.toContain('NaN')
    expect(text()).not.toContain('客5')
  })

  it('「活躍中」混到前幾天的號時要帶日期', () => {
    render()
    clickTab('活躍中')
    expect(text()).toMatch(/取號 9\/12（六） 12:00/)
    expect(text()).not.toMatch(/取號 9\/15/)
  })

  it('今天沒有候位時顯示今日空狀態', () => {
    bookingCtx = { waitlist: WAITLIST.filter(w => localDateOf(w.takenAt) !== TODAY) }
    render()
    expect(text()).toContain('今天尚無候位記錄')
  })
})
