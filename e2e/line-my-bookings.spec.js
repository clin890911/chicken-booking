import { test, expect } from '@playwright/test'

// 「LINE 我的訂位」主線：window.liff stub（不打真 LINE）+ 攔截 lineMyBookings 端點。
// 防回歸重點：
// 1) POST body 只帶 idToken（身分由後端驗 token 確立，前端不自報 userId）
// 2) upcoming 卡有「管理 / 修改」、已取消歷史卡沒有
// 3) 空清單與 not-configured 都優雅引導（電話查詢/立即訂位），絕不白屏

function ymdPlusDays(n) {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const ITEMS = [
  {
    id: 'B-UP-1', date: ymdPlusDays(3), dateLabel: '6/18 (四)', timeSlot: '18:00', guests: 4,
    status: 'confirmed', past: false, manageToken: 'tok-up-1', manageUrl: '',
  },
  {
    id: 'B-PAST-1', date: ymdPlusDays(-2), dateLabel: '6/13 (六)', timeSlot: '12:00', guests: 2,
    status: 'cancelled', past: true, manageToken: 'tok-past-1', manageUrl: '',
  },
]
const STORE = { storeName: '雞王涮涮鍋', storePhone: '049-2753377', storeMapUrl: 'https://maps.example.com' }

// 跨網域 mock 必備 CORS（fulfill 不會自動帶；POST+JSON 還有 preflight OPTIONS）
const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
}
function fulfillJson(route, payload, status = 200) {
  if (route.request().method() === 'OPTIONS') {
    return route.fulfill({ status: 204, headers: CORS_HEADERS })
  }
  return route.fulfill({ status, contentType: 'application/json', headers: CORS_HEADERS, body: JSON.stringify(payload) })
}

function stubLiff(page) {
  return page.addInitScript(() => {
    window.liff = {
      init: async () => {},
      isLoggedIn: () => true,
      getIDToken: () => 'fake-id-token',
      getProfile: async () => ({ userId: 'U-e2e', displayName: 'E2E', pictureUrl: '' }),
    }
  })
}

let lastBody = null

test.beforeEach(async ({ page }) => {
  lastBody = null
  await stubLiff(page)
})

// regex 鎖端點網域開頭：寬鬆 pattern 會誤攔 Vite 的 /src/pages/LineMyBookingsPage.jsx 模組請求
function mockEndpoint(page, payload, status = 200) {
  return page.route(/^https:\/\/linemybookings/i, route => {
    if (route.request().method() === 'POST') lastBody = route.request().postDataJSON()
    return fulfillJson(route, payload, status)
  })
}

test('清單：upcoming 有管理按鈕、歷史取消卡灰階無按鈕，body 只帶 idToken', async ({ page }) => {
  await mockEndpoint(page, { ok: true, items: ITEMS, store: STORE, line: { displayName: '綠綠' } })
  await page.goto('/line/my-bookings')

  await expect(page.getByRole('heading', { name: '嗨，綠綠' })).toBeVisible()
  await expect(page.getByText('#B-UP-1')).toBeVisible()
  await expect(page.getByText('#B-PAST-1')).toBeVisible()
  await expect(page.getByText('已取消')).toBeVisible()

  const manageLinks = page.getByRole('link', { name: '管理 / 修改訂位' })
  await expect(manageLinks).toHaveCount(1)
  await expect(manageLinks).toHaveAttribute('href', '/manage/B-UP-1?token=tok-up-1')

  // 到店快捷與電話查詢提示
  await expect(page.getByRole('link', { name: /導航到店/ })).toBeVisible()
  await expect(page.getByRole('link', { name: '電話查詢' })).toBeVisible()

  expect(lastBody).toEqual({ idToken: 'fake-id-token' })
})

test('空清單：顯示引導與兩顆 fallback 按鈕', async ({ page }) => {
  await mockEndpoint(page, { ok: true, items: [], store: STORE, line: {} })
  await page.goto('/line/my-bookings')

  await expect(page.getByRole('heading', { name: '目前沒有綁定的訂位' })).toBeVisible()
  await expect(page.getByRole('link', { name: '用電話查詢訂位' })).toBeVisible()
  await expect(page.getByRole('link', { name: '立即訂位' })).toBeVisible()
})

test('端點 not-configured：優雅退回電話查詢，不白屏', async ({ page }) => {
  await mockEndpoint(page, { ok: false, error: 'not-configured' }, 503)
  await page.goto('/line/my-bookings')

  await expect(page.getByRole('heading', { name: 'LINE 查詢暫時無法使用' })).toBeVisible()
  await expect(page.getByRole('link', { name: '用電話查詢訂位' })).toBeVisible()
})
