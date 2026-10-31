// 頁面捲動第 3 批：三個版面重排的行為鎖（④ 設定頁區塊進網址）。
//   ① 規劃→當日總覽：散客名單預設收合、只留一行摘要（含未配桌數），點開才列名單。
//   ② 團單精靈：已完成的段落收成一行摘要、還要處理的段落展開（新增＝一頁三段全開）；點「修改」展開、「收起」收回。
//   ③ 設定頁：md 以上主從式——同分類一次只畫一個區塊（不用 <details>），區塊清單切換；手機（無 matchMedia）維持清單版。
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { getSettings } from '../../src/services/settingsService'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let settingsSection = ''
let settingsQuery = '' // 完整查詢字串（優先於 settingsSection）
// 有狀態的 useSearchParams 假體：setter 會真的改網址並重繪，並記下每次呼叫的 options（replace 與否）
const urlLog = []
vi.mock('react-router-dom', async () => {
  const React = await import('react')
  return {
    useSearchParams: () => {
      const [params, setParams] = React.useState(() => new URLSearchParams(settingsQuery || (settingsSection ? `section=${settingsSection}` : '')))
      const set = (next, opts) => setParams(prev => {
        const n = typeof next === 'function' ? next(prev) : new URLSearchParams(next)
        urlLog.push({ query: n.toString(), replace: !!opts?.replace })
        return n
      })
      return [params, set]
    },
  }
})
const ctx = { fixtures: [], zones: [] }
vi.mock('../../src/contexts/BookingContext', () => ({ useBooking: () => ctx }))
vi.mock('../../src/contexts/AuthContext', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    useAuth: () => ({
      can: (p) => actual.PERMISSIONS.manager.has(p),
      user: { email: 'x@test', displayName: '測試', roleLabel: '店長', role: 'manager' },
      signOut: vi.fn(), usingFirebase: false,
    }),
  }
})
const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), action: vi.fn() }
vi.mock('../../src/components/ui/Toast', () => ({ useToast: () => toast, useConfirm: () => vi.fn(async () => true) }))
vi.mock('../../src/components/admin/floormap/FloorMap', () => ({ default: () => <div data-testid="floormap" /> }))
vi.mock('../../src/components/admin/group/GroupSheet', () => ({ default: () => null }))
vi.mock('../../src/components/admin/TableGrid', () => ({ default: () => null }))
vi.mock('../../src/components/admin/LayoutEditor', () => ({ default: () => null }))
vi.mock('../../src/components/admin/TelegramSettings', () => ({ default: () => <div>TgStub</div> }))
vi.mock('../../src/components/admin/StaffAdminSection', () => ({ default: () => null }))
vi.mock('../../src/components/admin/ExportCenter', () => ({ default: () => null }))

const GroupEditorStage = (await import('../../src/components/admin/planning/GroupEditorStage')).default
const GroupDayPanel = (await import('../../src/components/admin/planning/GroupDayPanel')).default
const { default: SettingsView, resolveSettingsLocation } = await import('../../src/components/admin/SettingsView')

let container, root
const mount = (el) => {
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
  act(() => root.render(el))
}
const btn = (pred) => [...container.querySelectorAll('button')].find(pred)
const click = (el) => act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
const q = (sel) => container.querySelector(sel)
afterEach(() => { act(() => root?.unmount()); container?.remove(); settingsSection = ''; settingsQuery = ''; urlLog.length = 0 })

