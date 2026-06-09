import { test, expect } from '@playwright/test'

// 管理端候位主線：同仁登入 → 候位分頁 → 新增取號 → 叫號 → 入座（A6 二步確認）→ 入座成功。
// 後台本機模式以 localStorage 為後端；攔截 admin* 雲端端點，避免雲端 pull 覆蓋、也不碰正式後端。

test.beforeEach(async ({ page }) => {
  await page.route('**/adminPullData', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'e2e-offline' }) }))
  await page.route('**/adminPushData', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }))
  await page.route('**/admin*', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false }) }))
  // 清掉殘留候位，確保取號序號從 #1 開始
  await page.addInitScript(() => {
    localStorage.removeItem('chicken_waitlist_v1')
    localStorage.removeItem('chicken_bookings_v1')
  })
})

test('管理端：取號 → 叫號 → 入座（二步確認）→ 入座成功', async ({ page }) => {
  // 登入
  await page.goto('/login')
  await page.getByPlaceholder('your@email.com').fill('berrylin0911@gmail.com')
  await page.getByRole('button', { name: /模擬登入/ }).click()
  await expect(page).toHaveURL(/\/admin/)

  // 進候位分頁
  await page.getByRole('button', { name: '候位' }).click()

  // 新增取號
  await page.getByRole('button', { name: '新增取號' }).click()
  await page.getByPlaceholder('王小姐').fill('候位王')
  await page.getByRole('button', { name: '取號', exact: true }).click()

  // 候位卡出現
  await expect(page.getByText('候位王').first()).toBeVisible()

  // 叫號
  await page.getByRole('button', { name: '叫號', exact: true }).click()

  // 入座 → 切到桌位頁、進入「候位入座」模式
  await page.getByRole('button', { name: '入座', exact: true }).click()
  await expect(page.getByText(/候位入座：候位王/)).toBeVisible()

  // 讀建議桌號 → 點該桌 → 二步確認 → 入座成功
  const suggestChip = page.getByText(/💡\s*建議\s*\d+/)
  await expect(suggestChip).toBeVisible()
  const tableNo = ((await suggestChip.textContent()).match(/\d+/) || [])[0]
  expect(tableNo).toBeTruthy()

  await page.locator(`svg g:has(:text-is("${tableNo}"))`).first().click()
  await expect(page.getByText(new RegExp(`確認指派 候位王 至桌 ${tableNo}`))).toBeVisible()
  await page.getByRole('button', { name: /確認指派/ }).click()
  await expect(page.getByText(/入座.*可指派下一組/)).toBeVisible()
})
