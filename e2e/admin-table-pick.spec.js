import { test, expect } from '@playwright/test'

// 2026-09 店主回報：「余先生早上來現場訂位，輸入完他的資料後，沒辦法選桌」。
// 1) 新增表單時段下方有「桌位」區：預選建議桌、可改選；來源＝現場時電話選填。
// 2) 存檔後訂位卡有「改桌」→ 跨頁到現場 move 模式 → 地圖點新桌 → 確認改桌。
// 3) 建議桌看佔用區間：11:00 已預配 105 時，11:30 的訂位不再被建議 105；
//    今日存檔即鎖桌 → 09:00 新增 13:30 的訂位也不可預選 105（反向撞桌，驗收問題 1）。
// 4) 覆蓋預配只在用餐區間重疊時解除；帶位「復原」把被解除的預配還回去（驗收問題 3）。
// 時間用 page.clock 固定、時區固定 Asia/Taipei，結果不隨跑測試的時刻變動。
// 後台本機模式以 localStorage 為後端；攔截 admin* 雲端端點（同 admin-assign.spec.js）。

test.use({ timezoneId: 'Asia/Taipei' })

const TODAY = '2026-09-19'
const at = (hhmm) => new Date(`${TODAY}T${hhmm}:00+08:00`)

async function login(page) {
  await page.goto('/login')
  await page.getByPlaceholder('your@email.com').fill('berrylin0911@gmail.com')
  await page.getByRole('button', { name: /模擬登入/ }).click()
  await expect(page).toHaveURL(/\/admin/)
}

async function toOps(page) {
  await page.locator('aside').getByRole('button', { name: '現場' }).click()
}

const slider = (page) => page.getByRole('button', { name: '滑動帶位 →' })
async function slide(page) {
  const knob = page.locator('[data-slide-knob]')
  const kb = await knob.boundingBox()
  const tb = await slider(page).boundingBox()
  await page.mouse.move(kb.x + kb.width / 2, kb.y + kb.height / 2)
  await page.mouse.down()
  await page.mouse.move(tb.x + tb.width, kb.y + kb.height / 2, { steps: 12 })
  await page.mouse.up()
}

const readBookings = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('chicken_bookings_v1') || '[]'))

// 余先生今天 slot 預配 105（只記在訂位上、桌況仍空）
const seedYu = async (page, slot, extra = []) => {
  await page.addInitScript(({ d, slot, extra }) => {
    localStorage.removeItem('chicken_tables_v3')
    localStorage.removeItem('chicken_group_reservations_v1')
    localStorage.removeItem('chicken_waitlist_v1')
    localStorage.setItem('chicken_bookings_v1', JSON.stringify([
      { id: 'E2E-YU', name: '余先生', phone: '0911000002', guests: 2, date: d, timeSlot: slot,
        status: 'confirmed', source: 'walkin', assignedTableId: '105', notes: {}, createdBy: 'staff' },
      ...extra,
    ]))
  }, { d: TODAY, slot, extra })
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
  await page.clock.setFixedTime(at('09:00'))
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

  // 跨頁進現場 move 模式。自己目前的 106 點了不進確認（驗收問題 8），直接說明
  await expect(page.getByText(/換桌：余先生 從 106 → 選新桌/)).toBeVisible()
  await page.locator('svg g:has(:text-is("106"))').first().click()
  await expect(page.getByText('106 是 余先生 目前的桌，請點要換過去的桌')).toBeVisible()
  await expect(page.getByText(/確認把 余先生 從 106 改到桌/)).toHaveCount(0)
  // 點 107 → 二步確認 → 改桌成功
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
  await page.clock.setFixedTime(at('09:00'))
  await seedYu(page, '11:00', [
    { id: 'E2E-CHEN', name: '陳小姐', phone: '0911000001', guests: 2, date: TODAY, timeSlot: '11:30',
      status: 'confirmed', source: 'phone', assignedTableId: null, notes: {}, createdBy: 'staff' },
  ])
  await login(page)

  // 余先生的 105 只是預配（桌況仍空）→ 藍色「預配 105」徽章
  await expect(page.getByText('預配 105', { exact: true })).toBeVisible()
  // 陳小姐：建議桌跳過 105（時段重疊），改建議 106
  await expect(page.getByText('建議桌 106')).toBeVisible()
  await expect(page.getByText('建議桌 105')).toHaveCount(0)
})

