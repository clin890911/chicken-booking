import {describe,it,expect,vi,beforeEach,afterEach} from 'vitest'
import * as waitlist from '../../src/services/waitlistService'
import * as seating from '../../src/services/seatingService'
import * as tables from '../../src/services/tableService'
import {computeDayRolloverActions} from '../../src/utils/opsSweep'
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(new Date(2026,9,5,1))})
afterEach(()=>vi.useRealTimers())
describe('過號候位consumer及席位重驗',()=>{
 it.each(['skipped','left','seated'])('%s不能called或單/多桌入座，不創booking或抢桌',status=>{
  const w=waitlist.create({name:'測試',partySize:4});waitlist.update(w.id,{status})
  tables.bulkWrite(['A','B'].map(number=>({number,capacity:4,floor:'1F',status:'vacant',isActive:true})))
  const before=localStorage.getItem('chicken_tables_v3')
  expect(waitlist.call(w.id)).toBe(null);expect(seating.seatWaitlist(w.id,'A').ok).toBe(false);expect(seating.seatWaitlistMulti(w.id,['A','B']).ok).toBe(false)
  expect(localStorage.getItem('chicken_tables_v3')).toBe(before);expect(localStorage.getItem('chicken_bookings_v1')).toBe(null)
  expect(waitlist.listActive()).toEqual([]);expect(waitlist.summary().active).toBe(0)
 })
 it('日結納入過號，執行前重驗不把已入座票結掉',()=>{
  const w=waitlist.create({name:'舊日過號'});waitlist.update(w.id,{status:'skipped',takenAt:'2026-10-04T02:00:00Z'})
  const actions=computeDayRolloverActions({waitlist:waitlist.listAll(),today:'2026-10-05'})
  expect(actions).toContainEqual(expect.objectContaining({type:'leave-waitlist-auto',waitlistId:w.id}))
  expect(seating.executeSweepActions(actions)).toHaveLength(1);expect(waitlist.getById(w.id).status).toBe('left')
  waitlist.update(w.id,{status:'seated'});expect(seating.executeSweepActions(actions)).toEqual([])
 })
 it('跨凌晨取號按台灣日期編號，前日候位不能入座',()=>{
  const w=waitlist.create({name:'測試'});expect(waitlist.waitlistDay(w)).toBe('2026-10-05')
  waitlist.update(w.id,{takenAt:'2026-10-04T02:00:00Z'})
  expect(waitlist.isSeatEligible(waitlist.getById(w.id))).toBe(false)
  expect(waitlist.create({name:'新日'}).queueNumber).toBe(1)
 })
})
