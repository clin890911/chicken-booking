import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import fs from 'node:fs'
import path from 'node:path'

// 頁面捲動第 2 批・A（2026-10-31）的版面約定：訂位「今日／新增」在 iPad 不整頁捲動（頁首固定、清單／表單自己捲）、
// 編輯訂位用寬版彈窗兩欄、新增訂位的日期快選單列＋時段 6 欄。
// 實際省下的 px 由 Playwright 量測（PR 描述附前後表）＋ e2e/bookings-fill-page.spec.js 守住；這裡守結構不被改回去。

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const ctx = {}
vi.mock('../../src/contexts/BookingContext', () => ({ useBooking: () => ctx }))
vi.mock('../../src/contexts/AuthContext', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, useAuth: () => ({ can: (p) => actual.PERMISSIONS.manager.has(p), user: { email: 'x@test' } }) }
})
vi.mock('../../src/components/ui/Toast', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), action: vi.fn() }) }))
vi.mock('../../src/services/customerService', () => ({ getByPhone: () => null, search: () => [] }))
vi.mock('../../src/services/bookingService', () => ({ getNoshowCount: () => 0 }))
// 今日清單：卡片內容（電話、桌號、狀態、更多）由 BookingCard 自己負責、本批沒改；這裡換樁只看清單版面
vi.mock('../../src/components/booking/BookingCard', () => ({ default: ({ booking }) => <div data-testid="card">{booking.name}</div> }))
vi.mock('../../src/components/booking/GroupBatchCard', () => ({ default: () => <div data-testid="group-card" /> }))
vi.mock('../../src/components/admin/planning/DaySeatingPanel', () => ({ default: () => <div>SeatStub</div> }))
vi.mock('../../src/components/admin/CalendarView', () => ({ default: () => <div>CalStub</div> }))
vi.mock('../../src/components/admin/SearchBookingsView', () => ({ default: () => <div>SearchStub</div> }))

const { Modal } = await import('../../src/components/ui')
const TimeSlotPicker = (await import('../../src/components/booking/TimeSlotPicker')).default
const EditBookingModal = (await import('../../src/components/booking/EditBookingModal')).default
const TodayView = (await import('../../src/components/admin/TodayView')).default
const AddBookingView = (await import('../../src/components/admin/AddBookingView')).default
const BookingsView = (await import('../../src/components/admin/BookingsView')).default

let container, root
const mount = (el) => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => { root.render(el) })
}
afterEach(() => { act(() => root?.unmount()); container?.remove(); vi.useRealTimers() })
const cls = (el) => (el?.className || '').split(/\s+/)
const sheet = () => document.querySelector('.lg-sheet')

const settings = { openTime: '11:00', closeTime: '19:30', slotInterval: 30 }
const tables = ['105', '106'].map(number => ({ number, capacity: 4, floor: '1F', isActive: true, status: 'vacant', currentBookingId: null, outage: null }))

beforeEach(() => {
  window.scrollTo = () => {} // jsdom 沒實作；子分頁切換的捲頂 hook 會呼叫
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 9, 30, 9, 0))
  Object.assign(ctx, {
    settings, tables, groupReservations: [],
    bookings: [],
    updateBooking: vi.fn(() => ({})),
    addBooking: vi.fn((d) => ({ id: 'n1', ...d })),
    findReserveCandidates: vi.fn(() => ({ kind: null, tables: [] })),
    assignBookingToTable: vi.fn(() => ({ ok: true })),
    preassignBookingTable: vi.fn(),
  })
})

describe('Modal size', () => {
  it('預設仍是 md（不影響其他 13 處）；xl＝lg 以上 max-w-4xl、lg 以下 max-w-lg', () => {
    mount(<Modal open onClose={() => {}} title="t"><p>x</p></Modal>)
    expect(cls(sheet())).toContain('sm:max-w-md')
    expect(cls(sheet())).not.toContain('lg:max-w-4xl')
    act(() => root.render(<Modal open size="xl" onClose={() => {}} title="t"><p>x</p></Modal>))
    expect(cls(sheet())).toEqual(expect.arrayContaining(['sm:max-w-lg', 'lg:max-w-4xl']))
    expect(cls(sheet())).not.toContain('sm:max-w-md')
  })

  it('玻璃面板不捲、裡層捲（#174 結構）', () => {
    mount(<Modal open size="xl" onClose={() => {}} title="t"><p>x</p></Modal>)
    expect(cls(sheet())).toEqual(expect.arrayContaining(['overflow-hidden', 'flex', 'flex-col', 'max-h-[90vh]']))
    expect(cls(sheet().firstElementChild)).toEqual(expect.arrayContaining(['min-h-0', 'overflow-y-auto']))
  })
})

