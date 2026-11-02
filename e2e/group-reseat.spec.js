import { test, expect } from '@playwright/test'
import { openGroupRow } from './helpers/opsToday'

// 團體「改派桌位」主線 + 完成團體側欄治理：
// 1) 散客先佔走團體圈桌 101 → 梯次入座失敗（中文狀態）→ 自動進入改派模式
//    → 點替代桌 103 → 二步確認 → 整梯入座。
// 2) 整團完成 → 團體梯次列移出「今日」清單、無入座按鈕；進行中時回傳單可印。
// （2026-11 方案 A：原「團體」籤併進「今日」時間清單，入口改成點開團體梯次列）
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
    localStorage.removeItem('chicken_tables_v3')
    const d = new Date()
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    localStorage.setItem('chicken_group_reservations_v1', JSON.stringify([{
      id: 'GRS1',
      schemaVersion: 2,
      date: today,
      agencyName: '改派旅行社',
      guideName: '林導',
      guidePhone: '0911000111',
      counts: { total: 12, vegetarian: 0, child: 0, mobility: 0, wheelchair: 0 },
      allergyText: '',
      status: 'confirmed',
      batches: [
        { id: 'BRS1', label: '第一梯', timeSlot: '11:30', tableNumbers: ['101', '102'], guests: 12, note: '' },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }]))
  })
})

async function login(page) {
  await page.goto('/login')
  await page.getByPlaceholder('your@email.com').fill('berrylin0911@gmail.com')
  await page.getByRole('button', { name: /模擬登入/ }).click()
  await expect(page).toHaveURL(/\/admin/)
  await page.locator('aside').getByRole('button', { name: '現場' }).click()
}

test('桌被佔 → 中文錯誤 + 改派模式 → 點替代桌整梯入座', async ({ page }) => {
  await login(page)

  // 散客先佔走 101（團體保留桌 → 覆蓋確認 → walk-in modal）
  // 帶位籤上點空桌＝選進帶位面板（v3），所以改從團體梯次列展開後的桌號按鈕開該桌抽屜
  await openGroupRow(page, '改派旅行社')
  await page.getByRole('button', { name: '101', exact: true }).click()
  await page.getByRole('button', { name: /散客入座（覆蓋團體預留）/ }).click()
  await page.getByRole('button', { name: '改散客入座', exact: true }).click()
  await page.getByRole('button', { name: '確認入座', exact: true }).click()
  await expect(page.getByText(/已入座 101/)).toBeVisible()

  // 團體梯次入座 → 失敗（101 用餐中，中文）→ 自動進入改派模式
  await page.keyboard.press('Escape') // 關掉 101 抽屜回左欄
  await openGroupRow(page, '改派旅行社')
  await page.getByRole('button', { name: /梯次入座/ }).first().click()
  await page.getByRole('button', { name: '確認入座', exact: true }).click()
  await expect(page.getByText(/101（用餐中）被佔用/)).toBeVisible()
  await expect(page.getByText(/改派桌位：改派旅行社/)).toBeVisible()

  // 點替代桌 103 → 二步確認 → 整梯入座
  await page.locator('svg g:has(:text-is("103"))').first().click()
  await expect(page.getByText(/把 101 改派為 103 並整梯入座/)).toBeVisible()
  await page.getByRole('button', { name: /確認改派/ }).click()
  await expect(page.getByText(/已改派 101 → 103/)).toBeVisible()

  // 成功後抽屜聚焦新桌 → ESC 關閉抽屜回側欄，團體梯次列顯示新桌號、可離席
  await page.keyboard.press('Escape')
  await openGroupRow(page, '改派旅行社')
  await expect(page.getByRole('button', { name: '103', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /梯次離席/ })).toBeVisible()
})

test('整團完成 → 團體梯次列移出今日清單、不可再入座；進行中可印回傳單', async ({ page }) => {
  await login(page)

  // 入座 → 整團完成
  const row = await openGroupRow(page, '改派旅行社')
  await row.getByRole('button', { name: /梯次入座/ }).click()
  await page.getByRole('button', { name: '確認入座', exact: true }).click()
  await expect(page.getByText(/第一梯 已入座/)).toBeVisible()
  // 進行中（已入座段、列仍展開）：回傳單列印鈕在列上
  await expect(page.locator('[data-section="seated"] [data-group-batch]')).toHaveCount(1)
  await expect(row.locator('button[title="回傳單"]')).toBeVisible()
  await row.getByRole('button', { name: '整團完成', exact: true }).click()
  await page.getByRole('button', { name: '完成釋桌', exact: true }).click()
  await expect(page.getByText(/整團已完成/)).toBeVisible()

  // 比照散客已離席：完成的團不列，也沒有任何入座／離席／整團完成按鈕
  await expect(page.locator('[data-group-batch]')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /梯次入座/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /梯次離席/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '整團完成', exact: true })).toHaveCount(0)

  // 「團體」籤已移除（併進「今日」）
  await expect(page.getByRole('button', { name: /^團體\s*\d*$/ })).toHaveCount(0)
})
