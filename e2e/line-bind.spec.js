import { test, expect } from '@playwright/test'

// LINE 綁定結果頁（LINE Login 網頁授權版）。
// 綁定本體已改由後端 lineLoginStart → LINE 授權 → lineLoginCallback 完成（純伺服器重導，
// 取代易卡「一直載入」的 LIFF）。本頁只負責顯示結果與提供入口，訂位摘要以 lineGetBooking 回讀。
// 防回歸重點：
// 1) ?bound=1 → 顯示「已啟用」
// 2) ?bound=1&needFriend=1 → 顯示「加入好友」引導與補發說明
// 3) 落地（無 bound）→ 「用 LINE 完成綁定」預取成功時直達 access.line.me 授權頁
//    （href 直指 authorize URL 才能觸發 Universal Link 直跳 LINE app；經 302 中轉會掉帳密頁）
// 3b) 預取失敗 → 退回 lineLoginStart 302 舊路（只帶 id+token），保底不壞
// 4) ?err=expired → 顯示過期錯誤，不再無限載入

const BOOKING = {
  id: 'E2E-LINE-1', name: '林測試', phone: '0987654321', guests: 2,
  date: '2099-12-31', timeSlot: '18:00', status: 'confirmed', manageToken: 'tok-line',
  notes: {},
}

const BASE = `/line/bind?bookingId=${BOOKING.id}&token=${BOOKING.manageToken}`
// 預取（POST lineLoginStart）成功時回的直達授權網址（可辨識 state 供斷言）
const AUTHORIZE_URL = 'https://access.line.me/oauth2/v2.1/authorize?response_type=code&client_id=2009996489&state=e2e-state&scope=profile%20openid&bot_prompt=aggressive'

// 跨網域 mock 必備：fulfill 不會自動帶 CORS 標頭；GET 也補上避免被瀏覽器擋。
const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
}
function fulfillJson(route, payload) {
  if (route.request().method() === 'OPTIONS') {
    return route.fulfill({ status: 204, headers: CORS_HEADERS })
  }
  return route.fulfill({
    status: 200,
    contentType: 'application/json',
    headers: CORS_HEADERS,
    body: JSON.stringify(payload),
  })
}

test.beforeEach(async ({ page }) => {
  // 注意：regex 鎖定端點網域開頭，避免誤攔 Vite 的 /src/.../LineBindPage.jsx 模組請求。
  await page.route(/^https:\/\/linegetbooking/i, route =>
    fulfillJson(route, { ok: true, booking: BOOKING, store: {}, line: {} }))
  // 直達授權預取（POST lineLoginStart）必須 mock：否則測試會打到真部署端點。
  await page.route(/^https:\/\/lineloginstart/i, route =>
    fulfillJson(route, { ok: true, authorizeUrl: AUTHORIZE_URL }))
})

test('綁定成功（bound=1）：顯示已啟用 + 訂位摘要', async ({ page }) => {
  await page.goto(`${BASE}&bound=1`)
  await expect(page.getByRole('heading', { name: 'LINE 訂位通知已啟用' })).toBeVisible()
  // 顯示資料來自 lineGetBooking 回讀（無本機資料、無 payload）
  await expect(page.getByText(BOOKING.id)).toBeVisible()
})

test('待加好友（bound=1&needFriend=1）：顯示加好友引導與補發說明', async ({ page }) => {
  await page.goto(`${BASE}&bound=1&needFriend=1`)
  await expect(page.getByRole('heading', { name: '最後一步：加入官方帳號好友' })).toBeVisible()
  await expect(page.getByText(/加入後會自動補發訂位資訊/)).toBeVisible()
  await expect(page.getByRole('link', { name: '加入 LINE 官方帳號' })).toBeVisible()
})

test('落地入口（無 bound）：預取成功 → 「用 LINE 完成綁定」直達 LINE 授權頁', async ({ page }) => {
  await page.goto(BASE)
  await expect(page.getByRole('heading', { name: '用 LINE 接收訂位通知' })).toBeVisible()
  const link = page.getByRole('link', { name: '用 LINE 完成綁定' })
  // href 直指 access.line.me（非自家後端 302 中轉）——Universal Link 直跳 LINE app 的前提
  await expect(link).toHaveAttribute('href', /^https:\/\/access\.line\.me\/oauth2\/v2\.1\/authorize/)
  await expect(link).toHaveAttribute('href', /state=e2e-state/)
  const href = await link.getAttribute('href')
  // 直達授權連結不夾個資
  expect(href).not.toContain(BOOKING.name)
  expect(href).not.toContain(BOOKING.phone)
})

test('落地入口：預取失敗 → 退回 lineLoginStart 302 舊路（只帶 id+token）', async ({ page }) => {
  // 後註冊的 route 優先：蓋掉 beforeEach 的預取 mock，模擬 prepare 端點掛掉
  await page.route(/^https:\/\/lineloginstart/i, route => route.abort())
  await page.goto(BASE)
  const link = page.getByRole('link', { name: '用 LINE 完成綁定' })
  await expect(link).toHaveAttribute('href', /lineloginstart/)
  const href = await link.getAttribute('href')
  expect(href).toContain(`bookingId=${BOOKING.id}`)
  expect(href).toContain(`token=${BOOKING.manageToken}`)
  // 入口連結不夾個資
  expect(href).not.toContain(BOOKING.name)
  expect(href).not.toContain(BOOKING.phone)
})

test('授權失敗（err=expired）：顯示過期提示，不再無限載入', async ({ page }) => {
  await page.goto(`${BASE}&bound=0&err=expired`)
  await expect(page.getByRole('heading', { name: 'LINE 綁定未完成' })).toBeVisible()
  await expect(page.getByText(/已過期/)).toBeVisible()
})