describe('TimeSlotPicker compactCols', () => {
  const props = { date: '2026-11-02', value: '', onChange: () => {}, settings, tables, bookings: [], variant: 'compact', now: new Date(2026, 9, 30, 9, 0) }
  it('預設 4 欄（現場內嵌面板不變）', () => {
    mount(<TimeSlotPicker {...props} />)
    const grid = container.querySelector('[data-testid="slot-grid"]')
    expect(cls(grid)).toContain('grid-cols-4')
    expect(cls(grid)).not.toContain('sm:grid-cols-6')
  })
  it('compactCols=6：手機 4 欄、sm 以上 6 欄', () => {
    mount(<TimeSlotPicker {...props} compactCols={6} />)
    expect(cls(container.querySelector('[data-testid="slot-grid"]'))).toEqual(expect.arrayContaining(['grid-cols-4', 'sm:grid-cols-6']))
  })
})

describe('EditBookingModal 寬版兩欄', () => {
  const base = { id: 'B1', name: '蔡小姐', phone: '0912000108', guests: 4, date: '2026-10-30', timeSlot: '18:30', source: 'phone', notes: { text: '靠窗' }, status: 'confirmed', assignedTableId: null, extraTableIds: [] }

  it('待到訂位：xl 寬版；左＝日期／時段／人數、右＝姓名／電話／來源／備註；時段 6 欄晶片', () => {
    mount(<EditBookingModal booking={base} onClose={() => {}} />)
    expect(cls(sheet())).toContain('lg:max-w-4xl')
    expect(cls(container.querySelector('[data-testid="edit-booking-columns"]'))).toContain('lg:grid-cols-2')
    const when = container.querySelector('[data-testid="edit-col-when"]').textContent
    const who = container.querySelector('[data-testid="edit-col-who"]').textContent
    for (const t of ['日期', '時段（', '大人']) expect(when).toContain(t)
    for (const t of ['姓名', '電話', '來源', '特殊需求']) expect(who).toContain(t)
    expect(cls(container.querySelector('[data-testid="slot-grid"]'))).toContain('sm:grid-cols-6')
  })

  it('已入座（#171）：維持窄版、只有人數＋備註，送出 patch 不含日期／時段／姓名／電話／來源', () => {
    mount(<EditBookingModal booking={{ ...base, status: 'arrived' }} onClose={() => {}} />)
    expect(cls(sheet())).toContain('sm:max-w-md')
    expect(container.querySelector('[data-testid="edit-booking-columns"]')).toBeNull()
    const txt = sheet().textContent
    expect(txt).toContain('大人')
    expect(txt).toContain('特殊需求')
    for (const t of ['時段（', '日期', '電話', '來源']) expect(txt).not.toContain(t)
    act(() => { [...document.querySelectorAll('button')].find(b => b.textContent === '儲存變更').click() })
    expect(Object.keys(ctx.updateBooking.mock.calls[0][1]).sort()).toEqual(['guests', 'notes'])
  })

  it('改日期／時段仍可用：點「明天」再點時段 → patch 帶新日期時段', () => {
    mount(<EditBookingModal booking={base} onClose={() => {}} />)
    act(() => { [...document.querySelectorAll('button')].find(b => b.textContent === '明天').click() })
    act(() => { [...document.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === '12:00').click() })
    act(() => { [...document.querySelectorAll('button')].find(b => b.textContent === '儲存變更').click() })
    expect(ctx.updateBooking.mock.calls[0][1]).toMatchObject({ date: '2026-10-31', timeSlot: '12:00', name: '蔡小姐' })
  })
})

