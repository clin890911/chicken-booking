import { beforeEach, it, expect, vi } from 'vitest'
import { guardOperationalSync } from '../../functions/lib/waitlistSyncGuard'
let cloud, remote
const key='chicken_tables_v3'
const save=t=>localStorage.setItem(key,JSON.stringify([t]))
beforeEach(async()=>{
 vi.resetModules();cloud=await import('../../src/services/cloudDataService')
 remote={number:'101',status:'dining',currentBookingId:'B1',currentRef:null,seatedAt:'now',waitlistId:'W1',operationalVersion:1,x:1}
 cloud.applyCloudSnapshot({tables:[remote],bookings:[],waitlist:[]})
 global.fetch=vi.fn(async(_url,options)=>{
  const sent=JSON.parse(options.body).dataset.tables[0]
  remote={...remote,...guardOperationalSync({ref:{path:'tables/101'},data:sent},remote).data}
  return {ok:true,json:async()=>({ok:true,tableUpdates:[remote],bookingUpdates:[],deletedBookingIds:[],deletedTableIds:[],writtenVersions:{tables:{'101':remote.operationalVersion}}})}
 })
})
it('checkout ACK advances operational version so immediately clearing the table succeeds',async()=>{
 save({...remote,status:'cleaning',currentBookingId:null})
 await cloud.pushChangedData()
 expect(cloud.localDataset().tables[0].operationalVersion).toBe(2)
 save({...cloud.localDataset().tables[0],status:'vacant',seatedAt:null})
 await cloud.pushChangedData()
 expect(remote.status).toBe('vacant');expect(remote.operationalVersion).toBe(3)
 expect((await cloud.pushChangedData()).skipped).toBe(true)
})
it('same-flight layout edits survive ACK but retry uses authoritative operational version',async()=>{
 const fetch=global.fetch;let release
 global.fetch=vi.fn(async(...args)=>{const response=await fetch(...args);await new Promise(r=>{release=r});return response})
 save({...remote,status:'cleaning',currentBookingId:null})
 const task=cloud.pushChangedData();await vi.waitFor(()=>expect(release).toBeTypeOf('function'))
 save({...cloud.localDataset().tables[0],x:99})
 release();await task
 expect(cloud.localDataset().tables[0]).toMatchObject({x:99,operationalVersion:2})
 global.fetch=fetch;await cloud.pushChangedData()
 expect(remote).toMatchObject({x:99,operationalVersion:2})
})
it('local ACK storage failure remains pending and retries local acceptance without another server mutation',async()=>{
 save({...remote,status:'cleaning',currentBookingId:null})
 const set=localStorage.setItem.bind(localStorage);let failed=false
 vi.spyOn(localStorage,'setItem').mockImplementation((k,v)=>{if(k===key&&!failed){failed=true;throw new Error('quota')}set(k,v)})
 await expect(cloud.pushChangedData()).rejects.toThrow('quota')
 expect(global.fetch).toHaveBeenCalledTimes(1)
 await cloud.pushChangedData()
 expect(global.fetch).toHaveBeenCalledTimes(1)
 expect(cloud.localDataset().tables[0].operationalVersion).toBe(2)
})

it('postcommit ACK with a newer owner must discard concurrent stale clear intent, while retaining layout draft',async()=>{
 let release
 global.fetch=vi.fn(async()=>{
  await new Promise(r=>{release=r})
  remote={...remote,status:'dining',currentBookingId:'B2',operationalVersion:3}
  return {ok:true,json:async()=>({ok:true,tableUpdates:[remote],writtenVersions:{tables:{'101':2}}})}
 })
 save({...remote,status:'cleaning',currentBookingId:null})
 const task=cloud.pushChangedData();await vi.waitFor(()=>expect(release).toBeTypeOf('function'))
 save({...cloud.localDataset().tables[0],status:'vacant',seatedAt:null,x:99})
 release();await expect(task).rejects.toMatchObject({status:409,code:'operational-sync-changed'})
 expect(cloud.localDataset().tables[0]).toMatchObject({status:'dining',currentBookingId:'B2',operationalVersion:3,x:99})
 const fetch=vi.fn(async(_url,options)=>{
  const sent=JSON.parse(options.body).dataset.tables[0]
  expect(sent.status).toBe('dining');expect(sent.currentBookingId).toBe('B2')
  remote={...remote,...guardOperationalSync({ref:{path:'tables/101'},data:sent},remote).data}
  return {ok:true,json:async()=>({ok:true,tableUpdates:[remote],writtenVersions:{tables:{'101':3}}})}
 })
 global.fetch=fetch;await cloud.pushChangedData()
 expect(remote.currentBookingId).toBe('B2')
})

it('after failed ACK storage then reload and stale clear, a newer poll restores canonical occupancy but keeps layout',async()=>{
 save({...remote,status:'cleaning',currentBookingId:null})
 const set=localStorage.setItem.bind(localStorage);let failed=false
 vi.spyOn(localStorage,'setItem').mockImplementation((k,v)=>{if(k===key&&!failed){failed=true;throw new Error('quota')}set(k,v)})
 await expect(cloud.pushChangedData()).rejects.toThrow('quota')
 save({...cloud.localDataset().tables[0],status:'vacant',seatedAt:null,x:99})
 vi.resetModules();cloud=await import('../../src/services/cloudDataService')
 const applied=cloud.applyCloudSnapshot({tables:[remote],bookings:[],waitlist:[]})
 expect(applied.operationalConflictsResolved).toBe(1)
 expect(cloud.localDataset().tables[0]).toMatchObject({status:'cleaning',operationalVersion:2,x:99})
 await cloud.pushChangedData()
 expect(remote).toMatchObject({status:'cleaning',operationalVersion:2,x:99})
 expect((await cloud.pushChangedData()).skipped).toBe(true)
})
it('old-server ACK missing written version fails closed, does not fake success, and newer poll can recover',async()=>{
 const fetch=global.fetch
 global.fetch=vi.fn(async(...args)=>{const response=await fetch(...args);return {ok:true,json:async()=>{const result=await response.json();delete result.writtenVersions;return result}}})
 save({...remote,status:'cleaning',currentBookingId:null})
 await expect(cloud.pushChangedData()).rejects.toMatchObject({code:'operational-ack-missing'})
 expect(cloud.localDataset().tables[0].operationalVersion).toBe(1)
 cloud.applyCloudSnapshot({tables:[remote],bookings:[],waitlist:[]})
 expect(cloud.localDataset().tables[0]).toMatchObject({status:'cleaning',operationalVersion:2})
 expect((await cloud.pushChangedData()).skipped).toBe(true)
})
