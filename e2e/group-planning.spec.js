import { test, expect } from '@playwright/test'

// 團體預排主線：同仁登入 → 側欄「團體」→ 預排規劃（一頁式主控台：左月曆 + 右當日總覽，預設選今天）。
// 「新增團單」在當日總覽 Hero；點擊進入編輯精靈（2 頁：① 團體資訊 → ② 圈選座位，儲存鈕在第 2 頁）。
// 後台在「本機開發模式」(無 Firebase) 以 localStorage 為後端；攔截 admin* 雲端端點避免碰正式後端。
// 覆蓋兩個重點（草稿優先）：
//   1) 反覆「新增團單→返回」不會在資料庫留下任何空白團單（草稿不落地）
//   2) 空白團單不能儲存（驗證在「下一步／圈選座位」就擋下，儲存鈕不可達、資料庫無落地）

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

// 登入 → 側欄「團體」→ 預排規劃主控台（預設選今天，當日總覽的「新增團單」直接可見）
async function loginAndOpenPlanning(page) {
  await page.goto('/login')
  await page.getByPlaceholder('your@email.com').fill('berrylin0911@gmail.com')
  await page.getByRole('button', { name: /模擬登入/ }).click()
  await expect(page).toHaveURL(/\/admin/)
  await page.locator('aside').getByRole('button', { name: '團體' }).click()
  await expect(page.getByRole('button', { name: '➕ 新增團單' })).toBeVisible()
}

// 直接讀本機後端：團單是否真的落地
async function storedGroups(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('chicken_group_reservations_v1') || '[]'))
}

test('團體：反覆「新增團單→返回」不留任何空白團單', async ({ page }) => {
  await loginAndOpenPlanning(page)

  // 初始：當日無任何團卡（預設場次存在 → 各場次顯示「本場次尚無團單」）
  await expect(page.getByText('本場次尚無團單').first()).toBeVisible()
  await expect(page.getByText('（未填旅行社）')).toHaveCount(0)

  // 反覆「新增（進編輯精靈）→ 返回」：草稿在記憶體、不落地，回來後仍 0 卡
  for (let i = 0; i < 3; i++) {
    await page.getByRole('button', { name: '➕ 新增團單' }).click()
    await expect(page.getByRole('button', { name: /返回當日總覽/ })).toBeVisible()
    await page.getByRole('button', { name: /返回當日總覽/ }).click()
    await expect(page.getByText('本場次尚無團單').first()).toBeVisible()
  }
  await expect(page.getByText('（未填旅行社）')).toHaveCount(0)
  expect(await storedGroups(page)).toHaveLength(0)
})

test('團體：空白團單不能儲存（驗證擋下）', async ({ page }) => {
  await loginAndOpenPlanning(page)
  await page.getByRole('button', { name: '➕ 新增團單' }).click()
  await expect(page.getByRole('button', { name: /返回當日總覽/ })).toBeVisible()

  // 空白草稿按「下一步」→ 驗證擋在第 1 頁（先要求旅行社），到不了有儲存鈕的第 2 頁
  await page.getByRole('button', { name: /下一步：圈選座位/ }).click()
  await expect(page.getByText(/請選擇或新增旅行社/).first()).toBeVisible()
  await expect(page.getByRole('button', { name: /儲存團單/ })).toHaveCount(0)

  // 直接點「2. 圈選座位」頁籤也一樣被擋
  await page.getByRole('button', { name: /2\.\s*圈選座位/ }).click()
  await expect(page.getByText(/請選擇或新增旅行社/).first()).toBeVisible()
  await expect(page.getByRole('button', { name: /儲存團單/ })).toHaveCount(0)

  // 沒有成功訊息、資料庫沒有任何團單落地
  await expect(page.getByText(/團單已儲存/)).toHaveCount(0)
  expect(await storedGroups(page)).toHaveLength(0)
})
