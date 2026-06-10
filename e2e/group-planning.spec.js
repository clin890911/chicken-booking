import { test, expect } from '@playwright/test'

// 規劃分頁主線：同仁登入 → 規劃（月曆+當日總覽一頁式，預設選今日）→ 編輯精靈（2 頁式）。
// 後台在「本機開發模式」(無 Firebase) 以 localStorage 為後端；攔截 admin* 雲端端點避免碰正式後端。
// 覆蓋三個重點：
//   1) 反覆「新增團單→返回」不會留下任何空白團單（草稿不落地）
//   2) 空白團單過不了驗證（第一頁就擋：請選擇或新增旅行社）
//   3) 當日總覽 ⇄ 排位地圖 三態切換（規劃分頁合併後的新動線）

test.beforeEach(async ({ page }) => {
  await page.route('**/adminPullData', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'e2e-offline' }) }))
  await page.route('**/adminPushData', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }))
  await page.route('**/admin*', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false }) }))
  await page.route('**/groupReserveTables', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }))

  // 清空團體資料 + 預先標記清除旗標（避免清除提示干擾），確保每次測試從乾淨狀態開始
  await page.addInitScript(() => {
    localStorage.setItem('chicken_group_reservations_v1', JSON.stringify([]))
    localStorage.setItem('chicken_group_blank_purge_v1', '1')
  })
})

// 登入 → 規劃分頁（預設 day 態：月曆 + 當日總覽，selectedDate 即今日）
async function loginAndOpenPlanning(page) {
  await page.goto('/login')
  await page.getByPlaceholder('your@email.com').fill('berrylin0911@gmail.com')
  await page.getByRole('button', { name: /模擬登入/ }).click()
  await expect(page).toHaveURL(/\/admin/)
  await page.locator('aside').getByRole('button', { name: '規劃' }).click()
  // 當日總覽直接可見「新增團單」
  await expect(page.getByRole("button", { name: /新增團單/ }).first()).toBeVisible()
}

test('規劃：反覆「新增團單→返回」不留任何空白團單', async ({ page }) => {
  await loginAndOpenPlanning(page)

  // 初始：當日無任何團卡（有場次時顯示各場次「本場次尚無團單」）
  await expect(page.getByText('本場次尚無團單').first()).toBeVisible()
  await expect(page.getByText('（未填旅行社）')).toHaveCount(0)

  // 反覆「新增（進編輯精靈）→ 返回」：草稿在記憶體、不落地，回來後仍 0 卡
  for (let i = 0; i < 3; i++) {
    await page.getByRole("button", { name: /新增團單/ }).first().click()
    await expect(page.getByRole('button', { name: /返回當日總覽/ })).toBeVisible()
    await page.getByRole('button', { name: /返回當日總覽/ }).click()
    await expect(page.getByText('本場次尚無團單').first()).toBeVisible()
  }
  await expect(page.getByText('（未填旅行社）')).toHaveCount(0)
})

test('規劃：空白團單過不了驗證（第一頁就擋）', async ({ page }) => {
  await loginAndOpenPlanning(page)
  await page.getByRole("button", { name: /新增團單/ }).first().click()
  // 2 頁式精靈：未選旅行社就點「下一步：圈選座位」→ 驗證擋下、停在第一頁
  await page.getByRole('button', { name: /下一步：圈選座位/ }).click()
  await expect(page.getByText(/請選擇或新增旅行社/)).toBeVisible()
  await expect(page.getByText(/團單已儲存/)).toHaveCount(0)
})

test('規劃：當日總覽 ⇄ 排位地圖 切換共享同一天', async ({ page }) => {
  await loginAndOpenPlanning(page)

  // 切到排位地圖（頂部 segmented control）→ 場次選擇與日期列可見
  await page.getByRole('button', { name: /排位地圖/ }).first().click()
  await expect(page.getByText('場次（批次）')).toBeVisible()
  await expect(page.getByRole('button', { name: /前一日/ })).toBeVisible()
  await expect(page.getByText(/全店座位/)).toBeVisible()

  // 換日仍在地圖態
  await page.getByRole('button', { name: /後一日/ }).click()
  await expect(page.getByText('場次（批次）')).toBeVisible()

  // 切回當日總覽 → 月曆與新增團單回來
  await page.getByRole('button', { name: /當日總覽/ }).first().click()
  await expect(page.getByRole("button", { name: /新增團單/ }).first()).toBeVisible()
})
