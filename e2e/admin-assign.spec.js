import { test, expect } from '@playwright/test'

// 管理端指派主線：同仁登入 → 後台今日列表看到訂位 → 指派桌位（A6 二步確認）→ 指派成功。
// 後台在「本機開發模式」(無 Firebase) 以 localStorage 為後端；攔截 admin* 雲端端點，
// 避免雲端 pull 覆蓋種子資料、也不碰正式後端。

function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const BOOKING = {
  id: 'E2E-ADM-1',
  name: '王大明',
  phone: '0912000111',
  guests: 4,
  date: todayStr(),
  timeSlot: '18:00',
  source: 'online',
  status: 'confirmed',
  assignedTableId: null,
  notes: {},
  manageToken: 't-e2e',
  createdBy: 'guest',
}

test.beforeEach(async ({ page }) => {
  // 攔截雲端端點：pull 回 ok:false（會被 catch、保留本機種子資料）、push 回 ok:true（no-op）
  await page.route('**/adminPullData', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'e2e-offline' }) }))
  await page.route('**/adminPushData', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }))
  await page.route('**/admin*', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false }) }))

  // 在每次頁面載入前種入一筆今日確認訂位（app 掛載時即可從 localStorage 讀到）
  await page.addInitScript(b => {
    localStorage.setItem('chicken_bookings_v1', JSON.stringify([b]))
  }, BOOKING)
})

test('管理端：登入 → 指派桌位（二步確認）→ 指派成功', async ({ page }) => {
  // 1) 同仁登入（開發模式 email 表單）
  await page.goto('/login')
  await page.getByPlaceholder('your@email.com').fill('berrylin0911@gmail.com')
  await page.getByRole('button', { name: /模擬登入/ }).click()
  await expect(page).toHaveURL(/\/admin/)

  // 2) 今日列表應顯示種子訂位
  await expect(page.getByText('王大明').first()).toBeVisible()

  // 3) 點「指派桌位」→ 切到桌位頁進入指派模式
  await page.getByRole('button', { name: '指派桌位' }).click()
  await expect(page.getByText(/指派桌位：王大明\s*4\s*位/)).toBeVisible()

  // 4) 讀出系統建議桌號（💡 建議 N）
  const suggestChip = page.getByText(/💡\s*建議\s*\d+/)
  await expect(suggestChip).toBeVisible()
  const chipText = await suggestChip.textContent()
  const tableNo = (chipText.match(/\d+/) || [])[0]
  expect(tableNo).toBeTruthy()

  // 5) 點該桌（SVG 內 <g> 含桌號文字）→ 進入待確認預覽（A6 二步）
  await page.locator(`svg g:has(:text-is("${tableNo}"))`).first().click()
  await expect(page.getByText(new RegExp(`確認指派 王大明 至桌 ${tableNo}`))).toBeVisible()

  // 6) 按「✓ 確認指派」→ 指派成功（成功 toast）
  await page.getByRole('button', { name: /確認指派/ }).click()
  await expect(page.getByText(new RegExp(`指派至 ${tableNo}.*可指派下一組`))).toBeVisible()
})
