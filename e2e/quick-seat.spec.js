import { test, expect } from '@playwright/test'

// 現場「立即帶位」主線（客人優先快速入座）：
// 同仁登入 → 現場分頁 → 頂部「🪑 立即帶位」→ 填人數/姓名 → 「選座位」進選桌模式
// → 讀建議桌 → 點該桌（二步確認）→ 確認帶位 → 入座成功（桌轉用餐中）。
// 後台本機模式以 localStorage 為後端；攔截 admin* 雲端端點。

test.beforeEach(async ({ page }) => {
  await page.route('**/adminPullData', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'e2e-offline' }) }))
  await page.route('**/adminPushData', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }))
  await page.route('**/admin*', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false }) }))
  await page.addInitScript(() => {
    localStorage.removeItem('chicken_waitlist_v1')
    localStorage.removeItem('chicken_bookings_v1')
    localStorage.removeItem('chicken_group_reservations_v1')
  })
})

test('現場：立即帶位 填人數/姓名 → 選建議桌（二步確認）→ 入座成功', async ({ page }) => {
  await page.goto('/login')
  await page.getByPlaceholder('your@email.com').fill('berrylin0911@gmail.com')
  await page.getByRole('button', { name: /模擬登入/ }).click()
  await expect(page).toHaveURL(/\/admin/)

  // 進現場分頁（鎖定側邊欄）
  await page.locator('aside').getByRole('button', { name: '現場' }).click()

  // 頂部「立即帶位」→ 開表單
  await page.getByRole('button', { name: /立即帶位/ }).click()

  // 填人數（chip 4）+ 姓名。現場左欄同時有電話大鍵盤（aria-label 為數字），
  // 人數 chips 以「N 位」為 accessible name 區分，避免與鍵盤數字鍵歧義。
  await page.getByRole('button', { name: '4 位', exact: true }).click()
  await page.getByPlaceholder('散客').fill('現場張')

  // 「選座位 →」進選桌模式：banner 顯示立即帶位 + 建議桌
  await page.getByRole('button', { name: /選座位/ }).click()
  await expect(page.getByText(/立即帶位：現場張 4 位/)).toBeVisible()

  const suggestChip = page.getByText(/💡\s*建議\s*\d+/)
  await expect(suggestChip).toBeVisible()
  const tableNo = ((await suggestChip.textContent()).match(/\d+/) || [])[0]
  expect(tableNo).toBeTruthy()

  // 點建議桌 → 二步確認 → 確認帶位 → 成功
  await page.locator(`svg g:has(:text-is("${tableNo}"))`).first().click()
  await expect(page.getByText(new RegExp(`確認帶 現場張 入座桌 ${tableNo}`))).toBeVisible()
  await page.getByRole('button', { name: /確認帶位/ }).click()
  await expect(page.getByText(/現場張（4 位）入座.*可帶下一組/)).toBeVisible()
})
