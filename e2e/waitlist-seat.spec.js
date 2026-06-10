import { test, expect } from '@playwright/test'

// 管理端候位主線（候位已併入「現場」頁右側欄）：
// 同仁登入 → 現場分頁 → 右側欄「候位」籤 → 新增取號 → 叫號 → 入座（A6 二步確認）→ 入座成功。
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

test('管理端：現場頁內 取號 → 叫號 → 入座（二步確認）→ 入座成功', async ({ page }) => {
  // 登入
  await page.goto('/login')
  await page.getByPlaceholder('your@email.com').fill('berrylin0911@gmail.com')
  await page.getByRole('button', { name: /模擬登入/ }).click()
  await expect(page).toHaveURL(/\/admin/)

  // 進現場分頁（鎖定側邊欄，避免與訂位來源篩選的「現場」chip 撞名）→ 右側欄切到「候位」籤
  await page.locator('aside').getByRole('button', { name: '現場' }).click()
  await page.getByRole('button', { name: '候位', exact: true }).click()

  // 新增取號
  await page.getByRole('button', { name: '新增取號' }).click()
  await page.getByPlaceholder('王小姐').fill('候位王')
  await page.getByRole('button', { name: '取號', exact: true }).click()

  // 候位卡出現在右側欄
  await expect(page.getByText('候位王').first()).toBeVisible()

  // 叫號
  await page.getByRole('button', { name: '叫號', exact: true }).click()

  // 入座 → 頁內直接進入「候位入座」模式（不再跨分頁）
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

  // 歷史 Sheet 可查到已入座記錄（先 ESC 關閉桌位詳情抽屜，右側欄才會回到候位籤）
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '歷史', exact: true }).click()
  await expect(page.getByText('候位歷史與統計')).toBeVisible()
  await expect(page.getByText(/入座 \d+/).first()).toBeVisible()
})
