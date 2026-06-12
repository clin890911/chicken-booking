import { test, expect } from '@playwright/test'

// 未來日訂位主線：日曆點明天 → 月曆收合成週條 + 當日清單 → 日期 guard（無「客人到了/標No-show」）
// → 「指派桌位（預配）」跨頁導到規劃排位地圖 → 點空桌完成預配。
// 後台本機模式以 localStorage 為後端；攔截 admin* 雲端端點。

function fmt(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function dayLabelOf(dateStr) {
  const d = new Date(dateStr + 'T00:00:00')
  const w = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()]
  return `${d.getMonth() + 1}/${d.getDate()} (${w})`
}

const tomorrow = new Date()
tomorrow.setDate(tomorrow.getDate() + 1)
const TOMORROW = fmt(tomorrow)

// 18:00 落在預設「晚餐第一批」場次（17:00–19:00）
const BOOKINGS = [
  {
    id: 'E2E-FUT-1', name: '林未來', phone: '0922000111', guests: 4,
    date: TOMORROW, timeSlot: '18:00', source: 'phone', status: 'confirmed',
    assignedTableId: null, notes: {}, manageToken: 't-e2e-f1', createdBy: 'staff',
  },
  {
    id: 'E2E-FUT-2', name: '陳已配', phone: '0922000222', guests: 2,
    date: TOMORROW, timeSlot: '18:00', source: 'phone', status: 'confirmed',
    assignedTableId: '102', notes: {}, manageToken: 't-e2e-f2', createdBy: 'staff',
  },
]

test.beforeEach(async ({ page }) => {
  await page.route('**/adminPullData', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'e2e-offline' }) }))
  await page.route('**/adminPushData', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }))
  await page.route('**/admin*', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false }) }))
  await page.addInitScript(list => {
    localStorage.setItem('chicken_bookings_v1', JSON.stringify(list))
    localStorage.setItem('chicken_group_reservations_v1', JSON.stringify([]))
    localStorage.setItem('chicken_group_blank_purge_v1', '1')
  }, BOOKINGS)
})

test('日曆點明天 → 收合週條 → 日期 guard → 預配導到規劃地圖 → 點空桌成功', async ({ page }) => {
  // 登入（預設落在訂位分頁）
  await page.goto('/login')
  await page.getByPlaceholder('your@email.com').fill('berrylin0911@gmail.com')
  await page.getByRole('button', { name: /模擬登入/ }).click()
  await expect(page).toHaveURL(/\/admin/)

  // 進日曆 sub-tab（月曆總覽）
  await page.getByRole('button', { name: /日曆/ }).click()
  await expect(page.getByText(/點日期看當天訂位/)).toBeVisible()

  // 明天若跨月，先翻下個月
  const today = new Date()
  if (tomorrow.getMonth() !== today.getMonth()) {
    await page.getByRole('button', { name: '›' }).click()
  }
  // 點明天的日期格（格內日數是獨立 span，exact 比對避免 1 對到 10/11）
  await page.getByRole('button')
    .filter({ has: page.getByText(String(tomorrow.getDate()), { exact: true }) })
    .filter({ hasText: '組' }) // 有訂位統計的那一格
    .first().click()

  // 月曆收合成週條、當日清單成為主體
  await expect(page.getByRole('button', { name: /展開月曆/ })).toBeVisible()
  await expect(page.getByText(`📋 ${dayLabelOf(TOMORROW)}`)).toBeVisible()
  await expect(page.getByText('林未來')).toBeVisible()

  // 日期 guard：未來日不可報到/標 No-show；已配桌的顯示「當天才可報到」
  await expect(page.getByRole('button', { name: '客人到了' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '標 No-show' })).toHaveCount(0)
  await expect(page.getByText('未來訂位 · 當天才可報到')).toBeVisible()

  // 「指派桌位（預配）」→ 跨頁導到規劃排位地圖（正確日期 + 自動進預配模式）
  await page.getByRole('button', { name: '指派桌位（預配）' }).click()
  await expect(page.getByText('場次（批次）')).toBeVisible()
  await expect(page.getByText(new RegExp(`📅 ${dayLabelOf(TOMORROW).replace(/[()]/g, '\\$&')}`))).toBeVisible()
  await expect(page.getByText(/預先配桌：林未來/)).toBeVisible()

  // 點空桌 101（6 人桌，容量足夠；102 已被陳已配佔用）完成預配
  await page.locator('svg g:has(:text-is("101"))').first().click()
  await expect(page.getByText(/林未來 已預先配到 101/)).toBeVisible()
})

// 大組併桌預配（2026-06-12）：未來日 12 人訂位無單桌可容（最大 6 人桌）→ 規劃地圖進「併桌預配」，
// 累加選兩張 6 人桌湊滿 12 席後一鍵預配。
test('未來日 12 人訂位 → 規劃地圖併桌預配（選兩張桌）成功', async ({ page }) => {
  // 只種一筆 12 人未來訂位（覆蓋 beforeEach 的種子）
  await page.addInitScript(() => {
    const t = new Date(); t.setDate(t.getDate() + 1)
    const d = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`
    localStorage.setItem('chicken_bookings_v1', JSON.stringify([{
      id: 'E2E-FUT-BIG', name: '李大團', phone: '0922000999', guests: 12,
      date: d, timeSlot: '18:00', source: 'phone', status: 'confirmed',
      assignedTableId: null, notes: {}, manageToken: 't-e2e-big', createdBy: 'staff',
    }]))
    localStorage.setItem('chicken_group_reservations_v1', JSON.stringify([]))
    localStorage.setItem('chicken_group_blank_purge_v1', '1')
  })

  await page.goto('/login')
  await page.getByPlaceholder('your@email.com').fill('berrylin0911@gmail.com')
  await page.getByRole('button', { name: /模擬登入/ }).click()
  await expect(page).toHaveURL(/\/admin/)

  await page.getByRole('button', { name: /日曆/ }).click()
  await expect(page.getByText(/點日期看當天訂位/)).toBeVisible()
  const today = new Date()
  if (tomorrow.getMonth() !== today.getMonth()) {
    await page.getByRole('button', { name: '›' }).click()
  }
  await page.getByRole('button')
    .filter({ has: page.getByText(String(tomorrow.getDate()), { exact: true }) })
    .filter({ hasText: '組' })
    .first().click()
  await expect(page.getByText('李大團')).toBeVisible()

  // 指派桌位（預配）→ 規劃地圖 → 無單桌可容 12 人 → 併桌預配模式
  await page.getByRole('button', { name: '指派桌位（預配）' }).click()
  await expect(page.getByText(/併桌預配：李大團/)).toBeVisible()

  // 累加選兩張 6 人桌（101 + 103）湊滿 12 席（102 此測無人佔，但任選兩張 6 人桌即可）
  await page.locator('svg g:has(:text-is("101"))').first().click()
  await page.locator('svg g:has(:text-is("103"))').first().click()

  // 席數湊滿 → 確認併桌預配
  const confirmBtn = page.getByRole('button', { name: /確認併桌預配/ })
  await expect(confirmBtn).toBeEnabled()
  await confirmBtn.click()
  await expect(page.getByText(/李大團（12 位）已併桌預配到/)).toBeVisible()
})
