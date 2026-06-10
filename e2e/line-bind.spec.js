import { test, expect } from '@playwright/test'

// LINE 綁定頁主線：以 window.liff stub 模擬 LIFF 環境（不打真 LINE），
// 攔截 lineGetBooking / lineBind 端點回假資料。
// 防回歸重點：
// 1) 新版連結不帶 payload，顯示資料須由 lineGetBooking 回讀（跨裝置/LINE 內開啟情境）
// 2) 未加好友（getFriendship friendFlag=false）→ 顯示「加入好友」引導，不顯示成功
// 3) 送往 lineBind 的 body 不得夾帶姓名/電話（後端權威重讀，只需 id + token + LINE profile）

const BOOKING = {
  id: 'E2E-LINE-1', name: '林測試', phone: '0987654321', guests: 2,
  date: '2099-12-31', timeSlot: '18:00', status: 'confirmed', manageToken: 'tok-line',
  notes: {},
}

// liff.state 參數讓頁面把這次開啟視為 LIFF callback，跳過向 liff.line.me 的重導、直接走綁定流程
const BIND_URL = `/line/bind?bookingId=${BOOKING.id}&token=${BOOKING.manageToken}&liff.state=cb`

function stubLiff(page, friendFlag) {
  return page.addInitScript(flag => {
    window.liff = {
      init: async () => {},
      isLoggedIn: () => true,
      getProfile: async () => ({ userId: 'U-e2e-1', displayName: 'E2E 測試帳號', pictureUrl: '' }),
      getFriendship: async () => ({ friendFlag: flag }),
    }
  }, friendFlag)
}

let lineBindBody = null

// 跨網域 mock 必備：fulfill 不會自動帶 CORS 標頭，少了 ACAO 瀏覽器會擋下回應；
// POST + JSON 還會先發 preflight OPTIONS，也要回 2xx + 允許標頭。
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
  lineBindBody = null
  // 注意：regex 必須鎖定端點網域開頭——寬鬆的 /linebind/i 會誤攔 Vite 的
  // /src/pages/LineBindPage.jsx 模組請求，把 JSON 餵給模組載入器導致整頁空白。
  await page.route(/^https:\/\/linegetbooking/i, route =>
    fulfillJson(route, { ok: true, booking: BOOKING, store: {}, line: {} }))
  await page.route(/^https:\/\/linebind/i, route => {
    if (route.request().method() === 'POST') {
      lineBindBody = route.request().postDataJSON()
      const needFriend = lineBindBody?.line?.friendFlag === false
      return fulfillJson(route, { ok: true, ...(needFriend ? { needFriend: true } : {}) })
    }
    return fulfillJson(route, { ok: true })
  })
})

test('未加好友：完成綁定但顯示「加入好友」引導與補發說明', async ({ page }) => {
  await stubLiff(page, false)
  await page.goto(BIND_URL)

  await expect(page.getByRole('heading', { name: '最後一步：加入官方帳號好友' })).toBeVisible()
  await expect(page.getByText(/加入後會自動補發訂位資訊/)).toBeVisible()
  await expect(page.getByRole('link', { name: '加入 LINE 官方帳號' })).toBeVisible()
  // 顯示資料來自 lineGetBooking 回讀（無本機資料、無 payload）
  await expect(page.getByText(BOOKING.id)).toBeVisible()
})

test('已是好友：綁定成功，body 不含姓名/電話（隱私回歸）', async ({ page }) => {
  await stubLiff(page, true)
  await page.goto(BIND_URL)

  await expect(page.getByRole('heading', { name: 'LINE 訂位通知已啟用' })).toBeVisible()
  expect(lineBindBody).toBeTruthy()
  expect(lineBindBody.booking).toEqual({ id: BOOKING.id, token: BOOKING.manageToken })
  expect(lineBindBody.line.userId).toBe('U-e2e-1')
  expect(lineBindBody.line.friendFlag).toBe(true)
  const raw = JSON.stringify(lineBindBody)
  expect(raw).not.toContain(BOOKING.name)
  expect(raw).not.toContain(BOOKING.phone)
})
