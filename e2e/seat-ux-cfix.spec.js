import { test, expect } from '@playwright/test'
import { todayTab } from './helpers/opsToday'

// 選客入座 C 包「驗收修正」（2026-11-27，docs/ux-review-seating-20261127/verify-c.md）。
// 核心原則：任何固定區、浮層或狀態切換，都不可讓手指在原本的位置按到另一個動作。
//   F2  釘底動作列不論內容多少（2 桌＋沿用、3 桌＋沿用＋RiskAck）都不可蓋到姓氏、人數鍵；備註欄仍看得到
//   F3  抽屜用餐中「換桌」「客人已離席」兩顆鈕位置固定，未滿／滿 5 分鐘只換強調樣式
//   F4  散客入座後按復原：姓氏、稱謂跟人數一起回填
//   F5  iPad 直向人數鍵命中區寬 ≥44
//   F6  「定位建議桌」是次鈕樣式（不是底線連結）
//   F7  載入時人數「未選」，確認鈕「先選人數」
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
const WALK = (seatedAt) => bk('E2E-CF-WALK', '現場散客', { status: 'arrived', source: 'walkin', assignedTableId: '106', timeSlot: '12:00', actualArrivalTime: seatedAt })
const LIN = bk('E2E-CF-LIN', '林先生', { assignedTableId: '105', timeSlot: '12:00' })

const TABLES = (seatedAt) => [
  mkTable('101', 120, 120, { capacity: 6 }), mkTable('102', 280, 120), mkTable('103', 440, 120, { capacity: 6 }),
  mkTable('105', 120, 300), mkTable('106', 280, 300, { status: 'dining', currentBookingId: 'E2E-CF-WALK', seatedAt }),
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
  await page.addStyleTag({ content: 'main > div.border-chicken-red.bg-red-50{display:none !important}' })
}
const mapTable = (page, n) => page.getByRole('button', { name: new RegExp(`^${n}桌`) })

test.beforeEach(async ({ page }) => {
  await page.route('**/adminPullData', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'e2e-offline' }) }))
  await page.route('**/adminPushData', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }))
  await page.route('**/admin*', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false }) }))
})

// 姓氏 12 鍵＋「其他」＋人數 1–8：每顆鍵的中心點 elementFromPoint 都是那顆鍵本身（不是釘底列、不是別的鈕）
const keysCovered = (page) => page.evaluate(() => {
  const names = ['陳', '林', '黃', '張', '李', '王', '吳', '劉', '蔡', '楊', '許', '鄭', '其他', ...[1, 2, 3, 4, 5, 6, 7, 8].map(n => `${n} 位`)]
  const bad = []
  for (const n of names) {
    const el = document.querySelector(`button[aria-label="${n}"]`) || [...document.querySelectorAll('button')].find(b => b.textContent.trim() === n)
    if (!el) { bad.push(`${n}：找不到`); continue }
    const r = el.getBoundingClientRect()
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
    if (!(hit === el || el.contains(hit))) bad.push(`${n} ← ${(hit?.getAttribute?.('aria-label') || hit?.textContent || hit?.tagName || 'null').trim().slice(0, 24)}`)
  }
  return bad
})
// 備註欄露出的高度（被可捲區裁掉的部分不算）
const notesVisible = (page) => page.evaluate(() => {
  const input = document.querySelector('input[placeholder="例：靠窗、慶生、過敏"]')
  const r = input.getBoundingClientRect()
  let top = r.top, bottom = r.bottom
  for (let el = input.parentElement; el; el = el.parentElement) {
    const s = getComputedStyle(el)
    if (/(auto|scroll|hidden)/.test(s.overflowY)) { const c = el.getBoundingClientRect(); top = Math.max(top, c.top); bottom = Math.min(bottom, c.bottom) }
  }
  const footer = document.querySelector('[data-rail-footer]').getBoundingClientRect()
  bottom = Math.min(bottom, footer.top)
  return { h: Math.round(r.height), visible: Math.max(0, Math.round(bottom - top)) }
})

