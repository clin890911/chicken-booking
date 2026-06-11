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
  // 兜底安全網（先註冊 → 最後匹配）：任何未被下方明確攔截的 guest* 端點一律擋下，
  // 確保就算之後頁面多打了新端點，也絕不會送到正式 Cloud Functions。
  await page.route('**/guest*', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'e2e-blocked' }) }))
  // BookingPage 的 LIFF 靜默偵測會嘗試載入 LINE SDK——攔掉確保離線確定性
  // （載入失敗＝靜默降級，正是非 LIFF 環境的預期行為）。
  await page.route('https://static.line-scdn.net/**', route => route.abort())
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

  // 送出 → 導向確認頁；確認頁須有「截圖或綁定 LINE」引導（rich menu 查詢流程的入口文案）
  await page.getByRole('button', { name: '完成訂位' }).click()
  await expect(page).toHaveURL(/\/confirm\/E2E-CUS-1/)
  await expect(page.getByText(/建議截圖保存此頁/)).toBeVisible()
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

// === 手機版主流程 @mobile ===
// 手機（lg 以下）顧客實際操作的是 fixed 底欄 MobileActionBar，桌面摘要卡完全隱藏。
// 2026-06 手機白屏 bug（AnimatePresence mode="wait" exit 回呼遺失 → 步驟切換後新內容永不掛載，
// PR #19 修復）只在這條動線觸發，桌面 viewport 永遠測不到。此測試在真機尺寸走完整流程，
// 並以「1 秒內可見」斷言防衛「步驟切換後內容未掛載」的迴歸。
test.describe('手機版 @mobile', () => {
  test('換日期 → 改選時段兩次 → 底欄進入聯絡資訊（1 秒內掛載）→ 完成訂位', async ({ page }) => {
    await page.goto('/book')

    // 手機尺寸下底欄必須可見（桌面摘要卡 hidden lg:block 不可見）
    const bar = page.getByTestId('mobile-action-bar')
    await expect(bar).toBeVisible()

    // 等今天的可訂時段載入
    await expect(page.getByRole('button', { name: /12:00 抵達/ })).toBeVisible()

    // 換日期：點月曆上的「明天」（cell 的 aria-label 由 dayLabel 組成，必為可預訂）
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    const weekday = ['日', '一', '二', '三', '四', '五', '六'][tomorrow.getDay()]
    await page.getByRole('button', { name: `${tomorrow.getMonth() + 1}/${tomorrow.getDate()} (${weekday})，可預訂` }).click()

    // 換日期會清空已選時段 → 底欄 CTA 退回 disabled 狀態
    await expect(bar.getByRole('button', { name: '請先選擇可訂時段' })).toBeDisabled()

    // 改選時段兩次：先 12:00、再改 18:00，底欄摘要應跟著更新
    await page.getByRole('button', { name: /12:00 抵達/ }).click()
    await page.getByRole('button', { name: /18:00 抵達/ }).click()
    await expect(bar).toContainText('18:00')

    // 點底欄「填寫聯絡資訊」→ 聯絡資訊表單必須在 1 秒內可見（白屏迴歸防線）
    await bar.getByRole('button', { name: '填寫聯絡資訊' }).click()
    await expect(page.getByPlaceholder('王小姐')).toBeVisible({ timeout: 1000 })

    // 底欄「修改」返回選時段 → 反向切換的內容同樣必須在 1 秒內掛載
    await bar.getByRole('button', { name: '修改' }).click()
    await expect(page.getByRole('button', { name: /18:00 抵達/ })).toBeVisible({ timeout: 1000 })

    // 再前進一次，填資料並由底欄送出 → 進入確認頁
    await bar.getByRole('button', { name: '填寫聯絡資訊' }).click()
    await expect(page.getByPlaceholder('王小姐')).toBeVisible({ timeout: 1000 })
    await page.getByPlaceholder('王小姐').fill('E2E 手機客')
    await page.getByPlaceholder('0912345678').fill('0912345678')
    await bar.getByRole('button', { name: '完成訂位' }).click()
    await expect(page).toHaveURL(/\/confirm\/E2E-CUS-1/)
  })
})
