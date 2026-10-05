import {describe,it,expect} from 'vitest'
import {mergeTasks,resolveTaskTarget} from '../../src/services/handoffService'
describe('交班逐筆merge與動態關聯',()=>{
 it('另一台新增不消失，舊snapshot不復活已完成；較新恢復會顯示',()=>{
  const completed={id:'A',version:2,status:'completed',createdAt:'1'}
  const items=mergeTasks([completed],[{id:'A',version:1,status:'pending'},{id:'B',version:1,status:'pending'}])
  expect(items).toHaveLength(2);expect(items.find(t=>t.id==='A')).toEqual(completed)
  expect(mergeTasks(items,[{...completed,version:3,status:'pending'}]).find(t=>t.id==='A').status).toBe('pending')
 })
 it('booking任務跟改桌，純桌任務留原桌，取消/移除清楚顯示',()=>{
  const task={bookingId:'B',tableNumber:'103'},tableTask={tableNumber:'103'},tables=[{number:'103'},{number:'107'},{number:'109'}]
  const booking={id:'B',name:'測試',status:'arrived',assignedTableId:'107',extraTableIds:['109']}
  expect(resolveTaskTarget(task,[booking],tables).numbers).toEqual(['107','109'])
  expect(resolveTaskTarget(tableTask,[booking],tables).numbers).toEqual(['103'])
  expect(resolveTaskTarget(task,[{...booking,status:'cancelled',assignedTableId:null,extraTableIds:[]}],tables)).toMatchObject({ended:true,numbers:[]})
  expect(resolveTaskTarget(task,[],tables).label).toContain('不存在')
 })
})
