import { test, expect } from '@playwright/test'

// LINE-first 訂位閉環：客人從 LINE rich menu（LIFF 內）開 /book，
// 已登入 → 靜默附帶 idToken → 後端訂位即綁定 → 確認頁直接顯示「已綁定」、無 CTA。
// 防回歸重點：
// 1) POST body 的 line 欄位只帶 idToken/displayName/pictureUrl/friendFlag（身分由後端驗 token）
// 2) LIFF 失敗時完全靜默降級——payload 無 line 欄位、訂位照常（絕不阻塞訂位）
// 3) 信任訊號只在有身分時顯示

const AVAILABILITY = {
  ok: true,
  slots: [{ time: '12:00', remaining: 40 }, { time: '18:00', remaining: 40 }],
  settings: { maxDaysAhead: 30, diningDurationMin: 90, cleanupBufferMin: 10, openTime: '11:00', closeTime: '19:00' },
}

let createBody = null

function stubLiff(page, { friendFlag = true, initFails = false } = {}) {
  return page.addInitScript(opts => {
    window.liff = {
      init: async () => { if (opts.initFails) throw new Error('liff-init-failed') },
      isLoggedIn: () => true,
      isInClient: () => true,
      getIDToken: () => 'fake-id-token',
      getDecodedIDToken: () => ({ exp: Math.floor(Date.now() / 1000) + 3600 }),
      getProfile: async () => ({ userId: 'U-liff-e2e', displayName: '綠綠', pictureUrl: 'https://p.example/a.jpg' }),
      getFriendship: async () => ({ friendFlag: opts.friendFlag }),
    }
  }, { friendFlag, initFails })
}

test.beforeEach(async ({ page }) => {
  createBody = null
  await page.route('**/guest*', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'e2e-blocked' }) }))
  await page.route('**/guestGetAvailability', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(AVAILABILITY) }))
  await page.route('**/guestCreateBooking', route => {
    createBody = route.request().postDataJSON() || {}
    const attached = !!createBody.line?.idToken
    const needFriend = createBody.line?.friendFlag === false
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        booking: {
          id: 'E2E-LIFF-1', manageToken: 'tok-liff', status: 'confirmed', source: 'online',
          ...createBody,
          // 模擬後端 attach 成功後合併的鏡像欄位
          ...(attached ? { lineUserId: 'U-liff-e2e', lineDisplayName: '綠綠', linePushBlocked: needFriend } : {}),
        },
      }),
    })
  })
  await page.route('**/admin*', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false }) }))
})

async function bookThrough(page) {
  await page.goto('/book')
  await page.getByRole('button', { name: /18:00 抵達/ }).click()
  await page.getByRole('button', { name: '填寫聯絡資訊' }).click()
  await page.getByPlaceholder('王小姐').fill('LIFF 測試客')
  await page.getByPlaceholder('0912345678').fill('0912345678')
}

test('LIFF 內訂位：信任訊號 → 送出帶 idToken → 確認頁直接顯示已綁定、無 CTA', async ({ page }) => {
  await stubLiff(page, { friendFlag: true })
  await bookThrough(page)

  // 信任訊號（已識別身分）
  await expect(page.getByText(/訂位卡片將自動傳送到您的 LINE（綠綠）/)).toBeVisible()

  await page.getByRole('button', { name: '完成訂位' }).click()
  await expect(page).toHaveURL(/\/confirm\/E2E-LIFF-1/)

  // POST body：line 欄位形狀正確，身分以 idToken 為準（不送 userId）
  expect(createBody.line).toEqual({
    idToken: 'fake-id-token',
    displayName: '綠綠',
    pictureUrl: 'https://p.example/a.jpg',
    friendFlag: true,
  })
  expect(createBody.line.userId).toBeUndefined()

  // 確認頁：已綁定狀態取代綁定 CTA
  await expect(page.getByText(/已綁定 LINE（綠綠）/)).toBeVisible()
  await expect(page.getByRole('link', { name: /加入並綁定 LINE 通知/ })).toHaveCount(0)
})

test('LIFF 內但未加好友：黃色提示 → 確認頁顯示重加好友警示', async ({ page }) => {
  await stubLiff(page, { friendFlag: false })
  await bookThrough(page)

  await expect(page.getByText(/完成訂位後加入官方帳號好友/)).toBeVisible()

  await page.getByRole('button', { name: '完成訂位' }).click()
  await expect(page).toHaveURL(/\/confirm\/E2E-LIFF-1/)
  expect(createBody.line.friendFlag).toBe(false)
  await expect(page.getByText(/LINE 通知暫時無法送達/)).toBeVisible()
})

test('LIFF init 失敗：靜默降級——無信任訊號、payload 無 line 欄位、訂位照常', async ({ page }) => {
  await stubLiff(page, { initFails: true })
  await bookThrough(page)

  await expect(page.getByText(/訂位卡片將自動傳送/)).toHaveCount(0)

  await page.getByRole('button', { name: '完成訂位' }).click()
  await expect(page).toHaveURL(/\/confirm\/E2E-LIFF-1/)
  expect(createBody.line).toBeUndefined()
  // 未綁定 → 既有 CTA fallback 正常出現
  await expect(page.getByRole('link', { name: /加入並綁定 LINE 通知/ })).toBeVisible()
})
