import { test, expect } from '@playwright/test'

// 未配桌的訂位到店「到了 · 選桌入座」（2026-10 前台尖峰 A1）：
//   過去要 7 下（今日訂位 → 指派桌位 → 點桌 → 確認指派 → 再按客人到了），現在選好桌確認即「指派＋入座」。
//   1) 報到列列出時間窗內未配桌的訂位；「到了 · 選桌」→ 點桌 → 確認入座＝3 下；5 秒復原→訂位回未配桌、桌回空桌
//   2) 今日訂位卡同一個入口
//   3) 選到的桌有重疊預配 → 要勾選才解鎖；入座解除那筆預配，復原時還回去
// 時間用 page.clock 固定、時區固定 Asia/Taipei；後台本機模式以 localStorage 為後端，攔截 admin* 雲端端點。

test.use({ timezoneId: 'Asia/Taipei' })

const TODAY = '2026-09-19'
const at = (hhmm) => new Date(`${TODAY}T${hhmm}:00+08:00`)

const mkTable = (number, over = {}) => ({
  number, capacity: 4, floor: '1F', x: 360, y: over.y ?? 612, w: 80, h: 75, rotation: 0, zoneId: null,
  isActive: true, outage: null, status: 'vacant', currentBookingId: null, currentRef: null, seatedAt: null, ...over,
})
const LIN = {
  id: 'E2E-ARR-LIN', name: '林先生', phone: '0911000003', guests: 3, date: TODAY, timeSlot: '12:00',
  status: 'confirmed', source: 'phone', assignedTableId: null, extraTableIds: [], notes: {}, createdBy: 'staff',
}

async function seed(page, { tables, bookings }) {
  await page.addInitScript(({ tables, bookings }) => {
    localStorage.setItem('chicken_tables_v3', JSON.stringify(tables))
    localStorage.setItem('chicken_bookings_v1', JSON.stringify(bookings))
    localStorage.setItem('chicken_group_reservations_v1', '[]')
    localStorage.setItem('chicken_group_blank_purge_v1', '1')
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
const mapTable = (page, n) => page.getByRole('button', { name: new RegExp(`^${n}桌`) })

test.beforeEach(async ({ page }) => {
  await page.route('**/adminPullData', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'e2e-offline' }) }))
  await page.route('**/adminPushData', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }))
  await page.route('**/admin*', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false }) }))
})

test('報到列列出未配桌的訂位 → 到了·選桌 → 點桌 → 確認入座（3 下）；復原 → 回未配桌、桌回空桌', async ({ page }) => {
  await page.clock.setFixedTime(at('11:40'))
  await seed(page, { tables: [mkTable('105'), mkTable('106', { y: 462 })], bookings: [LIN] })
  await loginToOps(page)

  const strip = page.getByRole('list', { name: '可入座名單' })
  await expect(page.getByText('等報到 1')).toBeVisible()
  await expect(strip.getByRole('listitem')).toContainText('林先生')
  await expect(strip.getByRole('listitem')).toContainText('未配桌')

  let taps = 0
  await strip.getByRole('button', { name: '林先生 到了，選桌入座' }).click(); taps++
  await expect(page.getByText(/到了 · 選桌入座：林先生 3 位/)).toBeVisible()
  await mapTable(page, '105').click(); taps++
  await page.getByRole('button', { name: '✓ 確認入座' }).click(); taps++
  expect(taps).toBeLessThanOrEqual(3)

  await expect(page.getByText('林先生（3 位）已入座 105')).toBeVisible()
  let { bookings, tables } = await readState(page)
  expect(bookings.find(b => b.id === LIN.id)).toMatchObject({ status: 'arrived', assignedTableId: '105' })
  expect(tables.find(t => t.number === '105')).toMatchObject({ status: 'dining', currentBookingId: LIN.id })
  await expect(page.getByText('等報到 1')).toHaveCount(0)

  // 5 秒內復原：booking 與桌一起倒——訂位回待到且未配桌、桌回空桌 → 又回到報到列
  await page.getByRole('button', { name: '復原', exact: true }).click()
  ;({ bookings, tables } = await readState(page))
  expect(bookings.find(b => b.id === LIN.id)).toMatchObject({ status: 'confirmed', assignedTableId: null })
  expect(tables.find(t => t.number === '105')).toMatchObject({ status: 'vacant', currentBookingId: null })
  await expect(page.getByText('等報到 1')).toBeVisible()
})

test('今日訂位卡：未配桌訂位「到了 · 選桌入座」→ 點桌 → 確認入座', async ({ page }) => {
  await page.clock.setFixedTime(at('11:40'))
  await seed(page, { tables: [mkTable('105'), mkTable('106', { y: 462 })], bookings: [LIN] })
  await loginToOps(page)

  await page.getByRole('button', { name: /^今日訂位/ }).click()
  const card = page.locator(`[data-booking-id="${LIN.id}"]`)
  await expect(card.getByRole('button', { name: '指派桌位' })).toBeVisible()
  await card.getByRole('button', { name: '林先生 到了，選桌入座' }).click()
  await mapTable(page, '106').click()
  await page.getByRole('button', { name: '✓ 確認入座' }).click()

  await expect(page.getByText('林先生（3 位）已入座 106')).toBeVisible()
  const { bookings, tables } = await readState(page)
  expect(bookings.find(b => b.id === LIN.id)).toMatchObject({ status: 'arrived', assignedTableId: '106' })
  expect(tables.find(t => t.number === '106')).toMatchObject({ status: 'dining', currentBookingId: LIN.id })
  // 完成後回到今日訂位籤（不開抽屜），可接著處理下一組（這裡只有這一組 → 顯示已無待到）
  await expect(page.getByText('今日已無待到訂位')).toBeVisible()
})

test('選到的桌有重疊預配 → 勾選才解鎖；入座解除那筆預配，復原時還回去', async ({ page }) => {
  await page.clock.setFixedTime(at('11:40'))
  const CHEN = {
    id: 'E2E-ARR-CHEN', name: '陳小姐', phone: '0911000004', guests: 2, date: TODAY, timeSlot: '12:30',
    status: 'confirmed', source: 'phone', assignedTableId: '105', extraTableIds: [], notes: {}, createdBy: 'staff',
  }
  await seed(page, { tables: [mkTable('105'), mkTable('106', { y: 462 })], bookings: [LIN, CHEN] })
  await loginToOps(page)

  const strip = page.getByRole('list', { name: '可入座名單' })
  await strip.getByRole('button', { name: '林先生 到了，選桌入座' }).click()
  await mapTable(page, '105').click()
  await expect(page.getByText(/105 已於排位規劃預留給 陳小姐.*入座後 12:30 陳小姐 的預配將解除/)).toBeVisible()
  const ok = page.getByRole('button', { name: '✓ 確認入座' })
  await expect(ok).toBeDisabled()
  await page.getByRole('checkbox', { name: /我已確認上述預配／團體保留/ }).check()
  await ok.click()

  await expect(page.getByText('林先生（3 位）已入座 105')).toBeVisible()
  let { bookings } = await readState(page)
  expect(bookings.find(b => b.id === CHEN.id).assignedTableId).toBeNull()

  await page.getByRole('button', { name: '復原', exact: true }).click()
  ;({ bookings } = await readState(page))
  expect(bookings.find(b => b.id === LIN.id)).toMatchObject({ status: 'confirmed', assignedTableId: null })
  expect(bookings.find(b => b.id === CHEN.id).assignedTableId).toBe('105')
})
