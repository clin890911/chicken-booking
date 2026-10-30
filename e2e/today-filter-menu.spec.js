import { test, expect } from '@playwright/test'

// 訂位「今日」（2026-10-31，Barry）：
//   1) 來源分段鈕＋「隱藏已離」併成一顆「篩選」鈕（details[data-popover]，來源多選勾選）；
//      點外面、Esc、按選單裡的按鈕會收；勾選框勾來勾去不收（多選）。
//   2) 統計卡每格可點：今日訂位→重設篩選（預設仍隱藏已離）、未指派→今天的當日排位、用餐中→現場頁、已到/離→原地只看已到。
//   3) iPad 1180×820：頁首固定、清單自己捲（#196）仍成立。
// SHOTS_DIR 有值時存截圖（驗收用）。
test.use({ timezoneId: 'Asia/Taipei', viewport: { width: 1180, height: 820 } })

const TODAY = '2026-10-30'
const SHOTS = process.env.SHOTS_DIR
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }) }
const SUR = ['陳', '林', '黃', '張', '李', '王', '吳', '劉', '蔡', '楊', '許', '鄭', '謝', '郭', '洪']
const SLOTS = ['11:00', '11:30', '12:00', '12:30', '13:00', '17:00', '17:30', '18:00', '18:30']
const SRC = ['phone', 'online', 'walkin', 'line', 'phone']
const BOOKINGS = Array.from({ length: 20 }, (_, i) => ({
  id: `TF-${i}`, name: `${SUR[i % SUR.length]}${i % 2 ? '先生' : '小姐'}`, phone: `09120002${String(i).padStart(2, '0')}`,
  guests: 2 + (i % 5), date: TODAY, timeSlot: SLOTS[i % SLOTS.length], source: SRC[i % SRC.length],
  status: i < 6 ? 'arrived' : (i === 19 ? 'completed' : 'confirmed'), assignedTableId: i < 6 ? String(101 + i) : null, extraTableIds: [],
  actualArrivalTime: i < 6 ? '2026-10-30T03:20:00.000Z' : null, notes: {}, createdBy: 'staff', createdAt: '2026-10-29T00:00:00.000Z',
}))
const visibleIds = (page) => page.getByTestId('today-list').evaluate(el =>
  [...el.querySelectorAll('[data-testid="phone-full"]')].map(p => p.textContent.replace(/\D/g, '')).sort())
const phonesOf = (pred) => BOOKINGS.filter(pred).map(b => b.phone).sort()
const pageOverflow = (page) => page.evaluate(() => {
  for (const d of document.querySelectorAll('main > div')) if (d.textContent.includes('雲端同步未啟用')) d.style.display = 'none'
  const c = document.querySelector('[data-testid=admin-content]')
  return c.scrollHeight - c.clientHeight
})

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date(`${TODAY}T11:50:00+08:00`))
  await page.route('**/admin*', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'e2e-offline' }) }))
  await page.addInitScript((bookings) => {
    if (sessionStorage.getItem('e2e-seeded')) return
    sessionStorage.setItem('e2e-seeded', '1')
    localStorage.setItem('chicken_bookings_v1', JSON.stringify(bookings))
    localStorage.setItem('chicken_group_reservations_v1', '[]')
    localStorage.setItem('chicken_group_blank_purge_v1', '1')
  }, BOOKINGS)
  await page.goto('/login')
  await page.getByPlaceholder('your@email.com').fill('berrylin0911@gmail.com')
  await page.getByRole('button', { name: /模擬登入/ }).click()
  await expect(page).toHaveURL(/\/admin/)
  await page.locator('aside').getByRole('button', { name: '訂位' }).click()
  await expect(page.getByTestId('today-list').getByText('蔡小姐').first()).toBeVisible()
  await page.waitForTimeout(400)
})

