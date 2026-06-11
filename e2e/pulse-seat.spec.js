import { test, expect } from '@playwright/test'

// 現場「訂位脈動」側欄：已指派但遲到（過時未到）的訂位，過去只顯示「✓ 已指派」+「標 No-show」，
// 沒有入座入口 → 遲到客終於到了卻無法從側欄帶位。修正後應有「✅ 客人到了」直接入座。

function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
// 3 小時前的時段（凌晨 underflow 則用 00:00），確保落在「過時未到」
function overdueSlot() {
  const d = new Date()
  let m = d.getHours() * 60 + d.getMinutes() - 180
  if (m < 0) m = 0
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

test.beforeEach(async ({ page }) => {
  await page.route('**/adminPullData', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'e2e-offline' }) }))
  await page.route('**/adminPushData', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }))
  await page.route('**/admin*', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false }) }))
  await page.addInitScript(({ today, slot }) => {
    localStorage.removeItem('chicken_waitlist_v1')
    localStorage.removeItem('chicken_group_reservations_v1')
    // 已指派 113（4 人桌、空桌）、過時未到的散客訂位
    localStorage.setItem('chicken_bookings_v1', JSON.stringify([
      { id: 'LATE1', name: '遲到客', phone: '0900111222', guests: 2, date: today, timeSlot: slot,
        status: 'confirmed', assignedTableId: '113', notes: {}, source: 'phone' },
    ]))
  }, { today: todayStr(), slot: overdueSlot() })
})

test('訂位脈動：遲到且已指派的訂位可直接「客人到了」入座', async ({ page }) => {
  await page.goto('/login')
  await page.getByPlaceholder('your@email.com').fill('berrylin0911@gmail.com')
  await page.getByRole('button', { name: /模擬登入/ }).click()
  await expect(page).toHaveURL(/\/admin/)
  await page.locator('aside').getByRole('button', { name: '現場' }).click()

  // 訂位脈動（預設籤）：過時未到區出現遲到客卡，含「✓ 已指派 113」「✅ 客人到了」「標 No-show」
  await expect(page.getByText('⚠ 過時未到（1 組）— 請聯絡或標記')).toBeVisible()
  await expect(page.getByText('遲到客')).toBeVisible()
  await expect(page.getByText('✓ 已指派 113')).toBeVisible()
  const seatBtn = page.getByRole('button', { name: /客人到了/ })
  await expect(seatBtn).toBeVisible()
  await expect(page.getByRole('button', { name: /標 No-show/ })).toBeVisible()

  // 點「客人到了」→ 直接入座成功（status→arrived、桌→用餐中），卡片離開脈動
  await seatBtn.click()
  await expect(page.getByText(/遲到客 已入座 113/)).toBeVisible()
  await expect(page.getByText('遲到客')).toHaveCount(0)
})

test('訂位脈動：入座撞到團體保留桌時跳確認，確認後仍可入座', async ({ page }) => {
  // 覆寫 beforeEach 的種子：同桌 113 同時被今日團體圈走（未入座）
  await page.addInitScript(({ today, slot }) => {
    localStorage.setItem('chicken_bookings_v1', JSON.stringify([
      { id: 'LATE2', name: '遲到客', phone: '0900111222', guests: 2, date: today, timeSlot: slot,
        status: 'confirmed', assignedTableId: '113', notes: {}, source: 'phone' },
    ]))
    localStorage.setItem('chicken_group_reservations_v1', JSON.stringify([
      { id: 'GHOLD', schemaVersion: 2, date: today, agencyName: '快樂旅行社', guideName: '張導',
        counts: { total: 4 }, status: 'confirmed',
        batches: [{ id: 'bh', label: '第一梯', timeSlot: '18:00', tableNumbers: ['113'], guests: 4 }] },
    ]))
  }, { today: todayStr(), slot: overdueSlot() })

  await page.goto('/login')
  await page.getByPlaceholder('your@email.com').fill('berrylin0911@gmail.com')
  await page.getByRole('button', { name: /模擬登入/ }).click()
  await expect(page).toHaveURL(/\/admin/)
  await page.locator('aside').getByRole('button', { name: '現場' }).click()

  await expect(page.getByText('遲到客')).toBeVisible()
  await page.getByRole('button', { name: /客人到了/ }).click()

  // 防呆確認：此桌為團體保留 → 跳確認對話框
  await expect(page.getByText('桌位有預留')).toBeVisible()
  await expect(page.getByText(/今日團體「快樂旅行社」預留/)).toBeVisible()
  await page.getByRole('button', { name: '仍要入座' }).click()

  // 確認後仍入座成功
  await expect(page.getByText(/遲到客 已入座 113/)).toBeVisible()
})