// ---------- ② 團單精靈 ----------
const DATE = '2026-11-01'
const SEATINGS = [
  { id: 'lunch1', name: '午餐第一批', start: '11:00', end: '12:30' },
  { id: 'dinner1', name: '晚餐第一批', start: '17:00', end: '19:00' },
]
const editorSettings = {
  openTime: '11:00', closeTime: '19:00', slotInterval: 30, diningDurationMin: 90, cleanupBufferMin: 10,
  seatings: SEATINGS, closures: { closedDates: [], closedSlots: {}, closedSeatings: {} },
}
const tables = [
  { number: '101', capacity: 6, floor: '1F', isActive: true },
  { number: '102', capacity: 6, floor: '1F', isActive: true },
]
const groupOf = (over = {}) => ({
  id: 'G1', date: DATE, status: 'confirmed', agencyId: 'A1', agencyName: '大發旅行社', guideName: '陳導', guidePhone: '0911',
  counts: { total: 6 },
  batches: [{ id: 'b1', label: '第一梯', timeSlot: '11:00', tableNumbers: ['101'], guests: 6 }],
  ...over,
})
const mountEditor = (props) => mount(
  <GroupEditorStage
    initialGroup={groupOf()} isNew={false} date={DATE} slots={['11:00', '17:00']}
    tables={tables} settings={editorSettings} bookings={[]} agencies={[{ id: 'A1', name: '大發旅行社' }]} guides={[]}
    groupReservations={[]} onBack={() => {}} onSaved={() => {}} onDeleted={() => {}}
    reserveExisting={vi.fn()} createGroup={vi.fn()} removeGroup={vi.fn()} addAgency={vi.fn()} addGuide={vi.fn()}
    {...props}
  />,
)
const open = (n) => !!q(`[data-testid="group-editor-sec-${n}"]`)
const row = (n) => q(`[data-testid="group-editor-row-${n}"]`)

describe('團單精靈：步驟收合', () => {
  it('編輯既有團（三段都填好）：全部收成一行摘要，標題 heading 仍在；儲存鈕與檢查清單照舊', () => {
    mountEditor()
    expect([1, 2, 3].map(open)).toEqual([false, false, false])
    expect(row(1).textContent).toContain('大發旅行社 · 導遊 陳導 · 0911')
    expect(row(2).textContent).toContain('6 人')
    expect(row(3).textContent).toContain('午餐第一批')
    expect(row(3).textContent).toContain('桌 101')
    expect([...container.querySelectorAll('h3')].map(h => h.textContent)).toEqual(expect.arrayContaining(['旅行社與導遊', '人數', '場次與梯次']))
    expect(q('[data-testid="floormap"]')).toBeNull() // 圈桌地圖收起時不渲染
    expect(btn(b => b.textContent.includes('儲存並保留')).disabled).toBe(false)
  })

  it('點「修改」展開、「收起」收回；展開的完成段落有「完成，收起」', () => {
    mountEditor()
    click(btn(b => b.getAttribute('aria-label') === '修改人數'))
    expect(open(2)).toBe(true)
    expect(q('[aria-label="總人數"]')).not.toBeNull()
    expect(btn(b => b.textContent.includes('完成，收起'))).toBeTruthy()
    click(btn(b => b.getAttribute('aria-label') === '收起人數'))
    expect(open(2)).toBe(false)
    click(btn(b => b.getAttribute('aria-label') === '修改場次與梯次'))
    expect(open(3)).toBe(true)
    expect(q('[data-testid="floormap"]')).not.toBeNull() // 圈桌地圖＋側欄回來
  })

  it('新增團單：維持一頁三段全開（#128），還沒完成的段落沒有「完成」鈕；可手動收起成「填寫」列', () => {
    mountEditor({ isNew: true, initialGroup: groupOf({ id: undefined, agencyId: null, agencyName: '', guideName: '', guidePhone: '', counts: { total: 0 }, batches: [{ id: 'b1', label: '第一梯', timeSlot: '11:00', tableNumbers: [], guests: 0 }] }) })
    expect([1, 2, 3].map(open)).toEqual([true, true, true])
    expect(btn(b => b.textContent.includes('完成，'))).toBeFalsy()
    expect(btn(b => b.textContent.includes('儲存並保留')).disabled).toBe(true) // 防呆照舊
    click(btn(b => b.getAttribute('aria-label') === '收起人數'))
    expect(btn(b => b.getAttribute('aria-label') === '填寫人數')).toBeTruthy()
  })

  it('複製／改期（旅行社、人數有了但桌被清空）：直接展開 ③ 圈桌；①② 收成摘要', () => {
    mountEditor({ isNew: true, initialGroup: groupOf({ id: undefined, batches: [{ id: 'b1', label: '第一梯', timeSlot: '11:00', tableNumbers: [], guests: 6 }] }) })
    expect([1, 2, 3].map(open)).toEqual([false, false, true])
  })

  it('填完一段按「完成，收起」→ 收成摘要；後面還有收起的待填段落時改叫「完成，下一步」並幫忙展開', () => {
    mountEditor({ isNew: true, initialGroup: groupOf({ id: undefined, counts: { total: 0 }, batches: [{ id: 'b1', label: '第一梯', timeSlot: '11:00', tableNumbers: [], guests: 0 }] }) })
    // ① 已有旅行社 → 收著；②③ 待填 → 展開
    expect([1, 2, 3].map(open)).toEqual([false, true, true])
    click(btn(b => b.textContent.includes('大巴')))
    click(btn(b => b.textContent.includes('完成，收起')))
    expect([1, 2, 3].map(open)).toEqual([false, false, true])
    expect(row(2).textContent).toContain('43 人')
    // ③ 收起後再展開 ②：② 的完成鈕會帶出 ③
    click(btn(b => b.getAttribute('aria-label') === '收起場次與梯次'))
    click(btn(b => b.getAttribute('aria-label') === '修改人數'))
    click(btn(b => b.textContent.includes('完成，下一步')))
    expect([1, 2, 3].map(open)).toEqual([false, false, true])
  })
})

