import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

// 「排錯位子要能當場改」（2026-08）。
// 店長回報：規劃頁點進訂位/團單的詳細資訊，發現排錯桌卻沒有任何修改入口——
// 散客列的桌號只是一顆死 pill，團單詳情整頁唯讀。修法是把改桌入口放在「發現錯誤的當下」，
// 並且用 can() 擋住唯讀角色（廚房改了只會寫本機、推雲被整包剔除 → 本機與雲端默默不一致）。

let currentAuth = { can: () => true }
vi.mock('../../src/contexts/AuthContext', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, useAuth: () => currentAuth }
})
vi.mock('../../src/contexts/BookingContext', () => ({
  useBooking: () => ({ fixtures: { '1F': [], '2F': [] }, zones: [] }),
}))

const { PERMISSIONS } = await import('../../src/contexts/AuthContext')
const GroupDayPanel = (await import('../../src/components/admin/planning/GroupDayPanel')).default
const GroupDetailStage = (await import('../../src/components/admin/planning/GroupDetailStage')).default

const asRole = (role) => { currentAuth = { can: (p) => PERMISSIONS[role].has(p) } }

const SEATING = { id: 'lunch1', name: '午餐第一批', start: '11:00', end: '12:30' }
const SETTINGS = { seatings: [SEATING], closures: { closedDates: [], closedSlots: {}, closedSeatings: {} } }
const TABLES = [
  { number: '101', capacity: 6, floor: '1F', x: 100, y: 100, w: 90, h: 75, rotation: 0, isActive: true, status: 'vacant' },
  { number: '102', capacity: 6, floor: '1F', x: 220, y: 100, w: 90, h: 75, rotation: 0, isActive: true, status: 'vacant' },
]

const walkinRow = (booking) => ({
  booking,
  timeSlot: booking.timeSlot,
  guests: booking.guests,
  assignedTableId: booking.assignedTableId || null,
  status: booking.status,
})

const daySummaryWith = (rows) => ({
  groupCount: 0, guests: 0, heldTableCount: 0, closed: false,
  prep: { counts: {}, allergies: [] },
  timeline: [],
  seatings: [{ seating: SEATING, summary: { remaining: 60, remainingTables: 10, totalSeats: 100, closed: false } }],
  walkins: {
    count: rows.length, guests: rows.reduce((s, r) => s + r.guests, 0),
    unassignedCount: rows.filter(r => !r.assignedTableId).length, unassignedGuests: 0,
    bySeating: [{ seating: SEATING, rows }], unscheduled: [],
  },
  warnings: [],
})

const renderDayPanel = (rows, props = {}) => renderToStaticMarkup(
  <GroupDayPanel
    date="2026-08-03"
    daySummary={daySummaryWith(rows)}
    dayGroups={[]}
    isToday={false}
    onSelectGroup={() => {}}
    onNewGroup={() => {}}
    onDuplicate={() => {}}
    onAssignWalkin={() => {}}
    {...props}
  />,
)

describe('當日總覽散客列：已配桌也要能改', () => {
  beforeEach(() => asRole('manager'))

  it('已配桌 → 桌號本身是「換桌」按鈕（不必先解除再重配）', () => {
    const html = renderDayPanel([walkinRow({
      id: 'B1', name: '王小明', guests: 4, timeSlot: '11:30', status: 'confirmed', assignedTableId: '101',
    })])
    expect(html).toContain('🪑 101')
    expect(html).toContain('↔ 換桌')
  })

  it('併桌的散客顯示所有桌（主桌 + 額外桌），不會只看到主桌', () => {
    const html = renderDayPanel([walkinRow({
      id: 'B2', name: '李大團', guests: 12, timeSlot: '11:30', status: 'confirmed',
      assignedTableId: '101', extraTableIds: ['102'],
    })])
    expect(html).toContain('🪑 101+102')
  })

  it('未配桌維持「→ 配桌」入口', () => {
    const html = renderDayPanel([walkinRow({
      id: 'B3', name: '陳小華', guests: 2, timeSlot: '11:30', status: 'confirmed', assignedTableId: null,
    })])
    expect(html).toContain('→ 配桌')
    expect(html).not.toContain('↔ 換桌')
  })

  it('無配桌權限（onAssignWalkin=null）→ 桌號退回唯讀 pill，不給按鈕', () => {
    const html = renderDayPanel([walkinRow({
      id: 'B4', name: '王小明', guests: 4, timeSlot: '11:30', status: 'confirmed', assignedTableId: '101',
    })], { onAssignWalkin: null })
    expect(html).toContain('🪑 101')
    expect(html).not.toContain('↔ 換桌')
  })
})

describe('團單詳情：改桌入口與權限門', () => {
  const group = {
    id: 'G1', date: '2026-08-03', agencyName: '快樂旅行社', guideName: '張導', status: 'confirmed',
    counts: { total: 10 },
    batches: [
      { id: 'BT1', label: '第一梯', timeSlot: '11:30', tableNumbers: ['101'], guests: 6 },
      { id: 'BT2', label: '第二梯', timeSlot: '11:30', tableNumbers: [], guests: 4 },
    ],
  }
  const render = (props = {}) => renderToStaticMarkup(
    <GroupDetailStage group={group} tables={TABLES} settings={SETTINGS}
      onBack={() => {}} onEdit={() => {}} onEditTables={() => {}} onReschedule={() => {}} {...props} />,
  )

  it('店長：每個梯次都有改桌入口（已圈桌＝改桌、未圈＝圈桌），座位示意可直接調整', () => {
    asRole('manager')
    const html = render()
    expect(html).toContain('↔ 改桌')
    expect(html).toContain('＋ 圈桌')
    expect(html).toContain('✏️ 調整圈桌')
    expect(html).toContain('🪑 改圈桌')
  })

  it('外場（有 group.update）也能改桌——帶團當天發現排錯位子不必找店長', () => {
    asRole('floor')
    const html = render()
    expect(html).toContain('↔ 改桌')
    expect(html).toContain('✏️ 調整圈桌')
  })

  it('廚房唯讀：所有改桌／編輯入口都不出現（避免寫本機卻推不上雲）', () => {
    asRole('kitchen')
    const html = render()
    expect(html).toContain('梯次與桌位')      // 詳情本身仍看得到
    expect(html).not.toContain('↔ 改桌')
    expect(html).not.toContain('✏️ 調整圈桌')
    expect(html).not.toContain('✏️ 編輯')
    expect(html).not.toContain('📅 改期')
  })

  it('容器沒給 onEditTables（舊呼叫端）→ 不渲染改桌鈕，不會炸', () => {
    asRole('manager')
    const html = render({ onEditTables: undefined })
    expect(html).not.toContain('↔ 改桌')
    expect(html).toContain('✏️ 編輯')
  })
})
