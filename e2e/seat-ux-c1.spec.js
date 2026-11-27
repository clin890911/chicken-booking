import { test, expect } from '@playwright/test'
import path from 'node:path'
import fs from 'node:fs'
import { todayTab } from './helpers/opsToday'

// 選客入座 C 包「左欄表單與按鈕」（2026-11-27，docs/ux-review-seating-20261127 walkthrough #8 #11 #13 #14 #20）：
//   #8  選桌前／選桌後／入座後，姓氏「陳」與人數「4 位」鍵的座標完全不變（iPad 橫 1180×820、直 820×1180）
//   #14 入座後人數回到「未選」，確認鈕「先選人數」停用
//   #13 用餐中剛入座 <5 分：抽屜主鈕是「換桌」
//   #11 手機：跳轉鈕 in-flow，不蓋任何可點元素（elementFromPoint）；點桌後自動捲回確認鈕
//   #20 觸控：其他姓氏／姓氏鈕／人數鈕／9+／地圖摘要排程分頁的可點範圍 ≥44px（elementFromPoint 量外擴區）
// 時間用 page.clock 固定、時區 Asia/Taipei；後台本機模式以 localStorage 為後端，攔截 admin* 雲端端點。

test.use({ timezoneId: 'Asia/Taipei' })

const TODAY = '2026-11-27'
const at = (hhmm) => new Date(`${TODAY}T${hhmm}:00+08:00`)
const mkTable = (number, x, y, over = {}) => ({
  number, capacity: 4, floor: '1F', x, y, w: 80, h: 75, rotation: 0, zoneId: null,
  isActive: true, outage: null, status: 'vacant', currentBookingId: null, currentRef: null, seatedAt: null, ...over,
})
const bk = (id, name, over = {}) => ({
  id, name, phone: '', guests: 3, date: TODAY, timeSlot: '12:00', status: 'confirmed', source: 'phone',
  assignedTableId: null, extraTableIds: [], notes: {}, createdBy: 'staff', ...over,
})
const WALK = bk('E2E-C1-WALK', '現場散客', { status: 'arrived', source: 'walkin', assignedTableId: '106', timeSlot: '12:00', actualArrivalTime: at('12:08').toISOString() })
const LIN = bk('E2E-C1-LIN', '林先生', { assignedTableId: '105', timeSlot: '12:00' })
const CHEN = bk('E2E-C1-CHEN', '陳小姐', { assignedTableId: '106', guests: 4, timeSlot: '12:00' })

const TABLES = () => [
  mkTable('101', 120, 120, { capacity: 6 }), mkTable('102', 280, 120), mkTable('103', 440, 120, { capacity: 6 }),
  mkTable('105', 120, 300), mkTable('106', 280, 300, { status: 'dining', currentBookingId: WALK.id, seatedAt: at('12:08').toISOString() }),
  mkTable('108', 440, 300, { capacity: 6 }),
]

async function seed(page, { tables, bookings }) {
  await page.addInitScript(({ tables, bookings }) => {
    if (sessionStorage.getItem('e2e-seeded')) return
    sessionStorage.setItem('e2e-seeded', '1')
    localStorage.setItem('chicken_tables_v3', JSON.stringify(tables))
    localStorage.setItem('chicken_bookings_v1', JSON.stringify(bookings))
    localStorage.setItem('chicken_group_reservations_v1', '[]')
    localStorage.setItem('chicken_group_blank_purge_v1', '1')
    localStorage.removeItem('chicken_waitlist_v1')
  }, { tables, bookings })
}
async function loginToOps(page) {
  await page.goto('/login')
  await page.getByPlaceholder('your@email.com').fill('berrylin0911@gmail.com')
  await page.getByRole('button', { name: /模擬登入/ }).click()
  await expect(page).toHaveURL(/\/admin/)
  const nav = page.locator('nav.lg-bottomnav')
  if (await nav.isVisible()) await nav.locator('button', { hasText: '現場' }).click()
  else await page.locator('aside').getByRole('button', { name: '現場' }).click()
  // 沙盒專屬的「雲端同步未啟用」橫幅正式站不會出現
  await page.addStyleTag({ content: 'main > div.border-chicken-red.bg-red-50{display:none !important}' })
}
const mapTable = (page, n) => page.getByRole('button', { name: new RegExp(`^${n}桌`) })
const box = async (loc) => { const b = await loc.boundingBox(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) } }
const SHOTS = path.resolve(process.env.C1_SHOTS_DIR || '/Users/chingchunlin/chicken-booking-main/docs/ux-review-seating-20261127/shots-c1')
const shot = async (page, name) => { try { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, `${name}.png`) }) } catch { /* 截圖失敗不影響斷言 */ } }