// ---------- ① 當日總覽散客收合 ----------
describe('當日總覽：散客名單預設收合', () => {
  const seating = SEATINGS[0]
  const wRow = (id, name, table) => ({ booking: { id, name, guests: 4, timeSlot: '11:30', notes: {} }, status: 'confirmed', timeSlot: '11:30', guests: 4, assignedTableId: table })
  const daySummary = {
    seatings: [{ seating, summary: { totalSeats: 100, remaining: 80, remainingTables: 10, groupHeldSeats: 0, walkinGuests: 8 } }],
    timeline: [],
    walkins: { count: 2, guests: 8, unassignedCount: 1, unassignedGuests: 4, bySeating: [{ seating, rows: [wRow('B1', '王小姐', '105'), wRow('B2', '林老師', null)] }], unscheduled: [] },
  }
  it('只顯示摘要（組數、位數、未配桌），點開才列名單、可再收起', () => {
    mount(<GroupDayPanel date={DATE} daySummary={daySummary} dayGroups={[]} onSelectGroup={() => {}} onAssignWalkin={() => {}} onOpenWalkin={() => {}} />)
    const toggle = q('[data-testid="walkin-toggle"]')
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(toggle.textContent).toContain('散客 2 組 · 8 位')
    expect(toggle.textContent).toContain('未配桌 1')
    expect(container.textContent).not.toContain('王小姐')
    click(toggle)
    expect(container.textContent).toContain('王小姐')
    expect(btn(b => b.textContent.trim() === '配桌')).toBeTruthy()
    click(toggle)
    expect(container.textContent).not.toContain('王小姐')
  })
})

// ---------- ③ 設定頁主從式 ----------
describe('設定頁：md 以上主從式（一次一個區塊）', () => {
  let origMM
  beforeEach(() => {
    Object.assign(ctx, {
      bookings: [], updateSettings: vi.fn((s) => s), flushCloudNow: vi.fn(async () => ({ ok: true })),
      cloudStatus: { state: 'idle' }, migrateLocalToCloud: vi.fn(), pullCloud: vi.fn(), discardRejectedChanges: vi.fn(),
      localPersistDegraded: false, settings: getSettings(),
    })
    origMM = window.matchMedia
  })
  afterEach(() => { window.matchMedia = origMM })
  const shown = () => [...container.querySelectorAll('[data-settings-section]')].map(e => e.dataset.settingsSection)

  it('寬螢幕：只畫選中的區塊、直接展開；點區塊清單切換；分類仍讀 ?section=', () => {
    window.matchMedia = () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} })
    settingsSection = 'line'
    mount(<SettingsView />)
    expect(container.querySelectorAll('details.card').length).toBe(0) // 區塊層不再是 <details>（區塊內的小摺疊不算）
    expect(shown()).toEqual(['line'])
    click(btn(b => b.textContent.trim() === '通知與備份'))
    expect(shown()).toEqual(['telegram'])
    expect(container.textContent).toContain('TgStub')
  })

  it('手機（無 matchMedia）：維持原本的可收合清單', () => {
    window.matchMedia = undefined
    settingsSection = 'line'
    mount(<SettingsView />)
    expect(shown()).toEqual([])
    expect([...container.querySelectorAll('details summary h2')].map(h => h.textContent)).toEqual(['LINE 官方帳號', '通知與備份'])
  })
})

