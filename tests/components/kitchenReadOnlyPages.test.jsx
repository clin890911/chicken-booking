import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { getSettings } from '../../src/services/settingsService'
import { todayStr } from '../../src/utils/timeSlots'

// 廚房（kitchen）完全唯讀——規劃／名冊／設定頁（現場頁見 kitchenReadOnlyOps.test.jsx，訂位頁見 bookingsViewAddFlow.test.jsx）。
// 角色矩陣一律取自真實 PERMISSIONS；同一份資料同時跑 manager／host／floor 證明原入口不少。
// 規劃頁的重型子元件換成只回報「收到哪些寫入 callback」的樁，驗證的是 PlanningView 該不該把入口交出去。

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let settingsSection = ''
vi.mock('react-router-dom', () => ({
  useSearchParams: () => [new URLSearchParams(settingsSection ? `section=${settingsSection}` : ''), vi.fn()],
}))

const TODAY = todayStr()
const ctx = {}
let currentRole = 'manager'
const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), action: vi.fn() }
vi.mock('../../src/contexts/BookingContext', () => ({ useBooking: () => ctx }))
vi.mock('../../src/contexts/AuthContext', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    useAuth: () => ({
      can: (p) => actual.PERMISSIONS[currentRole].has(p),
      user: { email: 'x@test', displayName: '測試', roleLabel: currentRole },
      signOut: vi.fn(), usingFirebase: true,
    }),
  }
})
vi.mock('../../src/components/ui/Toast', () => ({ useToast: () => toast, useConfirm: () => vi.fn(async () => true) }))

// ---- 規劃頁子元件樁 ----
vi.mock('../../src/components/admin/planning/GroupCalendar', () => ({ default: () => <div>CalStub</div> }))
vi.mock('../../src/components/admin/planning/GroupDaySheet', () => ({ default: () => null }))
vi.mock('../../src/components/admin/planning/GroupEditorStage', () => ({ default: () => <div>EditorStub</div> }))
vi.mock('../../src/components/admin/planning/GroupRescheduleModal', () => ({ default: () => null }))
vi.mock('../../src/components/admin/planning/AddWalkinModal', () => ({ default: ({ open }) => open ? <div>AddWalkinOpen</div> : null }))
vi.mock('../../src/components/booking/BookingDetailSheet', () => ({ default: () => null }))
vi.mock('../../src/components/admin/planning/GroupDayPanel', () => ({
  default: (p) => (
    <div data-testid="day-panel"
      data-new-group={String(!!p.onNewGroup)} data-duplicate={String(!!p.onDuplicate)} data-assign-walkin={String(!!p.onAssignWalkin)}>
      <button onClick={() => p.onSelectGroup('G1')}>openGroup</button>
    </div>
  ),
}))
vi.mock('../../src/components/admin/planning/GroupDetailStage', () => ({
  default: (p) => <div data-testid="detail" data-edit={String(!!p.onEdit)} data-reschedule={String(!!p.onReschedule)} />,
}))
vi.mock('../../src/components/admin/planning/SlotMapPanel', () => ({ default: () => <div>MapStub</div> }))

// ---- 設定頁重型子元件樁 ----
vi.mock('../../src/components/admin/TableGrid', () => ({ default: () => null }))
vi.mock('../../src/components/admin/LayoutEditor', () => ({ default: () => null }))
vi.mock('../../src/components/admin/TelegramSettings', () => ({ default: () => <button>TgSend</button> }))
vi.mock('../../src/components/admin/StaffAdminSection', () => ({ default: () => null }))
vi.mock('../../src/components/admin/ExportCenter', () => ({ default: () => <button>ExportBtn</button> }))

const PlanningView = (await import('../../src/components/admin/planning/PlanningView')).default
const CustomersView = (await import('../../src/components/admin/roster/CustomersView')).default
const AgencyDirectoryView = (await import('../../src/components/admin/roster/AgencyDirectoryView')).default
const SettingsView = (await import('../../src/components/admin/SettingsView')).default

let container, root
const mount = (el) => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => { root.render(el) })
}
const btns = () => [...container.querySelectorAll('button')]
const has = (t) => btns().some(b => b.textContent.includes(t))
const hasExact = (t) => btns().some(b => b.textContent.trim() === t)
const click = (el) => act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  currentRole = 'manager'
})

