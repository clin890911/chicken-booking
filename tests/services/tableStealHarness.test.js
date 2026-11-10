// 接線測試：真 adminPushData handler（搶桌守門）× 前端 cloudDataService。
// 第一台先把 102 帶給 A（直接打 handler）；第二台（本模組）把 102 帶給 B → 409 → 拉取自癒 → 第二次推送成功。
import { beforeEach, expect, it, vi } from 'vitest'
import { buildAdminPush, createFakeDb } from '../helpers/adminPushHarness'

const VACANT = { number: '102', status: 'vacant', currentBookingId: null, currentRef: null, seatedAt: null }
let fake, call, cloud

const pullBody = () => {
  const out = { ok: true, tables: [], bookings: [], waitlist: [] }
  for (const [path, doc] of fake.records) {
    const [col] = path.split('/')
    if (out[col]) out[col].push(structuredClone(doc))
  }
  return out
}

beforeEach(async () => {
  localStorage.clear()
  fake = createFakeDb({ 'tables/102': VACANT })
  call = buildAdminPush(fake.db)
  global.fetch = vi.fn(async (url, opts) => {
    if (String(url).endsWith('/adminPullData')) return { ok: true, json: async () => pullBody() }
    const r = await call('manager', JSON.parse(opts.body))
    return { ok: r.code < 400, status: r.code, json: async () => r.body }
  })
  vi.resetModules()
  cloud = await import('../../src/services/cloudDataService')
  cloud.applyCloudSnapshot(await cloud.pullCloudData())
})

it('A7：被拒 → 記錄 → 拉取採用雲端 → B 退回待到 → 第二次推送成功、雲端 A 不被覆蓋', async () => {
  // 第一台先帶 A
  expect((await call('manager', { partial: true, dataset: {
    tables: [{ ...VACANT, status: 'dining', currentBookingId: 'A', seatedAt: 't-a' }],
    bookings: [{ id: 'A', name: '陳小姐', date: '2026-11-10', status: 'arrived', assignedTableId: '102' }],
  } })).code).toBe(200)
  // 第二台（本機，還沒拉到 A）帶 B 到 102
  localStorage.setItem('chicken_tables_v3', JSON.stringify([{ ...VACANT, status: 'dining', currentBookingId: 'B', seatedAt: 't-b' }]))
  localStorage.setItem('chicken_bookings_v1', JSON.stringify([{ id: 'B', name: '王先生', date: '2026-11-10', status: 'arrived', assignedTableId: '102', extraTableIds: [] }]))
  const err = await cloud.pushChangedData().catch(e => e)
  expect(err).toMatchObject({ status: 409, code: 'table-occupied-elsewhere', tables: ['102'], tableStealConflict: true })
  expect(err.tableStealMessage).toBe('102 已被另一台帶位，王先生請重新帶位')
  expect(fake.records.has('bookings/B')).toBe(false)

  const applied = cloud.applyCloudSnapshot(await cloud.pullCloudData())
  expect(applied.tableStealsResolved).toHaveLength(1)

  const r = await cloud.pushChangedData()
  expect(r.ok).toBe(true)
  expect(fake.records.get('tables/102')).toMatchObject({ status: 'dining', currentBookingId: 'A' })
  expect(fake.records.get('bookings/B')).toMatchObject({ status: 'confirmed', assignedTableId: null })
  expect((await cloud.pushChangedData()).skipped).toBe(true)
})

it('預配被擋（reserved Y 蓋 dining A）：真 handler 409 → 拉取自癒 → Y 拿掉 102 → 第二次推送成功', async () => {
  await call('manager', { partial: true, dataset: {
    tables: [{ ...VACANT, status: 'dining', currentBookingId: 'A', seatedAt: 't-a' }],
    bookings: [{ id: 'A', name: '陳小姐', date: '2026-11-10', status: 'arrived', assignedTableId: '102' }],
  } })
  localStorage.setItem('chicken_tables_v3', JSON.stringify([{ ...VACANT, status: 'reserved', currentBookingId: 'Y' }]))
  localStorage.setItem('chicken_bookings_v1', JSON.stringify([{ id: 'Y', name: '林小姐', date: '2026-11-10', status: 'confirmed', assignedTableId: '102', extraTableIds: [] }]))
  const err = await cloud.pushChangedData().catch(e => e)
  expect(err).toMatchObject({ status: 409, code: 'table-occupied-elsewhere', tables: ['102'], tableStealConflict: true })
  cloud.applyCloudSnapshot(await cloud.pullCloudData())
  expect((await cloud.pushChangedData()).ok).toBe(true)
  expect(fake.records.get('tables/102')).toMatchObject({ status: 'dining', currentBookingId: 'A' })
  expect(fake.records.get('bookings/Y')).toMatchObject({ status: 'confirmed', assignedTableId: null })
})
