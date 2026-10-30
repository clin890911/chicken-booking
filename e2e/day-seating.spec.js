import { test, expect } from '@playwright/test'

// 規劃「當日排位」（2026-10-30 起）：月曆點日期 → 直接看到當天全部訂位＋桌況圖、同畫面排桌。
// 假資料走 dev 專用的 ?demo=dayplan 種子（src/dev/dayplanDemoSeed.js），順便驗證種子機制本身。
// 時間固定 2026-11-02 09:00（台北）→ 明天＝11/3、後天＝11/4，不跨月。
// SHOTS_DIR 有值時順手存截圖（驗收用），沒設就不存。
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

test('規劃頁：排位控制列上就有「當日總覽」分頁，一下回月曆＋當日總覽', async ({ page }) => {
  await loginWithDemo(page)
  await openPlanningDay(page, 3)
  const tabs = page.getByTestId('day-seating').getByLabel('規劃視圖')
  await expect(tabs.getByRole('button', { name: '當日排位' })).toHaveAttribute('aria-pressed', 'true')
  await expect(tabs.getByRole('button', { name: '排位地圖' })).toBeVisible() // 舊排位地圖本版保留
  await tabs.getByRole('button', { name: '當日總覽' }).click()
  await expect(page).toHaveURL(/tab=planning/)
  await expect(page.getByRole('button', { name: /^11月3日/ })).toBeVisible()
  await expect(page.getByTestId('day-seating')).toHaveCount(0)
})