describe('規劃頁 PlanningView', () => {
  beforeEach(() => {
    Object.assign(ctx, {
      groupReservations: [{ id: 'G1', date: TODAY, agencyName: '測試旅行社', status: 'planned', batches: [], counts: {} }],
      agencies: [], guides: [], tables: [], bookings: [], settings: getSettings(),
      reserveGroupTables: vi.fn(), removeGroupReservation: vi.fn(), addAgency: vi.fn(), addGuide: vi.fn(),
      createAndReserveGroup: vi.fn(), purgeBlankGroups: vi.fn(() => 0),
    })
  })
  const panel = () => container.querySelector('[data-testid="day-panel"]')

  it.each(['manager', 'host', 'floor'])('%s：新增散客／新增團單入口都在（外場無 group.create 的既有行為不動）', (role) => {
    currentRole = role
    mount(<PlanningView />)
    expect(has('新增團單')).toBe(true)
    expect(panel().dataset.newGroup).toBe('true')
    expect(panel().dataset.duplicate).toBe('true')
    // 新增散客：manager／host／floor 都有 booking.create
    expect(has('新增散客')).toBe(true)
    expect(panel().dataset.assignWalkin).toBe('true')
    click(btns().find(b => b.textContent.includes('openGroup')))
    expect(container.querySelector('[data-testid="detail"]').dataset.edit).toBe('true')
    expect(container.querySelector('[data-testid="detail"]').dataset.reschedule).toBe('true')
  })

  it('kitchen：沒有新增散客／新增團單／複製團單／配桌；團單詳情沒有編輯與改期', () => {
    currentRole = 'kitchen'
    mount(<PlanningView />)
    expect(has('新增散客')).toBe(false)
    expect(has('新增團單')).toBe(false)
    expect(panel().dataset.newGroup).toBe('false')
    expect(panel().dataset.duplicate).toBe('false')
    expect(panel().dataset.assignWalkin).toBe('false')
    // 仍可看團單詳情（唯讀）
    click(btns().find(b => b.textContent.includes('openGroup')))
    const detail = container.querySelector('[data-testid="detail"]')
    expect(detail).toBeTruthy()
    expect(detail.dataset.edit).toBe('false')
    expect(detail.dataset.reschedule).toBe('false')
    // 清理空白團單是進分頁自動跑的寫入：kitchen 不可觸發（原本就守 group.delete）
    expect(ctx.purgeBlankGroups).not.toHaveBeenCalled()
  })
})

