import { test, expect } from '@playwright/test'

// 選客入座 C 包「地圖」（2026-11-27，docs/ux-review-seating-20261127 walkthrough #18 #20 #21、verify P2-1 P2-3 P2-4）：
//   1 併桌同組標示：同一組佔多張桌（主＋副桌）→ 每張桌都有同一個「王・併」小標、非相鄰的畫連結線；單桌不標
//   2 進選桌模式不自動跳樓層；建議桌在別層 → 那層的樓層籤標「建議桌在 2F」；建議以目前樓層優先（散客表單也是）
//   3 復原欄與「放大視圖／轉向」至少隔 16px，工具列高度與地圖位置不變
//   4 現場頁入座提示同時最多 1 則（新的取代舊的）
//   5 iPad 直向桌子 <44px：視覺不變（全貌優先），透明擴大命中區；量改前／改後數字
//   6 地圖／摘要／排程分頁命中區 ≥44px、頂列不換行
// 時間用 page.clock 固定、時區 Asia/Taipei；後台本機模式以 localStorage 為後端，攔截 admin* 雲端端點。
// 截圖存 docs/ux-review-seating-20261127/shots-c2/（SHOTS_DIR 可覆寫）。

test.use({ timezoneId: 'Asia/Taipei' })

const SHOTS = process.env.SHOTS_DIR || '../../../docs/ux-review-seating-20261127/shots-c2'
const MAP = 'svg[aria-label$="桌況圖"]'
const TODAY = '2026-11-27'
const at = (hhmm) => new Date(`${TODAY}T${hhmm}:00+08:00`)
const mk = (number, capacity, floor, x, y, over = {}) => ({
  number, capacity, floor, x, y, w: capacity === 6 ? 90 : 80, h: 75, rotation: 0, zoneId: null,
  isActive: true, outage: null, status: 'vacant', currentBookingId: null, currentRef: null, seatedAt: null, ...over,
})
const bk = (id, name, over = {}) => ({
  id, name, phone: '', guests: 3, date: TODAY, timeSlot: '12:00', status: 'confirmed', source: 'phone',
  assignedTableId: null, extraTableIds: [], notes: {}, createdBy: 'staff', ...over,
})
const dining = (bookingId) => ({ status: 'dining', currentBookingId: bookingId, seatedAt: at('11:30').toISOString() })
const arrived = (id, name, main, extra = [], guests = 8) => bk(id, name, { status: 'arrived', source: 'walkin', guests, timeSlot: '11:30', assignedTableId: main, extraTableIds: extra, actualArrivalTime: at('11:30').toISOString() })

// 1F 座標同 src/data/tables.js（店主排好的版本）；2F 只放幾張
const FLOOR1 = (over = {}) => [
  ['103', 6, 130, 140], ['102', 6, 130, 300], ['101', 6, 130, 460],
  ['107', 4, 360, 300], ['110', 6, 440, 300], ['106', 4, 360, 460], ['109', 6, 440, 460], ['105', 4, 360, 620], ['108', 6, 440, 620],
  ['113', 4, 650, 300], ['112', 4, 650, 460], ['111', 4, 650, 620],
].map(([n, c, x, y]) => mk(n, c, '1F', x, y, over[n] || {}))
const FLOOR2 = (over = {}) => [
  ['201', 6, 430, 160], ['203', 6, 520, 160], ['207', 4, 700, 160], ['210', 6, 780, 160],
].map(([n, c, x, y]) => mk(n, c, '2F', x, y, over[n] || {}))

async function seed(page, { tables, bookings }) {
  await page.addInitScript(({ tables, bookings }) => {
    localStorage.setItem('chicken_tables_v3', JSON.stringify(tables))
    localStorage.setItem('chicken_bookings_v1', JSON.stringify(bookings))
    localStorage.setItem('chicken_group_reservations_v1', '[]')
    localStorage.setItem('chicken_group_blank_purge_v1', '1')
    localStorage.removeItem('chicken_waitlist_v1')
  }, { tables, bookings })
}
async function loginToOps(page, demo = false) {
  await page.goto(demo ? '/login?demo=ops' : '/login')
  await page.getByPlaceholder('your@email.com').fill('berrylin0911@gmail.com')
  await page.getByRole('button', { name: /模擬登入/ }).click()
  await expect(page).toHaveURL(/\/admin/)
  // 沙盒專屬的「雲端同步未啟用」橫幅正式站不會出現（同 mobile-admin-scroll）
  await page.addStyleTag({ content: 'main > div.border-chicken-red.bg-red-50{display:none !important}' })
  const nav = page.locator('nav.lg-bottomnav')
  if (await nav.isVisible()) await nav.locator('button', { hasText: '現場' }).click()
  else await page.locator('aside').getByRole('button', { name: '現場' }).click()
  await expect(page.locator(MAP).first()).toBeVisible()
}
const mapTable = (page, n) => page.locator(`${MAP} g[data-table-number="${n}"]`)
const floorTab = (page, f) => page.locator('[role=tablist][aria-label=樓層] [role=tab]', { hasText: f })
const rectOf = (page, sel) => page.locator(sel).first().evaluate(el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, r: r.right, b: r.bottom } })

