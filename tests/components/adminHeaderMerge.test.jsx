// 頁面捲動第 2 批・B（2026-10-31）：
//  (1) 非現場頁拿掉 48px 獨立標題列：頁名坐進子分頁籤那一列、登入者／角色移到側欄底部；
//      現場頁的 main 留白（py-4）不可被影響，其他頁縮成 py-3。
//  (2) 團單詳情 lg↑ 左右兩欄：左欄團資訊（只在左欄內捲動）、右欄座位示意；動作鈕全保留。
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { MemoryRouter } from 'react-router-dom'

const harness = vi.hoisted(() => ({ user: { role: 'manager', displayName: '王小明', roleLabel: '店長' } }))
vi.mock('../../src/contexts/BookingContext', () => ({ useBooking: () => ({ bookings: [], waitlist: [], cloudStatus: {}, hydrated: true, fixtures: {}, zones: [] }) }))
vi.mock('../../src/contexts/AuthContext', () => ({ useAuth: () => ({ can: () => true, user: harness.user, usingFirebase: true, signOut: vi.fn() }) }))
vi.mock('../../src/components/ui/Toast', () => ({ useToast: () => ({ info: vi.fn(), error: vi.fn(), success: vi.fn() }), useConfirm: () => vi.fn() }))
vi.mock('../../src/components/admin/OperationsView', () => ({ default: () => <div data-ops /> }))
vi.mock('../../src/components/admin/planning/PlanningView', () => ({ default: () => null }))
vi.mock('../../src/components/admin/BookingsView', () => ({ default: () => <div data-bookings /> }))
vi.mock('../../src/components/admin/SettingsView', () => ({ default: () => null, ADMIN_ACTION_BAR_SLOT: 'test-slot' }))
vi.mock('../../src/components/admin/roster/CustomersView', () => ({ default: () => <div data-customers /> }))
vi.mock('../../src/components/admin/roster/AgencyDirectoryView', () => ({ default: () => <div data-agencies /> }))
vi.mock('../../src/components/admin/floormap/FloorMap', () => ({ default: ({ selectedTables = [] }) => <div data-floormap={selectedTables.join(',')} /> }))
vi.mock('../../src/components/admin/group/GroupSheet', () => ({ default: () => <div data-group-sheet /> }))

const AdminPage = (await import('../../src/pages/AdminPage')).default
const SidebarNav = (await import('../../src/components/layout/SidebarNav')).default
const RosterView = (await import('../../src/components/admin/roster/RosterView')).default
const GroupDetailStage = (await import('../../src/components/admin/planning/GroupDetailStage')).default

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let container, root
const mount = el => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); act(() => root.render(el)) }
afterEach(() => { act(() => root?.unmount()); container?.remove(); container = root = null })
const btn = text => [...container.querySelectorAll('button')].find(b => b.textContent.includes(text))

describe('非現場頁頂端標題列合併', () => {
  const admin = (tab) => mount(<MemoryRouter initialEntries={[`/admin?tab=${tab}`]}><AdminPage /></MemoryRouter>)

  it.each(['planning', 'bookings', 'roster', 'settings'])('%s：不再渲染獨立標題列，main 上下留白縮成 py-3', (tab) => {
    admin(tab)
    expect(container.querySelector('.lg-topbar')).toBeNull()
    const main = container.querySelector('main')
    expect(main.className).toMatch(/\bpy-3\b/)
    expect(main.className).not.toMatch(/\bpy-4\b/)
  })

  it('現場頁：main 留白維持 py-4（一面式版面不受影響）', () => {
    admin('ops')
    expect(container.querySelector('[data-ops]')).not.toBeNull()
    expect(container.querySelector('.lg-topbar')).toBeNull()
    expect(container.querySelector('main').className).toMatch(/\bpy-4\b/)
  })

  it('側欄底部顯示登入者與角色（76px 圖示欄也看得到，不只頭像縮寫）', () => {
    const tabs = [{ key: 'bookings', label: '訂位', icon: 'bookings' }]
    mount(<SidebarNav tabs={tabs} active="bookings" onChange={() => {}} />)
    const card = container.querySelector('[data-testid="sidebar-user"]')
    expect(card.textContent).toContain('王小明')
    expect(card.textContent).toContain('店長')
    // 窄側欄（< xl）用的那一塊：xl 以上由原本的完整名片接手，避免重複
    const narrow = [...card.querySelectorAll('div')].find(d => d.className.includes('xl:hidden'))
    expect(narrow.textContent).toBe('王小明店長')
    expect(narrow.className).toMatch(/text-xs/)
  })

  it('名冊：頁名 h1 與子分頁籤在同一列，子分頁切換照舊', () => {
    mount(<RosterView />)
    const h1 = container.querySelector('h1')
    expect(h1.textContent).toBe('名冊')
    expect(h1.className).toMatch(/hidden lg:block/) // 手機殼有 Header，不重複
    const row = h1.parentElement
    expect(row.className).toMatch(/sticky/)
    expect(row.querySelector('[aria-label="名冊子分頁"]')).not.toBeNull()
    expect(container.querySelector('[data-customers]')).not.toBeNull()
    act(() => btn('旅行社').click())
    expect(container.querySelector('[data-agencies]')).not.toBeNull()
  })
})

