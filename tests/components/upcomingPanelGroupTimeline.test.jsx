import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'

// 現場「今日」時間清單（方案 A）：團體每一梯是一列，跟散客落在同一套區段；點開原地展開動作，
// 入座後列移到「已入座」（仍展開，接著可離席）。權限照 seatingPerms：kitchen 看得到列、沒有動作鈕。
globalThis.IS_REACT_ACT_ENVIRONMENT = true

let currentCan = () => true
const toast = { success: vi.fn(), error: vi.fn(), action: vi.fn(), info: vi.fn() }
const ctx = {}
vi.mock('../../src/contexts/AuthContext', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, useAuth: () => ({ can: (p) => currentCan(p) }) }
})
vi.mock('../../src/contexts/BookingContext', () => ({ useBooking: () => ctx }))
vi.mock('../../src/components/ui/Toast', () => ({ useToast: () => toast, useConfirm: () => vi.fn(async () => true) }))

const { PERMISSIONS } = await import('../../src/contexts/AuthContext')
const UpcomingPanel = (await import('../../src/components/admin/floormap/UpcomingPanel')).default

const NOW = new Date(2026, 10, 1, 12, 0, 0)
const TODAY = '2026-11-01'
const at = (h, m) => new Date(2026, 10, 1, h, m, 0).toISOString()
const tbl = (number, over = {}) => ({ number, capacity: 6, floor: '1F', isActive: true, outage: null, status: 'vacant', currentBookingId: null, currentRef: null, seatedAt: null, ...over })
const ref = (groupId, batchId) => ({ type: 'group', groupId, batchId })
const GA = {
  id: 'GA', date: TODAY, agencyName: '尖峰旅行社', guideName: '林導', guidePhone: '0911000111', status: 'arrived',
  counts: { total: 28, vegetarian: 3 }, allergyText: '花生',
  batches: [
    { id: 'A1', label: '第一梯', timeSlot: '11:20', tableNumbers: ['201', '203'], guests: 12 },
    { id: 'AE', label: '司領桌', timeSlot: '11:20', tableNumbers: ['207'], guests: 2, isEscort: true },
    { id: 'A2', label: '第二梯', timeSlot: '15:00', tableNumbers: ['210'], guests: 6 },
  ],
}
const GB = {
  id: 'GB', date: TODAY, agencyName: '山城旅遊', guideName: '陳導', guidePhone: '0922000222', status: 'confirmed',
  counts: { total: 11 }, batches: [{ id: 'B1', label: '第一梯', timeSlot: '12:40', tableNumbers: ['101', '102'], guests: 11 }],
}
const baseTables = () => [
  tbl('201', { status: 'dining', currentRef: ref('GA', 'A1'), seatedAt: at(11, 20) }),
  tbl('203', { status: 'dining', currentRef: ref('GA', 'A1'), seatedAt: at(11, 20) }),
  tbl('207', { status: 'dining', currentRef: ref('GA', 'AE'), seatedAt: at(11, 20) }),
  tbl('210'), tbl('101'), tbl('102'), tbl('105'),
]
const walkin = { id: 'W1', name: '陳先生', phone: '', guests: 2, date: TODAY, timeSlot: '12:30', status: 'confirmed', assignedTableId: null, extraTableIds: [], notes: {} }