test.beforeEach(async ({ page }) => {
  await page.route('https://**/*', route => route.abort())
  await page.route('**/adminPullData', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'e2e-offline' }) }))
  await page.route('**/adminPushData', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }))
  await page.route('**/admin*', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false }) }))
})

test('1 iPad 橫：併桌兩桌都有同組小標、非相鄰的併桌有連結線；單桌不標', async ({ page }) => {
  await page.clock.setFixedTime(at('12:00'))
  await page.setViewportSize({ width: 1180, height: 820 })
  const WANG = arrived('E2E-C2-WANG', '王先生', '107', ['110'], 9)       // 接邊的併桌
  const CHEN = arrived('E2E-C2-CHEN', '陳小姐', '101', ['102'], 11)      // 上下隔 85 unit 的併桌（中間沒有別桌）
  const LIN = arrived('E2E-C2-LIN', '林小姐', '105', [], 3)              // 單桌
  await seed(page, {
    tables: [...FLOOR1({ 107: dining(WANG.id), 110: dining(WANG.id), 101: dining(CHEN.id), 102: dining(CHEN.id), 105: dining(LIN.id) }), ...FLOOR2()],
    bookings: [WANG, CHEN, LIN],
  })
  await loginToOps(page)
  for (const n of ['107', '110']) {
    await expect(mapTable(page, n).locator('[data-combo-tag]')).toHaveAttribute('data-combo-tag', '王・併')
  }
  await expect(mapTable(page, '107')).toHaveAccessibleName(/與 110 併桌/)
  await expect(mapTable(page, '110')).toHaveAccessibleName(/與 107 併桌/)
  for (const n of ['101', '102']) await expect(mapTable(page, n).locator('[data-combo-tag]')).toHaveAttribute('data-combo-tag', '陳・併')
  // 單桌、空桌不標
  for (const n of ['105', '106', '113']) await expect(mapTable(page, n).locator('[data-combo-tag]')).toHaveCount(0)
  await expect(mapTable(page, '105')).not.toHaveAccessibleName(/併桌/)
  // 連結線：兩組各一條，畫在桌子底下（線的 DOM 在所有桌之前）、不可點
  await expect(page.locator('[data-combo-link]')).toHaveCount(2)
  await expect(page.locator('[data-combo-link="101-102"]')).toHaveCount(1)
  const order = await page.evaluate((sel) => {
    const svg = document.querySelector(sel)
    const all = [...svg.querySelectorAll('[data-testid="combo-links"], g[data-table-number]')]
    return { linksFirst: all[0]?.dataset.testid === 'combo-links', pe: getComputedStyle(svg.querySelector('[data-testid="combo-links"]')).pointerEvents }
  }, MAP)
  expect(order).toEqual({ linksFirst: true, pe: 'none' })
  // 桌面填色（status 色）不被蓋：併桌的桌本體 rect 仍是用餐中的暖灰褐
  expect(await mapTable(page, '107').locator(':scope > rect[rx="8"]').getAttribute('fill')).toBe('#ded7cc')
  await page.screenshot({ path: `${SHOTS}/01-combo-tags-ipad-landscape.png` })
})

