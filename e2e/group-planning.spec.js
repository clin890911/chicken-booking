import { test, expect } from '@playwright/test'

// 團體預排主線：同仁登入 → 團體分頁 → 預排規劃。
// 後台在「本機開發模式」(無 Firebase) 以 localStorage 為後端；攔截 admin* 雲端端點避免碰正式後端。
// 覆蓋兩個重點修正：
//   1) 連點「新增團單」不會產生多筆空白團單
//   2) 空白團單不能儲存（驗證擋下）

test.beforeEach(async ({ page }) => {
  await page.route('**/adminPullData', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'e2e-offline' }) }))
  await page.route('**/adminPushData', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }))
  await page.route('**/admin*', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false }) }))
  await page.route('**/groupReserveTables', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }))

  // 清空團體資料，確保每次測試從乾淨狀態開始
  await page.addInitScript(() => {
    localStorage.setItem('chicken_group_reservations_v1', JSON.stringify([]))
  })
})

async function loginAndOpenPlanning(page) {
  await page.goto('/login')
  await page.getByPlaceholder('your@email.com').fill('berrylin0911@gmail.com')
  await page.getByRole('button', { name: /模擬登入/ }).click()
  await expect(page).toHaveURL(/\/admin/)
  await page.locator('button').filter({ hasText: '團體' }).first().click()
  await expect(page.getByRole('button', { name: /新增團單/ })).toBeVisible()
}

test('團體：連點「新增團單」不會產生重複空白團單', async ({ page }) => {
  await loginAndOpenPlanning(page)
  const addBtn = page.getByRole('button', { name: /新增團單/ })
  // 連續點擊多次（同步鎖 + 空白草稿守衛應只留 1 筆空白團單）
  await addBtn.click()
  await addBtn.click()
  await addBtn.click()
  // 左側列表只應有一張「（未填旅行社）」空白團單卡
  await expect(page.getByText('（未填旅行社）')).toHaveCount(1)
})

test('團體：空白團單不能儲存（驗證擋下）', async ({ page }) => {
  await loginAndOpenPlanning(page)
  await page.getByRole('button', { name: /新增團單/ }).click()
  // 直接按儲存 → 應跳驗證錯誤（先要求旅行社），且不出現成功訊息
  await page.getByRole('button', { name: /儲存團單/ }).click()
  await expect(page.getByText(/請選擇或新增旅行社/)).toBeVisible()
  await expect(page.getByText(/團單已儲存/)).toHaveCount(0)
})