test.beforeEach(async ({ page }) => {
  await page.route('**/adminPullData', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'e2e-offline' }) }))
  await page.route('**/adminPushData', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }))
  await page.route('**/admin*', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false }) }))
})

for (const vp of [{ name: 'iPad 橫', width: 1180, height: 820, tag: 'ipadL' }, { name: 'iPad 直', width: 820, height: 1180, tag: 'ipadP' }]) {
  test(`#8／#14 ${vp.name}：選桌前、選桌後、入座後「陳」「4 位」座標不變；入座後人數未選`, async ({ page }) => {
    await page.clock.setFixedTime(at('12:10'))
    await seed(page, { tables: TABLES(), bookings: [WALK] })
    await page.setViewportSize({ width: vp.width, height: vp.height })
    await loginToOps(page)
    const chen = page.getByRole('button', { name: '陳', exact: true })
    const four = page.getByRole('button', { name: '4 位', exact: true })
    await expect(chen).toBeVisible()
    await chen.click()
    await four.click()
    const before = { chen: await box(chen), four: await box(four) }

    await mapTable(page, '103').click()
    await expect(page.getByRole('button', { name: '移除桌 103' })).toBeVisible()
    const picked = { chen: await box(chen), four: await box(four) }
    expect(picked, '選桌後').toEqual(before)
    if (vp.tag === 'ipadL') await shot(page, 'c1-ipadL-01-walkin-picked')

    const seat = page.getByTestId('walkin-seat')
    await expect(seat).toHaveText(/確認入座 · 陳先生 4 位 · 103/)
    await seat.click()
    await expect(page.getByRole('button', { name: /沿用上一組（4 位）/ })).toBeVisible()
    const seated = { chen: await box(chen), four: await box(four) }
    expect(seated, '入座後').toEqual(before)

    // #14：人數回到未選、確認鈕「先選人數」停用；1–8 位一顆都沒按下
    await expect(seat).toHaveText('先選人數')
    await expect(seat).toBeDisabled()
    for (let n = 1; n <= 8; n++) await expect(page.getByRole('button', { name: `${n} 位`, exact: true })).toHaveAttribute('aria-pressed', 'false')
    // 沿用上一組 → 4 位亮起（位置仍不變）
    await page.getByRole('button', { name: /沿用上一組/ }).click()
    await expect(four).toHaveAttribute('aria-pressed', 'true')
    expect({ chen: await box(chen), four: await box(four) }, '沿用後').toEqual(before)
  })
}

test('#13 iPad 橫：剛入座 2 分鐘的桌，抽屜主鈕是「換桌」，「客人已離席」降為次要；截圖', async ({ page }) => {
  await page.clock.setFixedTime(at('12:10'))
  await seed(page, { tables: TABLES(), bookings: [WALK, LIN, CHEN] })
  await page.setViewportSize({ width: 1180, height: 820 })
  await loginToOps(page)
  await todayTab(page).click()
  await mapTable(page, '106').click()
  const primary = page.getByTestId('drawer-primary')
  await expect(primary).toHaveText(/換桌/)
  await expect(page.getByRole('button', { name: '客人已離席' })).toBeVisible()
  const pb = await primary.boundingBox()
  const ob = await page.getByRole('button', { name: '客人已離席' }).boundingBox()
  // 驗收 F3：兩顆鈕位置固定並排（換桌在左、離席在右、同寬），只差強調樣式（原斷言：主鈕在上、主鈕較寬）
  expect(Math.round(pb.y)).toBe(Math.round(ob.y))
  expect(pb.x).toBeLessThan(ob.x)
  expect(Math.round(pb.width)).toBe(Math.round(ob.width))
  await shot(page, 'c1-ipadL-02-drawer-quickfix')
})

test('#17 iPad 橫：「到了・換桌入座」選桌任務只有一顆取消；截圖', async ({ page }) => {
  await page.clock.setFixedTime(at('12:10'))
  await seed(page, { tables: TABLES(), bookings: [WALK, CHEN] })
  await page.setViewportSize({ width: 1180, height: 820 })
  await loginToOps(page)
  await page.getByRole('list', { name: '可入座名單' }).getByRole('button', { name: '陳小姐 到了，換桌入座' }).click()
  const panel = page.getByTestId('mode-banner')
  await expect(panel).toContainText('到了 · 換桌入座：陳小姐 4 位')
  await mapTable(page, '103').click()
  await expect(page.getByRole('button', { name: '取消', exact: true })).toHaveCount(1)
  await expect(panel.getByRole('button', { name: '確認入座', exact: true })).toBeEnabled()
  await shot(page, 'c1-ipadL-03-mode-rail')
})