test('2 iPad 橫：大組「到了・選桌」不自動跳 2F，2F 籤標「建議桌在 2F」；切過去提示消失', async ({ page }) => {
  await page.clock.setFixedTime(at('11:55'))
  await page.setViewportSize({ width: 1180, height: 820 })
  const W = arrived('E2E-C2-W', '現場散客', '101', [], 4)
  const ZHANG = bk('E2E-C2-ZHANG', '張先生', { guests: 11, timeSlot: '12:00' })
  // 1F 只剩 105、106（4 人桌，擠一擠也只有 10 席）；2F 201＋203 兩張 6 人桌＝12 席
  const busy = Object.fromEntries(['101', '102', '103', '107', '108', '109', '110', '111', '112', '113'].map(n => [n, dining(W.id)]))
  await seed(page, { tables: [...FLOOR1(busy), ...FLOOR2({ 207: dining(W.id), 210: dining(W.id) })], bookings: [W, ZHANG] })
  await loginToOps(page)
  await expect(floorTab(page, '1F')).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('floor-suggest-hint')).toHaveCount(0)
  await page.getByRole('button', { name: '張先生 到了，選桌入座' }).click()
  // 進了選桌模式（左欄作業面板），樓層維持 1F
  await expect(page.getByTestId('mode-banner')).toBeVisible()
  await expect(floorTab(page, '1F')).toHaveAttribute('aria-selected', 'true')
  await expect(mapTable(page, '105')).toBeVisible()
  const hint = floorTab(page, '2F').getByTestId('floor-suggest-hint')
  await expect(hint).toHaveText('建議桌在 2F')
  // 樓層籤高度不變（提示塞在籤內，不撐高）
  expect(Math.round((await floorTab(page, '2F').boundingBox()).height)).toBe(Math.round((await floorTab(page, '1F').boundingBox()).height))
  await page.screenshot({ path: `${SHOTS}/02-floor-hint-ipad-landscape.png` })
  // 店員自己切到 2F → 建議桌就在這層，提示消失
  await floorTab(page, '2F').click()
  await expect(floorTab(page, '2F')).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('floor-suggest-hint')).toHaveCount(0)
  await expect(mapTable(page, '201')).toBeVisible()
})

test('2b iPad 橫：容量合適時建議目前樓層——散客 2 位建議 1F 的 6 人桌（不是 2F 的 4 人桌）；到了・選桌同口徑、不出提示', async ({ page }) => {
  await page.clock.setFixedTime(at('11:55'))
  await page.setViewportSize({ width: 1180, height: 820 })
  const W = arrived('E2E-C2-W', '現場散客', '102', [], 4)
  const LEE = bk('E2E-C2-LEE', '李小姐', { guests: 2, timeSlot: '12:00' })
  const busy = Object.fromEntries(['102', '103', '105', '106', '107', '108', '109', '110', '111', '112', '113'].map(n => [n, dining(W.id)]))
  await seed(page, { tables: [...FLOOR1(busy), ...FLOOR2({ 201: dining(W.id), 203: dining(W.id), 210: dining(W.id) })], bookings: [W, LEE] })
  await loginToOps(page)
  // 散客表單（預設 2 位）：1F 只剩 101（6 人桌）、2F 有 207（4 人桌，原本浪費少會被建議）
  await expect(page.getByText(/建議 1F・101/)).toBeVisible()
  await expect(page.getByText(/建議 2F・207/)).toHaveCount(0)
  // 切到 2F 看 → 建議跟著改成 2F 的 207（偏好跟著店員目前看的樓層）
  await floorTab(page, '2F').click()
  await expect(page.getByText(/建議 2F・207/)).toBeVisible()
  await floorTab(page, '1F').click()
  // 到了・選桌：建議 101（1F），所以 2F 籤不出提示；樓層不動
  await page.getByRole('button', { name: '李小姐 到了，選桌入座' }).click()
  await expect(page.getByTestId('mode-banner')).toBeVisible()
  await expect(floorTab(page, '1F')).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('floor-suggest-hint')).toHaveCount(0)
})