describe('訂位・今日：頁首固定、清單自己捲、lg 兩欄', () => {
  it('頁首（統計＋搜尋＋來源篩選）與清單分開；清單 md 以上 flex-1＋min-h-0＋自己捲；卡片格 lg 2 欄', () => {
    ctx.bookings = ['A', 'B', 'C'].map((n, i) => ({ id: `T${i}`, name: `${n}先生`, phone: '0912', guests: 2, date: '2026-10-30', timeSlot: '12:00', status: 'confirmed', source: 'phone' }))
    mount(<TodayView />)
    const header = container.querySelector('[data-testid="today-header"]')
    const list = container.querySelector('[data-testid="today-list"]')
    expect(header.textContent).toContain('今日訂位')
    expect(header.querySelector('input[type="search"]')).not.toBeNull()
    expect(header.textContent).toContain('LINE') // 來源篩選
    expect(cls(header)).toContain('md:flex-shrink-0')
    expect(cls(list)).toEqual(expect.arrayContaining(['md:flex-1', 'md:min-h-0', 'md:overflow-y-auto']))
    expect(cls(list.parentElement)).toEqual(expect.arrayContaining(['md:flex', 'md:flex-col', 'md:flex-1', 'md:min-h-0']))
    expect(list.querySelectorAll('[data-testid="card"]')).toHaveLength(3)
    expect(cls(list.querySelector('[data-testid="card"]').parentElement)).toContain('lg:grid-cols-2')
    // 一面式規則：不加固定高
    expect(container.innerHTML).not.toMatch(/\bh-\[\d+px\]|max-h-\[\d+px\]/)
  })
})

describe('訂位・新增：日期單列、時段 6 欄、表單區自己捲', () => {
  it('日期快選 sm 以上 8 格單列（7 天＋選月曆）、時段 6 欄、表單區 md 以上自己捲、確認列 md:static', () => {
    mount(<AddBookingView continuous />)
    const row = container.querySelector('[data-testid="quick-date-row"]')
    expect(cls(row)).toEqual(expect.arrayContaining(['grid', 'grid-cols-4', 'sm:grid-cols-8']))
    expect(row.querySelectorAll('button')).toHaveLength(8)
    for (const b of row.querySelectorAll('button')) expect(cls(b)).toContain('min-h-[44px]')
    expect(cls(container.querySelector('[data-testid="slot-grid"]'))).toContain('sm:grid-cols-6')
    const scroll = container.querySelector('[data-testid="add-form-scroll"]')
    expect(cls(scroll)).toEqual(expect.arrayContaining(['md:flex-1', 'md:min-h-0', 'md:overflow-y-auto']))
    const bar = scroll.nextElementSibling
    expect(bar.textContent).toContain('還差')
    expect(cls(bar)).toEqual(expect.arrayContaining(['sticky', 'md:static', 'md:flex-shrink-0']))
  })

  it('選月曆格：選了 7 天以外的日期顯示「已選 M/D」', () => {
    mount(<AddBookingView initial={{ date: '2026-12-25', seq: 1 }} />)
    const cal = [...container.querySelectorAll('[data-testid="quick-date-row"] button')].at(-1)
    expect(cal.textContent).toBe('選月曆已選 12/25')
  })
})

describe('BookingsView：今日／新增標 data-fill-page，日曆／查詢不標', () => {
  const tab = (label) => act(() => { [...container.querySelectorAll('button')].find(b => b.textContent.trim() === label).click() })
  it('子分頁切換時 data-fill-page 跟著換', () => {
    mount(<BookingsView />)
    const rootEl = () => container.firstElementChild
    expect(rootEl().hasAttribute('data-fill-page')).toBe(true) // 今日
    expect(cls(rootEl())).toEqual(expect.arrayContaining(['md:flex', 'md:flex-col', 'md:flex-1', 'md:min-h-0']))
    tab('日曆')
    expect(rootEl().hasAttribute('data-fill-page')).toBe(false)
    expect(cls(rootEl())).not.toContain('md:flex-1')
    tab('查詢')
    expect(rootEl().hasAttribute('data-fill-page')).toBe(false)
    tab('新增')
    expect(rootEl().hasAttribute('data-fill-page')).toBe(true)
  })

  it('index.css 把 admin-content 到子頁的高度鏈接起來（md 以上、只認沒被 hidden 的那層）', () => {
    const css = fs.readFileSync(path.resolve(__dirname, '../../src/index.css'), 'utf8')
    expect(css).toContain('[data-testid="admin-content"]:has(> div:not([hidden]) > [data-fill-page])')
    expect(css).toContain('[data-testid="admin-content"] > div:not([hidden]):has(> [data-fill-page])')
    expect(css).toMatch(/@media \(min-width: 768px\)\s*{\s*\[data-testid="admin-content"\]:has/)
  })
})
