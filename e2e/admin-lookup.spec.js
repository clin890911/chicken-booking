import { test, expect } from '@playwright/test'

// 後台「用訂位編號查詢」主線：同仁登入 → 訂位/查詢分頁 → 輸入（小寫帶空白的）編號
// → 跨日期精確查到目標、排除同名干擾筆、可查到已取消、查無時顯示空狀態，且不外洩 manageToken。
// 後台在「本機開發模式」(無 Firebase) 以 localStorage 為後端；攔截 admin* 雲端端點，
// 避免雲端 pull 覆蓋種子資料。

function dateStr(offsetDays = 0) {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// 目標：未來日期、編號全大寫（如後端產生），manageToken 設可辨識值以做外洩斷言
const TARGET = {
  id: 'BMQ60M3900491',
  name: '林測試',
  phone: '0939328314',
  guests: 2,
  date: dateStr(7),
  timeSlot: '18:00',
  source: 'online',
  status: 'confirmed',
  assignedTableId: null,
  notes: {},
  manageToken: 't-e2e-secret',
  createdBy: 'guest',
}
// 干擾筆：同姓名、不同編號、今日 → 驗證精確命中（搜全碼只應出現目標）
const DISTRACTOR = {
  id: 'BDIFFERENT999',
  name: '林測試',
  phone: '0900000000',
  guests: 4,
  date: dateStr(0),
  timeSlot: '12:00',
  source: 'phone',
  status: 'confirmed',
  assignedTableId: null,
  notes: {},
  manageToken: 't-distract',
  createdBy: 'staff',
}
// 已取消筆：驗證編號查詢「不過濾狀態」，已取消仍查得到
const CANCELLED = {
  id: 'BCANCELLED777',
  name: '王取消',
  phone: '0911111111',
  guests: 3,
  date: dateStr(0),
  timeSlot: '19:00',
  source: 'online',
  status: 'cancelled',
  assignedTableId: null,
  notes: {},
  manageToken: 't-cancel',
  createdBy: 'guest',
}

test.beforeEach(async ({ page }) => {
  await page.route('**/adminPullData', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'e2e-offline' }) }))
  await page.route('**/adminPushData', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }))
  await page.route('**/admin*', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false }) }))

  await page.addInitScript(seed => {
    localStorage.setItem('chicken_bookings_v1', JSON.stringify(seed))
  }, [TARGET, DISTRACTOR, CANCELLED])
})

async function login(page) {
  await page.goto('/login')
  await page.getByPlaceholder('your@email.com').fill('berrylin0911@gmail.com')
  await page.getByRole('button', { name: /模擬登入/ }).click()
  await expect(page).toHaveURL(/\/admin/)
}

test('後台用編號精確查詢：正規化命中、排除同名干擾、不外洩 token', async ({ page }) => {
  await login(page)

  // 進入「查詢」sub-tab（預設在訂位/今日）
  await page.getByRole('button', { name: /查詢/ }).click()

  // 輸入小寫 + 夾帶空白的編號，驗證正規化後仍命中未來日期的目標
  await page.getByPlaceholder('輸入訂位編號 / 姓名 / 電話').fill('  bmq60m39 00491 ')

  // 恰好命中 1 筆，且為目標編號
  await expect(page.getByText('找到 1 筆訂位')).toBeVisible()
  await expect(page.getByText('#BMQ60M3900491')).toBeVisible()
  // 同名但不同編號的干擾筆不應出現
  await expect(page.getByText('#BDIFFERENT999')).toHaveCount(0)

  // 安全：頁面任何處都不得出現 manageToken
  await expect(page.locator('body')).not.toContainText('t-e2e-secret')
})

test('後台編號查詢：已取消可查到、查無顯示空狀態', async ({ page }) => {
  await login(page)
  await page.getByRole('button', { name: /查詢/ }).click()
  const input = page.getByPlaceholder('輸入訂位編號 / 姓名 / 電話')

  // 已取消訂位仍可用編號查到（不過濾狀態）
  await input.fill('BCANCELLED777')
  await expect(page.getByText('#BCANCELLED777')).toBeVisible()
  await expect(page.getByText('已取消').first()).toBeVisible()

  // 不存在的編號 → 查無空狀態
  await input.fill('BZZZNOTEXIST9')
  await expect(page.getByText('查無此訂位')).toBeVisible()
})
