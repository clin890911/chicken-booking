import { test, expect } from '@playwright/test'

// 頁面捲動第 2 批・A（2026-10-31）：iPad 橫向 1180×820／1180×740 上
//   1) 訂位・今日：整頁不捲（AdminPage 內容區不溢出），頁首（統計＋搜尋＋來源篩選）固定，只有清單自己捲；
//      lg 以上卡片 2 欄；卡片的電話、桌號、狀態、⋯ 更多都還在。
//   2) 編輯訂位彈窗：寬版兩欄，彈窗內不必捲；已入座仍只開放人數＋備註（#171）。
//   3) 訂位・新增：整頁不捲，表單區自己捲、確認列固定在下方；日期快選單列、時段 6 欄。
// 量的是 [data-testid=admin-content] 的 scrollHeight−clientHeight（同 scroll-audit 口徑）。

test.use({ timezoneId: 'Asia/Taipei' })

const TODAY = '2026-10-30'
const SUR = ['陳', '林', '黃', '張', '李', '王', '吳', '劉', '蔡', '楊', '許', '鄭', '謝', '郭', '洪']
const SLOTS = ['11:00', '11:30', '12:00', '12:30', '13:00', '17:00', '17:30', '18:00', '18:30']
const BOOKINGS = Array.from({ length: 20 }, (_, i) => ({
  id: `FP-${i}`, name: `${SUR[i % SUR.length]}${i % 2 ? '先生' : '小姐'}`, phone: `09120001${String(i).padStart(2, '0')}`,
  guests: 2 + (i % 5), date: TODAY, timeSlot: SLOTS[i % SLOTS.length], source: 'phone',
  status: i < 6 ? 'arrived' : 'confirmed', assignedTableId: i < 6 ? String(101 + i) : null, extraTableIds: [],
  actualArrivalTime: i < 6 ? '2026-10-30T03:20:00.000Z' : null, notes: {}, createdBy: 'staff', createdAt: '2026-10-29T00:00:00.000Z',
}))

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
})

for (const [w, h] of [[1180, 820], [1180, 740]]) {
  test(`訂位今日／編輯／新增 ${w}×${h}：整頁不捲，只有清單／表單自己捲`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h })
    await page.locator('aside').getByRole('button', { name: '訂位' }).click()

    // ── 今日 ──
    const list = page.getByTestId('today-list')
    await expect(list.getByText('蔡小姐').first()).toBeVisible()
    await page.waitForTimeout(400) // 子分頁進場動畫（只動 transform）
    expect(await pageOverflow(page)).toBeLessThanOrEqual(1)
    const listBox = await list.evaluate(el => ({ over: el.scrollHeight - el.clientHeight, oy: getComputedStyle(el).overflowY }))
    expect(listBox.oy).toBe('auto')
    expect(listBox.over).toBeGreaterThan(100) // 20 筆一定超出 → 是清單自己捲，不是被截掉
    // 清單捲到底，頁首（搜尋框）位置不動
    const search = page.getByPlaceholder('搜尋姓名 / 電話 / 桌號 / 編號')
    const before = (await search.boundingBox()).y
    await list.evaluate(el => { el.scrollTop = el.scrollHeight })
    expect((await search.boundingBox()).y).toBe(before)
    await list.evaluate(el => { el.scrollTop = 0 })
    // lg 2 欄：同時段的兩張卡並排
    const cards = list.locator('.rounded-xl.shadow-sm')
    const [a, b] = [await cards.nth(0).boundingBox(), await cards.nth(1).boundingBox()]
    expect(Math.abs(a.y - b.y)).toBeLessThan(2)
    expect(b.x).toBeGreaterThan(a.x + a.width - 1)
    // 卡片內容不刪：電話、桌號、狀態、⋯ 更多
    const seated = cards.filter({ hasText: '陳小姐' }).first()
    await expect(seated.getByTestId('phone-full')).toHaveText('0912-000-100')
    await expect(seated.getByText('桌 101')).toBeVisible()
    await expect(seated.getByText('用餐中')).toBeVisible()
    await expect(seated.getByLabel('陳小姐 更多操作')).toBeVisible()

    // ── 編輯彈窗（待到）：寬版兩欄、彈窗內不捲 ──
    await page.locator('summary[aria-label="蔡小姐 更多操作"]').first().click()
    await page.getByRole('button', { name: '編輯' }).first().click()
    const sheet = page.locator('.lg-sheet')
    await expect(sheet.getByText('編輯訂位 · #FP-8')).toBeVisible()
    await page.waitForTimeout(400)
    const inner = await sheet.evaluate(p => { const s = p.firstElementChild; return { over: s.scrollHeight - s.clientHeight, w: p.getBoundingClientRect().width } })
    expect(inner.over).toBeLessThanOrEqual(1)
    expect(inner.w).toBeGreaterThan(800)
    const when = await sheet.getByTestId('edit-col-when').boundingBox()
    const who = await sheet.getByTestId('edit-col-who').boundingBox()
    expect(who.x).toBeGreaterThan(when.x + when.width - 1)
    await expect(sheet.getByRole('button', { name: '儲存變更' })).toBeInViewport()
    await sheet.getByRole('button', { name: '取消' }).click()
    await expect(sheet).toHaveCount(0)

    // ── 編輯彈窗（已入座）：只有人數＋備註 ──
    await page.locator('summary[aria-label="陳小姐 更多操作"]').first().click()
    await page.getByRole('button', { name: '改人數／備註' }).first().click()
    await expect(sheet.getByText('改人數／備註 · 陳小姐')).toBeVisible()
    await expect(sheet.getByText('大人')).toBeVisible()
    await expect(sheet.getByLabel('訂位備註')).toBeVisible()
    await expect(sheet.getByText(/^時段（/)).toHaveCount(0)
    await expect(sheet.getByText('電話', { exact: true })).toHaveCount(0)
    await sheet.getByRole('button', { name: '取消' }).click()
    await expect(sheet).toHaveCount(0)

    // ── 新增 ──
    await page.getByRole('button', { name: /^新增/ }).first().click()
    await expect(page.getByText('客人資訊')).toBeVisible()
    await page.waitForTimeout(400)
    expect(await pageOverflow(page)).toBeLessThanOrEqual(1)
    // 日期快選 8 格同一列；時段一列 6 個
    const dates = page.getByTestId('quick-date-row').getByRole('button')
    await expect(dates).toHaveCount(8)
    const ys = await dates.evaluateAll(bs => bs.map(b => Math.round(b.getBoundingClientRect().top)))
    expect(new Set(ys).size).toBe(1)
    const slotYs = await page.getByTestId('slot-grid').getByRole('button').evaluateAll(bs => bs.slice(0, 6).map(b => Math.round(b.getBoundingClientRect().top)))
    expect(new Set(slotYs).size).toBe(1)
    // 確認列固定在表單區下方、看得到
    await expect(page.getByText('還差', { exact: true })).toBeInViewport()
  })
}
