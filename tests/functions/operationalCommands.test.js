import {describe,it,expect} from 'vitest'
import {buildHandoffCommand,buildQueueCommand,protectQueueUpsert,businessDate} from '../../functions/lib/operationalCommands'
const now='2026-10-05T04:00:00.000Z',options={role:'floor',actor:'staff_1',now}
const create={id:'T1',commandId:'command_123',expectedVersion:0,action:'create',label:'等兒童椅',bookingId:'B1',tableNumber:'103'}
const queue={id:'W1',takenAt:'2026-10-05T02:00:00Z',queueNumber:1,name:'測試',phone:'0900000000',partySize:4,status:'called',queueVersion:0}
describe('交班server命令與角色/版本守門',()=>{
 it('只保存refs，actor/date/times由server決定，完成/恢復同id遞增',()=>{
  const task=buildHandoffCommand({...create,createdBy:'spoof',date:'2000-01-01'},null,options)
  expect(task).toMatchObject({createdBy:'staff_1',date:'2026-10-05',status:'pending',version:1,bookingId:'B1',tableNumber:'103'})
  expect(task.name).toBeUndefined()
  const done=buildHandoffCommand({...create,action:'complete',expectedVersion:1},task,options)
  expect(done).toMatchObject({status:'completed',completedBy:'staff_1',completedAt:now,version:2})
  expect(buildHandoffCommand({...create,action:'reopen',expectedVersion:2},done,options)).toMatchObject({id:'T1',status:'pending',version:3,completedAt:null})
 })
 it.each(['kitchen','unknown'])('%s不能繞UI建立或完成',role=>{
  expect(()=>buildHandoffCommand(create,null,{...options,role})).toThrow('permission-denied')
 })
 it('兩台同版本完成只有第一個能提交；舊快照不能恢復',()=>{
  const task=buildHandoffCommand(create,null,options),done=buildHandoffCommand({...create,action:'complete',expectedVersion:1},task,options)
  expect(()=>buildHandoffCommand({...create,action:'complete',expectedVersion:1},done,options)).toThrow('task-changed')
  expect(()=>buildHandoffCommand({...create,action:'reopen',expectedVersion:1},done,options)).toThrow('task-changed')
 })
 it.each([{label:''},{label:'a'.repeat(81)},{bookingId:null,tableNumber:null},{expectedVersion:1},{action:'delete'}])('非法命令%s不修改',patch=>{
  expect(()=>buildHandoffCommand({...create,...patch},null,options)).toThrow()
 })
 it('booking/table reference必须存在',()=>{
  expect(()=>buildHandoffCommand(create,null,{...options,bookingExists:false})).toThrow('reference-not-found')
 })
})
describe('候位過號/回來與stale generic保護',()=>{
 it('叫號→過號→原號回來，保留takenAt/pax/contact；回來不自動called/seated',()=>{
  const skipped=buildQueueCommand({...create,id:'W1',action:'skip'},queue,options)
  expect(skipped).toMatchObject({status:'skipped',skippedAt:now,queueNumber:1,takenAt:queue.takenAt,phone:queue.phone,partySize:4,queueVersion:1})
  expect(buildQueueCommand({...create,id:'W1',action:'return',expectedVersion:1},skipped,options)).toMatchObject({status:'waiting',calledAt:null,queueVersion:2,queueNumber:1,returnedAt:now})
 })
 it.each(['seated','left'])('終止狀態%s在0版與新版皆不能被舊waiting復活',status=>{
  for(const queueVersion of [0,2])expect(()=>protectQueueUpsert({...queue,status:'waiting',queueVersion},{...queue,status,queueVersion})).toThrow('waitlist-ended')
  expect(()=>buildQueueCommand({...create,id:'W1',action:'return'}, {...queue,status},options)).toThrow('waitlist-changed')
 })
 it('過日/過號座位状态/版本必拒绝，日期按台灣凌晨而非UTC',()=>{
  expect(businessDate('2026-10-04T17:00:00Z')).toBe('2026-10-05')
  expect(()=>buildQueueCommand({...create,id:'W1',action:'skip'},{...queue,takenAt:'2026-10-04T04:00:00Z'},options)).toThrow('waitlist-not-today')
  expect(()=>buildQueueCommand({...create,id:'W1',action:'return',expectedVersion:0},{...queue,status:'skipped',queueVersion:1},options)).toThrow('waitlist-changed')
 })
 it('generic不能复原skipped/伪造日期号码，版本匹配也必须专用命令',()=>{
  const previous={...queue,status:'skipped',queueVersion:1}
  expect(()=>protectQueueUpsert({...previous,status:'waiting'},previous)).toThrow('use-queue-command')
  const saved=protectQueueUpsert({...previous,status:'left',takenAt:'2099-01-01',queueNumber:999},previous)
  expect(saved).toMatchObject({queueNumber:1,takenAt:queue.takenAt,queueVersion:2,status:'left'})
 })
})
