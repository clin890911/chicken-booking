import { test, expect } from '@playwright/test'
import { todayTab, openGroupRow } from './helpers/opsToday'

// 現場左欄「今日」時間清單（方案 A demo，2026-11）：原「今日訂位」「團體」兩籤併成一條依時間排的清單。
// 直接用 `?demo=ops` 假資料（dev server 才有）驗收：
//   1) 散客與甲乙兩團的梯次列混在同一條清單；甲團第一梯＋司領桌在「已入座」、第二梯與乙團在「90 分內」
//   2) 點乙團列展開 → 梯次入座 → 該列移到「已入座」、地圖 101/102 用餐中
//   3) 「團體」籤已不存在；iPad 橫向（1180×820）列與動作鈕觸控高度 ≥ 44px、整頁不捲（捲動留在左欄內）
//   4) 整團完成 → 從時間線移到底部「已完成」區，展開仍可開回傳單
// 時間固定在當地 12:00（demo 的時段都由「現在」推算，避開跨午夜夾值）。

test.use({ timezoneId: 'Asia/Taipei', viewport: { width: 1180, height: 820 } })

test.beforeEach(async ({ page }) => {
  await page.route('https://**/*', route => route.abort())
  await page.route('**/adminPullData', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'e2e-offline' }) }))
  await page.route('**/adminPushData', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }))
  await page.route('**/admin*', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false }) }))
  const d = new Date()
  const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  await page.clock.setFixedTime(new Date(`${ymd}T12:00:00+08:00`))
})

test('?demo=ops：散客＋甲乙兩團同一條時間清單 → 點開乙團梯次入座 → 移到已入座', async ({ page }) => {
  // 帶 ?demo=ops 開頁：掛載前灌假資料（main.jsx，只在 dev）。掛在 /login 上——/admin* 已被上面的路由攔截
  await page.goto('/login?demo=ops')
  await page.getByPlaceholder('your@email.com').fill('berrylin0911@gmail.com')
  await page.getByRole('button', { name: /模擬登入/ }).click()
  await expect(page).toHaveURL(/\/admin/)
  await page.locator('aside').getByRole('button', { name: '現場' }).click()

  // 團體籤已移除；「今日」籤徽章含團體未入座梯次
  await expect(page.getByRole('button', { name: /^團體\s*\d*$/ })).toHaveCount(0)
  await todayTab(page).click()

  const soon = page.locator('[data-section="soon"]')
  const seated = page.locator('[data-section="seated"]')
  // 90 分內：散客（吳小姐／張先生／李家）與乙團、甲團第二梯混在一起
  await expect(soon.locator('[data-group-batch="GOPSDEMO-B:BTOPSDEMO-B1"]')).toBeVisible()
  await expect(soon.locator('[data-group-batch="GOPSDEMO-A:BTOPSDEMO-A2"]')).toBeVisible()
  await expect(soon.locator('[data-booking-id]')).toHaveCount(3)
  await expect(soon.locator('[data-group-batch="GOPSDEMO-A:BTOPSDEMO-A2"]')).toContainText('2/2 梯')
  // 已入座（預設收合）：展開後甲團第一梯與司領桌跟散客 SeatedRow 一起列
  await seated.getByRole('button', { name: /已入座/ }).click()
  await expect(seated.locator('[data-group-batch="GOPSDEMO-A:BTOPSDEMO-A1"]')).toContainText('用餐中 3 桌')
  await expect(seated.locator('[data-group-batch="GOPSDEMO-A:BTOPSDEMO-AE"]')).toContainText('司領')

  // 列高接近散客卡片、觸控 ≥ 44px
  const header = page.locator('[data-group-batch="GOPSDEMO-B:BTOPSDEMO-B1"] > button[aria-expanded]')
  expect((await header.boundingBox()).height).toBeGreaterThanOrEqual(44)

  // 點開乙團 → 梯次入座（確認框）→ 列移到已入座、仍展開、改給「梯次離席」
  const row = await openGroupRow(page, '山城旅遊')
  await expect(row).toContainText('導遊 陳導')
  const seatBtn = row.getByRole('button', { name: '梯次入座' })
  expect((await seatBtn.boundingBox()).height).toBeGreaterThanOrEqual(44)
  await seatBtn.click()
  await expect(page.getByText(/整梯 2 桌：101、102/)).toBeVisible()
  await page.getByRole('button', { name: '確認入座', exact: true }).click()
  await expect(page.getByText(/山城旅遊 第一梯 已入座/)).toBeVisible()
  await expect(seated.locator('[data-group-batch="GOPSDEMO-B:BTOPSDEMO-B1"]')).toContainText('用餐中 2 桌')
  await expect(soon.locator('[data-group-batch="GOPSDEMO-B:BTOPSDEMO-B1"]')).toHaveCount(0)
  await expect(seated.locator('[data-group-batch="GOPSDEMO-B:BTOPSDEMO-B1"]').getByRole('button', { name: '梯次離席' })).toBeVisible()
  const t101 = await page.evaluate(() => JSON.parse(localStorage.getItem('chicken_tables_v3') || '[]').find(t => t.number === '101'))
  expect(t101).toMatchObject({ status: 'dining', currentRef: { groupId: 'GOPSDEMO-B', batchId: 'BTOPSDEMO-B1' } })

  // 一面式：整頁不捲，捲動留在左欄內
  const pageScrolls = await page.evaluate(() => document.scrollingElement.scrollHeight > window.innerHeight + 1)
  expect(pageScrolls).toBe(false)
})

test('整團完成後移到「已完成」區，展開仍可開回傳單', async ({ page }) => {
  await page.goto('/login?demo=ops')
  await page.getByPlaceholder('your@email.com').fill('berrylin0911@gmail.com')
  await page.getByRole('button', { name: /模擬登入/ }).click()
  await expect(page).toHaveURL(/\/admin/)
  await page.locator('aside').getByRole('button', { name: '現場' }).click()
  await todayTab(page).click()

  const done = page.locator('[data-section="done"]')
  await expect(done).toHaveCount(0)

  const row = await openGroupRow(page, '山城旅遊')
  await row.getByRole('button', { name: '梯次入座' }).click()
  await page.getByRole('button', { name: '確認入座', exact: true }).click()
  await expect(page.getByText(/山城旅遊 第一梯 已入座/)).toBeVisible()
  await page.locator('[data-group-batch="GOPSDEMO-B:BTOPSDEMO-B1"]').getByRole('button', { name: '整團完成' }).click()
  await page.getByRole('button', { name: '完成釋桌', exact: true }).click()

  await expect(page.locator('[data-group-batch="GOPSDEMO-B:BTOPSDEMO-B1"]')).toHaveCount(0)
  await page.getByLabel('清除搜尋').click()
  const toggle = done.getByRole('button', { name: /已完成（1）/ })
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  expect((await toggle.boundingBox()).height).toBeGreaterThanOrEqual(44)
  await toggle.click()
  await expect(done).toContainText('山城旅遊')
  await expect(done.getByRole('button', { name: '梯次入座' })).toHaveCount(0)

  const print = done.getByRole('button', { name: '回傳單', exact: true })
  const box = await print.boundingBox()
  expect(box.height).toBeGreaterThanOrEqual(44)
  expect(box.width).toBeGreaterThanOrEqual(44)
  await print.click()
  await expect(page.getByRole('button', { name: '存成圖片（傳 LINE）' })).toBeVisible()
})
