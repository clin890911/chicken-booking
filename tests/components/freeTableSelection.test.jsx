import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'

const harness = vi.hoisted(() => ({ ctx: {}, toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), action: vi.fn() } }))
vi.mock('../../src/contexts/BookingContext', () => ({ useBooking: () => harness.ctx }))
vi.mock('../../src/contexts/AuthContext', () => ({ useAuth: () => ({ can: () => true, user: { role: 'manager' } }) }))
vi.mock('../../src/components/ui/Toast', () => ({ useToast: () => harness.toast, useConfirm: () => vi.fn() }))
vi.mock('../../src/components/admin/floormap/FloorMap', () => ({ default: ({ tables, onSelectTable, selectedTableNumbers = [], scopedFocusTables = [] }) => <div>{tables.map(t => <button key={t.number} data-table={t.number} data-selected={[...selectedTableNumbers, ...scopedFocusTables].includes(t.number)} onClick={() => onSelectTable(t.number)}>{t.number}</button>)}</div> }))
vi.mock('../../src/components/admin/ops/OpsRail', () => ({ default: ({ onSeatWaitlist }) => <button onClick={() => onSeatWaitlist(harness.ctx.waitlist[0])}>開始候位</button> }))
vi.mock('../../src/components/admin/floormap/TableDrawer', () => ({ default: () => null }))
vi.mock('../../src/components/admin/floormap/ArrivalStrip', () => ({ default: () => null }))
vi.mock('../../src/components/admin/floormap/StatusBar', () => ({ default: () => null }))
vi.mock('../../src/components/admin/ops/OpsHintBar', () => ({ default: () => null }))
vi.mock('../../src/components/admin/ops/OpsLogModal', () => ({ default: () => null }))
vi.mock('../../src/components/admin/LayoutEditor', () => ({ default: () => null }))
vi.mock('../../src/components/booking/BookingDetailSheet', () => ({ default: () => null }))
const OperationsView = (await import('../../src/components/admin/OperationsView')).default
const SlotMapPanel = (await import('../../src/components/admin/planning/SlotMapPanel')).default

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let container, root, booking
const table = (number, capacity, extra = {}) => ({ number, capacity, floor: '1F', isActive: true, status: 'vacant', ...extra })
const mount = el => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); act(() => root.render(el)) }
const button = text => [...container.querySelectorAll('button')].find(b => b.textContent.includes(text))
const click = text => act(() => button(text).click())
const pick = n => act(() => container.querySelector(`[data-table="${n}"]`).click())
const confirm = () => button('確認併桌') || button('確認預配') || button('確認指派') || button('確認入座')
const begin = (flow, guests = 8) => {
  booking.guests = guests
  harness.ctx.waitlist[0].partySize = guests
  if (flow === 'planning') mount(<SlotMapPanel date={booking.date} assignRequest={{ bookingId: booking.id }} />)
  else if (flow === 'booking') mount(<OperationsView pendingAssign={booking} />)
  else { mount(<OperationsView />); click('開始候位') }
}
const saveSpy = flow => flow === 'planning' ? harness.ctx.preassignBookingTables : flow === 'booking' ? harness.ctx.assignBookingTablesMulti : harness.ctx.seatWaitlistMulti

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 9, 4, 12))
  booking = { id: 'B1', name: '測試八人', guests: 8, date: '2026-10-04', timeSlot: '12:00', status: 'confirmed' }
  const ctx = { tables: [table('A', 8), table('B', 4), table('C', 4), table('D', 6), table('X', 4, { floor: '2F' })], bookings: [booking], waitlist: [{ id: 'W1', queueNumber: 1, name: '測試候位', partySize: 8 }], groupReservations: [], fixtures: {}, zones: [], settings: { seatings: [{ id: 'lunch', start: '11:00', end: '14:30' }], diningDurationMin: 90, cleanupBufferMin: 10 } }
  for (const k of ['preassignBookingTable','preassignBookingTables','assignBookingToTable','assignBookingTablesMulti','seatWaitlist','seatWaitlistMulti','releaseOverriddenAssignment','replacePendingBookingTables']) ctx[k] = vi.fn(() => ({ ok: true }))
  ctx.findSuitableTables = vi.fn(size => ctx.tables.filter(t => t.status === 'vacant' && t.capacity >= size))
  ctx.preassignableTables = ctx.findSuitableTables
  ctx.findReserveCandidates = () => ({ tables: [ctx.tables[0]], kind: 'hold' })
  ctx.suggestTable = () => ctx.tables[0]
  ctx.suggestTableCombo = () => ({ enough: true, tableNumbers: ['D','B'], seats: 10 })
  harness.ctx = ctx
})
afterEach(() => { act(() => root?.unmount()); container?.remove(); vi.useRealTimers() })