describe('UpcomingPanel × 團體梯次（今日時間清單）', () => {
  let container, root
  const render = () => act(() => root.render(<UpcomingPanel onClickBooking={() => {}} onFocusTable={() => {}} />))
  const mount = (can = () => true) => {
    currentCan = can
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
    render()
  }
  const section = (name) => container.querySelector(`[data-section="${name}"]`)
  const rowKeys = (name) => [...(section(name)?.querySelectorAll('[data-group-batch], [data-booking-id]') || [])]
    .map(e => e.getAttribute('data-group-batch') || e.getAttribute('data-booking-id'))
  const row = (key) => container.querySelector(`[data-group-batch="${key}"]`)
  const header = (key) => row(key).querySelector('button[aria-expanded]')
  const btn = (scope, text) => [...scope.querySelectorAll('button')].find(b => b.textContent.trim() === text)

  beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(NOW)
    Object.assign(ctx, {
      bookings: [walkin], groupReservations: [GA, GB], tables: baseTables(), settings: {},
      seatGroupBatch: vi.fn((gid, bid) => {
        ctx.tables = ctx.tables.map(t => ['101', '102'].includes(t.number) && gid === 'GB'
          ? { ...t, status: 'dining', currentRef: ref(gid, bid), seatedAt: new Date().toISOString() } : t)
        return { ok: true }
      }),
      checkoutGroupBatch: vi.fn(), undoGroupCheckout: vi.fn(), releaseGroupBatch: vi.fn(), finalizeGroup: vi.fn(), setGroupStatus: vi.fn(),
    })
  })
  afterEach(() => { act(() => root?.unmount()); container?.remove(); vi.useRealTimers() })

  it('團體梯次與散客混在同一套區段：乙團與散客在 90 分內、甲團第一梯＋司領在已入座、第二梯在之後', () => {
    mount()
    expect(rowKeys('soon')).toEqual(['W1', 'GB:B1'])          // 12:30 散客、12:40 乙團
    // 已入座、之後預設收合：展開後才列出
    act(() => { section('seated').querySelector('button').click() })
    expect(rowKeys('seated')).toEqual(['GA:A1', 'GA:AE'])
    act(() => { section('later').querySelector('button').click() })
    expect(rowKeys('later')).toEqual(['GA:A2'])
    // 列外觀：時間＋團徽章＋旅行社＋序號＋人數＋桌號＋狀態
    expect(row('GB:B1').textContent).toMatch(/12:40.*團.*山城旅遊.*待到/)
    expect(row('GA:A1').textContent).toContain('1/2 梯')
    expect(row('GA:A1').textContent).toContain('用餐中 2 桌')
    expect(row('GA:AE').textContent).toContain('司領')
    expect(row('GA:AE').textContent).toContain('不計旅客')
    // 同一團同色細邊條、不同團不同色
    expect(row('GA:A1').style.borderLeftColor).toBe(row('GA:AE').style.borderLeftColor)
    expect(row('GA:A1').style.borderLeftColor).not.toBe(row('GB:B1').style.borderLeftColor)
  })

  it('點乙團列展開（同時只展開一列）→ 梯次入座 → 列移到已入座、仍展開、改給梯次離席', async () => {
    mount()
    expect(header('GB:B1').getAttribute('aria-expanded')).toBe('false')
    act(() => { header('GB:B1').click() })
    expect(header('GB:B1').getAttribute('aria-expanded')).toBe('true')
    const expanded = row('GB:B1')
    expect(expanded.textContent).toContain('導遊 陳導')
    expect(expanded.querySelector('[data-testid="guide-phone"]').textContent).toBe('0922-000-222')
    const seatBtn = btn(expanded, '梯次入座')
    expect(seatBtn.className).toContain('min-h-[44px]')
    expect(btn(expanded, '整團完成')).toBeTruthy()

    // 另開一列 → 前一列收起
    act(() => { section('seated').querySelector('button').click() })
    act(() => { header('GA:A1').click() })
    expect(header('GB:B1').getAttribute('aria-expanded')).toBe('false')
    act(() => { header('GB:B1').click() })

    await act(async () => { btn(row('GB:B1'), '梯次入座').click() })
    expect(ctx.seatGroupBatch).toHaveBeenCalledWith('GB', 'B1')
    expect(toast.success).toHaveBeenCalledWith('山城旅遊 第一梯 已入座（101、102）')
    render() // context 更新後重繪
    expect(rowKeys('soon')).toEqual(['W1'])
    expect(rowKeys('seated')).toContain('GB:B1')
    expect(header('GB:B1').getAttribute('aria-expanded')).toBe('true')
    expect(btn(row('GB:B1'), '梯次離席')).toBeTruthy()
    expect(row('GB:B1').textContent).toContain('用餐中 2 桌')
  })

  it('已釋出的梯、已完成的團不列（比照散客已離席）', () => {
    ctx.groupReservations = [{ ...GA, batches: GA.batches.map(b => b.id === 'A2' ? { ...b, releasedAt: at(11, 0) } : b) }, { ...GB, status: 'completed' }]
    mount()
    expect(container.querySelector('[data-group-batch="GA:A2"]')).toBeNull()
    expect(container.querySelector('[data-group-batch="GB:B1"]')).toBeNull()
  })

  it('搜尋旅行社名／導遊名／桌號都找得到團體梯次', () => {
    mount()
    const input = container.querySelector('input[aria-label="搜尋今日訂位"]')
    const type = (v) => act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, v)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const all = () => [...container.querySelectorAll('[data-group-batch], [data-booking-id]')].map(e => e.getAttribute('data-group-batch') || e.getAttribute('data-booking-id'))
    type('山城'); expect(all()).toEqual(['GB:B1'])
    type('林導'); expect(all().sort()).toEqual(['GA:A1', 'GA:A2', 'GA:AE'])
    type('210'); expect(all()).toEqual(['GA:A2'])
  })

  it('kitchen：看得到團體列與導遊資訊，展開後沒有任何動作鈕（回傳單仍在）', () => {
    mount((p) => PERMISSIONS.kitchen.has(p))
    act(() => { header('GB:B1').click() })
    const r = row('GB:B1')
    expect(r.textContent).toContain('導遊 陳導')
    for (const t of ['梯次入座', '梯次離席', '整梯清桌釋出', '整團完成']) expect(btn(r, t), t).toBeFalsy()
    expect(r.querySelector('button[aria-label="回傳單"]')).toBeTruthy()
  })
  describe('已完成區', () => {
    const DONE = { ...GB, id: 'GD', agencyName: '完成旅行社', status: 'completed', batches: [{ id: 'D1', label: '第一梯', timeSlot: '10:30', tableNumbers: ['301'], guests: 8, releasedAt: at(11, 50) }] }
    const PARTIAL = { ...GA, batches: GA.batches.map(b => (b.id === 'A1' ? { ...b, releasedAt: at(11, 55) } : b)) }
    const toggle = () => section('done').querySelector('button[aria-expanded]')
    const search = (v) => act(() => {
      const input = container.querySelector('input[aria-label="搜尋今日訂位"]')
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, v)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })

    it('今天沒有完成的團就不出現', () => {
      mount()
      expect(section('done')).toBeNull()
    })

    it('預設收合只露筆數；展開後整團完成的團唯讀（無入座／完成鈕）、留回傳單', () => {
      ctx.groupReservations = [GA, GB, DONE]
      mount()
      expect(toggle().textContent).toContain('已完成（1）')
      expect(section('done').textContent).not.toContain('完成旅行社')
      act(() => { toggle().click() })
      const done = section('done')
      expect(done.textContent).toContain('完成旅行社')
      for (const t of ['梯次入座', '梯次離席', '整梯清桌釋出', '整團完成']) expect(btn(done, t), t).toBeFalsy()
      expect(done.querySelector('button[aria-label="回傳單"]')).toBeTruthy()
    })

    it('團還在進行、已跑完的梯列「此梯完成」，不再回到時間線', () => {
      ctx.groupReservations = [PARTIAL]
      mount()
      expect(row('GA:A1')).toBeNull()
      act(() => { toggle().click() })
      const r = section('done').querySelector('[data-released-batch="GA:A1"]')
      expect(r.textContent).toContain('此梯完成')
      expect(r.textContent).toContain('201、203')
      expect(r.querySelector('button[aria-label="回傳單"]')).toBeTruthy()
    })

    it('全梯已釋出但團還沒結：團卡留「整團完成」，kitchen 看不到', () => {
      const allReleased = { ...GB, status: 'arrived', batches: GB.batches.map(b => ({ ...b, releasedAt: at(11, 55) })) }
      ctx.groupReservations = [allReleased]
      mount()
      act(() => { toggle().click() })
      expect(btn(section('done'), '整團完成')).toBeTruthy()
      act(() => root.unmount()); container.remove()
      mount((p) => PERMISSIONS.kitchen.has(p))
      act(() => { toggle().click() })
      expect(btn(section('done'), '整團完成')).toBeFalsy()
    })

    it('今天全部都完成了：不落入「今日已無待到訂位」空畫面，已完成區仍在', () => {
      ctx.bookings = []; ctx.groupReservations = [DONE]
      mount()
      expect(section('done')).toBeTruthy()
    })

    it('搜尋會自動打開已完成區，只留符合的；全部不符才顯示「找不到」', () => {
      ctx.groupReservations = [GA, GB, DONE]
      mount()
      search('完成旅行')
      expect(section('done').textContent).toContain('完成旅行社')
      expect(toggle().textContent).toContain('已完成（1／1）')
      expect(container.textContent).not.toContain('找不到符合')
      search('沒有這團')
      expect(section('done').textContent).not.toContain('完成旅行社')
      expect(container.textContent).toContain('找不到符合')
    })
  })
})
