import { test, expect } from '@playwright/test'

// 訂位 → 日曆：月曆格與週條都要把「旅行社團體」顯示出來（先前只顯示散客「X組·Y位」+ 一個小 🚌 徽章，
// 30 人的團體在格內讀不出來）。種 6/17：散客 2 位 + 兩團共 30 位 → 月曆格須同時顯示散客與團體人數。

test.beforeEach(async ({ page }) => {
  await page.route('**/adminPullData', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'e2e-offline' }) }))
  await page.route('**/adminPushData', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }))
  await page.route('**/admin*', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false }) }))
  await page.addInitScript(() => {
    localStorage.setItem('chicken_group_blank_purge_v1', '1')
    localStorage.setItem('chicken_bookings_v1', JSON.stringify([
      { id: 'BK17', name: '劉小姐', phone: '0944928323', guests: 2, date: '2026-06-17', timeSlot: '13:00', status: 'confirmed', assignedTableId: '110', notes: {}, source: 'phone' },
    ]))
    localStorage.setItem('chicken_group_reservations_v1', JSON.stringify([
      { id: 'G17A', schemaVersion: 2, date: '2026-06-17', agencyName: '好賺錢旅行社', guideName: 'lida', counts: { total: 10 }, status: 'confirmed', batches: [{ id: 'b1', label: '第一梯', timeSlot: '11:00', tableNumbers: ['107', '110'], guests: 10 }] },
      { id: 'G17B', schemaVersion: 2, date: '2026-06-17', agencyName: '花花旅行社', guideName: 'Candy', counts: { total: 20 }, status: 'confirmed', batches: [{ id: 'b2', label: '第一梯', timeSlot: '12:00', tableNumbers: ['101', '102', '103', '108'], guests: 20 }] },
    ]))
  })
})

test('日曆月格同時顯示散客與旅行社團體人數', async ({ page }) => {
  await page.goto('/login')
  await page.getByPlaceholder('your@email.com').fill('berrylin0911@gmail.com')
  await page.getByRole('button', { name: /模擬登入/ }).click()
  await expect(page).toHaveURL(/\/admin/)
  await page.getByRole('button', { name: /日曆/ }).click()

  // 導到種子月份 2026 年 6 月。★ 須雙向翻頁：種子是固定日期，當系統日期已過 2026/6（例如
  // 7 月以後），6 月變成「過去月」，只往後（›）翻永遠到不了 → 依目前顯示月與目標月比較方向。
  const TARGET = 2026 * 12 + 6
  for (let i = 0; i < 24; i++) {
    const t = await page.getByRole('heading', { name: /\d+年 \d+月/ }).textContent()
    const m = t.match(/(\d+)年\s*(\d+)月/)
    if (!m) break
    const cur = Number(m[1]) * 12 + Number(m[2])
    if (cur === TARGET) break
    await page.getByRole('button', { name: cur > TARGET ? '‹' : '›' }).first().click()
  }
  await expect(page.getByRole('heading', { name: /2026年 6月/ })).toBeVisible()

  // 17 號月格：散客（🧍 1 組 · 2 位）與旅行社團體（🚌 2 團 · 30 位）都要顯示。
  // 用 button + hasText 定位日格（頂部月摘要的同字串是 span，不是 button，故不衝突）
  const cell17 = page.locator('button').filter({ hasText: '🚌 2 團 · 30 位' }).filter({ hasText: '🧍 1 組 · 2 位' })
  await expect(cell17).toBeVisible()
  await expect(cell17).toContainText('17')

  // 點入 17 → 當日清單仍含兩個旅行社團卡
  await cell17.click()
  await expect(page.getByText('好賺錢旅行社')).toBeVisible()
  await expect(page.getByText('花花旅行社')).toBeVisible()
})
