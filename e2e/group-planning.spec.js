import { test, expect } from '@playwright/test'

// 團體預排主線：同仁登入 → 團體分頁 → 預排規劃（分階段導覽）。
// 階段：① 選日期 → ② 當日總覽（新增團單 在此）→ ③ 編輯精靈。
// 後台在「本機開發模式」(無 Firebase) 以 localStorage 為後端；攔截 admin* 雲端端點避免碰正式後端。
// 覆蓋兩個重點（草稿優先後更強）：
//   1) 反覆「新增團單→返回」不會在資料庫留下任何空白團單（草稿不落地）
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

  // 清空團體資料 + 預先標記清除旗標（避免清除提示干擾），確保每次測試從乾淨狀態開始
  await page.addInitScript(() => {
    localStorage.setItem('chicken_group_reservations_v1', JSON.stringify([]))
    localStorage.setItem('chicken_group_blank_purge_v1', '1')
  })
})

// 登入 → 團體 → 預排規劃（階段一）→ 點「今天」進入階段二（當日總覽）
async function loginAndOpenDayStage(page) {
  await page.goto('/login')
  await page.getByPlaceholder('your@email.com').fill('berrylin0911@gmail.com')
  await page.getByRole('button', { name: /模擬登入/ }).click()
  await expect(page).toHaveURL(/\/admin/)
  await page.locator('button').filter({ hasText: '團體' }).first().click()
  // 階段一：選日期 → 點「今天」日期卡
  await page.getByRole('button', { name: /今天/ }).first().click()
  // 階段二：當日總覽，「新增團單」可見
  await expect(page.getByRole('button', { name: /新增團單/ })).toBeVisible()
}

test('團體：反覆「新增團單→返回」不留任何空白團單', async ({ page }) => {
  await loginAndOpenDayStage(page)

  // 初始：當日無任何團卡
  await expect(page.getByText('這天還沒有團單', { exact: false })).toBeVisible()
  await expect(page.getByText('（未填旅行社）')).toHaveCount(0)

  // 反覆「新增（進編輯精靈）→ 返回」：草稿在記憶體、不落地，回來後仍 0 卡
  for (let i = 0; i < 3; i++) {
    await page.getByRole('button', { name: /新增團單/ }).click()
    await expect(page.getByRole('button', { name: /返回當日總覽/ })).toBeVisible()
    await page.getByRole('button', { name: /返回當日總覽/ }).click()
    await expect(page.getByText('這天還沒有團單', { exact: false })).toBeVisible()
  }
  await expect(page.getByText('（未填旅行社）')).toHaveCount(0)
})

test('團體：空白團單不能儲存（驗證擋下）', async ({ page }) => {
  await loginAndOpenDayStage(page)
  await page.getByRole('button', { name: /新增團單/ }).click()
  // 跳到「確認」步驟直接按儲存 → 應跳驗證錯誤（先要求旅行社），且不出現成功訊息
  await page.getByRole('button', { name: /4\.\s*確認/ }).click()
  await page.getByRole('button', { name: /儲存團單/ }).click()
  await expect(page.getByText(/請選擇或新增旅行社/)).toBeVisible()
  await expect(page.getByText(/團單已儲存/)).toHaveCount(0)
})
