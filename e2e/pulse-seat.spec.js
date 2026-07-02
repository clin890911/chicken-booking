import { test, expect } from '@playwright/test'

// 現場「訂位脈動」側欄：已指派但遲到（過時未到）的訂位，過去只顯示「✓ 已指派」+「標 No-show」，
// 沒有入座入口 → 遲到客終於到了卻無法從側欄帶位。修正後應有「✅ 客人到了」直接入座。

// 釘死時間，測試不再依賴真實 wall-clock。
// 舊版用 `now - 180 分` 算「過時未到」的時段，凌晨（約 00:00–00:3X）會 underflow 被 clamp 到 00:00，
// 此時 now 距 00:00 不足 15 分寬限 → 誤判非「過時未到」→ 側欄不出現該區塊 → 確定性失敗。
// 改用 page.clock.setFixedTime 把瀏覽器時間釘在營業時段中段（14:30），訂位時段 11:30 = 已過 3 小時，
// 遠超 15 分寬限，任何時刻執行都穩定落在「過時未到（overdue no-show）」。
// setFixedTime 只固定 Date.now()/new Date()、保留計時器與 rAF 正常運作（動畫/導覽不受影響）。
const FIXED_NOW = new Date(2026, 6, 2, 14, 30, 0) // 2026-07-02 14:30 本地時間（月份 0-indexed）
const FIXED_DATE = '2026-07-02'
const OVERDUE_SLOT = '11:30'

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(FIXED_NOW)
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
  }, { today: FIXED_DATE, slot: OVERDUE_SLOT })
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
  }, { today: FIXED_DATE, slot: OVERDUE_SLOT })

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
