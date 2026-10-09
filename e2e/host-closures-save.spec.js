import { test, expect } from '@playwright/test'

// 訂位專員（host）在設定頁「休店 / 關閉時段管理」關閉後要能按儲存（店主實際用 iPad 以訂位專員帳號操作）。
// 本機模式（e2e 無 Firebase 設定）：登入身分由 localStorage chicken_auth_v1 模擬，直接種入 host 角色；
// 儲存走本機路徑（不推雲）。雲端推送的「只套關閉 key」由 tests/functions/settingsScope.test.js 驗。
// 所有後端端點一律攔截，不碰正式 Cloud Functions。

test.beforeEach(async ({ page }) => {
  // 只攔 Cloud Functions 端點（adminPullData／adminPushData…）；頁面本身 /admin 不可被攔。
  await page.route(url => /^\/admin[A-Z]/.test(url.pathname), route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'e2e-offline' }) }))
  await page.addInitScript(() => {
    if (sessionStorage.getItem('__e2e_seeded')) return
    sessionStorage.setItem('__e2e_seeded', '1')
    localStorage.removeItem('chicken_settings_v1')
    localStorage.setItem('chicken_auth_v1', JSON.stringify({
      email: 'berrylin0911@gmail.com', displayName: 'host-e2e', role: 'host', roleLabel: '訂位專員', loggedAt: new Date().toISOString(),
    }))
  })
})

async function openClosures(page) {
  await page.goto('/admin?tab=settings&section=ops-rules')
  await expect(page.getByText('訂位專員只能儲存「休店 / 關閉時段管理」')).toBeVisible()
  await page.getByRole('heading', { name: '休店 / 關閉時段管理' }).click()
  await expect(page.getByRole('button', { name: '設為整天公休' })).toBeVisible()
}

test('訂位專員：關閉整天 → 儲存休店／關閉設定 → 寫進本機設定、其他設定不動', async ({ page }) => {
  await openClosures(page)
  await expect(page.getByRole('button', { name: '儲存全部變更' })).toHaveCount(0)

  await page.getByRole('button', { name: '設為整天公休' }).click()
  const save = page.getByRole('button', { name: '儲存休店／關閉設定' })
  await expect(save).toBeEnabled()
  await expect(page.getByText('訂位專員只能儲存休店／關閉設定，其他設定請用店長帳號。')).toBeVisible()
  await save.click()
  await expect(page.getByText('已儲存（本機模式）')).toBeVisible()
  await expect(save).toHaveCount(0)

  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('chicken_settings_v1')))
  expect(saved.closures.closedDates).toHaveLength(1)
  expect(saved.openTime).toBe('11:00') // 出廠預設，未被動到

  // 重新整理後仍在（＝真的存進去了，不是只有表單狀態）
  await page.reload()
  await page.getByRole('heading', { name: '休店 / 關閉時段管理' }).click()
  await expect(page.getByText('整天公休中').first()).toBeVisible()
})

test('訂位專員：同時改了營業時間 → 儲存鈕停用，還原其他設定後才可存', async ({ page }) => {
  await openClosures(page)
  await page.getByRole('button', { name: '設為整天公休' }).click()
  await page.getByRole('heading', { name: '營業時段' }).click()
  await page.getByLabel('開始時間').fill('09:00')
  const save = page.getByRole('button', { name: '儲存休店／關閉設定' })
  await expect(save).toBeDisabled()
  await page.getByRole('button', { name: '還原其他設定' }).click()
  await expect(save).toBeEnabled()
  await save.click()
  await expect(page.getByText('已儲存（本機模式）')).toBeVisible()
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('chicken_settings_v1')))
  expect(saved.openTime).not.toBe('09:00')
  expect(saved.closures.closedDates).toHaveLength(1)
})
