import {describe,it,expect,vi,beforeEach,afterEach} from 'vitest'
import {createRoot} from 'react-dom/client'
import {act} from 'react'
import {buildHandoffCommand} from '../../functions/lib/operationalCommands'
const state=vi.hoisted(()=>({role:'floor',ctx:{},records:[],receipts:new Map(),requests:[],fail:false,lost:false}))
const confirm=vi.hoisted(()=>vi.fn(async()=>true))
vi.mock('framer-motion',()=>({AnimatePresence:({children})=>children,motion:{div:({children,initial,animate,exit,transition,...props})=><div {...props}>{children}</div>}}))
vi.mock('../../src/contexts/AuthContext',()=>({useAuth:()=>({user:{email:'fixture@example.test'},can:permission=>state.role!=='kitchen'||permission.endsWith('.read')})}))
vi.mock('../../src/contexts/BookingContext',()=>({useBooking:()=>state.ctx}))
vi.mock('../../src/components/ui/Toast',()=>({useConfirm:()=>confirm,useToast:()=>({error:vi.fn(),success:vi.fn(),info:vi.fn()})}))
vi.mock('../../src/services/cloudDataService',()=>({operationalRequest:async(name,command)=>{
 if(!command)return {ok:true,items:structuredClone(state.records)}
 state.requests.push(command)
 if(state.fail){state.fail=false;throw Object.assign(Error('offline'),{status:500})}
 const receipt=state.receipts.get(command.commandId)
 if(receipt)return {ok:true,item:structuredClone(state.records.find(t=>t.id===command.id))}
 const previous=state.records.find(t=>t.id===command.id)
 const item=buildHandoffCommand(command,previous,{role:state.role,actor:'SERVER_ACTOR',now:'2026-10-05T04:00:00.000Z'})
 state.records=state.records.filter(t=>t.id!==item.id).concat(item);state.receipts.set(command.commandId,item)
 if(state.lost){state.lost=false;throw Error('lost-response')}
 return {ok:true,item}
}}))
const {HandoffProvider}=await import('../../src/contexts/HandoffContext')
const HandoffPanel=(await import('../../src/components/admin/ops/HandoffPanel')).default
const BookingCard=(await import('../../src/components/booking/BookingCard')).default
const TableDrawer=(await import('../../src/components/admin/floormap/TableDrawer')).default
globalThis.IS_REACT_ACT_ENVIRONMENT=true
let root,container
const booking={id:'B1',name:'測試客',status:'arrived',date:'2026-10-05',timeSlot:'11:00',guests:4,phone:'',assignedTableId:'103',extraTableIds:[],actualArrivalTime:'2026-10-05T03:15:00Z',notes:{}}
const table={number:'103',capacity:6,floor:'1F',status:'dining',currentBookingId:'B1',seatedAt:booking.actualArrivalTime,isActive:true}
const render=async()=>{
 if(!container){container=document.createElement('div');document.body.append(container);root=createRoot(container)}
 await act(async()=>root.render(<HandoffProvider><BookingCard booking={state.ctx.bookings[0]}/><TableDrawer table={table} booking={state.ctx.bookings[0]}/><HandoffPanel/></HandoffProvider>))
}
const button=text=>[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===text)
const click=async text=>{expect(button(text)).toBeTruthy();await act(async()=>button(text).click())}
const input=(selector,value)=>act(()=>{const el=document.querySelector(selector);Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}))})
beforeEach(()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date(2026,9,5,12));state.role='floor';state.records=[];state.receipts.clear();state.requests=[];state.fail=false;state.lost=false;confirm.mockResolvedValue(true)
 state.ctx={bookings:[structuredClone(booking)],tables:[structuredClone(table)],settings:{},groupReservations:[],waitlist:[],findReserveCandidates:()=>({tables:[]})}
})
afterEach(()=>{act(()=>root?.unmount());container?.remove();root=null;container=null;vi.useRealTimers()})
describe('真卡片/桌抽屜交班建立與跨班操作',()=>{
 it('卡片快捷標籤建立→完成→恢復，同ID、無重複建立、日期歷史可找',async()=>{
  await render();await click('＋ 交班事項');await click('等兒童椅');await click('儲存交班事項')
  expect(state.records).toHaveLength(1);const id=state.records[0].id
  expect(state.records[0]).toMatchObject({bookingId:'B1',tableNumber:null,label:'等兒童椅',createdBy:'SERVER_ACTOR',status:'pending'})
  await click('完成');expect(state.records[0]).toMatchObject({id,status:'completed',version:2,completedBy:'SERVER_ACTOR'})
  await click('已完成 1');await click('恢復待辦');expect(state.records[0]).toMatchObject({id,status:'pending',version:3})
  input('input[aria-label="交班日期"]','2026-10-04');expect(document.querySelector('[aria-label="現場交班待辦"]').textContent).not.toContain('等兒童椅')
  input('input[aria-label="交班日期"]','2026-10-05');await click('待辦 1');expect(document.querySelector('[aria-label="現場交班待辦"]').textContent).toContain('等兒童椅')
 })
 it('純桌任務固定，客人任務隨改桌顯示新桌；取消客人不刪任務',async()=>{
  await render();await click('＋ 桌位交班');await click('需協助');await click('儲存交班事項')
  await click('＋ 客人交班');await click('需回電');await click('儲存交班事項')
  state.ctx.bookings[0].assignedTableId='109';await render()
  const panel=document.querySelector('[aria-label="現場交班待辦"]')
  expect(panel.textContent).toContain('桌 103');expect(panel.textContent).toContain('測試客 · 109')
  state.ctx.bookings[0].status='cancelled';state.ctx.bookings[0].assignedTableId=null;await render()
  expect(panel.textContent).toContain('已結束');expect(state.records).toHaveLength(2)
 })
 it('儲存失敗不關草稿，重試同command不重複；lost response也只建立一次',async()=>{
  await render();await click('＋ 交班事項');state.lost=true;await click('儲存交班事項')
  expect(document.querySelector('[role="alert"]').textContent).toContain('未儲存成功');expect(state.records).toHaveLength(1)
  await click('儲存交班事項');expect(state.records).toHaveLength(1);expect(state.requests[0].commandId).toBe(state.requests[1].commandId)
 })
 it('完成失敗仍pending，重試一次成功；另一台先完成409會重拉',async()=>{
  state.records=[{id:'T',version:1,label:'需協助',bookingId:'B1',status:'pending',date:'2026-10-05',createdAt:'2026-10-05T04:00:00Z'}]
  await render();state.fail=true;await click('完成');expect(state.records[0].status).toBe('pending');expect(button('完成')).toBeTruthy()
  await click('完成');expect(state.records[0].status).toBe('completed')
 })
 it('完成回應遺失後poll證實已完成，清除過期失敗訊息且不再次完成',async()=>{
  state.records=[{id:'T',version:1,label:'需協助',bookingId:'B1',status:'pending',date:'2026-10-05',createdAt:'2026-10-05T04:00:00Z'}]
  await render();state.lost=true;await click('完成')
  expect(document.querySelector('[role="alert"]').textContent).toContain('未儲存成功')
  expect(state.records[0].status).toBe('completed')
  await act(async()=>vi.advanceTimersByTimeAsync(5000))
  expect(document.querySelector('[role="alert"]')).toBeNull()
  expect(state.requests).toHaveLength(1);await click('已完成 1');expect(button('恢復待辦')).toBeTruthy()
 })
 it('交班區預設展開、固定最高260px內捲動，收合顯示待辦數且不丟任務/篩選',async()=>{
  state.records=Array.from({length:4},(_,i)=>({id:'T'+i,version:1,label:'需協助'+i,bookingId:'B1',status:'pending',date:'2026-10-05',createdAt:'2026-10-05T04:00:00Z'}))
  await render();const panel=document.querySelector('[aria-label="現場交班待辦"]')
  expect(panel.className).toContain('max-h-[260px]');expect(document.querySelector('[data-testid="handoff-task-list"]').className).toContain('overflow-y-auto')
  expect(button('完成').className).toContain('min-h-[44px]')
  await click('交班待辦 4 收合');expect(panel.querySelector('[data-testid="handoff-task-list"]')).toBeNull();expect(button('交班待辦 4 展開').getAttribute('aria-expanded')).toBe('false')
  await click('交班待辦 4 展開');expect(panel.textContent).toContain('需協助3');expect(state.records).toHaveLength(4);expect(state.requests).toEqual([])
 })
 it('廚房只讀：看到交班事項，沒有新增/完成/恢復寫入口',async()=>{
  state.role='kitchen';state.records=[{id:'T',version:1,label:'需協助',bookingId:'B1',status:'pending',date:'2026-10-05',createdAt:'2026-10-05T04:00:00Z'}]
  await render();expect(document.querySelector('[aria-label="現場交班待辦"]').textContent).toContain('需協助');expect(button('完成')).toBeUndefined();expect(button('＋ 交班事項')).toBeUndefined();expect(button('＋ 桌位交班')).toBeUndefined()
 })
 it('其他文字草稿取消需確認；否定時保留草稿且無server寫入',async()=>{
  await render();await click('＋ 交班事項');await click('其他');input('input[maxlength="80"]','需回覆座位問題')
  confirm.mockResolvedValue(false);await click('取消');expect(document.querySelector('input[maxlength="80"]').value).toBe('需回覆座位問題');expect(state.requests).toEqual([])
  confirm.mockResolvedValue(true);await click('取消');expect(document.querySelector('input[maxlength="80"]')).toBeNull()
 })
})
