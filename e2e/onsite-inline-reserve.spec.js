import { test, expect } from '@playwright/test'

// 2026-09 店主：「在現場按了：今日訂位 > 新增今日訂位，還可以新增已經過了的時間段，而且整個 UX 流程也沒有很順」。
// 改成「留在現場頁新增」：左欄原地換成新增面板（姓氏／人數／電話跟帶位一樣是大按鈕），
// 時段只列還沒過的，桌子直接點右邊桌況圖（可不選），存完回「今日訂位」、新的那筆閃一下。
// 鎖桌時機（「接近時段才鎖」）：離用餐 30 分內存檔才鎖桌，更早只預配（桌況仍空、仍可帶位）。
// 時間用 page.clock 固定、時區固定 Asia/Taipei；後台本機模式以 localStorage 為後端，攔截 admin* 雲端端點。

test.use({ timezoneId: 'Asia/Taipei' })

const TODAY = '2026-09-19'
const at = (hhmm) => new Date(`${TODAY}T${hhmm}:00+08:00`)

test.beforeEach(async ({ page }) => {
  await page.route('**/adminPullData', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'e2e-offline' }) }))
  await page.route('**/adminPushData', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }))
  await page.route('**/admin*', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false }) }))
  await page.addInitScript(() => {
    localStorage.setItem('chicken_bookings_v1', JSON.stringify([]))
    localStorage.removeItem('chicken_tables_v3')
    localStorage.removeItem('chicken_group_reservations_v1')
    localStorage.removeItem('chicken_waitlist_v1')
  })
})

async function openPanel(page) {
  await page.goto('/login')
  await page.getByPlaceholder('your@email.com').fill('berrylin0911@gmail.com')
  await page.getByRole('button', { name: /模擬登入/ }).click()
  await expect(page).toHaveURL(/\/admin/)
  await page.locator('aside').getByRole('button', { name: '現場' }).click()
  await page.getByRole('button', { name: /^今日訂位/ }).click()
  await page.getByRole('button', { name: '＋ 新增今日訂位' }).click()
  await expect(page.getByTestId('quick-reserve-panel')).toBeVisible()
}

const panel = (page) => page.getByTestId('quick-reserve-panel')
const mapTable = (page, n) => page.locator(`svg g:has(:text-is("${n}"))`).first()
const readState = (page) => page.evaluate(() => ({
  bookings: JSON.parse(localStorage.getItem('chicken_bookings_v1') || '[]'),
  tables: JSON.parse(localStorage.getItem('chicken_tables_v3') || '[]'),
}))

async function typePhone(page, digits) {
  await panel(page).getByLabel('電話', { exact: true }).click()
  const pad = page.getByRole('dialog', { name: '電話數字鍵盤' })
  for (const d of digits) await pad.getByRole('button', { name: d, exact: true }).click()
  await pad.getByRole('button', { name: 'OK' }).click()
}

test('現場→今日訂位→＋新增：姓氏/稱謂→人數→時段→電話→點地圖桌→確認 → 回今日訂位看到新卡「預配」', async ({ page }) => {
  await page.clock.setFixedTime(at('13:10'))
  await openPanel(page)

  // 不跳頁：桌況圖仍在右邊；時段只列還沒過的（13:00 以前不列），預設下一個還沒開始的 13:30
  await expect(page.locator('svg').first()).toBeVisible()
  await expect(panel(page).getByRole('button', { name: '12:30' })).toHaveCount(0)
  await expect(panel(page).getByRole('button', { name: '13:30' })).toHaveAttribute('aria-pressed', 'true')
  // 人數預設 2；欄位不齊 → 主按鈕停用、寫明還差什麼
  await expect(panel(page).getByRole('button', { name: '2 位' })).toHaveAttribute('aria-pressed', 'true')
  await expect(panel(page).getByRole('button', { name: '還差：姓名／電話' })).toBeDisabled()

  // 姓氏＋稱謂（點一下換小姐）→ 人數 3 → 時段 14:00（離現在 50 分 → 預配型）→ 電話
  await panel(page).getByRole('button', { name: '王', exact: true }).click()
  await panel(page).getByRole('button', { name: /^稱謂：先生/ }).click()
  await panel(page).getByRole('button', { name: '3 位' }).click()
  await panel(page).getByRole('button', { name: '14:00' }).click()
  await typePhone(page, '0912345678')

  // 建議桌預選（預配 105）；點地圖 106 改選
  await expect(panel(page).getByTestId('reserve-table')).toContainText('預配 105')
  await expect(panel(page).getByText(/預配：桌子先不鎖、現在仍可帶位/)).toBeVisible()
  await mapTable(page, '106').click()
  await expect(panel(page).getByTestId('reserve-table')).toContainText('預配 106')

  const confirm = panel(page).getByRole('button', { name: '確認新增 · 14:00 · 3 位 · 預配 106' })
  await expect(confirm).toBeEnabled()
  await confirm.click()

  // 回「今日訂位」籤，新卡捲到可見並閃一下；toast 據實
  await expect(page.getByText('已新增 王小姐 14:00 · 預配 106')).toBeVisible()
  await expect(page.getByTestId('quick-reserve-panel')).toHaveCount(0)
  // 本裝置自己建的不再跳「📋 新訂位」提醒（已有上面的確認 toast）
  await expect(page.getByText(/📋 新訂位/)).toHaveCount(0)
  const card = page.locator('[data-booking-id][data-flash="true"]')
  await expect(card).toBeVisible()
  await expect(card).toContainText('王小姐')
  await expect(card).toContainText('預配 106')

  const { bookings, tables } = await readState(page)
  const b = bookings.find(x => x.name === '王小姐')
  expect(b).toMatchObject({ guests: 3, timeSlot: '14:00', phone: '0912345678', source: 'phone', status: 'confirmed', assignedTableId: '106' })
  expect(tables.find(t => t.number === '106').status).toBe('vacant')   // 預配：桌況不鎖
})