// 桌子尺寸：視覺（g[role=button] 外框短邊）與有效命中區（含透明擴大）——用頁面裡同一支 pickTableAt 逐 0.1px 往外探
const measureTables = (page) => page.evaluate(async (sel) => {
  const { pickTableAt } = await import('/src/utils/tableHitArea.js')
  const svg = document.querySelector(sel)
  const ctm = svg.getScreenCTM()
  const scale = Math.hypot(ctm.a, ctm.b)
  const gs = [...svg.querySelectorAll('g[role=button][data-table-number]')]
  const model = gs.map(g => {
    const body = g.querySelector(':scope > rect[rx="8"]') || g.querySelector(':scope > rect')
    const rot = /rotate\(([-\d.]+)/.exec(g.getAttribute('transform') || '')?.[1]
    return { number: g.dataset.tableNumber, x: +body.getAttribute('x'), y: +body.getAttribute('y'), w: +body.getAttribute('width'), h: +body.getAttribute('height'), rotation: rot ? +rot : 0 }
  })
  const inv = ctm.inverse()
  const toUser = (cx, cy) => new DOMPoint(cx, cy).matrixTransform(inv)
  const hitsSelf = (n, cx, cy) => {
    const el = document.elementFromPoint(cx, cy)
    const g = el?.closest?.('g[role=button][data-table-number]')
    if (g) return g.dataset.tableNumber === n
    if (el?.dataset?.testid !== 'table-hit-layer') return false
    const p = toUser(cx, cy)
    return pickTableAt({ x: p.x, y: p.y }, model, scale) === n
  }
  const rows = gs.map(g => {
    const r = g.getBoundingClientRect(); const n = g.dataset.tableNumber
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2
    const reach = (dx, dy, start) => { let d = start; while (d < 60 && hitsSelf(n, cx + dx * (d + 0.1), cy + dy * (d + 0.1))) d += 0.1; return d }
    const hitW = reach(-1, 0, r.width / 2 - 1) + reach(1, 0, r.width / 2 - 1)
    const hitH = reach(0, -1, r.height / 2 - 1) + reach(0, 1, r.height / 2 - 1)
    return { n, visual: Math.min(r.width, r.height), hit: Math.min(hitW, hitH), hitW, hitH, w: r.width, h: r.height }
  })
  const min = (k) => Math.round(Math.min(...rows.map(x => x[k])) * 10) / 10
  return { visual: min('visual'), hit: min('hit'), worst: (([w]) => w && `${w.n} ${Math.round(w.hitW * 10) / 10}×${Math.round(w.hitH * 10) / 10}`)(rows.sort((a, b) => a.hit - b.hit)), scale: Math.round(scale * 1000) / 1000 }
}, MAP)

test('5 iPad 直／橫：桌子視覺尺寸不變（全貌優先），透明命中區補到 44px（量最小桌）', async ({ page }) => {
  const d = new Date()
  const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  await page.clock.setFixedTime(new Date(`${ymd}T12:00:00+08:00`))
  const out = {}
  for (const vp of [{ name: '橫', width: 1180, height: 820 }, { name: '直', width: 820, height: 1180 }]) {
    await page.setViewportSize({ width: vp.width, height: vp.height })
    if (!out.started) { await loginToOps(page, true); out.started = true }
    await floorTab(page, '1F').click()
    await page.waitForTimeout(150)
    out[`${vp.name}1F`] = await measureTables(page)
    if (vp.name === '直') await page.screenshot({ path: `${SHOTS}/03-portrait-1F-map.png` })
    await floorTab(page, '2F').click()
    await page.waitForTimeout(150)
    out[`${vp.name}2F`] = await measureTables(page)
  }
  delete out.started
  console.log('[C2-5 桌子尺寸 px]', JSON.stringify(out))
  // 視覺尺寸＝改前基準（mobile-admin-scroll 的 iPad 橫向基準 49.3／42；直向 31.6／23.5）——不放大、不縮小
  expect(out['橫1F'].visual).toBe(49.3)
  expect(out['橫2F'].visual).toBe(42)
  expect(out['直1F'].visual).toBeCloseTo(31.6, 0)
  expect(out['直2F'].visual).toBeCloseTo(23.5, 0)
  // 有效命中區：iPad 橫 1F／2F、iPad 直 1F 都 ≈44；iPad 直 2F 受桌距（島內上下只隔 15 unit≈5px）限制，只能改善、到不了 44。
  // 容許 1px：接邊的鄰桌（1F 107｜110）邊框會壓住本桌邊緣約 0.4px，探針又是 0.1px 一步。
  expect(out['橫1F'].hit).toBeGreaterThanOrEqual(44)
  expect(out['橫2F'].hit).toBeGreaterThanOrEqual(43)
  expect(out['直1F'].hit).toBeGreaterThanOrEqual(43)
  expect(out['直2F'].hit).toBeGreaterThan(out['直2F'].visual)

  // 真的點：iPad 直向 1F，點在 105 桌外 5px（視覺外、44px 內）→ 開 105 的抽屜
  await floorTab(page, '1F').click()
  const box = await mapTable(page, '105').boundingBox()
  const hitEl = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.dataset?.testid || null, { x: box.x + box.width / 2, y: box.y - 5 })
  expect(hitEl).toBe('table-hit-layer')
  await page.mouse.click(box.x + box.width / 2, box.y - 5)
  await expect(mapTable(page, '105')).toHaveAttribute('aria-pressed', 'true')
})