test('#20 iPad 橫：其他姓氏、9+、地圖／摘要／排程的可點範圍 ≥44px（外觀不變）', async ({ page }) => {
  await page.clock.setFixedTime(at('12:10'))
  await seed(page, { tables: TABLES(), bookings: [WALK] })
  await page.setViewportSize({ width: 1180, height: 820 })
  await loginToOps(page)
  await expect(page.getByRole('button', { name: '陳', exact: true })).toBeVisible()
  const span = (loc) => loc.evaluate(el => {
    const r = el.getBoundingClientRect(), cx = r.left + r.width / 2
    const hit = (y) => { const h = document.elementFromPoint(cx, y); return !!h && (h === el || el.contains(h)) }
    let top = r.top, bottom = r.bottom
    // 以 0.25px 步進往外找可點範圍的邊（版面座標有小數，1px 步進會少算 1px）
    while (hit(top - 0.25) && top > r.top - 30) top -= 0.25
    while (hit(bottom + 0.25) && bottom < r.bottom + 30) bottom += 0.25
    const above = document.elementFromPoint(cx, top - 1)
    return { visual: Math.round(r.height), hit: Math.round((bottom - top) * 4) / 4, up: Math.round(r.top - top), down: Math.round(bottom - r.bottom), above: (above?.className || above?.tagName || '').toString().slice(0, 80) }
  })
  const other = await span(page.getByRole('button', { name: '其他', exact: true }))
  expect(other.visual).toBeLessThan(44)
  expect(other.hit, `其他姓氏 ${JSON.stringify(other)}`).toBeGreaterThanOrEqual(44)
  const nine = await span(page.getByRole('button', { name: /9\+/ }))
  expect(nine.hit, `9+ ${JSON.stringify(nine)}`).toBeGreaterThanOrEqual(44)
  for (const name of ['地圖', '摘要', '排程']) {
    const seg = await span(page.getByLabel('現場視圖').getByRole('button', { name }))
    expect(seg.hit, `${name} ${JSON.stringify(seg)}`).toBeGreaterThanOrEqual(44)
  }
  // 外擴區不能吃到下面的姓氏鍵：陳的上緣 1px 內打到的是「陳」
  const chenTop = await page.getByRole('button', { name: '陳', exact: true }).evaluate(el => {
    const r = el.getBoundingClientRect(); const h = document.elementFromPoint(r.left + r.width / 2, r.top + 1); return h === el || el.contains(h)
  })
  expect(chenTop).toBe(true)
})

