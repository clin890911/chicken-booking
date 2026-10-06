// 團單編輯器 × 線上關閉場次 / 超坐（2026-10 店主語意）：
//   關閉場次只停線上客人 → 後台照選場次、照存；7 人坐 6 人桌只黃字提醒、照存。
//   停用/維修桌仍擋、公休日仍擋。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'

const harness = vi.hoisted(() => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }))
vi.mock('../../src/contexts/BookingContext', () => ({ useBooking: () => ({ fixtures: [], zones: [] }) }))
vi.mock('../../src/contexts/AuthContext', () => ({ useAuth: () => ({ can: () => true, user: { role: 'manager' } }) }))
vi.mock('../../src/components/ui/Toast', () => ({ useToast: () => harness.toast, useConfirm: () => vi.fn() }))
vi.mock('../../src/components/admin/floormap/FloorMap', () => ({ default: () => null }))
vi.mock('../../src/components/admin/group/GroupSheet', () => ({ default: () => null }))
const GroupEditorStage = (await import('../../src/components/admin/planning/GroupEditorStage')).default

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const DATE = '2026-10-10'
const SEATINGS = [
  { id: 'lunch1', name: '午餐第一批', start: '11:00', end: '12:30' },
  { id: 'dinner1', name: '晚餐第一批', start: '17:00', end: '19:00' },
]
const settingsWith = (closures = {}) => ({
  openTime: '11:00', closeTime: '19:00', slotInterval: 30, diningDurationMin: 90, cleanupBufferMin: 10,
  seatings: SEATINGS, closures: { closedDates: [], closedSlots: {}, closedSeatings: {}, ...closures },
})
const tables = [
  { number: '101', capacity: 6, floor: '1F', isActive: true },
  { number: '102', capacity: 6, floor: '1F', isActive: true },
]
const groupOf = (over = {}) => ({
  id: 'G1', date: DATE, status: 'confirmed', agencyId: 'A1', agencyName: '大發旅行社',
  counts: { total: 7 },
  batches: [{ id: 'b1', label: '第一梯', timeSlot: '11:00', tableNumbers: ['101'], guests: 7 }],
  ...over,
})

let container, root, reserveExisting, onSaved
const mount = (props) => {
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
  act(() => root.render(
    <GroupEditorStage
      initialGroup={groupOf()} isNew={false} date={DATE} slots={['11:00', '17:00']}
      tables={tables} settings={settingsWith()} bookings={[]} agencies={[{ id: 'A1', name: '大發旅行社' }]} guides={[]}
      groupReservations={[]}
      onBack={() => {}} onSaved={onSaved} onDeleted={() => {}}
      reserveExisting={reserveExisting} createGroup={vi.fn()} removeGroup={vi.fn()}
      addAgency={vi.fn()} addGuide={vi.fn()}
      {...props}
    />,
  ))
}
const saveButtons = () => [...container.querySelectorAll('button')].filter(b => b.textContent.includes('儲存並保留'))
const seatingCard = (name) => [...container.querySelectorAll('button')].find(b => b.getAttribute('aria-pressed') !== null && b.textContent.includes(name))

beforeEach(() => {
  localStorage.clear()
  reserveExisting = vi.fn().mockResolvedValue(undefined)
  onSaved = vi.fn()
  Object.values(harness.toast).forEach(f => f.mockClear())
})
afterEach(() => { act(() => root.unmount()); container.remove() })

describe('GroupEditorStage × 線上關閉場次 / 超坐', () => {
  it('場次線上已關＋7 人坐 6 席：場次可選、黃字提醒、儲存鈕可按且真的存得進去', async () => {
    mount({ settings: settingsWith({ closedSeatings: { [DATE]: ['lunch1'] } }) })
    const text = container.textContent
    expect(text).toContain('線上已關：午餐第一批')
    expect(text).toContain('席位：已圈 6 / 需 7，超坐 1 人')
    expect(seatingCard('午餐第一批').disabled).toBe(false)
    expect(seatingCard('午餐第一批').textContent).toContain('線上已關')
    expect(saveButtons().length).toBeGreaterThan(0)
    expect(saveButtons().every(b => !b.disabled)).toBe(true)
    await act(async () => { saveButtons()[0].click() })
    expect(harness.toast.error).not.toHaveBeenCalled()
    expect(reserveExisting).toHaveBeenCalledWith('G1', expect.objectContaining({ date: DATE }))
    expect(onSaved).toHaveBeenCalledWith('G1')
  })

  it('時段被關（closedSlots）一樣只提醒、可存', async () => {
    mount({ settings: settingsWith({ closedSlots: { [DATE]: ['11:00'] } }), initialGroup: groupOf({ counts: { total: 6 }, batches: [{ id: 'b1', label: '第一梯', timeSlot: '11:00', tableNumbers: ['101'], guests: 6 }] }) })
    expect(container.textContent).toContain('線上已關：午餐第一批')
    expect(saveButtons().every(b => !b.disabled)).toBe(true)
  })

  it('停用/維修桌仍擋：儲存鈕不可按', () => {
    mount({ tables: [{ ...tables[0], isActive: false }, tables[1]] })
    expect(container.textContent).toContain('101 當日停用/維修中')
    expect(saveButtons().every(b => b.disabled)).toBe(true)
  })

  it('公休日（closedDates）維持原狀：場次卡不可選、儲存鈕不可按', () => {
    mount({ settings: settingsWith({ closedDates: [DATE] }) })
    expect(container.textContent).toContain('本日公休，無法建團')
    expect(seatingCard('晚餐第一批').disabled).toBe(true)
    expect(saveButtons().every(b => b.disabled)).toBe(true)
  })
})
