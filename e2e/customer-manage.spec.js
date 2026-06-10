import { test, expect } from '@playwright/test'

// 用戶端查詢/修改訂位主線：開管理連結 → 驗證電話末碼 → 改時段 / 取消。
// ManageBookingPage 透過後端 guestGetBooking / guestGetAvailability / guestUpdateBooking /
// guestCancelBooking 運作；全程攔截這些端點回假資料（不打正式 Cloud Functions）。

function ymdPlusDays(n) {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// 用餐日設在 3 天後 → 必定 >2 小時、可線上修改
const DATE = ymdPlusDays(3)
const BOOKING = {
  id: 'E2E-MNG-1', name: '李小華', phone: '0912345678', guests: 2,
  date: DATE, timeSlot: '18:00', status: 'confirmed', manageToken: 'tok-e2e',
  notes: { pet: false, child: false, mobility: false, text: '' }, createdBy: 'guest',
}
const AVAILABILITY = {
  ok: true,
  slots: [{ time: '12:00', remaining: 40 }, { time: '18:00', remaining: 40 }, { time: '18:30', remaining: 20 }],
  settings: { maxDaysAhead: 30, diningDurationMin: 90, cleanupBufferMin: 10 },
}

// LINE 通知已改由後端 guestUpdate/guestCancel 權威送出：前端不得再打 linePushBooking
// （否則部署共存期外的正常狀態也會重複推播）。計數攔截、事後斷言為 0。
let linePushCalls = 0

test.beforeEach(async ({ page }) => {
  linePushCalls = 0
  await page.route(/linepushbooking/i, route => {
    linePushCalls += 1
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
  })
  await page.route('**/guestGetBooking', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, booking: BOOKING }) }))
  await page.route('**/guestGetAvailability', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(AVAILABILITY) }))
  await page.route('**/guestUpdateBooking', route => {
    const { patch } = route.request().postDataJSON() || {}
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, booking: { ...BOOKING, ...patch } }) })
  })
  await page.route('**/guestCancelBooking', route => {
    const { reason } = route.request().postDataJSON() || {}
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, booking: { ...BOOKING, status: 'cancelled', cancellationReason: { source: 'guest', reason } } }) })
  })
  await page.route('**/admin*', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false }) }))
})

async function openAndVerify(page) {
  await page.goto('/manage/E2E-MNG-1?token=tok-e2e')
  // 驗證電話末碼（末 3 碼 678）
  await page.getByPlaceholder('例如 678').fill('678')
  await page.getByRole('button', { name: '進入訂位管理' }).click()
  // 進入管理首頁（三張動作卡）
  await expect(page.getByRole('button', { name: /修改日期/ })).toBeVisible()
}

test('用戶端：驗證末碼 → 改時段 → 更新成功', async ({ page }) => {
  await openAndVerify(page)

  await page.getByRole('button', { name: /修改日期/ }).click()
  // 選一個與原訂不同的時段（原 18:00 → 改 18:30）
  await page.getByRole('button', { name: /18:30/ }).click()
  await page.getByRole('button', { name: '確認修改' }).click()

  await expect(page.getByRole('heading', { name: '訂位已更新' })).toBeVisible()
  expect(linePushCalls).toBe(0)
})

test('用戶端：驗證末碼 → 取消訂位 → 取消成功', async ({ page }) => {
  await openAndVerify(page)

  await page.getByRole('button', { name: '取消訂位' }).click()
  await page.getByRole('button', { name: '行程改變' }).click()
  await page.getByRole('button', { name: '確認取消訂位' }).click()
  // 危險操作確認對話框
  await page.getByRole('button', { name: '確定取消' }).click()

  await expect(page.getByRole('heading', { name: '訂位已取消' })).toBeVisible()
  expect(linePushCalls).toBe(0)
})

test('用戶端：已綁定 LINE 的訂位 → 顯示綁定狀態與重新傳送，不顯示綁定 CTA', async ({ page }) => {
  // 覆蓋 guestGetBooking：回已綁定 LINE 的訂位（後註冊的 route 優先生效）
  const BOUND = { ...BOOKING, lineUserId: 'U-e2e-bound', lineDisplayName: '綠綠', linePushBlocked: false }
  await page.route('**/guestGetBooking', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, booking: BOUND }) }))

  await openAndVerify(page)

  await expect(page.getByText('已綁定 LINE：綠綠')).toBeVisible()
  await expect(page.getByRole('button', { name: '重新傳送訂位資訊' })).toBeVisible()
  await expect(page.getByRole('link', { name: '綁定 LINE 訂位通知' })).toHaveCount(0)
})

test('用戶端：LINE 推播被拒的訂位 → 顯示重加好友警示', async ({ page }) => {
  const BLOCKED = { ...BOOKING, lineUserId: 'U-e2e-blocked', lineDisplayName: '小黑', linePushBlocked: true }
  await page.route('**/guestGetBooking', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, booking: BLOCKED }) }))

  await openAndVerify(page)

  await expect(page.getByText('LINE 通知暫時無法送達')).toBeVisible()
  await expect(page.getByRole('link', { name: '重新加入好友' })).toBeVisible()
})
