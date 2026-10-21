import {describe,it,expect} from 'vitest'
import {guardOperationalSync} from '../../functions/lib/waitlistSyncGuard.js'
const op=(data,path='tables/101')=>({ref:{path},data})
describe('server operational occupancy fence',()=>{
 it('rejects an old layout snapshot which would clear an occupied command table',()=>{
  expect(()=>guardOperationalSync(op({status:'vacant',currentBookingId:null}),{status:'dining',currentBookingId:'WLB_A',operationalVersion:1})).toThrow('operational-state-changed')
 })
 it('allows layout edits with matching occupancy without resetting server version',()=>{
  const current={status:'dining',currentBookingId:'WLB_A',seatedAt:'now',currentRef:null,waitlistId:'W1',operationalVersion:2}
  expect(guardOperationalSync(op({...current,x:200,operationalVersion:1}),current).data).toMatchObject({...current,x:200})
 })
 it('preserves existing checkout and move flows with a current version and advances fence',()=>{
  expect(guardOperationalSync(op({status:'cleaning',currentBookingId:null,operationalVersion:2}),{status:'dining',currentBookingId:'B1',operationalVersion:2}).data.operationalVersion).toBe(3)
 })
 it('rejects invented derived bookings and deletion of protected tables',()=>{
  expect(()=>guardOperationalSync(op({waitlistId:'W1'},'bookings/NEW'),null)).toThrow()
  expect(()=>guardOperationalSync({ref:{path:'tables/101'},delete:true},{status:'dining',operationalVersion:1})).toThrow()
 })
})