describe('名冊：顧客檔與旅行社', () => {
  beforeEach(() => {
    Object.assign(ctx, {
      customers: [{ phone: '0911000111', name: '王小明', visits: 3, totalGuests: 9, lastVisit: '2026-09-01', vipTier: 'none', blacklisted: false, archived: false }],
      bookings: [],
      updateCustomer: vi.fn(), setCustomerBlacklist: vi.fn(), setCustomerVip: vi.fn(),
      agencies: [{ id: 'A1', name: '快樂旅行社', phone: '02-1234', contactName: '王', lineId: '', note: '' }],
      guides: [], groupReservations: [],
      addAgency: vi.fn(), updateAgency: vi.fn(), archiveAgency: vi.fn(), addGuide: vi.fn(), updateGuide: vi.fn(), archiveGuide: vi.fn(),
    })
  })

  it.each(['manager', 'host', 'floor'])('%s：顧客卡有 編輯／黑名單／歸檔，詳情有 新增訂位／編輯備註', (role) => {
    currentRole = role
    mount(<CustomersView onAddBooking={vi.fn()} />)
    for (const t of ['編輯', '加黑名單', '歸檔']) expect(hasExact(t), `${role} ${t}`).toBe(true)
    click(container.querySelector('[role="button"][title="查看來訪記錄"]'))
    expect(has('新增訂位')).toBe(true)
    expect(has('編輯備註')).toBe(true)
  })

  it('kitchen：顧客只能看——沒有 編輯／黑名單／歸檔，詳情沒有 新增訂位／編輯備註', () => {
    currentRole = 'kitchen'
    mount(<CustomersView onAddBooking={vi.fn()} />)
    expect(container.textContent).toContain('王小明')
    for (const t of ['編輯', '加黑名單', '解除黑名單', '歸檔']) expect(hasExact(t), t).toBe(false)
    click(container.querySelector('[role="button"][title="查看來訪記錄"]'))
    expect(has('新增訂位')).toBe(false)
    expect(has('編輯備註')).toBe(false)
    expect(ctx.updateCustomer).not.toHaveBeenCalled()
  })

  it('旅行社名冊：manager／host 有新增＋詳情的「新增團體預排」；floor 詳情保留該導覽（既有行為）；kitchen 全無', () => {
    for (const role of ['manager', 'host', 'floor']) {
      currentRole = role
      mount(<AgencyDirectoryView onGoPlanning={vi.fn()} />)
      click(btns().find(b => b.textContent.includes('詳情') || b.textContent.includes('歷史')))
      expect(has('新增團體預排'), role).toBe(true)
      act(() => root.unmount()); container.remove()
    }
    currentRole = 'kitchen'
    mount(<AgencyDirectoryView onGoPlanning={vi.fn()} />)
    expect(has('新增旅行社')).toBe(false)
    expect(has('編輯')).toBe(false)
    expect(has('封存')).toBe(false)
    click(btns().find(b => b.textContent.includes('詳情') || b.textContent.includes('歷史')))
    expect(has('新增團體預排')).toBe(false)
    expect(has('編輯旅行社')).toBe(false)
    // 旅行社詳情的「匯出 CSV」也不可用
    expect(has('匯出 CSV')).toBe(false)
  })

  it.each(['manager', 'host', 'floor'])('%s：旅行社詳情保有「匯出 CSV」', (role) => {
    currentRole = role
    mount(<AgencyDirectoryView onGoPlanning={vi.fn()} />)
    click(btns().find(b => b.textContent.includes('詳情') || b.textContent.includes('歷史')))
    expect(has('匯出 CSV')).toBe(true)
  })
})