for (const vp of [{ name: 'iPad 橫', width: 1180, height: 820 }, { name: 'iPad 直', width: 820, height: 1180 }]) {
  test(`F2 ${vp.name}：2 桌＋沿用、3 桌＋沿用＋RiskAck，姓氏與人數每顆鍵都沒被釘底列蓋住；備註欄看得到`, async ({ page }) => {
    await page.clock.setFixedTime(at('12:10'))
    await seed(page, { tables: TABLES(at('11:30').toISOString()), bookings: [WALK(at('11:30').toISOString()), LIN] })
    await page.setViewportSize({ width: vp.width, height: vp.height })
    await loginToOps(page)
    // 先帶一組（產生「沿用上一組」）
    await page.getByRole('button', { name: '陳', exact: true }).click()
    await page.getByRole('button', { name: '4 位', exact: true }).click()
    await mapTable(page, '103').click()
    await page.getByTestId('walkin-seat').click()
    await expect(page.getByRole('button', { name: /沿用上一組/ })).toBeVisible()
    expect(await keysCovered(page), `${vp.name} 入座後`).toEqual([])

    // (a) 2 桌＋沿用
    await mapTable(page, '101').click()
    await page.getByTestId('walkin-multi-toggle').click()
    await mapTable(page, '102').click()
    await expect(page.getByRole('button', { name: '移除桌 101' })).toBeVisible()
    await expect(page.getByRole('button', { name: '移除桌 102' })).toBeVisible()
    await expect(page.getByRole('button', { name: /沿用上一組/ })).toBeVisible()
    const fa = await page.locator('[data-rail-footer]').boundingBox()
    console.log(`[F2 ${vp.name} a] footer`, JSON.stringify(fa), JSON.stringify(await notesVisible(page)))
    expect(await keysCovered(page), `${vp.name} 2 桌＋沿用`).toEqual([])
    const na = await notesVisible(page)
    expect(na.visible, `${vp.name} 2 桌＋沿用 備註欄露出`).toBeGreaterThanOrEqual(na.h)
    // (b) 3 桌＋沿用＋RiskAck（105 有林先生 12:00 預配）
    await mapTable(page, '105').click()
    await expect(page.getByTestId('risk-ack')).toBeVisible()
    await expect(page.getByRole('button', { name: /沿用上一組/ })).toBeVisible()
    const fb = await page.locator('[data-rail-footer]').boundingBox()
    console.log(`[F2 ${vp.name} b] footer`, JSON.stringify(fb), JSON.stringify(await notesVisible(page)))
    expect(await keysCovered(page), `${vp.name} 3 桌＋沿用＋RiskAck`).toEqual([])
    const nb = await notesVisible(page)
    expect(nb.visible, `${vp.name} 3 桌＋沿用＋RiskAck 備註欄露出`).toBeGreaterThanOrEqual(nb.h)
    // RiskAck 勾選列整列看得到、中心點打得到自己（不被資訊列捲走）
    const ackOk = await page.getByTestId('risk-ack').evaluate(el => { const r = el.getBoundingClientRect(); const h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return r.bottom <= innerHeight && (h === el || el.contains(h)) })
    expect(ackOk, `${vp.name} RiskAck`).toBe(true)
    // 在「8 位」中心點按下去，按到的是 8 位（不是移除桌）
    const eight = page.getByRole('button', { name: '8 位', exact: true })
    const eb = await eight.boundingBox()
    await page.mouse.click(eb.x + eb.width / 2, eb.y + eb.height / 2)
    await expect(eight).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByRole('button', { name: '移除桌 105' })).toBeVisible()

    // 確認入座鈕仍整顆看得到、按得到
    const seatOk = await page.getByTestId('walkin-seat').evaluate(el => { const r = el.getBoundingClientRect(); const h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return r.bottom <= innerHeight && (h === el || el.contains(h)) })
    expect(seatOk, `${vp.name} 確認入座鈕`).toBe(true)
    // RiskAck 勾得到、勾了才解鎖
    await page.getByTestId('risk-ack').click()
    await expect(page.getByTestId('walkin-seat')).toBeEnabled()
  })
}