// 驗收問題 1 的重現情境：09:00 時余先生 11:00 預配 105；新增陳小姐 13:30 → 表單存檔即鎖桌，
// 105 從 09:00 起就被鎖，會撞到 11:00 的余先生 → 不得預選、也不得列出 105。
test('反向撞桌：09:00 新增 13:30 的訂位，不得預選／列出 11:00 已預配的 105', async ({ page }) => {
  await page.clock.setFixedTime(at('09:00'))
  await seedYu(page, '11:00')
  await login(page)
  await page.getByRole('button', { name: /新增/ }).click()
  await page.getByPlaceholder('0912345678').fill('0911000001')
  await page.getByPlaceholder('王小姐').fill('陳小姐')
  await page.getByRole('button', { name: /^13:30/ }).click()

  await expect(page.getByRole('button', { name: /^106 · 4人/ })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', { name: /^105 · 4人/ })).toHaveCount(0)
  await page.getByRole('button', { name: /確認新增 · .*13:30 · 2 位 · 桌 106/ }).click()
  await expect(page.getByText(/陳小姐 2 位 · .*13:30 · 已指派 106/)).toBeVisible()
  const yu = (await readBookings(page)).find(b => b.id === 'E2E-YU')
  expect(yu.assignedTableId).toBe('105')
})

// 驗收問題 3：12:20 帶位覆蓋 20:30 的預配（用餐區間不重疊）→ 警示寫「會保留」、帶位後預配仍在
test('帶位覆蓋不重疊的預配（12:20 vs 20:30）→ 預配保留', async ({ page }) => {
  await page.clock.setFixedTime(at('12:20'))
  await seedYu(page, '20:30')
  await login(page)
  await toOps(page)

  await page.locator('svg g:has(:text-is("105"))').first().click()
  await expect(page.getByText(/105 已於排位規劃預留給 余先生.*20:30 余先生 的預配會保留/)).toBeVisible()
  await page.getByRole('checkbox', { name: /仍要帶這桌/ }).check()     // M1：警示仍要勾選解鎖
  await slide(page)
  await expect(page.getByText(/入座 105\s*·\s*可帶下一組/)).toBeVisible()
  await expect(page.getByText(/余先生原本的預配/)).toHaveCount(0)
  const yu = (await readBookings(page)).find(b => b.id === 'E2E-YU')
  expect(yu.assignedTableId).toBe('105')
})

// 驗收問題 3：12:20 帶位覆蓋 12:30 的預配（重疊）→ 解除；按帶位 toast 的「復原」→ 預配回來
test('帶位覆蓋重疊的預配（12:20 vs 12:30）→ 解除；按復原 → 預配回來', async ({ page }) => {
  await page.clock.setFixedTime(at('12:20'))
  await seedYu(page, '12:30')
  await login(page)
  await toOps(page)

  await page.locator('svg g:has(:text-is("105"))').first().click()
  await expect(page.getByText(/用餐時段重疊：帶位後 12:30 余先生 的預配將解除/)).toBeVisible()
  await page.getByRole('checkbox', { name: /仍要帶這桌/ }).check()
  await slide(page)
  await expect(page.getByText('余先生原本的預配 105 已解除，請重新指派')).toBeVisible()
  expect((await readBookings(page)).find(b => b.id === 'E2E-YU').assignedTableId).toBeNull()

  await page.getByRole('button', { name: '復原', exact: true }).click()
  await expect(page.getByText(/已復原：105 回到空桌（余先生 的預配 105 已還原）/)).toBeVisible()
  const after = await readBookings(page)
  expect(after.find(b => b.id === 'E2E-YU').assignedTableId).toBe('105')
  expect(after.find(b => b.id !== 'E2E-YU').status).toBe('cancelled')   // 帶位那筆已取消
})
