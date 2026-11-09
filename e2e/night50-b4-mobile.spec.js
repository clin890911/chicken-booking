import { test, expect } from '@playwright/test'

// night-50 批 4：H7 手機 390px 帶位（A1 散客帶位）。只跑 @mobile（--project=mobile-chromium）。
test.use({ timezoneId: 'Asia/Taipei', viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

const SHOTS = '/private/tmp/claude-501/-Users-chingchunlin--claude-spares-spare-WtJFow/2abbcc7f-2edc-4b13-af84-1f34c069374e/scratchpad/shots-b4'
const TODAY = '2026-11-10'
const mkTables = (nums) => nums.map((number, i) => ({ number, capacity: 4, floor: '1F', x: 100 + i * 120, y: 400, w: 80, h: 75, rotation: 0, zoneId: null,
  isActive: true, outage: null, status: 'vacant', currentBookingId: null, currentRef: null, seatedAt: null }))
const SEAT = '[data-testid=walkin-seat]'
const JUMP = '[data-testid=ops-phone-jump]'

const hittable = (page, sel) => page.locator(sel).first().evaluate(el => {
  const r = el.getBoundingClientRect(); const cx = r.left + r.width / 2, cy = r.top + r.height / 2
  if (!r.width || cx < 0 || cy < 0 || cx >= innerWidth || cy >= innerHeight) return false
  const hit = document.elementFromPoint(cx, cy); return !!hit && (hit === el || el.contains(hit))
})

test.beforeEach(async ({ page }) => {
  await page.route(url => url.hostname !== 'localhost' && url.hostname !== '127.0.0.1', route => {
    const u = route.request().url()
    const body = u.includes('adminPullData') ? { ok: false, error: 'e2e-offline' } : u.includes('adminPushData') ? { ok: true } : { ok: false }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  })
  await page.clock.setFixedTime(new Date(`${TODAY}T12:00:00+08:00`))
  await page.addInitScript((tables) => {
    if (sessionStorage.getItem('e2e-seeded')) return
    sessionStorage.setItem('e2e-seeded', '1')
    localStorage.setItem('chicken_tables_v3', JSON.stringify(tables))
    localStorage.setItem('chicken_bookings_v1', '[]')
    localStorage.setItem('chicken_group_reservations_v1', '[]')
    localStorage.setItem('chicken_group_blank_purge_v1', '1')
    localStorage.removeItem('chicken_waitlist_v1')
  }, mkTables(['105', '106', '107']))
})

test('H7 手機 390px 帶位：整頁捲、按鈕都按得到 @mobile', async ({ page }) => {
  await page.goto('/login')
  await page.getByPlaceholder('your@email.com').fill('berrylin0911@gmail.com')
  await page.getByRole('button', { name: /模擬登入/ }).click()
  await expect(page).toHaveURL(/\/admin/)
  let steps = 0
  const nav = page.locator('nav.lg-bottomnav')
  steps++; await nav.locator('button', { hasText: '現場' }).tap()
  await expect(page.locator(JUMP)).toBeVisible()
  await page.screenshot({ path: `${SHOTS}/H7-ops-top.png` })
  steps++; await page.locator('.lg-tabs button', { hasText: '帶位' }).tap()
  // 人數鈕要在視窗內（否則店員要先捲）
  const four = page.getByRole('button', { name: '4 位', exact: true })
  const fourVisible = await four.isVisible() && await four.evaluate(el => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight })
  if (!fourVisible) { steps++; await four.scrollIntoViewIfNeeded() }
  steps++; await four.tap()
  steps++; await page.locator(JUMP).tap()  // 跳到桌況圖
  await page.waitForTimeout(600)
  const t = page.locator('svg[aria-label$="桌況圖"] g[data-table-number="105"]').first()
  const box = await t.boundingBox()
  console.log('H7 table 105 box', JSON.stringify(box))
  await page.screenshot({ path: `${SHOTS}/H7-map.png` })
  steps++; await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)
  await expect(page.locator(JUMP)).toContainText('回帶位')
  steps++; await page.locator(JUMP).tap()
  await page.waitForTimeout(600)
  await expect(page.locator(SEAT)).toContainText('105')
  const seatHit = await hittable(page, SEAT)
  if (!seatHit) { steps++; await page.locator(SEAT).scrollIntoViewIfNeeded() }
  await page.screenshot({ path: `${SHOTS}/H7-seat-ready.png` })
  steps++; await page.locator(SEAT).tap()
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('chicken_tables_v3')).find(t => t.number === '105').status)).toBe('dining')
  const ovf = await page.evaluate(() => document.scrollingElement.scrollWidth - innerWidth)
  console.log('H7 steps', steps, 'seat hittable without scroll', seatHit, 'table box h', box?.height, 'horizontal overflow', ovf, 'size chip hit', fourVisible)
  expect(ovf).toBeLessThanOrEqual(0)
})