test('訂位頁當日排位：選中訂位就有訂位卡的動作——聯絡、編輯、交班、更多（含取消訂位：保留確認框＋復原）', async ({ page }) => {
  await loginWithDemo(page)
  await page.locator('aside').getByRole('button', { name: '訂位' }).click()
  await page.getByRole('button', { name: /日曆/ }).click()
  await page.getByRole('button').filter({ has: page.getByText('3', { exact: true }) }).filter({ hasText: '組' }).first().click()
  await expect(page.getByTestId('day-seating')).toBeVisible()

  await row(page, '王小姐').click()
  const detail = page.getByTestId('day-seating-detail')
  await expect(detail.getByRole('link', { name: /聯絡 王小姐/ })).toHaveAttribute('href', 'tel:0912000101')
  await expect(detail.getByRole('button', { name: '改桌' })).toBeVisible()
  await expect(detail.getByRole('button', { name: '交班事項' })).toBeVisible()
  await shot(page, '09-bookings-actions')

  // 編輯：走既有 EditBookingModal
  await detail.getByRole('button', { name: '編輯' }).click()
  await expect(page.getByText(/編輯訂位 · #DEMO-/)).toBeVisible()
  await page.getByRole('button', { name: '取消', exact: true }).click()
  await expect(page.getByText(/編輯訂位 · #DEMO-/)).toHaveCount(0)

  // 更多：訂位詳情（未來日沒有 No-show）
  await detail.getByLabel('王小姐 更多操作').click()
  await expect(detail.getByRole('button', { name: '訂位詳情（顧客紀錄）' })).toBeVisible()
  await expect(detail.getByRole('button', { name: '標 No-show' })).toHaveCount(0)

  // 取消訂位（在「更多」裡，同訂位卡）：確認框保留（LINE 通知收不回）→ 取消 → 清單不再列 → 復原
  await detail.getByRole('button', { name: '取消訂位' }).click()
  await expect(page.getByText('取消 王小姐 11:00 的訂位？')).toBeVisible()
  await page.getByRole('button', { name: '取消訂位', exact: true }).last().click()
  await expect(page.getByText('已取消 王小姐 的訂位')).toBeVisible()
  expect(await storedBooking(page, '王小姐')).toMatchObject({ status: 'cancelled' })
  await expect(row(page, '王小姐')).toHaveCount(0)
  await page.getByTestId('toast-action').click()
  await expect.poll(async () => (await storedBooking(page, '王小姐')).status).toBe('confirmed')
  await expect(row(page, '王小姐')).toBeVisible()
})

test('過去日期：清單照看、沒有配桌入口', async ({ page }) => {
  await loginWithDemo(page)
  await openPlanningDay(page, 3)
  await page.getByRole('button', { name: '前一日' }).click()
  await page.getByRole('button', { name: '前一日' }).click() // 11/1（今天是 11/2）
  await expect(page.getByTestId('day-seating-date')).toContainText('11/1')
  await expect(page.getByText(/過去的日期：只能看，不能配桌/)).toBeVisible()
  await expect(banner(page)).toHaveCount(0)
  await expect(page.getByTestId('day-seating-empty')).toContainText('還沒有任何訂位')
  await expect(page.getByRole('button', { name: '新增訂位' })).toHaveCount(0)
})

test('今天：開桌前 30 分內配桌＝現場指派（鎖桌、非空桌不能選）；已鎖桌的從規劃頁「到現場頁改桌」', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-02T10:45:00+08:00')) // 11:00 的訂位離用餐 15 分
  await loginWithDemo(page)
  await page.evaluate(() => {
    const today = '2026-11-02'
    const bk = (id, name, extra = {}) => ({ id, name, phone: '', guests: 2, date: today, timeSlot: '11:00', source: 'phone', status: 'confirmed', assignedTableId: null, extraTableIds: [], notes: {}, createdBy: 'staff', createdAt: new Date().toISOString(), ...extra })
    const bookings = JSON.parse(localStorage.getItem('chicken_bookings_v1') || '[]')
    localStorage.setItem('chicken_bookings_v1', JSON.stringify([...bookings, bk('E2E-T1', '近客'), bk('E2E-T2', '鎖桌客', { assignedTableId: '108' })]))
    const tables = JSON.parse(localStorage.getItem('chicken_tables_v3'))
    localStorage.setItem('chicken_tables_v3', JSON.stringify(tables.map(t =>
      String(t.number) === '108' ? { ...t, status: 'reserved', currentBookingId: 'E2E-T2' }
        : String(t.number) === '106' ? { ...t, status: 'dining', currentBookingId: null, seatedAt: new Date().toISOString() } : t)))
  })
  // 重新載入讓 app 讀到注入的資料：/admin 頁面本身放行（beforeEach 的 **/admin* 只該攔後端端點）
  await page.route('**/admin*', route => route.request().resourceType() === 'document' ? route.continue() : route.fallback())
  await page.reload()
  await page.locator('aside').getByRole('button', { name: '規劃' }).click()
  await page.getByRole('button', { name: /^11月2日/ }).click()
  await expect(page.getByTestId('day-seating')).toBeVisible()
  await expect(banner(page)).toContainText('排位：近客')
  await expect(page.getByTestId('hold-badge')).toBeVisible()

  await table(page, '106').click() // 此刻用餐中
  await expect(page.getByText(/106 此刻不是空桌/)).toBeVisible()
  await table(page, '105').click()
  await page.getByRole('button', { name: '確認', exact: true }).click()
  await expect(page.getByText('近客（2 位）已指派並鎖桌 105')).toBeVisible()
  expect(await storedBooking(page, '近客')).toMatchObject({ assignedTableId: '105' })
  const t105 = await page.evaluate(() => JSON.parse(localStorage.getItem('chicken_tables_v3')).find(t => String(t.number) === '105'))
  expect(t105).toMatchObject({ status: 'reserved', currentBookingId: 'E2E-T1' })

  // 已鎖桌：這裡不給改桌／取消配桌，改給「到現場頁改桌」→ 現場頁改桌模式
  await row(page, '鎖桌客').click()
  const detail = page.getByTestId('day-seating-detail')
  await expect(detail.getByText('今天已在現場鎖桌')).toBeVisible()
  await expect(detail.getByRole('button', { name: '取消配桌' })).toHaveCount(0)
  await detail.getByRole('button', { name: '到現場頁改桌' }).click()
  await expect(page).toHaveURL(/tab=ops/)
  await expect(page.getByText(/重新選桌：鎖桌客/)).toBeVisible()
})