for (const vp of [{ name: 'iPad 橫', width: 1180, height: 820 }, { name: 'iPad 直', width: 820, height: 1180 }]) {
  test(`F3 ${vp.name}：用餐中抽屜「換桌」「客人已離席」位置固定，跨過 5 分鐘只換強調樣式`, async ({ page }) => {
    await page.clock.setFixedTime(at('12:10'))
    await seed(page, { tables: TABLES(at('12:08').toISOString()), bookings: [WALK(at('12:08').toISOString())] })
    await page.setViewportSize({ width: vp.width, height: vp.height })
    await loginToOps(page)
    await todayTab(page).click()
    await mapTable(page, '106').click()
    const move = page.locator('[data-drawer-slot="move"]')
    const out = page.locator('[data-drawer-slot="checkout"]')
    await expect(page.getByTestId('drawer-primary')).toHaveText(/換桌/)
    const before = { move: await move.boundingBox(), out: await out.boundingBox() }
    expect(before.move.x, '換桌在左').toBeLessThan(before.out.x)
    expect(Math.round(before.move.y)).toBe(Math.round(before.out.y))
    expect(Math.round(before.move.width)).toBe(Math.round(before.out.width))
    // 抽屜開著跨過 5 分鐘（每秒 tick）→ 主鈕變「客人已離席」，但兩顆鈕的位置、大小完全不變
    await page.clock.setFixedTime(at('12:14'))
    await expect(page.getByTestId('drawer-primary')).toHaveText('客人已離席', { timeout: 5000 })
    const after = { move: await move.boundingBox(), out: await out.boundingBox() }
    expect(after, `${vp.name} 跨過 5 分鐘前後`).toEqual(before)
    await expect(move).toHaveText(/換桌/)
    await expect(out).toHaveText('客人已離席')
  })

  test(`F4／F7 ${vp.name}：載入時人數未選；散客入座後按復原，姓氏、稱謂與人數一起回填`, async ({ page }) => {
    await page.clock.setFixedTime(at('12:10'))
    await seed(page, { tables: TABLES(at('11:30').toISOString()), bookings: [WALK(at('11:30').toISOString())] })
    await page.setViewportSize({ width: vp.width, height: vp.height })
    await loginToOps(page)
    const seat = page.getByTestId('walkin-seat')
    // F7：載入時「未選」（與入座後一致），確認鈕講「先選人數」
    await expect(seat).toHaveText('先選人數')
    await expect(seat).toBeDisabled()
    for (let n = 1; n <= 8; n++) await expect(page.getByRole('button', { name: `${n} 位`, exact: true })).toHaveAttribute('aria-pressed', 'false')
    // F4
    const chen = page.getByRole('button', { name: '陳', exact: true })
    await chen.click()
    await page.getByRole('button', { name: '4 位', exact: true }).click()
    await mapTable(page, '103').click()
    await expect(seat).toHaveText(/確認入座 · 陳先生 4 位 · 103/)
    await seat.click()
    await expect(chen).toHaveAttribute('aria-pressed', 'false')
    await page.getByTestId('seat-undo-action').click()
    await expect(chen).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByRole('button', { name: '4 位', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(seat).toHaveText(/確認入座 · 陳先生 4 位 · 103/)
  })
}

test('F5 iPad 直：人數鍵 1–8 可點寬 ≥44（外觀 42px，透明外擴），外擴不吃到鄰鍵', async ({ page }) => {
  await page.clock.setFixedTime(at('12:10'))
  await seed(page, { tables: TABLES(at('11:30').toISOString()), bookings: [WALK(at('11:30').toISOString())] })
  await page.setViewportSize({ width: 820, height: 1180 })
  await loginToOps(page)
  await expect(page.getByRole('button', { name: '1 位', exact: true })).toBeVisible()
  const rows = await page.evaluate(() => [1, 2, 3, 4, 5, 6, 7, 8].map(n => {
    const el = document.querySelector(`button[aria-label="${n} 位"]`)
    const r = el.getBoundingClientRect(), cy = r.top + r.height / 2
    const hit = (x) => { const h = document.elementFromPoint(x, cy); return !!h && (h === el || el.contains(h)) }
    let l = r.left, rr = r.right
    while (hit(l - 0.25) && l > r.left - 20) l -= 0.25
    while (hit(rr + 0.25) && rr < r.right + 20) rr += 0.25
    return { n, visual: Math.round(r.width * 4) / 4, hit: Math.round((rr - l) * 4) / 4 }
  }))
  console.log('[F5]', JSON.stringify(rows))
  for (const r of rows) {
    expect(r.visual, `${r.n} 位外觀`).toBeLessThan(44)
    expect(r.hit, `${r.n} 位可點寬`).toBeGreaterThanOrEqual(44)
    expect(r.hit, `${r.n} 位外擴不超過格線間距（6px）`).toBeLessThanOrEqual(r.visual + 6.5)
  }
  // 每顆鍵中心點仍是自己；相鄰兩鍵的外擴區不重疊（左鍵可點右緣 ≤ 右鍵可點左緣）
  expect(await keysCovered(page)).toEqual([])
})

