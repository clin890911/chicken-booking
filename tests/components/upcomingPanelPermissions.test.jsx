import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'

// UpcomingPanel 的前端權限門。
// 背景：三顆既有鈕（指派桌位 / ✅ 客人到了 / 標 No-show）原本完全沒有前端權限檢查，
// 唯讀角色（kitchen）按得下去 → 寫進本機 localStorage → 推送雲端時被
// functions/lib/staffAccess.js 的 classifyDatasetByPermission 剔除 → 本機與雲端狀態不一致，
// 而畫面上沒有任何錯誤提示。慣例見 TableDrawer.jsx 的 can('table.update')。
//
// 角色矩陣直接綁 AuthContext 匯出的真實 PERMISSIONS：若哪天有人給 kitchen 加了 booking.update，
// 這裡會紅，而不是測試自己抄的一份假表默默通過。

globalThis.IS_REACT_ACT_ENVIRONMENT = true

// 目前測試扮演的身分（在 mock factory 之外，讓每個 it 可切換；設 null 可測 useAuth 未就緒）
let currentAuth = null

vi.mock('../../src/contexts/AuthContext', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, useAuth: () => currentAuth }
})

const bookingCtx = {
  bookings: [],
  tables: [],
  groupReservations: [],
  setStatus: vi.fn(),
  seatBooking: vi.fn(() => ({ ok: true })),
  completeWithoutSeating: vi.fn(() => ({ ok: true })),
  undoCompleteWithoutSeating: vi.fn(() => ({ ok: true })),
}
vi.mock('../../src/contexts/BookingContext', () => ({ useBooking: () => bookingCtx }))
vi.mock('../../src/components/ui/Toast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), action: vi.fn() }),
  useConfirm: () => vi.fn(async () => true),
}))

const { PERMISSIONS } = await import('../../src/contexts/AuthContext')
const UpcomingPanel = (await import('../../src/components/admin/floormap/UpcomingPanel')).default

const roleCan = (role) => (action) => PERMISSIONS[role].has(action)

// 固定時鐘：2026-08-01 20:00。UpcomingPanel 的 now 取自 Date.now()，無法由外部注入。
const NOW = new Date(2026, 7, 1, 20, 0, 0)
const TODAY = '2026-08-01'

const booking = (over = {}) => ({
  id: 'b1', name: '王小明', phone: '0912345678', guests: 2,
  date: TODAY, timeSlot: '19:00', status: 'confirmed',
  assignedTableId: null, notes: {}, ...over,
})

// 19:00（已過 60 分 > 15 分寬限）→ overdue，四顆鈕的條件全開得起來
const OVERDUE_ASSIGNED = booking({ id: 'b1', name: '已指派客', assignedTableId: '101' })
const OVERDUE_UNASSIGNED = booking({ id: 'b2', name: '未指派客' })
// 20:30（30 分後，≤90）→ soon，只會有「指派桌位」
const SOON_UNASSIGNED = booking({ id: 'b3', name: '將到客', timeSlot: '20:30' })

const ALL_BOOKINGS = [OVERDUE_ASSIGNED, OVERDUE_UNASSIGNED, SOON_UNASSIGNED]