test('篩選鈕：預設清單不變、勾選多選、點外面／Esc／按鈕收合、鍵盤可操作、頁首固定', async ({ page }) => {
  const summary = page.getByTestId('today-filter').locator('summary')
  const menu = page.getByRole('group', { name: '訂位篩選選項' })
  await expect(page.getByLabel('來源篩選')).toHaveCount(0)
  await expect(summary).toHaveAttribute('aria-label', '篩選：全部來源；隱藏已離')
  // 預設：今日、非已離，任何來源（＝改動前「全部＋隱藏已離」）
  expect(await visibleIds(page)).toEqual(phonesOf(b => b.status !== 'completed'))
  expect(await pageOverflow(page)).toBeLessThanOrEqual(1)
  await shot(page, 'after-default')

  // 開選單 → 截圖；勾選框勾來勾去不收
  await summary.click()
  await expect(menu).toBeVisible()
  await shot(page, 'after-menu-open')
  await menu.getByRole('checkbox', { name: '線上' }).uncheck()
  await menu.getByRole('checkbox', { name: '現場' }).uncheck()
  await menu.getByRole('checkbox', { name: '團體' }).uncheck()
  await expect(menu).toBeVisible()
  expect(await visibleIds(page)).toEqual(phonesOf(b => b.status !== 'completed' && ['phone', 'line'].includes(b.source)))
  // 點外面收
  await page.getByPlaceholder('搜尋姓名 / 電話 / 桌號 / 編號').click()
  await expect(menu).toBeHidden()
  await expect(summary).toContainText('電話、LINE')
  await shot(page, 'after-filtered-multi')

  // 「只看」＝單選，按了收
  await summary.click()
  await menu.getByRole('button', { name: '只看電話' }).click()
  await expect(menu).toBeHidden()
  expect(await visibleIds(page)).toEqual(phonesOf(b => b.status !== 'completed' && b.source === 'phone'))
  await expect(summary).toContainText('電話')
  await shot(page, 'after-filtered-phone')

  // Esc 收；鍵盤：Tab 到勾選框、空白鍵切換
  await summary.click()
  await menu.getByRole('checkbox', { name: '隱藏已離' }).focus()
  await page.keyboard.press('Space')
  await expect(menu.getByRole('checkbox', { name: '隱藏已離' })).not.toBeChecked()
  await page.keyboard.press('Escape')
  await expect(menu).toBeHidden()
  await expect(summary).toBeFocused()
  await expect(summary).toContainText('電話・含已離')
  expect(await visibleIds(page)).toEqual(phonesOf(b => b.source === 'phone'))
  // 鍵盤開選單（Enter）→「重設」→ 收、回預設
  await page.keyboard.press('Enter')
  await expect(menu).toBeVisible()
  await menu.getByRole('button', { name: '重設' }).click()
  await expect(menu).toBeHidden()
  await expect(summary).toHaveText('篩選')
  expect(await visibleIds(page)).toEqual(phonesOf(b => b.status !== 'completed'))
  // #198 收尾：鍵盤 Tab 在選單內移動不收；Tab 出最後一顆（完成）→ 焦點到下方卡片，選單要收（不再蓋在卡片上）
  await summary.focus()
  await page.keyboard.press('Enter')
  await expect(menu).toBeVisible()
  await page.keyboard.press('Tab')
  await expect(menu.getByRole('checkbox').first()).toBeFocused()
  await expect(menu).toBeVisible()
  await menu.getByRole('button', { name: '完成' }).focus()
  await expect(menu).toBeVisible()
  await page.keyboard.press('Tab')
  await expect(menu).toBeHidden()
  expect(await page.evaluate(() => !!document.activeElement?.closest('[data-testid="today-list"]'))).toBe(true)
  // 頁首固定、清單自己捲仍成立
  const list = page.getByTestId('today-list')
  expect(await list.evaluate(el => el.scrollHeight - el.clientHeight)).toBeGreaterThan(100)
  expect(await pageOverflow(page)).toBeLessThanOrEqual(1)
})

test('統計卡：已到/離原地篩選（再點還原）、今日訂位重設篩選', async ({ page }) => {
  await shot(page, 'after-stats-row')
  const arrived = page.getByTestId('stat-arrived')
  const done = BOOKINGS.filter(b => b.status === 'arrived' || b.status === 'completed')
  await expect(arrived).toHaveAccessibleName(`已到/離 ${done.length} 組 ${done.reduce((s, b) => s + b.guests, 0)} 人，只看已到和已離`)
  await arrived.click()
  await expect(arrived).toHaveAttribute('aria-pressed', 'true')
  expect(await visibleIds(page)).toEqual(phonesOf(b => b.status === 'arrived' || b.status === 'completed'))
  await expect(page.getByTestId('today-filter').locator('summary')).toContainText('已到/離')
  await shot(page, 'after-click-arrived')
  await arrived.click()
  expect(await visibleIds(page)).toEqual(phonesOf(b => b.status !== 'completed'))

  // 今日訂位：提示字「重設篩選」；搜尋＋篩選都回預設、清單捲回頂端（預設仍隱藏已離，所以清單筆數可少於卡上組數）
  await expect(page.getByTestId('stat-total')).toContainText('重設篩選')
  await page.getByPlaceholder('搜尋姓名 / 電話 / 桌號 / 編號').fill('蔡')
  await page.getByTestId('stat-arrived').click()
  await page.getByTestId('stat-total').click()
  await expect(page.getByPlaceholder('搜尋姓名 / 電話 / 桌號 / 編號')).toHaveValue('')
  expect(await visibleIds(page)).toEqual(phonesOf(b => b.status !== 'completed'))
  expect(await page.getByTestId('today-list').evaluate(el => el.scrollTop)).toBe(0)
  await shot(page, 'after-click-total')
})

test('統計卡：未指派 → 今天的當日排位（選中最早一筆未配桌）；用餐中 → 現場頁', async ({ page }) => {
  const un = page.getByTestId('stat-unassigned')
  const unassigned = BOOKINGS.filter(b => b.status === 'confirmed' && !b.assignedTableId)
  await expect(un).toHaveAccessibleName(`未指派 ${unassigned.length} 組 ${unassigned.reduce((s, b) => s + b.guests, 0)} 人，前往排位`)
  await un.click()
  await expect(page.getByTestId('day-seating')).toBeVisible()
  await expect(page.getByLabel('訂位子分頁').getByRole('button', { name: /日曆/ })).toHaveAttribute('aria-pressed', 'true')
  const picked = page.locator('[data-testid="day-seating"] [data-key^="b:"][aria-pressed="true"]')
  await expect(picked).toHaveCount(1)
  const pickedId = (await picked.getAttribute('data-key')).slice(2)
  expect(unassigned.map(b => b.id)).toContain(pickedId)
  await shot(page, 'after-click-unassigned')

  await page.getByLabel('訂位子分頁').getByRole('button', { name: /今日/ }).click()
  await page.getByTestId('stat-dining').click()
  await expect(page).toHaveURL(/tab=ops/)
  await page.waitForTimeout(400)
  await shot(page, 'after-click-dining')
})