test.describe('手機 390×844', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  // 視窗內每顆可點元素的中心點都打得到自己（沒有浮動鈕蓋在上面）
  const coveredInViewport = (page) => page.evaluate(() => {
    const content = document.querySelector('[data-testid=admin-content]')
    const els = [...content.querySelectorAll('button, [role=button], a[href], summary, input')]
    const bad = []
    for (const el of els) {
      const r = el.getBoundingClientRect()
      if (!r.width || !r.height) continue
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2
      const cr = content.getBoundingClientRect()
      if (cy < cr.top + 2 || cy > cr.bottom - 2 || cx < 0 || cx > innerWidth) continue
      // 收合的 <details> 選單內容（Chromium 用 content-visibility 隱藏、但 rect 仍在）不算畫面上的元素
      if (getComputedStyle(el).visibility === 'hidden' || el.closest('[inert]') || (el.checkVisibility && !el.checkVisibility({ checkVisibilityCSS: true, contentVisibilityAuto: true }))) continue
      const hit = document.elementFromPoint(cx, cy)
      if (!hit || !(hit === el || el.contains(hit) || hit.contains(el))) bad.push(`${(el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 20)} ← ${(hit?.textContent || hit?.tagName || '').trim().slice(0, 20)}`)
    }
    return bad
  })

  test('#11 跳轉鈕 in-flow：不是 fixed；「客人到了」「1 位」「2 位」等每顆可點元素都沒被蓋（elementFromPoint）', async ({ page }) => {
    await page.clock.setFixedTime(at('12:10'))
    await seed(page, { tables: TABLES(), bookings: [WALK, LIN] })
    await loginToOps(page)
    const jump = page.getByTestId('ops-phone-jump')
    await expect(jump).toBeVisible()
    expect(await jump.evaluate(el => getComputedStyle(el).position)).not.toBe('fixed')
    expect(Math.round((await jump.boundingBox()).height)).toBeGreaterThanOrEqual(44)
    const arrive = page.getByRole('button', { name: '客人到了' }).first()
    await expect(arrive).toBeVisible()
    await arrive.scrollIntoViewIfNeeded()
    expect(await coveredInViewport(page), '今日籤').toEqual([])
    // 往下捲幾段，每一段都沒有被蓋的
    for (let i = 0; i < 4; i++) {
      await page.locator('[data-testid=admin-content]').evaluate((el, i) => { el.scrollTop = i * 300 }, i)
      expect(await coveredInViewport(page), `今日籤 scrollTop=${i * 300}`).toEqual([])
    }
    await page.locator('[data-testid=admin-content]').evaluate(el => { el.scrollTop = 0 })
    await page.locator('.lg-tabs button', { hasText: '帶位' }).tap()
    for (const n of ['1 位', '2 位']) {
      const b = page.getByRole('button', { name: n, exact: true })
      await b.scrollIntoViewIfNeeded()
      const ok = await b.evaluate(el => { const r = el.getBoundingClientRect(); const h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return h === el || el.contains(h) })
      expect(ok, n).toBe(true)
    }
    expect(await coveredInViewport(page), '帶位籤').toEqual([])
  })

  test('#11 帶位：↓ 桌況圖 → 點桌 → 自動捲回確認鈕（不用再按「回帶位」）→ 入座', async ({ page }) => {
    await page.clock.setFixedTime(at('12:10'))
    await seed(page, { tables: TABLES(), bookings: [WALK] })
    await loginToOps(page)
    await page.locator('.lg-tabs button', { hasText: '帶位' }).tap()
    await page.getByRole('button', { name: '3 位', exact: true }).tap()
    await page.getByTestId('ops-phone-jump').tap()
    const t = mapTable(page, '103')
    await expect.poll(async () => { const b = await t.boundingBox(); return b && b.y > 0 && b.y + b.height < 844 }).toBe(true)
    await page.waitForTimeout(400)
    await t.tap()
    const seat = page.getByTestId('walkin-seat')
    await expect(seat).toContainText('103')
    await expect.poll(() => seat.evaluate(el => { const r = el.getBoundingClientRect(); const h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return r.top >= 0 && r.bottom <= innerHeight && (h === el || el.contains(h)) }), { timeout: 4000 }).toBe(true)
    await seat.tap()
    await expect(seat).toHaveText('先選人數')
  })

  test('#20 手機：姓氏鈕可點寬 ≥44（含外擴）、人數鈕寬高 ≥44', async ({ page }) => {
    await page.clock.setFixedTime(at('12:10'))
    await seed(page, { tables: TABLES(), bookings: [WALK] })
    await loginToOps(page)
    await page.locator('.lg-tabs button', { hasText: '帶位' }).tap()
    const chen = page.getByRole('button', { name: '陳', exact: true })
    await chen.scrollIntoViewIfNeeded()
    const widths = await page.evaluate(() => {
      const out = []
      for (const s of ['陳', '林', '鄭']) {
        const el = document.querySelector(`button[aria-label="${s}"]`)
        const r = el.getBoundingClientRect(), cy = r.top + r.height / 2
        const hit = (x) => { const h = document.elementFromPoint(x, cy); return !!h && (h === el || el.contains(h)) }
        let l = r.left, rr = r.right
        while (hit(l - 0.25) && l > r.left - 20) l -= 0.25
        while (hit(rr + 0.25) && rr < r.right + 20) rr += 0.25
        out.push({ s, visual: Math.round(r.width), hit: Math.round((rr - l) * 4) / 4, h: Math.round(r.height) })
      }
      return out
    })
    for (const w of widths) {
      expect(w.hit, JSON.stringify(w)).toBeGreaterThanOrEqual(44)
      expect(w.h).toBeGreaterThanOrEqual(44)
    }
    for (let n = 1; n <= 8; n++) {
      const b = await page.getByRole('button', { name: `${n} 位`, exact: true }).boundingBox()
      expect(Math.min(b.width, b.height), `${n} 位 ${b.width}×${b.height}`).toBeGreaterThanOrEqual(44)
    }
  })
})