test('3 復原欄與「放大視圖／轉向」至少隔 16px；工具列高度與地圖位置不變（iPad 橫／直）', async ({ page }) => {
  const d = new Date()
  const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  await page.clock.setFixedTime(new Date(`${ymd}T12:00:00+08:00`))
  await page.setViewportSize({ width: 1180, height: 820 })
  await loginToOps(page, true)
  // 先入座一組，讓復原欄出現可按的「復原」
  await page.getByRole('button', { name: '王', exact: true }).click()
  await mapTable(page, '113').click()
  await page.getByTestId('walkin-seat').click()
  await expect(page.getByTestId('seat-undo-action')).toBeVisible()
  for (const vp of [{ name: '橫', width: 1180, height: 820, wrapped: 'false', toolbarH: 44 }, { name: '直', width: 820, height: 1180, wrapped: 'true', toolbarH: 96 }]) {
    await page.setViewportSize({ width: vp.width, height: vp.height })
    await expect(page.getByTestId('seat-undo-bar')).toHaveAttribute('data-wrapped', vp.wrapped)
    const m = await page.evaluate((sel) => {
      const bar = document.querySelector('[data-testid="seat-undo-bar"]')
      const toolbar = bar.parentElement
      const action = document.querySelector('[data-testid="seat-undo-action"]').getBoundingClientRect()
      const btns = [...toolbar.querySelectorAll(':scope > button')].filter(b => /放大視圖|轉向|縮小地圖|放大地圖/.test(b.textContent + (b.getAttribute('aria-label') || '')))
      const gaps = btns.map(b => {
        const r = b.getBoundingClientRect()
        const dx = Math.max(0, action.left - r.right, r.left - action.right), dy = Math.max(0, action.top - r.bottom, r.top - action.bottom)
        return { who: (b.getAttribute('aria-label') || b.textContent).trim(), d: Math.round(Math.hypot(dx, dy) * 10) / 10 }
      })
      const tb = toolbar.getBoundingClientRect()
      const vpEl = document.querySelector(sel).parentElement.getBoundingClientRect()
      return { gaps, toolbarH: Math.round(tb.height), mapTopGap: Math.round(vpEl.top - tb.bottom) }
    }, MAP)
    console.log(`[C2-3 ${vp.name}]`, JSON.stringify(m))
    for (const g of m.gaps) expect(g.d, `${vp.name}：復原 與 ${g.who}`).toBeGreaterThanOrEqual(16)
    expect(m.toolbarH, `${vp.name} 工具列高度`).toBe(vp.toolbarH)
    expect(m.mapTopGap, `${vp.name} 地圖與工具列距離（mb-2）`).toBe(8)
  }
})

test('4 iPad 直：連續入座 3 組，畫面上的入座提示同時最多 1 則（新的取代舊的），提示仍不可點、不帶按鈕', async ({ page }) => {
  const d = new Date()
  const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  await page.clock.setFixedTime(new Date(`${ymd}T12:00:00+08:00`))
  await page.setViewportSize({ width: 820, height: 1180 })
  await loginToOps(page, true)
  for (const n of ['113', '108', '111']) {
    await page.getByRole('button', { name: '王', exact: true }).click()
    await mapTable(page, n).click()
    await expect(page.getByRole('button', { name: `移除桌 ${n}` })).toBeVisible()
    await page.getByTestId('walkin-seat').click()
    await expect(page.locator('[data-placement="seat"]').filter({ hasText: `→ ${n} 已入座` })).toBeVisible()
  }
  // 舊的兩則退場動畫（0.16 秒）結束後，只剩最新那則
  await expect(page.locator('[data-placement="seat"]')).toHaveCount(1)
  const t = page.locator('[data-placement="seat"]')
  await expect(t).toContainText('→ 111 已入座')
  expect(await t.evaluate(el => getComputedStyle(el).pointerEvents)).toBe('none')
  await expect(t.locator('button')).toHaveCount(0)
  // 頂列「待清／候位」不被提示蓋住（中心點打得到自己）
  const covered = await page.evaluate(() => [...document.querySelectorAll('[role=group][aria-label="需要處理"] button')].map(b => {
    const r = b.getBoundingClientRect(); const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
    return { who: b.textContent.trim().slice(0, 8), ok: b.contains(hit) }
  }).filter(x => !x.ok))
  expect(covered).toEqual([])
})

