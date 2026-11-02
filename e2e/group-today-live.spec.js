import { test, expect } from '@playwright/test'
import { openGroupRow } from './helpers/opsToday'

// 今日團體現場帶位主線（已併入「現場」頁右側欄）：
// 種一筆今日團體（兩梯次共用 101）→ 現場「今日」時間清單點開團體梯次列 → 梯次入座（confirm）
// （2026-11 方案 A：原「團體」籤併進「今日」，團體每一梯是一列）
// → 點地圖團體桌 → 整梯離席 → 清桌完成＋接下一梯入座。
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

test('管理端：今日團體 梯次入座 → 整梯離席 → 清桌＋接下一梯', async ({ page }) => {
  // 登入
  await page.goto('/login')
  await page.getByPlaceholder('your@email.com').fill('berrylin0911@gmail.com')
  await page.getByRole('button', { name: /模擬登入/ }).click()
  await expect(page).toHaveURL(/\/admin/)

  // 進現場分頁 → 左欄「今日」時間清單 → 點開快樂旅行社第一梯（同一團兩梯各一列，第一梯在前）
  await page.locator('aside').getByRole('button', { name: '現場' }).click()
  const row = await openGroupRow(page, '快樂旅行社')
  await expect(row).toContainText('第一梯')
  await expect(row).toContainText('1/2 梯')

  // 第一梯入座（confirm 對話框列出整梯桌號）
  await row.getByRole('button', { name: /梯次入座/ }).click()
  await expect(page.getByText(/整梯 2 桌：101、102/)).toBeVisible()
  await page.getByRole('button', { name: '確認入座', exact: true }).click()
  await expect(page.getByText(/第一梯 已入座/)).toBeVisible()

  // 點地圖上的團體桌 101 → 抽屜顯示團體資訊與「整梯離席（N 桌）」（2026-11 原「此梯離席（整梯）」改名，單桌另有「這桌離席」）
  await page.locator('svg g:has(:text-is("101"))').first().click()
  await expect(page.getByText('快樂旅行社', { exact: true }).first()).toBeVisible() // 抽屜在左欄清單（隱藏中）之前
  await page.getByRole('button', { name: '整梯離席（2 桌）', exact: true }).click()
  await page.getByRole('button', { name: '確認離席', exact: true }).click()
  await expect(page.getByText(/已離席，桌位待清/)).toBeVisible()

  // 清桌中的團體桌 → 「清桌完成＋第二梯 入座」（第二梯也圈了 101）
  await page.getByRole('button', { name: /清桌完成＋第二梯 入座/ }).click()
  await page.getByRole('button', { name: '清桌＋入座', exact: true }).click()
  await expect(page.getByText(/第二梯 入座/).first()).toBeVisible()

  // 抽屜轉為第二梯用餐中
  await expect(page.getByText(/第二梯 13:00/)).toBeVisible()
  await expect(page.getByRole('button', { name: /整梯離席/ })).toBeVisible()
})

// 2026-06-12 防回歸：整輪流程（入座→離席→整梯清桌釋出）後梯次必須收斂——
// 「梯次入座」按鈕不得復活、桌況不得畫回團保；單梯團全消化要自動「整團完成」。
test('管理端：單梯團 入座 → 離席 → 整梯清桌釋出 → 自動整團完成、不可重跑', async ({ page }) => {
  // 覆蓋種子：單梯團（只圈 101、102）
  await page.addInitScript(() => {
    const d = new Date()
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    localStorage.setItem('chicken_group_reservations_v1', JSON.stringify([{
      id: 'GE2E2',
      schemaVersion: 2,
      date: today,
      agencyName: '好賺錢旅行社',
      guideName: 'lida',
      guidePhone: '0911000111',
      counts: { total: 10, vegetarian: 0, child: 0, mobility: 0, wheelchair: 0 },
      allergyText: '',
      status: 'confirmed',
      batches: [
        { id: 'BE2E9', label: '第一梯', timeSlot: '11:00', tableNumbers: ['101', '102'], guests: 7, note: '' },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }]))
  })

  await page.goto('/login')
  await page.getByPlaceholder('your@email.com').fill('berrylin0911@gmail.com')
  await page.getByRole('button', { name: /模擬登入/ }).click()
  await expect(page).toHaveURL(/\/admin/)
  await page.locator('aside').getByRole('button', { name: '現場' }).click()
  await openGroupRow(page, '好賺錢旅行社')

  // 整輪：入座 → 離席（列上）→ 整梯清桌釋出（列入座後移到「已入座」區段、維持展開）
  await page.getByRole('button', { name: /梯次入座/ }).click()
  await page.getByRole('button', { name: '確認入座', exact: true }).click()
  await expect(page.getByText(/第一梯 已入座/)).toBeVisible()
  await page.getByRole('button', { name: '梯次離席' }).click()
  await page.getByRole('button', { name: '確認離席', exact: true }).click()
  await expect(page.getByText(/已離席，桌位待清/)).toBeVisible()
  await page.getByRole('button', { name: /整梯清桌釋出/ }).click()
  await page.getByRole('button', { name: '清桌釋出', exact: true }).click()
  await expect(page.getByText(/已清桌釋出/)).toBeVisible()

  // 收斂斷言：唯一梯已消化 → 自動整團完成，列移出今日清單（比照散客已離席不列）
  await expect(page.getByRole('button', { name: /梯次入座/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '整團完成' })).toHaveCount(0)
  await expect(page.locator('[data-group-batch]')).toHaveCount(0)
  await expect.poll(() => page.evaluate(() =>
    JSON.parse(localStorage.getItem('chicken_group_reservations_v1') || '[]').find(g => g.id === 'GE2E2')?.status)).toBe('completed')
})
