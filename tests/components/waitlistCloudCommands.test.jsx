import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
const state = vi.hoisted(() => ({ owner: 'staff-a', can: () => true }))
vi.mock('../../src/contexts/AuthContext', () => ({ useAuth: () => ({ user: { email: state.owner }, can: state.can, usingFirebase: false }) }))
vi.mock('../../src/contexts/HandoffContext', () => ({ HandoffProvider: ({children}) => children }))
vi.mock('../../src/components/ui/Toast', () => ({ useToast: () => ({ error:vi.fn(),success:vi.fn(),warning:vi.fn(),info:vi.fn() }) }))
vi.mock('../../src/services/telegramService', () => ({ notifyWaitlistCreated: vi.fn(), notifyWaitlistSeated: vi.fn() }))
import { BookingProvider, useBooking } from '../../src/contexts/BookingContext'
import * as cloud from '../../src/services/cloudDataService'
import { listPending } from '../../src/services/waitlistCommands'
let root, container, api
const now = new Date().toISOString()
const wait = { id:'W1', queueNumber:1, partySize:4, children:1, name:'測試', status:'waiting', takenAt:now, queueVersion:1 }
const snapshot = () => ({waitlist:[wait],bookings:[],tables:[{number:'T1',capacity:4,status:'vacant'}]})
function Probe(){ api=useBooking(); return <div>{api.waitlist.map(w=>w.status).join(',')}</div> }
const mount = async () => { container=document.createElement('div'); document.body.append(container); root=createRoot(container); await act(async()=>root.render(<BookingProvider><Probe/></BookingProvider>)) }
const unmount=()=>{act(()=>root?.unmount());container?.remove();root=null}
beforeEach(()=>{
  state.owner='staff-a'; state.can=()=>true
  globalThis.IS_REACT_ACT_ENVIRONMENT=true
  vi.stubGlobal('fetch',vi.fn(()=>{throw new Error('network forbidden')}))
  vi.spyOn(cloud,'pullCloudData').mockResolvedValue(snapshot())
  Object.defineProperty(navigator,'onLine',{value:true,configurable:true})
})
afterEach(()=>{unmount();vi.unstubAllGlobals()})
it('call changes only after cloud ACK, failures never leave local called state',async()=>{
  let resolve; const request=vi.spyOn(cloud,'operationalRequest').mockImplementation(()=>new Promise(r=>{resolve=r}))
  await mount();let task
  await act(async()=>{task=api.callWaitlist('W1')})
  expect(api.waitlist[0].status).toBe('waiting')
  expect(request.mock.calls[0][1]).toMatchObject({action:'call',expectedVersion:1})
  await act(async()=>{resolve({ok:true,item:{...wait,status:'called',queueVersion:2},bookings:[],tables:[]});await task})
  expect(api.waitlist[0].status).toBe('called')
  expect(api.pendingWaitlistCommands).toHaveLength(0)
})
it('lost ACK/reload sends the exact same command and creates one canonical ticket',async()=>{
  const request=vi.spyOn(cloud,'operationalRequest').mockRejectedValue(new Error('lost ack'))
  await mount();await act(async()=>{expect((await api.addWaitlist({name:'測試',partySize:4,children:1})).pending).toBe(true)})
  const original=request.mock.calls[0][1]
  unmount();await mount()
  expect(api.pendingWaitlistCommands[0].command).toEqual(original)
  request.mockResolvedValue({ok:true,item:{...wait,id:original.id,queueNumber:9},bookings:[],tables:[]})
  await act(async()=>api.retryWaitlistCommands())
  expect(request.mock.calls[1][1]).toEqual(original)
  expect(api.waitlist.filter(w=>w.id===original.id)).toHaveLength(1)
})
it('offline seat saves a recoverable command without occupying a table or creating booking',async()=>{
  const request=vi.spyOn(cloud,'operationalRequest')
  await mount();Object.defineProperty(navigator,'onLine',{value:false,configurable:true})
  await act(async()=>{expect((await api.seatWaitlistMulti('W1',['T1'],{confirmedConflictTables:[]})).pending).toBe(true)})
  expect(request).not.toHaveBeenCalled()
  expect(api.tables.find(t=>t.number==='T1').status).toBe('vacant')
  expect(api.bookings).toHaveLength(0)
})
it('409 seat reloads all canonical collections; no orphan booking/table is locally created',async()=>{
  vi.spyOn(cloud,'operationalRequest').mockRejectedValue(Object.assign(new Error('seat conflict'),{status:409}))
  await mount()
  await act(async()=>expect((await api.seatWaitlist('W1','T1')).ok).toBe(false))
  expect(api.bookings).toHaveLength(0)
  expect(api.tables.find(t=>t.number==='T1').status).toBe('vacant')
  expect(api.pendingWaitlistCommands).toHaveLength(0)
})
it('account switch cannot replay the previous staff pending request',async()=>{
  const request=vi.spyOn(cloud,'operationalRequest').mockRejectedValue(new Error('unknown'))
  await mount();await act(async()=>api.callWaitlist('W1'))
  expect(listPending('staff-a','chicken-booking-tw')).toHaveLength(1)
  unmount();state.owner='staff-b';await mount()
  expect(api.pendingWaitlistCommands).toHaveLength(0)
  await act(async()=>api.retryWaitlistCommands())
  expect(request).toHaveBeenCalledTimes(1)
})