describe('UpcomingPanel 動作鈕的前端權限門', () => {
  let container, root

  // tables 影響「已指派」徽章的兩種寫法（見 utils/tableStatus.assignmentKind）：預設不給桌，
  // 等同「查不到桌況」→ 一律當預配（不宣稱桌已鎖），權限測試本身不受影響。
  const render = (can, bookings = ALL_BOOKINGS, tables = []) => {
    currentAuth = can ? { can } : null
    bookingCtx.bookings = bookings
    bookingCtx.tables = tables
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => { root.render(<UpcomingPanel onClickBooking={() => {}} onAssignTable={() => {}} />) })
    return container
  }
  const buttonTexts = () => [...container.querySelectorAll('button')].map(b => b.textContent)

  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW) })
  afterEach(() => {
    act(() => root?.unmount())
    container?.remove()
    vi.useRealTimers()
  })

  it('manager：三顆既有鈕（指派桌位／客人到了／標 No-show）全部出現', () => {
    render(roleCan('manager'))
    const texts = buttonTexts()
    expect(texts.some(t => t.includes('指派桌位'))).toBe(true)
    expect(texts.some(t => t.includes('客人到了'))).toBe(true)
    expect(texts.some(t => t.includes('標 No-show'))).toBe(true)
    expect(texts.some(t => t.includes('已完成'))).toBe(true)
  })

  it('kitchen（唯讀）：三顆鈕一顆都不渲染', () => {
    render(roleCan('kitchen'))
    const texts = buttonTexts()
    expect(texts.some(t => t.includes('指派桌位'))).toBe(false)
    expect(texts.some(t => t.includes('客人到了'))).toBe(false)
    expect(texts.some(t => t.includes('標 No-show'))).toBe(false)
    expect(texts.some(t => t.includes('已完成'))).toBe(false)
  })

  it('kitchen：訂位資訊本身照常看得到（是隱藏動作，不是隱藏整張卡）', () => {
    render(roleCan('kitchen'))
    expect(container.textContent).toContain('已指派客')
    expect(container.textContent).toContain('未指派客')
    expect(container.textContent).toContain('將到客')
    expect(container.textContent).toContain('19:00')
    // 桌號徽章是唯讀資訊（非按鈕），唯讀角色仍該看得到（2026-08 起文案依指派種類分「已指派／已預配」）
    expect(container.textContent).toMatch(/(已指派|已預配) 101/)
  })

  // 2026-08：訂位卡的「已指派」徽章原本不分兩種指派，與桌況圖一藍一綠對不起來（店主回報）。
  // 徽章文案／配色改為跟著 assignmentKind 走，這裡鎖住兩種寫法不會再被合併回同一個。
  describe('已指派徽章分辨「桌況已鎖」與「只是預配」', () => {
    const table = (over = {}) => ({ number: '101', status: 'vacant', currentBookingId: null, ...over })

    it('現場指派（桌況 reserved 且指向這筆）→「✓ 已指派 101」', () => {
      render(roleCan('manager'), [OVERDUE_ASSIGNED], [table({ status: 'reserved', currentBookingId: 'b1' })])
      expect(container.textContent).toContain('✓ 已指派 101')
      expect(container.textContent).not.toContain('已預配')
    })

    it('規劃頁預配（桌況仍是空桌）→「📌 已預配 101」', () => {
      render(roleCan('manager'), [OVERDUE_ASSIGNED], [table()])
      expect(container.textContent).toContain('📌 已預配 101')
      expect(container.textContent).not.toContain('✓ 已指派')
    })

    it('預配的桌被別筆訂位鎖走 →仍是「已預配」（桌並不屬於這筆）', () => {
      render(roleCan('manager'), [OVERDUE_ASSIGNED], [table({ status: 'reserved', currentBookingId: 'b9' })])
      expect(container.textContent).toContain('📌 已預配 101')
    })

    it('未指派的訂位不出現任何桌號徽章', () => {
      render(roleCan('manager'), [OVERDUE_UNASSIGNED], [table()])
      expect(container.textContent).not.toMatch(/(已指派|已預配) 101/)
    })
  })

  it('floor／host：兩者都有 booking.update + table.update → 三顆鈕都在（不誤傷有權限的角色）', () => {
    for (const role of ['floor', 'host']) {
      render(roleCan(role))
      const texts = buttonTexts()
      expect(texts.some(t => t.includes('指派桌位'))).toBe(true)
      expect(texts.some(t => t.includes('客人到了'))).toBe(true)
      expect(texts.some(t => t.includes('標 No-show'))).toBe(true)
      act(() => root.unmount())
      container.remove()
    }
  })

  it('只有 booking.update、沒有 table.update：標 No-show 留著，會動到桌位的兩顆消失', () => {
    render((a) => a === 'booking.update')
    const texts = buttonTexts()
    expect(texts.some(t => t.includes('標 No-show'))).toBe(true)
    expect(texts.some(t => t.includes('指派桌位'))).toBe(false)
    expect(texts.some(t => t.includes('客人到了'))).toBe(false)
  })

  it('useAuth 尚未就緒回 null（防呆）：一律視為無權限，不炸也不渲染動作鈕', () => {
    expect(() => render(null)).not.toThrow()
    const texts = buttonTexts()
    expect(texts.some(t => t.includes('標 No-show'))).toBe(false)
    expect(texts.some(t => t.includes('指派桌位'))).toBe(false)
    expect(texts.some(t => t.includes('客人到了'))).toBe(false)
  })

  it('kitchen 且該筆未指派桌：整條動作列不渲染（不留空白 margin）', () => {
    render(roleCan('kitchen'), [OVERDUE_UNASSIGNED])
    expect(container.querySelector('.mt-2.flex')).toBeNull()
  })
})
