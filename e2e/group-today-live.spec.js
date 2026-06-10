import { test, expect } from '@playwright/test'

// 今日團體現場帶位主線（已併入「現場」頁右側欄）：
// 種一筆今日團體（兩梯次共用 101）→ 現場「今日團體」籤 梯次入座（confirm）
// → 點地圖團體桌 → 此梯離席 → 清桌完成＋接下一梯入座。
// 後台本機模式以 localStorage 為後端；攔截 admin* 雲端端點。

test.beforeEach(async ({ page }) => {
  await page.route('**/adminPullData', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'e2e-offline' }) }))
  await page.route('**/adminPushData', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }))
  await page.route('**/admin*', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false }) }))
  await page.addInitScript(() => {
    localStorage.removeItem('chicken_waitlist_v1')
    localStorage.removeItem('chicken_bookings_v1')
    localStorage.removeItem('chicken_tables_v1')
    const d = new Date()
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    localStorage.setItem('chicken_group_reservations_v1', JSON.stringify([{
      id: 'GE2E1',
      schemaVersion: 2,
      date: today,
      agencyName: '快樂旅行社',
      guideName: '張導',
      guidePhone: '0911222333',
      counts: { total: 22, vegetarian: 2, child: 0, mobility: 0, wheelchair: 0 },
      allergyText: '',
      status: 'confirmed',
      batches: [
        { id: 'BE2E1', label: '第一梯', timeSlot: '11:30', tableNumbers: ['101', '102'], guests: 12, note: '' },
        { id: 'BE2E2', label: '第二梯', timeSlot: '13:00', tableNumbers: ['101'], guests: 10, note: '' },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }]))
  })
})

test('管理端：今日團體 梯次入座 → 此梯離席 → 清桌＋接下一梯', async ({ page }) => {
  // 登入
  await page.goto('/login')
  await page.getByPlaceholder('your@email.com').fill('berrylin0911@gmail.com')
  await page.getByRole('button', { name: /模擬登入/ }).click()
  await expect(page).toHaveURL(/\/admin/)

  // 進現場分頁 → 右側欄「今日團體」籤（今日有團體才會出現）
  await page.locator('aside').getByRole('button', { name: '現場' }).click()
  await page.getByRole('button', { name: /今日團體/ }).click()
  await expect(page.getByText('快樂旅行社').first()).toBeVisible()

  // 第一梯入座（confirm 對話框列出整梯桌號）
  await page.getByRole('button', { name: /梯次入座/ }).first().click()
  await expect(page.getByText(/整梯 2 桌：101、102/)).toBeVisible()
  await page.getByRole('button', { name: '確認入座', exact: true }).click()
  await expect(page.getByText(/第一梯 已入座/)).toBeVisible()

  // 點地圖上的團體桌 101 → 抽屜顯示團體資訊與「此梯離席」
  await page.locator('svg g:has(:text-is("101"))').first().click()
  await expect(page.getByText('🚌 快樂旅行社')).toBeVisible()
  await page.getByRole('button', { name: /此梯離席/ }).click()
  await page.getByRole('button', { name: '確認離席', exact: true }).click()
  await expect(page.getByText(/已離席，桌位待清/)).toBeVisible()

  // 清桌中的團體桌 → 「清桌完成＋第二梯 入座」（第二梯也圈了 101）
  await page.getByRole('button', { name: /清桌完成＋第二梯 入座/ }).click()
  await page.getByRole('button', { name: '清桌＋入座', exact: true }).click()
  await expect(page.getByText(/第二梯 入座/).first()).toBeVisible()

  // 抽屜轉為第二梯用餐中
  await expect(page.getByText(/第二梯 13:00/)).toBeVisible()
  await expect(page.getByRole('button', { name: /此梯離席/ })).toBeVisible()
})
