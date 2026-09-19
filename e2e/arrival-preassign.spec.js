import { test, expect } from '@playwright/test'

// 報到列（地圖下方）也要列「預配」的待到訂位（2026-09「接近時段才鎖」之後，早上接的訂位多半只預配、
// 桌況仍空——只看 reserved 桌的話，客人到了在報到列找不到）。時間窗同鎖桌：前 30／後 60 分。
//   1) 預配 12:00 的訂位在 11:40 出現在報到列、按「到了」一下入座；5 秒復原把桌倒回空桌、預配仍在
//   2) 預配的桌此刻被別組佔 → 不入座，toast 帶「改桌」出口
// 時間用 page.clock 固定、時區固定 Asia/Taipei；後台本機模式以 localStorage 為後端，攔截 admin* 雲端端點。

test.use({ timezoneId: 'Asia/Taipei' })

const TODAY = '2026-09-19'
const at = (hhmm) => new Date(`${TODAY}T${hhmm}:00+08:00`)

const mkTable = (number, over = {}) => ({
  number, capacity: 4, floor: '1F', x: 360, y: over.y ?? 612, w: 80, h: 75, rotation: 0, zoneId: null,
  isActive: true, outage: null, status: 'vacant', currentBookingId: null, currentRef: null, seatedAt: null, ...over,
})
const YU = {
  id: 'E2E-PRE-YU', name: '余先生', phone: '0911000002', guests: 2, date: TODAY, timeSlot: '12:00',
  status: 'confirmed', source: 'phone', assignedTableId: '105', extraTableIds: [], notes: {}, createdBy: 'staff',
}

async function seed(page, { tables, bookings }) {
  await page.addInitScript(({ tables, bookings }) => {
    localStorage.setItem('chicken_tables_v3', JSON.stringify(tables))
    localStorage.setItem('chicken_bookings_v1', JSON.stringify(bookings))
    localStorage.removeItem('chicken_group_reservations_v1')
    localStorage.removeItem('chicken_waitlist_v1')
  }, { tables, bookings })
}

async function loginToOps(page) {
  await page.goto('/login')
  await page.getByPlaceholder('your@email.com').fill('berrylin0911@gmail.com')
  await page.getByRole('button', { name: /模擬登入/ }).click()
  await expect(page).toHaveURL(/\/admin/)
  await page.locator('aside').getByRole('button', { name: '現場' }).click()
}

const readState = (page) => page.evaluate(() => ({
  bookings: JSON.parse(localStorage.getItem('chicken_bookings_v1') || '[]'),
  tables: JSON.parse(localStorage.getItem('chicken_tables_v3') || '[]'),
}))

test.beforeEach(async ({ page }) => {
  await page.route('**/adminPullData', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'e2e-offline' }) }))
  await page.route('**/adminPushData', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }))
  await page.route('**/admin*', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false }) }))
})

test('預配 12:00 的訂位 11:40 出現在報到列 → 按到了入座；復原 → 桌回空桌、預配仍在', async ({ page }) => {
  await page.clock.setFixedTime(at('11:40'))
  await seed(page, { tables: [mkTable('105'), mkTable('106', { y: 462 })], bookings: [YU] })
  await loginToOps(page)

  const strip = page.getByRole('list', { name: '可入座名單' })
  await expect(page.getByText('等報到 1')).toBeVisible()
  await expect(strip.getByRole('listitem')).toContainText('余先生')
  await expect(strip.getByRole('listitem')).toContainText('預配')

  await strip.getByRole('button', { name: '余先生 到了，入座 105' }).click()
  await expect(page.getByText('余先生 已入座 105')).toBeVisible()
  let { bookings, tables } = await readState(page)
  expect(bookings.find(b => b.id === YU.id).status).toBe('arrived')
  expect(tables.find(t => t.number === '105')).toMatchObject({ status: 'dining', currentBookingId: YU.id })
  await expect(page.getByText('等報到 1')).toHaveCount(0)

  // 5 秒內復原：桌回空桌（不是 reserved）、訂位回待到且保留預配 105 → 又回到報到列
  await page.getByRole('button', { name: '↩ 復原' }).click()
  ;({ bookings, tables } = await readState(page))
  expect(bookings.find(b => b.id === YU.id)).toMatchObject({ status: 'confirmed', assignedTableId: '105' })
  expect(tables.find(t => t.number === '105')).toMatchObject({ status: 'vacant', currentBookingId: null })
  await expect(page.getByText('等報到 1')).toBeVisible()
})

test('預配的桌此刻被別組佔 → 報到列標「預配·桌被佔」，按到了不入座、toast 給改桌', async ({ page }) => {
  await page.clock.setFixedTime(at('11:40'))
  const OCC = {
    id: 'E2E-OCC', name: '別組', phone: '', guests: 2, date: TODAY, timeSlot: '11:00', status: 'arrived',
    source: 'walkin', assignedTableId: '105', extraTableIds: [], notes: {}, createdBy: 'staff',
  }
  await seed(page, {
    tables: [
      mkTable('105', { status: 'dining', currentBookingId: OCC.id, seatedAt: at('11:05').toISOString() }),
      mkTable('106', { y: 462 }),
    ],
    bookings: [OCC, YU],
  })
  await loginToOps(page)

  const strip = page.getByRole('list', { name: '可入座名單' })
  await expect(strip.getByRole('listitem')).toContainText('預配·桌被佔')
  await strip.getByRole('button', { name: '余先生 到了，入座 105' }).click()
  await expect(page.getByText('入座失敗：105 目前由 別組 使用，請先改桌')).toBeVisible()

  let { bookings, tables } = await readState(page)
  expect(bookings.find(b => b.id === YU.id).status).toBe('confirmed')
  expect(tables.find(t => t.number === '105').currentBookingId).toBe(OCC.id)

  // 改桌出口 → 現場換桌模式（預配維持預配語意）
  await page.getByRole('button', { name: '改桌', exact: true }).click()
  await expect(page.getByText(/換桌：余先生 從 105 → 選新桌/)).toBeVisible()
})