for (const flow of ['planning','booking','waitlist']) describe(`${flow} 人工選桌`, () => {
  it.each([['B','C'], ['D','B']])('有 8 席大桌時仍可選 %s + %s，推薦不自動勾桌', (a,b) => {
    begin(flow)
    expect(container.textContent).toContain('已選 0/8 席')
    expect(confirm().disabled).toBe(true)
    pick(a); expect(confirm().disabled).toBe(true)
    pick(b); expect(confirm().disabled).toBe(false)
    expect(container.querySelector('[data-table="A"]').dataset.selected).toBe('false')
    act(() => confirm().click())
    expect(saveSpy(flow)).toHaveBeenCalledWith(flow === 'waitlist' ? 'W1' : 'B1', [a,b])
  })
  it('單張 6 席不足、可移除與改選單張 8 席後確認', () => {
    begin(flow); pick('D'); expect(confirm().disabled).toBe(true)
    pick('D'); expect(container.textContent).toContain('已選 0/8 席')
    pick('A'); expect(confirm().disabled).toBe(false); act(() => confirm().click())
    const spy = flow === 'planning' ? harness.ctx.preassignBookingTable : flow === 'booking' ? harness.ctx.assignBookingToTable : harness.ctx.seatWaitlist
    expect(spy).toHaveBeenCalledWith(flow === 'waitlist' ? 'W1' : 'B1','A')
  })
  it('無大桌時也可 4 + 4，取消不寫資料', () => {
    harness.ctx.tables = harness.ctx.tables.filter(t => t.number !== 'A')
    begin(flow); pick('B'); pick('C'); expect(confirm().disabled).toBe(false)
    click('取消'); expect(saveSpy(flow)).not.toHaveBeenCalled()
    expect(container.textContent).not.toContain('已選 8/8 席')
  })
  it('小組仍可選單桌，跨樓層被擋', () => {
    begin(flow,2); pick('B'); expect(confirm().disabled).toBe(false)
    pick('X'); expect(harness.toast.error).toHaveBeenCalledWith(expect.stringContaining('同一樓層'))
    expect(container.querySelector('[data-table="X"]').dataset.selected).toBe('false')
  })
})

it('現場多桌選擇保留預配警示確認，選桌改變後重新鎖確認', () => {
  harness.ctx.bookings.push({ id:'OTHER', name:'預配測試', date:booking.date, timeSlot:'12:30', guests:4, status:'confirmed', assignedTableId:'B' })
  begin('booking'); pick('B'); pick('C')
  expect(container.textContent).toContain('預配測試')
  expect(confirm().disabled).toBe(true)
  act(() => container.querySelector('input[type="checkbox"]').click())
  expect(confirm().disabled).toBe(false)
  pick('C'); pick('D'); expect(confirm().disabled).toBe(true)
})

it('確認前桌被佔用時不寫入', () => {
  begin('booking'); pick('B'); pick('C'); harness.ctx.tables.find(t=>t.number==='B').status='dining'
  act(() => confirm().click())
  expect(harness.ctx.assignBookingTablesMulti).not.toHaveBeenCalled()
  expect(harness.toast.error).toHaveBeenCalledWith('所選桌已不可用，請重新選桌')
})