test('6 地圖／摘要／排程分頁：視覺 32px、命中區 ≥44px；iPad 橫頂列不換行（iPad 橫／直）', async ({ page }) => {
  const d = new Date()
  const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  await page.clock.setFixedTime(new Date(`${ymd}T12:00:00+08:00`))
  await page.setViewportSize({ width: 1180, height: 820 })
  await loginToOps(page, true)
  for (const vp of [{ name: '橫', width: 1180, height: 820 }, { name: '直', width: 820, height: 1180 }]) {
    await page.setViewportSize({ width: vp.width, height: vp.height })
    const rows = await page.evaluate(() => {
      const bar = document.querySelector('[aria-label="現場視圖"]')
      return [...bar.querySelectorAll(':scope > button')].map(b => {
        const r = b.getBoundingClientRect(); const cx = r.left + r.width / 2, cy = r.top + r.height / 2
        const own = (x, y) => document.elementFromPoint(x, y)?.closest('button') === b
        return { label: b.textContent.trim(), w: r.width, h: r.height, top: own(cx, cy - 21.5), bottom: own(cx, cy + 21.5), left: own(r.left + 1, cy), right: own(r.right - 1, cy) }
      })
    })
    expect(rows.map(r => r.label)).toEqual(['地圖', '摘要', '排程'])
    for (const r of rows) {
      expect(Math.round(r.h), `${vp.name} ${r.label} 視覺高`).toBe(32)
      expect(r.w, `${vp.name} ${r.label} 寬`).toBeGreaterThanOrEqual(44)
      expect([r.top, r.bottom, r.left, r.right], `${vp.name} ${r.label} 命中區 44px`).toEqual([true, true, true, true])
    }
    if (vp.name === '橫') {
      // 頂列單行：每個子項都和第一個子項上下重疊（換到第二行的子項會整個落在第一行下面）
      const rows = await page.evaluate(() => [...document.querySelector('.lg-toolbar').children].map(c => c.getBoundingClientRect()).filter(r => r.height > 0).map(r => [Math.round(r.top), Math.round(r.bottom)]))
      const [t0, b0] = rows[0]
      expect(rows.every(([t, b]) => t < b0 && b > t0), `頂列子項 ${JSON.stringify(rows)}`).toBe(true)
    }
    // 真的點：點在視覺高度外 5px（44px 內）切到摘要，再切回地圖
    const sum = page.getByLabel('現場視圖').getByRole('button', { name: '摘要' })
    const b = await sum.boundingBox()
    await page.mouse.click(b.x + b.width / 2, b.y + b.height + 5)
    await expect(sum).toHaveAttribute('aria-pressed', 'true')
    await page.getByLabel('現場視圖').getByRole('button', { name: '地圖' }).click()
  }
})

test('2m 手機 @mobile：大組「到了・選桌」不跳樓層、2F 籤標提示；模式橫幅 <180', async ({ page }) => {
  await page.clock.setFixedTime(at('11:55'))
  const W = arrived('E2E-C2-W', '現場散客', '101', [], 4)
  const ZHANG = bk('E2E-C2-ZHANG', '張先生', { guests: 11, timeSlot: '12:00' })
  const busy = Object.fromEntries(['101', '102', '103', '107', '108', '109', '110', '111', '112', '113'].map(n => [n, dining(W.id)]))
  await seed(page, { tables: [...FLOOR1(busy), ...FLOOR2({ 207: dining(W.id), 210: dining(W.id) })], bookings: [W, ZHANG] })
  await loginToOps(page)
  // 手機上報到列與今日清單都有同一顆（報到列在地圖下方）；點報到列那顆
  await page.getByTestId('arrival-strip').getByRole('button', { name: '張先生 到了，選桌入座' }).click()
  const banner = page.getByTestId('mode-banner')
  await expect(banner).toBeVisible()
  expect((await banner.boundingBox()).height).toBeLessThan(180)
  await expect(floorTab(page, '1F')).toHaveAttribute('aria-selected', 'true')
  const hint = floorTab(page, '2F').getByTestId('floor-suggest-hint')
  await expect(hint).toHaveText('建議桌在 2F')
  // 提示在籤內、不超出籤（窄螢幕把「可選 N」藏起來讓位）
  const tab = await floorTab(page, '2F').boundingBox()
  const hb = await hint.boundingBox()
  expect(hb.x + hb.width).toBeLessThanOrEqual(tab.x + tab.width + 0.5)
  expect(Math.round(tab.height)).toBeGreaterThanOrEqual(44)
})
