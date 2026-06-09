import { test, expect } from '@playwright/test'

// 用戶端訂位主線：選人數/日期/時段 → 填聯絡資訊 → 送出 → 進入確認頁。
// BookingPage 透過後端 guestGetAvailability / guestCreateBooking 取得可訂時段與建立訂位，
// 故全程攔截這兩個端點回傳假資料（不打正式 Cloud Functions、結果可重複）。

const AVAILABILITY = {
  ok: true,
  slots: [
    { time: '12:00', remaining: 40 },
    { time: '18:00', remaining: 40 },
    { time: '18:30', remaining: 8 },
  ],
  settings: { maxDaysAhead: 30, diningDurationMin: 90, cleanupBufferMin: 10, openTime: '11:00', closeTime: '19:00' },
}

test.beforeEach(async ({ page }) => {
  // 攔截可訂時段查詢
  await page.route('**/guestGetAvailability', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(AVAILABILITY) }))
  // 攔截建立訂位，回傳一筆含 id + manageToken 的訂位
  await page.route('**/guestCreateBooking', route => {
    const payload = route.request().postDataJSON() || {}
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ ok: true, booking: { id: 'E2E-CUS-1', manageToken: 'tok-e2e', status: 'confirmed', source: 'online', ...payload } }),
    })
  })
  // 安全網：任何其他 function 端點都擋掉，避免誤打正式後端
  await page.route('**/admin*', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false }) }))
})

test('用戶端：選時段 → 填資料 → 送出 → 進入確認頁', async ({ page }) => {
  await page.goto('/book')

  // 等可訂時段載入（mock 回 12:00 / 18:00 / 18:30）
  const slot = page.getByRole('button', { name: /18:00 抵達/ })
  await expect(slot).toBeVisible()
  await slot.click()

  // 進到「填寫聯絡資訊」步驟（桌面版摘要卡的 CTA）
  await page.getByRole('button', { name: '填寫聯絡資訊' }).click()

  // 填姓名 / 電話（用 placeholder 定位，ui Input 未綁 label）
  await page.getByPlaceholder('王小姐').fill('E2E 測試客')
  await page.getByPlaceholder('0912345678').fill('0912345678')

  // 送出 → 導向確認頁
  await page.getByRole('button', { name: '完成訂位' }).click()
  await expect(page).toHaveURL(/\/confirm\/E2E-CUS-1/)
})

test('用戶端：電話格式錯誤時擋下，無法送出', async ({ page }) => {
  await page.goto('/book')
  await page.getByRole('button', { name: /18:00 抵達/ }).click()
  await page.getByRole('button', { name: '填寫聯絡資訊' }).click()

  await page.getByPlaceholder('王小姐').fill('格式測試')
  await page.getByPlaceholder('0912345678').fill('0912abc345') // 含字母 → 不合法

  // canSubmit 為 false → 完成訂位鈕應為 disabled
  await expect(page.getByRole('button', { name: '完成訂位' })).toBeDisabled()
  // 仍停在 /book，未導向確認頁
  await expect(page).toHaveURL(/\/book/)
})