test('09:00 新增 18:00 → 只預配：地圖該桌仍可入座（帶位籤點得到、警示寫預配會保留）', async ({ page }) => {
  await page.clock.setFixedTime(at('09:00'))
  await openPanel(page)

  // 09:00 → 預設 11:00（今天第一個還沒開始的時段）；改 18:00，來源現場（電話選填）
  await expect(panel(page).getByRole('button', { name: '11:00' })).toHaveAttribute('aria-pressed', 'true')
  await panel(page).getByRole('button', { name: '來源：現場' }).click()
  await panel(page).getByRole('button', { name: '陳', exact: true }).click()
  await panel(page).getByRole('button', { name: '18:00' }).click()
  await expect(panel(page).getByTestId('reserve-table')).toContainText('預配 105')
  await panel(page).getByRole('button', { name: '確認新增 · 18:00 · 2 位 · 預配 105' }).click()
  await expect(page.getByText('已新增 陳先生 18:00 · 預配 105')).toBeVisible()

  let { tables } = await readState(page)
  expect(tables.find(t => t.number === '105').status).toBe('vacant')

  // 地圖：105 是「18:00 預配」藍色虛線，但仍可帶位——帶位籤點 105 會選進面板並據實警示「會保留」
  await expect(page.getByText('18:00 預配')).toBeVisible()
  await page.getByRole('button', { name: /^帶位/ }).click()
  await mapTable(page, '105').click()
  await expect(page.getByText(/105 已於排位規劃預留給 陳先生.*18:00 陳先生 的預配會保留/)).toBeVisible()
  ;({ tables } = await readState(page))
  expect(tables.find(t => t.number === '105').status).toBe('vacant')
})

test('離用餐 30 分內新增 → 存檔即鎖桌（桌 105）；點非候選桌 toast 說明、不選取', async ({ page }) => {
  await page.clock.setFixedTime(at('13:10'))
  await openPanel(page)

  await panel(page).getByRole('button', { name: '來源：現場' }).click()
  await panel(page).getByRole('button', { name: '林', exact: true }).click()
  // 預設 13:30（離現在 20 分）→ 鎖桌型
  await expect(panel(page).getByTestId('reserve-table')).toContainText('桌 105')
  await expect(panel(page).getByText(/存檔後立刻鎖桌/)).toBeVisible()
  // 大組（沒有單桌坐得下 7 位）→ 不選桌，存檔後再到今日訂位指派併桌
  await panel(page).getByRole('button', { name: '7 位' }).click()
  await expect(panel(page).getByText(/店裡沒有單桌坐得下 7 位/)).toBeVisible()
  // 非候選桌：5 位時 105（4 人桌）坐不下 → 點了只 toast 說明，不選取（仍是建議的 6 人桌）
  await panel(page).getByRole('button', { name: '5 位' }).click()
  await mapTable(page, '105').click()
  await expect(page.getByText('105 只有 4 席，坐不下 5 位')).toBeVisible()
  await expect(panel(page).getByTestId('reserve-table')).not.toContainText('105')
  await panel(page).getByRole('button', { name: '2 位' }).click()

  await panel(page).getByRole('button', { name: '確認新增 · 13:30 · 2 位 · 桌 105' }).click()
  await expect(page.getByText('已新增 林先生 13:30 · 桌 105')).toBeVisible()
  const { bookings, tables } = await readState(page)
  const b = bookings.find(x => x.name === '林先生')
  expect(b.assignedTableId).toBe('105')
  const t = tables.find(x => x.number === '105')
  expect(t.status).toBe('reserved')
  expect(t.currentBookingId).toBe(b.id)
})

test('返回：有填姓名時先確認「放棄這筆新增？」；繼續填留在面板、ESC＋放棄回今日訂位', async ({ page }) => {
  await page.clock.setFixedTime(at('13:10'))
  await openPanel(page)

  await panel(page).getByRole('button', { name: '張', exact: true }).click()
  await panel(page).getByRole('button', { name: /返回今日訂位/ }).click()
  await expect(page.getByText('放棄這筆新增？')).toBeVisible()
  await page.getByRole('button', { name: '繼續填' }).click()
  await expect(panel(page)).toBeVisible()
  await expect(panel(page).getByRole('button', { name: '張', exact: true })).toHaveAttribute('aria-pressed', 'true')

  await page.keyboard.press('Escape')
  await expect(page.getByText('放棄這筆新增？')).toBeVisible()
  await page.getByRole('button', { name: '放棄', exact: true }).click()
  await expect(page.getByTestId('quick-reserve-panel')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '＋ 新增今日訂位' })).toBeVisible()
  expect((await readState(page)).bookings).toHaveLength(0)
})