describe('團單詳情左右兩欄', () => {
  const tables = [{ number: '201', capacity: 6, floor: '2F' }, { number: '202', capacity: 6, floor: '2F' }, { number: '101', capacity: 4, floor: '1F' }]
  const group = (over = {}) => ({
    id: 'G1', date: '2026-10-30', status: 'confirmed', agencyName: '好運旅行社', guideName: '陳導遊', guidePhone: '0933000111',
    counts: { total: 12, vegetarian: 2 }, allergyText: '海鮮過敏', notes: '靠窗',
    batches: [{ id: 'B1', label: '第一梯', timeSlot: '11:30', tableNumbers: ['201', '202'], guests: 12 }], ...over,
  })

  it('lg↑ 左欄團資訊可獨立捲動、右欄座位示意；動作鈕（回傳單／改期／編輯）全保留', () => {
    const onEdit = vi.fn(), onReschedule = vi.fn()
    mount(<GroupDetailStage group={group()} tables={tables} settings={{}} onBack={() => {}} onEdit={onEdit} onReschedule={onReschedule} />)
    const root = container.querySelector('[data-testid="group-detail"]')
    expect(root.className).toMatch(/lg:h-full/)
    expect(root.className).toMatch(/lg:flex-col/)
    const info = container.querySelector('[data-testid="group-detail-info"]')
    const map = container.querySelector('[data-testid="group-detail-map"]')
    expect(info.className).toMatch(/lg:overflow-y-auto/)
    expect(info.className).toMatch(/lg:min-h-0/)
    expect(info.parentElement).toBe(map.parentElement) // 同一個兩欄 grid
    expect(info.parentElement.className).toMatch(/lg:grid-cols-\[minmax\(0,5fr\)_minmax\(0,7fr\)\]/)
    // 左欄：梯次、人數、旅行社、導遊、備註
    for (const t of ['梯次與桌位', '總人數', '好運旅行社', '陳導遊', '靠窗', '海鮮過敏']) expect(info.textContent).toContain(t)
    // 右欄：地圖、圈到的桌
    expect(map.querySelector('[data-floormap]').dataset.floormap).toBe('201,202')
    // 動作
    act(() => btn('改期').click()); expect(onReschedule).toHaveBeenCalled()
    act(() => btn('編輯').click()); expect(onEdit).toHaveBeenCalled()
    act(() => btn('回傳單').click()); expect(container.querySelector('[data-group-sheet]')).not.toBeNull()
  })

  it('沒有圈桌：不渲染地圖欄，左欄改成單欄撐滿', () => {
    mount(<GroupDetailStage group={group({ batches: [{ id: 'B1', label: '第一梯', timeSlot: '11:30', tableNumbers: [], guests: 12 }] })} tables={tables} settings={{}} onBack={() => {}} />)
    expect(container.querySelector('[data-testid="group-detail-map"]')).toBeNull()
    expect(container.querySelector('[data-testid="group-detail-info"]').parentElement.className).toMatch(/lg:grid-cols-1/)
  })
})
