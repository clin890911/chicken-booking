import {describe,it,expect,vi,beforeEach,afterEach} from 'vitest'
import {createRoot} from 'react-dom/client'
import {act} from 'react'
const state=vi.hoisted(()=>({tasks:[]}))
vi.mock('../../src/contexts/HandoffContext',()=>({useHandoff:()=>({tasks:state.tasks,loaded:true,error:'',canWrite:true,changeTask:vi.fn(),refresh:vi.fn()})}))
vi.mock('../../src/contexts/BookingContext',()=>({useBooking:()=>({bookings:[],tables:[]})}))
const HandoffPanel=(await import('../../src/components/admin/ops/HandoffPanel')).default
const {todayStr}=await import('../../src/utils/timeSlots')
globalThis.IS_REACT_ACT_ENVIRONMENT=true
let root,container
const render=async()=>{
 if(!container){container=document.createElement('div');document.body.append(container);root=createRoot(container)}
 await act(async()=>root.render(<HandoffPanel/>))
}
const toggle=()=>document.querySelector('button[aria-expanded]')
beforeEach(()=>{state.tasks=[];localStorage.clear()})
afterEach(()=>{act(()=>root?.unmount());container?.remove();root=null;container=null;vi.restoreAllMocks()})
describe('交班面板預設收合',()=>{
 it('沒有待辦 → 預設收合，沒有日期輸入',async()=>{
  await render()
  expect(toggle().getAttribute('aria-expanded')).toBe('false')
  expect(document.querySelector('input[aria-label="交班日期"]')).toBeNull()
 })
 it('有待辦 → 展開；即使 localStorage 記著收合',async()=>{
  localStorage.setItem('handoffPanelCollapsed','1')
  state.tasks=[{id:'T',version:1,label:'需協助',status:'pending',date:todayStr(),createdAt:'2026-10-05T04:00:00Z'}]
  await render()
  expect(toggle().getAttribute('aria-expanded')).toBe('true')
})
 it('手動展開會寫入 localStorage，重新載入後維持展開',async()=>{
  await render();await act(async()=>toggle().click())
  expect(toggle().getAttribute('aria-expanded')).toBe('true')
  expect(localStorage.getItem('handoffPanelCollapsed')).toBe('0')
  await act(()=>root.unmount());container.remove();root=null;container=null
  await render()
  expect(toggle().getAttribute('aria-expanded')).toBe('true')
 })
 it('localStorage 丟例外時退回預設，不當掉',async()=>{
  vi.spyOn(Storage.prototype,'getItem').mockImplementation(()=>{throw new Error('blocked')})
  vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('blocked')})
  await render()
  expect(toggle().getAttribute('aria-expanded')).toBe('false')
  await act(async()=>toggle().click())
  expect(toggle().getAttribute('aria-expanded')).toBe('true')
 })
})
describe('交班面板：沒有待辦時不佔版面',()=>{
 it('待辦 0＋收合 → 縮成細列（不是卡片），仍可展開',async()=>{
  await render()
  const section=document.querySelector('section[aria-label="現場交班待辦"]')
  expect(section.getAttribute('data-compact')).toBe('true')
  expect(section.className).not.toContain('p-3')
  expect(section.className).not.toContain('border')
  await act(async()=>toggle().click())
  const expanded=document.querySelector('section[aria-label="現場交班待辦"]')
  expect(expanded.getAttribute('data-compact')).toBeNull()
  expect(document.querySelector('input[aria-label="交班日期"]')).toBeTruthy()
 })
 it('有待辦 → 照常是完整卡片',async()=>{
  state.tasks=[{id:'T',version:1,label:'需協助',status:'pending',date:todayStr(),createdAt:'2026-10-05T04:00:00Z'}]
  await render()
  expect(document.querySelector('section[aria-label="現場交班待辦"]').getAttribute('data-compact')).toBeNull()
 })
})