// ---------- ④ 設定頁：選到的區塊進網址（Barry 2026-10-31 拍板） ----------
describe('設定頁：區塊寫進網址 ?section=<分類>&block=<區塊>', () => {
  let origMM
  beforeEach(() => {
    Object.assign(ctx, {
      bookings: [], updateSettings: vi.fn((s) => s), flushCloudNow: vi.fn(async () => ({ ok: true })),
      cloudStatus: { state: 'idle' }, migrateLocalToCloud: vi.fn(), pullCloud: vi.fn(), discardRejectedChanges: vi.fn(),
      localPersistDegraded: false, settings: getSettings(),
    })
    origMM = window.matchMedia
    window.matchMedia = () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} })
  })
  afterEach(() => { window.matchMedia = origMM })
  const shown = () => [...container.querySelectorAll('[data-settings-section]')].map(e => e.dataset.settingsSection)
  const last = () => urlLog[urlLog.length - 1]
  const lastParams = () => new URLSearchParams(last().query)

  it('resolveSettingsLocation：合法、非法、跨分類、只給 block', () => {
    expect(resolveSettingsLocation('line', 'telegram')).toEqual({ categoryKey: 'line', block: 'telegram' })
    expect(resolveSettingsLocation('floor', 'nope')).toEqual({ categoryKey: 'floor', block: null })
    expect(resolveSettingsLocation('line', 'hours')).toEqual({ categoryKey: 'line', block: null }) // 別分類的區塊不採用
    expect(resolveSettingsLocation(null, 'closures')).toEqual({ categoryKey: 'ops-rules', block: 'closures' }) // 只給 block → 推回分類
    expect(resolveSettingsLocation('xxx', 'yyy')).toEqual({ categoryKey: 'ops-rules', block: null })
    expect(resolveSettingsLocation(null, null)).toEqual({ categoryKey: 'ops-rules', block: null })
  })

  it('帶 block 開頁直接停在該區塊（重新整理／書籤）', () => {
    settingsQuery = 'tab=settings&section=line&block=telegram'
    mount(<SettingsView />)
    expect(shown()).toEqual(['telegram'])
    expect(urlLog).toEqual([]) // 開頁不改網址
  })

  it('非法或不屬該分類的 block → 退回該分類第一個區塊', () => {
    settingsQuery = 'tab=settings&section=floor&block=nope'
    mount(<SettingsView />)
    expect(shown()).toEqual(['device-display'])
    act(() => root.unmount()); container.remove()
    settingsQuery = 'tab=settings&section=line&block=hours'
    mount(<SettingsView />)
    expect(shown()).toEqual(['line'])
  })

  it('點區塊 → 網址寫入 block，用 replace（不塞歷史）', () => {
    settingsQuery = 'tab=settings&section=line'
    mount(<SettingsView />)
    click(btn(b => b.textContent.trim() === '通知與備份'))
    expect(shown()).toEqual(['telegram'])
    expect(last().replace).toBe(true)
    expect(Object.fromEntries(lastParams())).toEqual({ tab: 'settings', section: 'line', block: 'telegram' })
  })

  it('換分類 → push、block 改成該分類上次選的（沒選過就拿掉）', () => {
    settingsQuery = 'tab=settings&section=line&block=telegram'
    mount(<SettingsView />)
    const cat = (label) => btn(b => b.getAttribute('aria-current') !== 'true' && b.textContent.includes(label) && !!b.querySelector('svg'))
    click(cat('資料與權限'))
    expect(last().replace).toBe(false)
    expect(lastParams().get('section')).toBe('data')
    expect(lastParams().has('block')).toBe(false)
    expect(shown()).toEqual(['firestore'])
    click(cat('通知與 LINE'))
    expect(lastParams().get('section')).toBe('line')
    expect(lastParams().get('block')).toBe('telegram') // 回到原分類，停在上次的區塊
    expect(shown()).toEqual(['telegram'])
  })

  it('手機清單版：帶 block 的連結預先展開該區塊，其餘照舊收合', () => {
    window.matchMedia = undefined
    settingsQuery = 'tab=settings&section=line&block=telegram'
    mount(<SettingsView />)
    const open = [...container.querySelectorAll('details.card')].map(d => [d.querySelector('summary h2')?.textContent, d.open])
    expect(open).toEqual([['LINE 官方帳號', false], ['通知與備份', true]])
  })
})
