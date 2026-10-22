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


it('command ACK rebases dirty layout and booking notes onto canonical authority, then pushes them once', async () => {
  const table = { number: 'T1', status: 'vacant', currentBookingId: null, operationalVersion: 1, x: 10, y: 20, label: '舊標籤' }
  const booking = { id: 'PRE1', status: 'confirmed', assignedTableId: 'T1', extraTableIds: [], operationalVersion: 1, notes: '舊備註' }
  cloud.applyCloudSnapshot({ waitlist: [], bookings: [booking], tables: [table] })
  localStorage.setItem('chicken_tables_v3', JSON.stringify([{ ...table, x: 999, y: 888, label: '新標籤', status: 'cleaning', currentBookingId: 'LOCAL', waitlistId: 'LOCAL' }]))
  localStorage.setItem('chicken_bookings_v1', JSON.stringify([{ ...booking, notes: '保留的備註', status: 'arrived', assignedTableId: 'LOCAL' }]))
  const canonicalTable = { ...table, status: 'dining', currentBookingId: 'B1', waitlistId: 'W1', operationalVersion: 2 }
  const canonicalBooking = { ...booking, assignedTableId: null, operationalVersion: 2 }
  cloud.acceptWaitlistCommandResult({ item: { id: 'W1', status: 'seated', queueVersion: 2 }, tables: [canonicalTable], bookings: [canonicalBooking] })
  expect(cloud.localDataset().tables[0]).toMatchObject({ x: 999, y: 888, label: '新標籤', status: 'dining', currentBookingId: 'B1', waitlistId: 'W1', operationalVersion: 2 })
  expect(cloud.localDataset().bookings[0]).toMatchObject({ notes: '保留的備註', status: 'confirmed', assignedTableId: null, operationalVersion: 2 })
  let payload
  global.fetch = vi.fn(async (_url, options) => {
    payload = JSON.parse(options.body).dataset
    return { ok: true, json: async () => ({ ok: true, tableUpdates: payload.tables, bookingUpdates: payload.bookings, writtenVersions: { tables: { T1: 2 }, bookings: { PRE1: 2 } } }) }
  })
  await cloud.pushChangedData()
  expect(payload.tables).toEqual([{ ...canonicalTable, x: 999, y: 888, label: '新標籤' }])
  expect(payload.bookings).toEqual([{ ...canonicalBooking, notes: '保留的備註' }])
  expect(payload.waitlist).toBeUndefined()
  expect((await cloud.pushChangedData()).skipped).toBe(true)
  expect(global.fetch).toHaveBeenCalledTimes(1)
})

it('older per-record ACK never advances a newer baseline or overwrites its dirty layout', async () => {
  const table = { number: 'T1', status: 'dining', currentBookingId: 'B2', waitlistId: 'W2', operationalVersion: 3, x: 10 }
  cloud.applyCloudSnapshot({ waitlist: [], bookings: [], tables: [table] })
  localStorage.setItem('chicken_tables_v3', JSON.stringify([{ ...table, x: 777 }]))
  cloud.acceptWaitlistCommandResult({ item: { id: 'W1', status: 'seated', queueVersion: 2 }, tables: [{ ...table, operationalVersion: 2, currentBookingId: 'B1', waitlistId: 'W1' }] })
  expect(cloud.localDataset().tables[0]).toEqual({ ...table, x: 777 })
  let payload
  global.fetch = vi.fn(async (_url, options) => {
    payload = JSON.parse(options.body).dataset
    return { ok: true, json: async () => ({ ok: true, tableUpdates: payload.tables, writtenVersions: { tables: { T1: 3 } } }) }
  })
  await cloud.pushChangedData()
  expect(payload.tables).toEqual([{ ...table, x: 777 }])
})

it('command ACK preserves deletion of a dirty non-operational field', () => {
  const table = { number: 'T1', status: 'vacant', operationalVersion: 1, label: '刪除此標籤' }
  cloud.applyCloudSnapshot({ waitlist: [], bookings: [], tables: [table] })
  const { label, ...edited } = table
  localStorage.setItem('chicken_tables_v3', JSON.stringify([edited]))
  cloud.acceptWaitlistCommandResult({ item: { id: 'W1', status: 'seated', queueVersion: 2 }, tables: [{ ...table, status: 'dining', operationalVersion: 2 }] })
  expect(cloud.localDataset().tables[0]).not.toHaveProperty('label')
})