describe('設定頁 SettingsView', () => {
  const CATEGORIES = ['ops-rules', 'online', 'floor', 'line', 'data']
  // 本質是讀取／帳號操作而保持可用的區塊（標題）：No-show 查詢、帳號（登出）、Firestore 資料同步（另驗上傳鈕）
  // 資料匯出（含電話個資）不在其內——kitchen 根本不渲染（見下方專測）
  // 這台裝置的顯示（不透明模式）：只存這台裝置的 localStorage、不寫雲端 → 唯讀角色也能切
  const EXEMPT_TITLES = ['No-show 查詢', '帳號', 'Firestore 資料同步', '這台裝置的顯示']
  beforeEach(() => {
    Object.assign(ctx, {
      bookings: [], updateSettings: vi.fn((s) => s), flushCloudNow: vi.fn(async () => ({ ok: true })),
      cloudStatus: { state: 'idle' }, migrateLocalToCloud: vi.fn(), pullCloud: vi.fn(), discardRejectedChanges: vi.fn(),
      localPersistDegraded: false,
    })
    ctx.settings = getSettings()
  })
  afterEach(() => { settingsSection = '' })

  // 回傳「不在 disabled fieldset 內、自身也沒 disabled」的可操作元件（排除非豁免區塊的 summary 展開列）
  const liveControls = (sectionEl) => [...sectionEl.querySelectorAll('input, select, textarea, button')]
    .filter(el => !el.closest('summary') && !el.closest('fieldset[disabled]') && !el.disabled)
  const sections = () => [...container.querySelectorAll('details')].map(d => ({ el: d, title: d.querySelector('summary h2')?.textContent || '' }))

  it('manager：每個分類的區塊都沒被鎖（沒有 disabled fieldset）', () => {
    currentRole = 'manager'
    for (const cat of CATEGORIES) {
      settingsSection = cat
      mount(<SettingsView />)
      expect(container.querySelector('fieldset[disabled]'), cat).toBeNull()
      expect(sections().length, cat).toBeGreaterThan(0)
      act(() => root.unmount()); container.remove()
    }
  })

  it.each(['host', 'floor'])('%s：設定區塊同樣不被鎖（既有行為不變，儲存仍由 settings.update 擋）', (role) => {
    currentRole = role
    for (const cat of CATEGORIES) {
      settingsSection = cat
      mount(<SettingsView />)
      expect(container.querySelector('fieldset[disabled]'), `${role} ${cat}`).toBeNull()
      act(() => root.unmount()); container.remove()
    }
  })

  it('kitchen：五個分類的所有可編輯區塊整段 disabled，且沒有儲存鈕', () => {
    currentRole = 'kitchen'
    let checked = 0
    for (const cat of CATEGORIES) {
      settingsSection = cat
      mount(<SettingsView />)
      for (const { el, title } of sections()) {
        if (EXEMPT_TITLES.includes(title)) continue
        checked += 1
        expect(liveControls(el).map(c => c.outerHTML.slice(0, 90)), `${cat}/${title}`).toEqual([])
      }
      expect(has('儲存全部變更'), cat).toBe(false)
      expect(container.textContent).toContain('唯讀')
      act(() => root.unmount()); container.remove()
    }
    expect(checked).toBeGreaterThanOrEqual(8)   // 確認真的掃到了一堆區塊，不是空轉
  })

  it('kitchen：資料同步「上傳本機資料」disabled；No-show 查詢、登出保持可用；資料匯出整區不存在', () => {
    currentRole = 'kitchen'
    settingsSection = 'data'
    mount(<SettingsView />)
    const push = btns().find(b => b.textContent.includes('上傳本機資料到 Firestore'))
    expect(push.disabled).toBe(true)
    expect(btns().find(b => b.textContent.includes('從 Firestore 重新整理')).disabled).toBe(false)
    expect(btns().some(b => b.textContent.includes('ExportBtn'))).toBe(false)
    expect(sections().some(x => x.title === '資料匯出')).toBe(false)
    expect(container.textContent).not.toContain('下載 CSV')
    expect(btns().find(b => b.textContent.trim() === '查詢').closest('fieldset[disabled]')).toBeNull()
    expect(btns().find(b => b.textContent.trim() === '登出').closest('fieldset[disabled]')).toBeNull()
  })

  // 「不透明模式」只寫這台裝置的 localStorage。歷史上整份 settings 推送曾洗掉 LINE 設定——這個開關絕不可碰雲端。
  it.each(['kitchen', 'manager'])('%s：「不透明模式」開關可切（aria-checked 變 true）、且不寫任何雲端 settings', (role) => {
    currentRole = role
    let sw = null
    for (const cat of CATEGORIES) {
      settingsSection = cat
      mount(<SettingsView />)
      sw = container.querySelector('button[role="switch"]')
      if (sw) break
      act(() => root.unmount()); container.remove()
    }
    expect(sw, '找不到不透明模式開關').not.toBeNull()
    expect(sw.closest('fieldset[disabled]')).toBeNull()
    expect(sw.disabled).toBe(false)
    expect(sw.getAttribute('aria-checked')).toBe('false')
    click(sw)
    expect(sw.getAttribute('aria-checked')).toBe('true')
    expect(container.querySelector('button[role="switch"]').getAttribute('aria-checked')).toBe('true')
    // 任何雲端寫入路徑都不能被呼叫
    expect(ctx.updateSettings).not.toHaveBeenCalled()
    expect(ctx.flushCloudNow).not.toHaveBeenCalled()
    expect(ctx.migrateLocalToCloud).not.toHaveBeenCalled()
    // 切回去也一樣；並清掉全域狀態不影響其他測試
    click(sw)
    expect(sw.getAttribute('aria-checked')).toBe('false')
    expect(ctx.updateSettings).not.toHaveBeenCalled()
    expect(ctx.flushCloudNow).not.toHaveBeenCalled()
    try { localStorage.clear() } catch { /* noop */ }
    delete document.documentElement.dataset.material
  })

  it.each(['manager', 'host', 'floor'])('%s：資料匯出區塊在、匯出鈕可用（既有行為不動）', (role) => {
    currentRole = role
    settingsSection = 'data'
    mount(<SettingsView />)
    expect(sections().some(x => x.title === '資料匯出')).toBe(true)
    expect(btns().find(b => b.textContent.includes('ExportBtn')).closest('fieldset[disabled]')).toBeNull()
  })

  it('manager：同一頁的上傳鈕可按（只受 usingFirebase 影響）', () => {
    currentRole = 'manager'
    settingsSection = 'data'
    mount(<SettingsView />)
    expect(btns().find(b => b.textContent.includes('上傳本機資料到 Firestore')).disabled).toBe(false)
  })
})
