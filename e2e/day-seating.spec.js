import { test, expect } from '@playwright/test'

// 規劃「當日排位」（2026-10-30 demo）：月曆點日期 → 直接看到當天全部訂位＋桌況圖、同畫面排桌。
// 假資料走 dev 專用的 ?demo=dayplan 種子（src/dev/dayplanDemoSeed.js），順便驗證種子機制本身。
// 時間固定 2026-11-02 09:00（台北）→ 明天＝11/3、後天＝11/4，不跨月。
// SHOTS_DIR 有值時順手存截圖（給 Barry 的 demo 圖），沒設就不存。
test.use({ timezoneId: 'Asia/Taipei', viewport: { width: 1180, height: 820 } })

const NOW = '2026-11-02T09:00:00+08:00'
const D1 = '2026-11-03'
const D2 = '2026-11-04'
const SHOTS = process.env.SHOTS_DIR
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }) }
const table = (page, n) => page.locator(`svg g:has(:text-is("${n}"))`).first()
const banner = (page) => page.getByTestId('seat-banner')
const row = (page, name) => page.getByTestId('day-seating').getByRole('button', { name: new RegExp(name) }).first()

test.beforeEach(async ({ page }) => {
  await page.route('https://**/*', route => route.abort())
  await page.clock.setFixedTime(new Date(NOW))
  await page.route('**/adminPullData', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'e2e-offline' }) }))
  await page.route('**/adminPushData', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }))
  await page.route('**/admin*', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false }) }))
})

async function loginWithDemo(page) {
  await page.goto('/login?demo=dayplan')
  await page.getByPlaceholder('your@email.com').fill('berrylin0911@gmail.com')
  await page.getByRole('button', { name: /模擬登入/ }).click()
  await expect(page).toHaveURL(/\/admin/)
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('chicken_bookings_v1') || '[]').filter(b => b.id.startsWith('DEMO-')).length)
  expect(stored).toBe(22)
}

async function openPlanningDay(page, dayNum) {
  await page.locator('aside').getByRole('button', { name: '規劃' }).click()
  await expect(page.getByRole('button', { name: /^11月3日/ })).toBeVisible()
  await shot(page, '01-entry-calendar')
  await page.getByRole('button', { name: new RegExp(`^11月${dayNum}日`) }).click()
  await expect(page.getByTestId('day-seating')).toBeVisible()
}

const storedBooking = (page, name) => page.evaluate(n => JSON.parse(localStorage.getItem('chicken_bookings_v1')).find(b => b.name === n), name)

test('月曆點日期 → 直接進當日排位；11 人選 4＋6 擠一擠 → 確認 → 自動跳下一筆', async ({ page }) => {
  await loginWithDemo(page)
  await openPlanningDay(page, 3)

  // 當天全部訂位（散客＋團體；取消的何先生不列），預設最早未配桌＝林老師（11:30 同時段先排大組）
  const panel = page.getByTestId('day-seating')
  await expect(page.getByTestId('day-seating-summary')).toContainText('午餐第一批 7 組・未配桌 3')
  await expect(panel.getByText('山水旅行社')).toBeVisible()
  await expect(panel.getByText('團保 201、202、203')).toBeVisible()
  await expect(panel.getByText('桌 105')).toBeVisible()
  await expect(panel.getByText('何先生')).toHaveCount(0)
  await expect(banner(page)).toContainText('排位：林老師（11 位 · 11:30）')
  await expect(banner(page)).toContainText('建議')
  await shot(page, '02-day-landscape')

  // 點 4 人桌 112 ＋ 6 人桌 110 → 10 席、擠一擠 12 → 黃字超坐 1 位
  await table(page, '112').click()
  await table(page, '110').click()
  await expect(banner(page)).toContainText('已選 10/11 席 · 2 桌')
  await expect(page.getByTestId('squeeze-badge')).toHaveText('擠一擠 · 超坐 1 位')
  await shot(page, '03-seating')

  await page.getByRole('button', { name: '確認併桌' }).click()
  await expect(page.getByText('林老師（11 位）已併桌配到 112 + 110（擠一擠超坐 1 位）')).toBeVisible()
  expect(await storedBooking(page, '林老師')).toMatchObject({ assignedTableId: '112', extraTableIds: ['110'] })
  // 自動跳下一筆未配桌（同場次 11:30 陳先生）
  await expect(banner(page)).toContainText('排位：陳先生（2 位 · 11:30）')
  await expect(page.getByTestId('day-seating-summary')).toContainText('未配桌 2')
  await shot(page, '04-after-confirm')

  // 直向也能用
  await page.setViewportSize({ width: 820, height: 1180 })
  await expect(banner(page)).toBeVisible()
  await shot(page, '05-day-portrait')
})

