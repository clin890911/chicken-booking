import { test, expect } from '@playwright/test'

// 2026-09 店主回報：「余先生早上來現場訂位，輸入完他的資料後，沒辦法選桌」。
// 1) 新增表單時段下方有「桌位」區：預選建議桌、可改選；來源＝現場時電話選填。
// 2) 存檔後訂位卡有「改桌」→ 跨頁到現場 move 模式 → 地圖點新桌 → 確認改桌。
// 3) 建議桌看時段：11:00 已預配 105 時，11:30 的訂位不再被建議 105。
// 後台本機模式以 localStorage 為後端；攔截 admin* 雲端端點（同 admin-assign.spec.js）。

function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

async function login(page) {
  await page.goto('/login')
  await page.getByPlaceholder('your@email.com').fill('berrylin0911@gmail.com')
  await page.getByRole('button', { name: /模擬登入/ }).click()
  await expect(page).toHaveURL(/\/admin/)
}

test.beforeEach(async ({ page }) => {
  await page.route('**/adminPullData', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'e2e-offline' }) }))
  await page.route('**/adminPushData', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }))
  await page.route('**/admin*', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false }) }))
})

test('新增（現場、不留電話）→ 表單選桌 106 → 卡片「改桌」→ 現場地圖改到 107', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('chicken_bookings_v1', JSON.stringify([]))
    localStorage.removeItem('chicken_tables_v3')
    localStorage.removeItem('chicken_group_reservations_v1')
  })
  await login(page)
  await page.getByRole('button', { name: /新增/ }).click()

  // 來源＝現場 → 電話選填；只填姓名＋時段就能存
  await page.getByRole('button', { name: '來源：現場' }).click()
  await expect(page.getByPlaceholder('現場客可不填')).toBeVisible()
  await page.getByPlaceholder('王小姐').fill('余先生')
  await expect(page.getByText('選好時段後')).toBeVisible()
  await page.getByRole('button', { name: /^11:00/ }).click()

  // 桌位區：預選建議桌（2 位 → 1F 四人桌 105），改選 106，確認列帶出桌號
  await expect(page.getByRole('button', { name: /^105 · 4人/ })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: /^106 · 4人/ }).click()
  const confirmBtn = page.getByRole('button', { name: /確認新增 · .*11:00 · 2 位 · 桌 106/ })
  await expect(confirmBtn).toBeVisible()
  await confirmBtn.click()
  await expect(page.getByText(/余先生 2 位 · .*11:00 · 已指派 106/)).toBeVisible()

  // 回到今日清單：卡片是綠色「桌 106」（現場指派已鎖桌），有「改桌」
  await expect(page.getByText('桌 106', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '↔ 改桌' }).click()

  // 跨頁進現場 move 模式 → 點 107 → 二步確認 → 改桌成功
  await expect(page.getByText(/換桌：余先生 從 106 → 選新桌/)).toBeVisible()
  await page.locator('svg g:has(:text-is("107"))').first().click()
  await expect(page.getByText(/確認把 余先生 從 106 改到桌 107/)).toBeVisible()
  await page.getByRole('button', { name: /確認改桌/ }).click()
  await expect(page.getByText(/余先生 已從 106 改到 107/)).toBeVisible()

  const state = await page.evaluate(() => ({
    bookings: JSON.parse(localStorage.getItem('chicken_bookings_v1') || '[]'),
    tables: JSON.parse(localStorage.getItem('chicken_tables_v3') || '[]'),
    customers: localStorage.getItem('chicken_customers_v1'),
  }))
  const yu = state.bookings.find(b => b.name === '余先生')
  expect(yu.phone).toBe('')
  expect(yu.assignedTableId).toBe('107')
  const t = (n) => state.tables.find(x => x.number === n)
  expect(t('107').status).toBe('reserved')
  expect(t('107').currentBookingId).toBe(yu.id)
  expect(t('106').status).toBe('vacant')
})

test('建議桌看時段：11:00 余先生已預配 105 → 11:30 陳小姐不再被建議 105', async ({ page }) => {
  const today = todayStr()
  await page.addInitScript((d) => {
    localStorage.removeItem('chicken_tables_v3')
    localStorage.removeItem('chicken_group_reservations_v1')
    localStorage.setItem('chicken_bookings_v1', JSON.stringify([
      { id: 'E2E-YU', name: '余先生', phone: '0911000002', guests: 2, date: d, timeSlot: '11:00',
        status: 'confirmed', source: 'walkin', assignedTableId: '105', notes: {}, createdBy: 'staff' },
      { id: 'E2E-CHEN', name: '陳小姐', phone: '0911000001', guests: 2, date: d, timeSlot: '11:30',
        status: 'confirmed', source: 'phone', assignedTableId: null, notes: {}, createdBy: 'staff' },
    ]))
  }, today)
  await login(page)

  // 余先生的 105 只是預配（桌況仍空）→ 藍色「預配 105」徽章
  await expect(page.getByText('預配 105', { exact: true })).toBeVisible()
  // 陳小姐：建議桌跳過 105（時段重疊），改建議 106
  await expect(page.getByText('建議桌 106')).toBeVisible()
  await expect(page.getByText('建議桌 105')).toHaveCount(0)
})
