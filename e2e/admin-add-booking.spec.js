import { test, expect } from '@playwright/test'

// 後台新增訂位（緊湊單頁＋缺漏清單）主線：
// 缺漏欄位即時列在底部按鈕（還差：電話、姓名、時段）→ 逐項補齊（日期用「明天」chip）
// → 按鈕轉綠可提交 → 建立成功。
// 後台本機模式以 localStorage 為後端；攔截 admin* 雲端端點。

test.beforeEach(async ({ page }) => {
  await page.route('**/adminPullData', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'e2e-offline' }) }))
  await page.route('**/adminPushData', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }))
  await page.route('**/admin*', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false }) }))
  await page.addInitScript(() => {
    localStorage.setItem('chicken_bookings_v1', JSON.stringify([]))
  })
})

test('新增訂位：缺漏清單即時提示 → 補齊 → 建立成功', async ({ page }) => {
  await page.goto('/login')
  await page.getByPlaceholder('your@email.com').fill('berrylin0911@gmail.com')
  await page.getByRole('button', { name: /模擬登入/ }).click()
  await expect(page).toHaveURL(/\/admin/)

  // 進「新增」sub-tab
  await page.getByRole('button', { name: /新增/ }).click()

  // 初始：人數預設 2、日期預設今天 → 還差 電話、姓名、時段
  const submit = page.getByRole('button', { name: /還差：電話、姓名、時段/ })
  await expect(submit).toBeVisible()
  await expect(submit).toBeDisabled()

  // 補電話、姓名 → 缺漏縮減為「時段」
  await page.getByPlaceholder('0912345678').fill('0933111222')
  await page.getByPlaceholder('王小姐').fill('測試客')
  await expect(page.getByRole('button', { name: /還差：時段/ })).toBeVisible()

  // 日期點「明天」chip（避免今天的過時時段干擾）→ 選 18:00
  await page.getByRole('button', { name: /^明天/ }).click()
  await page.getByRole('button', { name: /18:00/ }).click()

  // 按鈕轉為可提交（含日期+時段+人數摘要）
  const confirmBtn = page.getByRole('button', { name: /✅ 確認新增 · .*18:00 · 2 位/ })
  await expect(confirmBtn).toBeEnabled()
  await confirmBtn.click()

  // 建立成功（未來日 → 一般建立 toast，附「預配桌位」捷徑）
  await expect(page.getByText(/測試客 2 位 · .*18:00 已建立/)).toBeVisible()
})
