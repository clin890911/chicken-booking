import { describe, it, expect, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import FloorMap, { isArriveEligible, isPreassignArriveEligible } from '../../src/components/admin/floormap/FloorMap'
import StatusBar from '../../src/components/admin/floormap/StatusBar'
import ArrivalStrip, { buildTargets } from '../../src/components/admin/floormap/ArrivalStrip'
import { diningTablePresentation } from '../../src/utils/tableStatus'
import { buildOpsTablePresentation } from '../../src/utils/opsTablePresentation'
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const now = new Date(2026,9,4,12).getTime()
const start = new Date(2026,9,4,11,15).toISOString()
const booking = { id:'B', name:'九位已到', guests:9, status:'arrived', date:'2026-10-04', timeSlot:'11:00', assignedTableId:'103', extraTableIds:['113'], actualArrivalTime:start }
const tables = ['103','113'].map((number,i)=>({number,capacity:6,floor:'1F',x:100+i*100,y:100,w:80,h:75,isActive:true,status:i?'reserved':'dining',currentBookingId:'B',currentRef:null,seatedAt:i?null:start}))
let root, container
afterEach(()=>{act(()=>root?.unmount());container?.remove()})
const mount=(jsx)=>{container=document.createElement('div');document.body.append(container);root=createRoot(container);act(()=>root.render(jsx))}
describe('legacy整組已到店呈現與報到入口一致',()=>{
 it('同組兩桌用餐同起點，純衍生不修改來源metadata',()=>{
  const before=JSON.stringify(tables)
  expect(diningTablePresentation(tables[1],booking,tables)).toMatchObject({status:'dining',seatedAt:start})
  expect(JSON.stringify(tables)).toBe(before)
 })
 it.each(['arrived','completed','cancelled','noshow',undefined])('%s不能出現在已鎖桌或預配等報到入口',status=>{
  const b={...booking,status}
  expect(isArriveEligible(tables[1],b,now)).toBe(false)
  expect(isPreassignArriveEligible({...tables[0],status:'vacant',currentBookingId:null},b,now)).toBe(false)
  expect(buildTargets(tables,[b],now)).toEqual([])
 })
 it.each(['pending','confirmed'])('%s依既有時間窗可等報到',status=>{
  expect(isArriveEligible(tables[1],{...booking,status},now)).toBe(true)
 })
 it('報到列排除legacy已到組，仍顯示待到組且總數正確',()=>{
  const pending={...booking,id:'P',name:'待到客',status:'confirmed',assignedTableId:'104',extraTableIds:[]}
  mount(<ArrivalStrip tables={[...tables,{...tables[1],number:'104',currentBookingId:'P'}]} bookings={[booking,pending]} now={now}/>)
  expect(container.textContent).toContain('等報到 1')
  expect(container.textContent).not.toContain('九位已到')
  expect(container.querySelectorAll('button[aria-label*="到了，入座"]').length).toBe(1)
 })
 it('地圖兩桌均用餐，不再顯示原訂位時間或reserved藍色語義',()=>{
  const presentation=buildOpsTablePresentation({tables,bookings:[booking],date:'2026-10-04',now,settings:{}})
  mount(<FloorMap floor="1F" tables={tables} bookings={[booking]} tablePresentation={presentation} fixtures={{'1F':[]}}/>)
  for(const n of ['103','113']) {
   const target=container.querySelector(`g[aria-label^="${n}桌"]`)
   expect(target.getAttribute('aria-label')).toContain('用餐中')
   expect(target.textContent).not.toContain('11:00')
   expect(target.querySelector('rect')).toBeTruthy()
  }
  const shapes=[...container.querySelectorAll('g[data-table-number]')]
  expect(shapes.length).toBe(2)
  expect(shapes[0].querySelector('rect').getAttribute('fill')).toBe(shapes[1].querySelector('rect').getAttribute('fill'))
 })
 it('頂部用餐桌數跟地圖2桌一致，在席9人只計一次，不寫儲存',()=>{
  const before=JSON.stringify(tables)
  mount(<StatusBar tables={tables} bookings={[booking]} waitlist={[]} variant="compact"/>)
  const valueFor=label=>[...container.querySelectorAll('span')].find(s=>s.textContent===label)?.parentElement.querySelector('span').textContent
  expect(valueFor('用餐中')).toBe('2')
  expect(valueFor('在席人數')).toBe('9')
  expect(JSON.stringify(tables)).toBe(before)
 })
 it.each([{currentBookingId:'OTHER'},{currentRef:{type:'group',groupId:'G'}},{status:'cleaning'},{number:'999'}])('不遮蓋其他所有權或非桌組：%s',over=>{
  const t={...tables[1],...over};expect(diningTablePresentation(t,booking,tables)).toBe(t)
 })
})
