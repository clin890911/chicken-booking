import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act, useState } from 'react'
import { MemoryRouter, useLocation } from 'react-router-dom'

const harness = vi.hoisted(() => ({ ctx: {}, toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), action: vi.fn() } }))
vi.mock('../../src/contexts/BookingContext', () => ({ useBooking: () => harness.ctx }))
vi.mock('../../src/contexts/AuthContext', () => ({ useAuth: () => ({ can: () => true, user: { role: 'manager' } }) }))
vi.mock('../../src/components/ui/Toast', () => ({ useToast: () => harness.toast, useConfirm: () => vi.fn() }))
vi.mock('../../src/components/admin/floormap/FloorMap', () => ({ default: ({ tables, onSelectTable, selectedTableNumbers = [], scopedFocusTables = [] }) => <div>{tables.map(t => <button key={t.number} data-table={t.number} data-selected={[...selectedTableNumbers, ...scopedFocusTables].includes(t.number)} onClick={() => onSelectTable(t.number)}>{t.number}</button>)}</div> }))
vi.mock('../../src/components/admin/ops/OpsRail', () => ({ default: ({ onSeatWaitlist, activeTab, onTabChange, showNextWaitlist, onNextWaitlist }) => <div data-rail={activeTab}><span>散客表單</span><button onClick={() => onTabChange('waitlist')}>查看候位</button><button onClick={() => onSeatWaitlist(harness.ctx.waitlist[0])}>開始候位</button>{showNextWaitlist && <button onClick={onNextWaitlist}>帶下一組候位</button>}</div> }))
vi.mock('../../src/components/admin/floormap/TableDrawer', () => ({ default: () => null }))
vi.mock('../../src/components/admin/floormap/ArrivalStrip', () => ({ default: () => null }))
vi.mock('../../src/components/admin/floormap/StatusBar', () => ({ default: () => null }))
vi.mock('../../src/components/admin/ops/OpsHintBar', () => ({ default: () => null }))
vi.mock('../../src/components/admin/ops/OpsLogModal', () => ({ default: () => null }))
vi.mock('../../src/components/admin/LayoutEditor', () => ({ default: () => null }))
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


vi.mock('../../src/components/layout/Header', () => ({default:()=>null}))
vi.mock('../../src/components/layout/SidebarNav', () => ({default:()=>null}))
vi.mock('../../src/components/layout/BottomNav', () => ({default:()=>null}))
vi.mock('../../src/components/admin/planning/PlanningView', () => ({default:()=>null}))
vi.mock('../../src/components/admin/roster/RosterView', () => ({default:()=>null}))
vi.mock('../../src/components/admin/SettingsView', () => ({default:()=>null,ADMIN_ACTION_BAR_SLOT:'test-slot'}))
vi.mock('../../src/components/admin/BookingsView', () => ({default:({onMoveTable,onAssignTable})=>{
 const [filter,setFilter]=useState('');
 return <div data-source-list><input aria-label="清單篩選" value={filter} onChange={e=>setFilter(e.target.value)}/><BookingCard booking={harness.ctx.bookings[0]} onMove={onMoveTable} onAssign={onAssignTable}/></div>
}}))
const BookingCard=(await import('../../src/components/booking/BookingCard')).default
const AdminPage=(await import('../../src/pages/AdminPage')).default
function Path(){const location=useLocation();return <output data-url>{location.search}</output>}
const admin=()=>mount(<MemoryRouter initialEntries={['/admin?tab=bookings&day=2026-10-04']}><Path/><AdminPage/></MemoryRouter>)
const seedSource=()=>{
 const input=container.querySelector('[aria-label="清單篩選"]')
 act(()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'外部客');input.dispatchEvent(new Event('input',{bubbles:true}))})
 container.querySelector('[data-testid="admin-content"]').scrollTop=240
}
const assertReturned=()=>{
 expect(container.querySelector('[data-url]').textContent).toBe('?tab=bookings&day=2026-10-04')
 expect(container.querySelector('[aria-label="清單篩選"]').value).toBe('外部客')
 expect(container.querySelector('[data-testid="admin-content"]').scrollTop).toBe(240)
 expect(container.querySelector('[data-source-list]').parentElement.hidden).toBe(false)
}
const openEntry=entry=>{
 if(entry==='card')act(()=>container.querySelector('summary').click())
 else click('詳情 ›')
 const target=[...document.querySelectorAll('button')].find(b=>b.textContent.startsWith('↔ 改桌'))
 expect(target).toBeTruthy();expect(target.disabled).not.toBe(true)
 act(()=>target.click())
}
const seedSeated=()=>{
 booking.status='arrived';booking.assignedTableId='A';booking.extraTableIds=['D'];booking.notes={};booking.actualArrivalTime='2026-10-04T11:15:00+08:00'
 harness.ctx.tables.find(t=>t.number==='A').status='dining';harness.ctx.tables.find(t=>t.number==='A').currentBookingId=booking.id
 harness.ctx.tables.find(t=>t.number==='D').status='reserved';harness.ctx.tables.find(t=>t.number==='D').currentBookingId=booking.id
 harness.ctx.replaceSeatedBookingTables=vi.fn((id,nums)=>{booking.assignedTableId=nums[0];booking.extraTableIds=nums.slice(1);return {ok:true,booking,tableNumbers:nums}})
}
it.each(['card','detail'])('真實%s已入座併桌入口：取消回原URL/篩選/捲動，保留桌組與arrival',entry=>{
 seedSeated();admin();seedSource();openEntry(entry)
 expect(container.querySelector('[data-url]').textContent).toContain('tab=ops')
 pick('B');pick('C');click('取消並返回');assertReturned()
 expect(harness.ctx.replaceSeatedBookingTables).not.toHaveBeenCalled()
 expect(booking).toMatchObject({status:'arrived',assignedTableId:'A',extraTableIds:['D'],actualArrivalTime:'2026-10-04T11:15:00+08:00'})
})
it.each(['card','detail'])('真實%s已入座併桌入口：成功單次提交並回原URL/篩選/捲動',entry=>{
 seedSeated();admin();seedSource();openEntry(entry);pick('B');pick('C')
 act(()=>button('確認改桌').click());assertReturned()
 expect(harness.ctx.replaceSeatedBookingTables).toHaveBeenCalledTimes(1)
 expect(harness.ctx.replaceSeatedBookingTables).toHaveBeenCalledWith('B1',['B','C'],expect.objectContaining({originalTableNumbers:['A','D']}))
 expect(booking).toMatchObject({status:'arrived',assignedTableId:'B',extraTableIds:['C'],actualArrivalTime:'2026-10-04T11:15:00+08:00'})
})