it('現場團保桌仍需明確確認，取消不入座', () => {
  harness.ctx.groupReservations=[{id:'G1',date:booking.date,status:'confirmed',agencyName:'測試團',batches:[{id:'GB1',label:'第一梯',timeSlot:'12:00',tableNumbers:['B'],guests:4}]}]
  begin('waitlist'); pick('B'); pick('C')
  expect(container.textContent).toContain('測試團')
  expect(confirm().disabled).toBe(true)
  click('取消'); expect(harness.ctx.seatWaitlistMulti).not.toHaveBeenCalled()
})

it('較早時段的訂位可人工多桌預配，不提前鎖桌', () => {
  booking.timeSlot='17:00'
  begin('booking'); pick('B'); pick('C'); act(()=>confirm().click())
  expect(harness.ctx.preassignBookingTables).toHaveBeenCalledWith('B1',['B','C'])
  expect(harness.ctx.assignBookingTablesMulti).not.toHaveBeenCalled()
})

it('餐前已選桌同步後被占用，仍可點選移除', () => {
  const request={bookingId:booking.id}
  mount(<SlotMapPanel date={booking.date} assignRequest={request} />); pick('B'); pick('C')
  harness.ctx.bookings=[booking,{id:'OTHER',date:booking.date,timeSlot:'12:00',guests:4,status:'confirmed',assignedTableId:'B'}]
  act(()=>root.render(<SlotMapPanel date={booking.date} assignRequest={request} />))
  pick('B')
  expect(container.textContent).toContain('已選 4/8 席')
  expect(container.querySelector('[data-table="B"]').dataset.selected).toBe('false')
})

it('未到併桌改選：取消保留原配桌，重新選4+4後確認才替換', () => {
  booking.assignedTableId='D'; booking.extraTableIds=['A']
  mount(<OperationsView pendingMove={{booking,seq:1}} />)
  expect(container.textContent).toContain('原配桌 D + A')
  expect(container.textContent).toContain('已選 0/8 席')
  pick('B'); pick('C'); click('取消')
  expect(harness.ctx.replacePendingBookingTables).not.toHaveBeenCalled()
  expect(booking.assignedTableId).toBe('D')
  act(()=>root.render(<OperationsView pendingMove={{booking,seq:2}} />))
  pick('B'); pick('C'); click('確認改桌')
  expect(harness.ctx.replacePendingBookingTables).toHaveBeenCalledWith('B1',['B','C'])
})

it('未到單桌可重選為多桌；service拒絕時原桌與選擇保持', () => {
  booking.assignedTableId='A'
  harness.ctx.replacePendingBookingTables.mockReturnValue({ok:false,error:'所選桌已被占用'})
  mount(<OperationsView pendingMove={{booking,seq:1}} />)
  pick('B'); pick('C'); click('確認改桌')
  expect(harness.toast.error).toHaveBeenCalledWith('改桌失敗：所選桌已被占用')
  expect(booking.assignedTableId).toBe('A')
  expect(container.textContent).toContain('已選 8/8 席')
})

it('改桌跨過餐前30分鐘門檻：先更新鎖桌文字，不直接儲存，再確認才替換', () => {
  booking.timeSlot='17:00';booking.assignedTableId='A'
  mount(<OperationsView pendingMove={{booking,seq:1}} />)
  pick('B');pick('C');expect(container.textContent).toContain('預配 · 桌子先不鎖')
  vi.setSystemTime(new Date(2026,9,4,16,40));click('確認改桌')
  expect(harness.ctx.replacePendingBookingTables).not.toHaveBeenCalled()
  expect(container.textContent).toContain('指派即鎖桌')
  expect(container.textContent).toContain('已選 8/8 席')
  click('確認改桌');expect(harness.ctx.replacePendingBookingTables).toHaveBeenCalledWith('B1',['B','C'])
})
