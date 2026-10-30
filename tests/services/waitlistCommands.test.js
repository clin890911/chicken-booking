import { vi, beforeEach, it, expect } from 'vitest'
let service, cloud
const owner = 'staff-a', store = 'test-store'
const draft = { name: '測試', partySize: 4, children: 1 }
beforeEach(async () => {
  vi.resetModules()
  service = await import('../../src/services/waitlistCommands')
  cloud = await import('../../src/services/cloudDataService')
})
it('lost acknowledgement restores exactly the same command after reload; another account cannot replay', async () => {
  const pending = service.prepareCommand({ owner, store, action: 'create', payload: draft })
  const first = pending.command
  vi.resetModules()
  service = await import('../../src/services/waitlistCommands')
  expect(service.listPending(owner, store)[0].command).toEqual(first)
  expect(service.listPending('staff-b', store)).toEqual([])
  expect(service.prepareCommand({ owner, store, action: 'create', payload: draft }).command).toEqual(first)
})
it('storage failure closes the submission gate', () => {
  vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('quota') })
  expect(() => service.prepareCommand({ owner, store, action: 'create', payload: draft })).toThrow(/儲存/)
})
it('old-day pending keeps its original date; do not silently reissue it tomorrow', () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 9, 12, 23, 59))
  const pending = service.prepareCommand({ owner, store, action: 'create', payload: draft })
  vi.setSystemTime(new Date(2026, 9, 13, 0, 1))
  expect(service.listPending(owner, store)[0].command.date).toBe(pending.command.date)
  vi.useRealTimers()
})
it('ACK accepts waitlist/booking/tables as synced; stale poll started before ACK cannot roll them back', async () => {
  cloud.applyCloudSnapshot({ waitlist: [], bookings: [], tables: [{ number: 'T1', status: 'vacant' }] })
  let release
  global.fetch = vi.fn(() => new Promise(resolve => { release = resolve }))
  const pull = cloud.pullCloudData()
  await vi.waitFor(() => expect(release).toBeTypeOf('function'))
  cloud.acceptWaitlistCommandResult({ item: { id: 'W1', status: 'seated', queueVersion: 2 }, bookings: [{ id: 'B1', status: 'arrived' }], tables: [{ number: 'T1', status: 'dining', currentBookingId: 'B1' }] })
  release({ ok: true, json: async () => ({ ok: true, waitlist: [], bookings: [], tables: [{ number: 'T1', status: 'vacant' }] }) })
  expect(cloud.applyCloudSnapshot(await pull)).toMatchObject({ stale: true })
  expect(cloud.localDataset().tables[0].currentBookingId).toBe('B1')
  global.fetch = vi.fn()
  expect((await cloud.pushChangedData()).skipped).toBe(true)
  expect(global.fetch).not.toHaveBeenCalled()
})

it('partial local ACK persistence rolls back every canonical collection; keeps baseline unchanged', () => {
  cloud.applyCloudSnapshot({ waitlist: [], bookings: [], tables: [{ number: 'T1', status: 'vacant' }] })
  const set = localStorage.setItem.bind(localStorage)
  let failed = false
  vi.spyOn(localStorage, 'setItem').mockImplementation((key, value) => {
    if (key === 'chicken_bookings_v1' && !failed) { failed = true; throw new Error('quota') }
    set(key,value)
  })
  expect(() => cloud.acceptWaitlistCommandResult({ item: { id: 'W1', status: 'seated', queueVersion: 2 }, bookings: [{ id: 'B1', status: 'arrived' }], tables: [{ number: 'T1', status: 'dining' }] })).toThrow('quota')
  expect(cloud.localDataset().waitlist).toEqual([])
  expect(cloud.localDataset().bookings).toEqual([])
  expect(cloud.localDataset().tables[0].status).toBe('vacant')
})
it('錯誤碼中文化：table-capacity-insufficient 講座位不足（已含擠一擠），不誤報成「另一台已更新」', () => {
  expect(service.commandError({ status: 409, code: 'table-capacity-insufficient' })).toBe('座位不足（已含每桌擠一擠 1 位），未入座；請再加一桌')
  // 沒有對照的錯誤碼仍依 HTTP 狀態退回通用說法；原型鏈上的鍵不可被當成對照
  expect(service.commandError({ status: 409, code: 'waitlist-changed' })).toMatch(/另一台已更新/)
  expect(service.commandError({ status: 409, code: 'constructor' })).toMatch(/另一台已更新/)
  expect(service.commandError({ status: 403 })).toMatch(/沒有操作權限/)
})
