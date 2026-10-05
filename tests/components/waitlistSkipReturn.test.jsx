import {describe,it,expect,vi,beforeEach,afterEach} from 'vitest'
import {createRoot} from 'react-dom/client'
import {act} from 'react'
import {buildQueueCommand} from '../../functions/lib/operationalCommands'
import {compareWaitlistOrder} from '../../src/utils/waitlistOrder'
const state=vi.hoisted(()=>({role:'floor',waits:[],requests:[],hold:null,fail:false}))
const toast=vi.hoisted(()=>({success:vi.fn(),error:vi.fn(),warning:vi.fn()}))
const transition=async(id,action,commandId)=>{
 const previous=state.waits.find(w=>w.id===id)
 state.requests.push({id,action,commandId})
 if(state.hold)await state.hold
 if(state.fail){state.fail=false;return {ok:false,error:'未儲存成功'}}
 const item=buildQueueCommand({id,action,commandId,expectedVersion:previous.queueVersion||0},previous,{role:state.role,now:new Date().toISOString()})
 state.waits=state.waits.filter(w=>w.id!==id).concat(item)
 root?.render(<WaitlistPanel/>) // 模擬真Context接收server ack後發佈新集合
 return {ok:true,item}
}
vi.mock('../../src/contexts/AuthContext',()=>({useAuth:()=>({can:()=>state.role!=='kitchen'})}))
vi.mock('../../src/contexts/BookingContext',()=>({useBooking:()=>({waitlist:state.waits,skipWaitlist:(id,c)=>transition(id,'skip',c),returnWaitlist:(id,c)=>transition(id,'return',c),leaveWaitlist:vi.fn(),callWaitlist:vi.fn(),addWaitlist:vi.fn()})}))
vi.mock('../../src/components/ui/Toast',()=>({useToast:()=>toast,useConfirm:()=>vi.fn(async()=>true)}))
const WaitlistPanel=(await import('../../src/components/admin/ops/WaitlistPanel')).default
globalThis.IS_REACT_ACT_ENVIRONMENT=true
let root,container
const click=async(text)=>{const el=[...container.querySelectorAll('button')].find(b=>b.textContent.trim()===text);expect(el).toBeTruthy();await act(async()=>el.click())}
const render=()=>{container=document.createElement('div');document.body.append(container);root=createRoot(container);act(()=>root.render(<WaitlistPanel/>))}
const seed=(id,n,status='waiting')=>({id,queueNumber:n,status,name:'測試'+n,partySize:4,takenAt:'2026-10-05T03:00:00Z',queueVersion:status==='skipped'?1:0})
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(new Date(2026,9,5,12));state.role='floor';state.waits=[seed('W1',1),seed('W2',2,'called'),seed('W3',3,'skipped')];state.requests=[];state.fail=false;state.hold=null})
afterEach(()=>{act(()=>root?.unmount());container?.remove();vi.useRealTimers()})
describe('候位真面板暫過號/回來',()=>{
 it('暫過號區保留原票、回來依取號時間+原號排序，即使merge append或同timestamp',async()=>{
  render();await click('暫過號');expect(state.waits.find(w=>w.id==='W1')).toMatchObject({status:'skipped',queueNumber:1})
  await click('回來了')
  const rows=[...container.querySelectorAll('button')].filter(b=>b.textContent.trim()==='入座').map(b=>b.closest('.border-2').textContent)
  expect(rows[0]).toContain('#1');expect(rows[0]).toContain('輪到了');expect(rows[1]).toContain('#2');expect(rows[1]).toContain('前面還有 1 組')
  expect(state.waits.find(w=>w.id==='W1').status).toBe('waiting');expect(state.requests).toHaveLength(2)
 })
 it('儲存中所有寫入口禁用並可識別；失敗原票不動、重試同commandId',async()=>{
  let release;state.hold=new Promise(resolve=>{release=resolve});render()
  const skip=[...container.querySelectorAll('button')].find(b=>b.textContent==='暫過號')
  act(()=>skip.click());expect(container.textContent).toContain('儲存中…')
  expect([...container.querySelectorAll('button')].filter(b=>['入座','叫號','棄號'].includes(b.textContent.trim())).every(b=>b.disabled)).toBe(true)
  state.fail=true;await act(async()=>{release();await state.hold});state.hold=null
  expect(state.waits.find(w=>w.id==='W1').status).toBe('waiting');expect(toast.error).toHaveBeenCalledWith('未儲存成功')
  await click('暫過號');expect(state.requests[0].commandId).toBe(state.requests[1].commandId)
 })
 it('廚房只看候位/過號，無回來/過號/叫號/入座入口',()=>{
  state.role='kitchen';render();expect(container.textContent).toContain('暫過號 · 保留原號')
  for(const text of ['回來了','暫過號','入座','叫號'])expect([...container.querySelectorAll('button')].some(b=>b.textContent.trim()===text)).toBe(false)
 })
 it('共同排序相同時間用票號，資料型別不同仍穩定',()=>{
  expect([seed('W2','2'),seed('W1',1)].sort(compareWaitlistOrder).map(w=>w.id)).toEqual(['W1','W2'])
 })
})