test('防呆沿用：撞桌、停用、時間重疊、跨樓層都點不進去', async ({ page }) => {
  await loginWithDemo(page)
  await openPlanningDay(page, 3)
  await expect(banner(page)).toContainText('排位：林老師')

  await table(page, '105').click() // 王小姐 11:00 已配
  await expect(page.getByText('105 在此場次已被佔用')).toBeVisible()
  // demo 種子：113 明天維修 → 地圖本身就不給點（aria-disabled），硬點也加不進已選
  await expect(table(page, '113')).toHaveAttribute('aria-disabled', 'true')
  await expect(table(page, '113')).toHaveAttribute('aria-label', /維修/)
  await table(page, '113').click({ force: true })
  await expect(banner(page)).toContainText('已選 0/11 席 · 0 桌')
  await table(page, '107').click() // 吳小姐 13:00 預配，與 11:30–13:10 重疊（assignmentWindow）
  await expect(page.getByText('107 與同日其他預配或團體時間重疊')).toBeVisible()
  await table(page, '110').click()
  await page.getByRole('button', { name: '2F', exact: true }).click()
  await table(page, '205').click()
  await expect(page.getByText('併桌需在同一樓層，請改選同層的桌')).toBeVisible()
  await table(page, '201').click() // 山水旅行社團保
  await expect(page.getByText('201 在此場次已被佔用')).toBeVisible()
  // 一張都沒被寫進去
  expect(await storedBooking(page, '林老師')).toMatchObject({ assignedTableId: null })
  await expect(banner(page)).toContainText('已選 6/11 席 · 1 桌')
  await expect(page.getByRole('button', { name: '確認' , exact: true })).toBeDisabled()
})

test('已配桌：改桌 → 取消配桌 → 復原', async ({ page }) => {
  await loginWithDemo(page)
  await openPlanningDay(page, 3)

  await row(page, '王小姐').click()
  await page.getByRole('button', { name: '改桌' }).click()
  await expect(banner(page)).toContainText('改桌：王小姐（4 位 · 11:00）')
  await table(page, '105').click() // 取消原桌
  await table(page, '111').click()
  await page.getByRole('button', { name: '確認', exact: true }).click()
  await expect(page.getByText('王小姐（4 位）已配到 111')).toBeVisible()
  expect(await storedBooking(page, '王小姐')).toMatchObject({ assignedTableId: '111', extraTableIds: [] })
  await expect(page.getByTestId('day-seating').getByText('桌 111')).toBeVisible()

  await row(page, '王小姐').click()
  await page.getByRole('button', { name: '取消配桌' }).click()
  await expect(page.getByText('已取消 王小姐 的配桌（111）')).toBeVisible()
  expect(await storedBooking(page, '王小姐')).toMatchObject({ assignedTableId: null })
  await page.getByTestId('toast-action').click()
  await expect(page.getByText('已復原 王小姐 的配桌（111）')).toBeVisible()
  expect(await storedBooking(page, '王小姐')).toMatchObject({ assignedTableId: '111' })
})

test('公休日：清單照看，配桌入口與點桌全擋', async ({ page }) => {
  await page.addInitScript((d) => {
    localStorage.setItem('chicken_settings_v1', JSON.stringify({ closures: { closedDates: [d], closedSlots: {}, closedSeatings: {} } }))
  }, D2)
  await loginWithDemo(page)
  await openPlanningDay(page, 4)
  await expect(page.getByTestId('day-seating-date')).toContainText('公休')
  await expect(page.getByText(/本日公休：只能看，不能配桌/)).toBeVisible()
  await expect(banner(page)).toHaveCount(0)
  await row(page, '郭先生').click()
  await expect(page.getByText('本日公休，無法配桌。')).toBeVisible()
  await expect(page.getByRole('button', { name: '配桌', exact: true })).toHaveCount(0)
  await table(page, '103').click()
  expect(await storedBooking(page, '郭先生')).toMatchObject({ assignedTableId: null })
})

test('訂位頁日曆點日期 → 直接進同一個當日排位；排好後「月曆」回到訂位頁日曆', async ({ page }) => {
  await loginWithDemo(page)
  await page.locator('aside').getByRole('button', { name: '訂位' }).click()
  await page.getByRole('button', { name: /日曆/ }).click()
  await expect(page.getByText(/點日期看當天訂位/)).toBeVisible()
  await shot(page, '07-bookings-calendar')
  await page.getByRole('button').filter({ has: page.getByText('3', { exact: true }) }).filter({ hasText: '組' }).first().click()

  // 直接是當日排位（同一個元件），沒有中間層；仍在訂位分頁
  await expect(page.getByTestId('day-seating')).toBeVisible()
  await expect(page).toHaveURL(/tab=bookings/)
  await expect(page.getByTestId('day-seating-date')).toContainText('11/3')
  await expect(banner(page)).toContainText('排位：林老師')
  await table(page, '112').click()
  await table(page, '110').click()
  await page.getByRole('button', { name: '確認併桌' }).click()
  await expect(banner(page)).toContainText('排位：陳先生')
  await shot(page, '08-bookings-day-seating')

  // 返回：回到訂位頁日曆（停在 11/3 當日清單），不是規劃頁
  await page.getByRole('button', { name: '月曆', exact: true }).click()
  await expect(page.getByTestId('day-seating')).toHaveCount(0)
  await expect(page).toHaveURL(/tab=bookings/)
  await expect(page.getByRole('button', { name: /展開月曆/ })).toBeVisible()
  await expect(page.getByText('預配 112+110').or(page.getByText(/112/).first())).toBeVisible()
  // 清單標頭「排位」可再進同一畫面
  await page.getByRole('button', { name: /^排位/ }).click()
  await expect(page.getByTestId('day-seating')).toBeVisible()
})

test('規劃頁進來的「月曆」回規劃月曆', async ({ page }) => {
  await loginWithDemo(page)
  await openPlanningDay(page, 3)
  await page.getByRole('button', { name: '月曆', exact: true }).click()
  await expect(page).toHaveURL(/tab=planning/)
  await expect(page.getByRole('button', { name: /^11月3日/ })).toBeVisible()
  await expect(page.getByTestId('day-seating')).toHaveCount(0)
})
