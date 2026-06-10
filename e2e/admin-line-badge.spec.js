import { test, expect } from '@playwright/test'

// 後台訂位卡 LINE 可見性：已綁定（綠 pill，含最近送達狀態）與推播被拒（紅 pill）。
// 與 admin-assign 同模式：本機開發模式 + localStorage 種子 + 攔截 admin* 端點。

function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const BOUND = {
  id: 'E2E-LB-1', name: '綁定客', phone: '0912000222', guests: 2,
  date: todayStr(), timeSlot: '18:00', source: 'online', status: 'confirmed',
  assignedTableId: null, notes: {}, manageToken: 't1', createdBy: 'guest',
  lineUserId: 'U-ok', lineDisplayName: '綠綠',
  lineLastNotify: { event: 'created', status: 'sent', at: new Date().toISOString() },
}
const BLOCKED = {
  id: 'E2E-LB-2', name: '被拒客', phone: '0912000333', guests: 4,
  date: todayStr(), timeSlot: '18:30', source: 'online', status: 'confirmed',
  assignedTableId: null, notes: {}, manageToken: 't2', createdBy: 'guest',
  lineUserId: 'U-blocked', lineDisplayName: '小黑', linePushBlocked: true,
}

test.beforeEach(async ({ page }) => {
  await page.route('**/adminPullData', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'e2e-offline' }) }))
  await page.route('**/adminPushData', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }))
  await page.route('**/admin*', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false }) }))
  await page.addInitScript(list => {
    localStorage.setItem('chicken_bookings_v1', JSON.stringify(list))
  }, [BOUND, BLOCKED])
})

test('後台訂位卡：已綁定顯示綠 pill（含送達），被拒顯示紅 pill', async ({ page }) => {
  await page.goto('/login')
  await page.getByPlaceholder('your@email.com').fill('berrylin0911@gmail.com')
  await page.getByRole('button', { name: /模擬登入/ }).click()
  await expect(page).toHaveURL(/\/admin/)

  await expect(page.getByText('綁定客').first()).toBeVisible()
  await expect(page.getByText(/LINE ✓ 已送達/).first()).toBeVisible()
  await expect(page.getByText('LINE 無法送達').first()).toBeVisible()
})
