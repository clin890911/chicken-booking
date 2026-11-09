import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import { todayTab } from './helpers/opsToday'

// night-50 批 1：A1–A8 現場散客帶位、B1–B7 訂位到店報到→入座。
// 每題計步（click／fill／切頁／確認框各 1 步），結果寫到 scratchpad 的 b1-steps.json 供報告引用。
// 本機模擬登入（manager）＋ localStorage 種子；所有後端端點以「非 localhost 且 /admin、/guest 開頭」攔截。

test.use({ timezoneId: 'Asia/Taipei' })

const SCRATCH = '/private/tmp/claude-501/-Users-chingchunlin--claude-spares-spare-WtJFow/2abbcc7f-2edc-4b13-af84-1f34c069374e/scratchpad'
const SHOTS = `${SCRATCH}/shots-b1`
const STEPS_FILE = `${SCRATCH}/b1-steps.json`
const TODAY = '2026-09-19'
const at = (hhmm) => new Date(`${TODAY}T${hhmm}:00+08:00`)

function record(id, data) {
  let all = {}
  try { all = JSON.parse(fs.readFileSync(STEPS_FILE, 'utf8')) } catch {}
  all[id] = { ...(all[id] || {}), ...data }
  fs.writeFileSync(STEPS_FILE, JSON.stringify(all, null, 2))
}
const shot = (page, name) => page.screenshot({ path: `${SHOTS}/${name}.png` })

// 版面：1F 兩排、2F 一排；座標拉開避免重疊
const T = (number, capacity, floor, x, y, over = {}) => ({
  number, capacity, floor, x, y, w: 80, h: 75, rotation: 0, zoneId: null,
  isActive: true, outage: null, status: 'vacant', currentBookingId: null, currentRef: null, seatedAt: null, ...over,
})
const dining = (bid) => ({ status: 'dining', currentBookingId: bid, seatedAt: at('17:00').toISOString() })
const bk = (id, over = {}) => ({
  id, name: '王先生', phone: '0911000001', guests: 4, date: TODAY, timeSlot: '18:00',
  status: 'confirmed', source: 'phone', assignedTableId: null, extraTableIds: [], notes: {}, createdBy: 'staff', ...over,
})
const OCC = (id, table, guests = 2) => bk(id, { name: `佔桌${table}`, phone: '', guests, status: 'arrived', source: 'walkin', timeSlot: '17:00', assignedTableId: table, actualArrivalTime: at('17:00').toISOString() })

async function seed(page, { tables, bookings = [], customers = null }) {
  await page.addInitScript(({ tables, bookings, customers }) => {
    if (sessionStorage.getItem('b1-seeded')) return   // 同一 page 重新整理不要重灌
    sessionStorage.setItem('b1-seeded', '1')
    localStorage.setItem('chicken_tables_v3', JSON.stringify(tables))
    localStorage.setItem('chicken_bookings_v1', JSON.stringify(bookings))
    localStorage.setItem('chicken_group_reservations_v1', '[]')
    localStorage.setItem('chicken_group_blank_purge_v1', '1')
    localStorage.removeItem('chicken_waitlist_v1')
    if (customers) localStorage.setItem('chicken_customers_v1', JSON.stringify(customers))
  }, { tables, bookings, customers })
}

async function interceptBackend(target) {
  await target.route(url => url.hostname !== 'localhost' && /^\/(admin|guest|line|staff|group|retry|notification)/.test(url.pathname), route => {
    const u = route.request().url()
    const body = u.includes('adminPullData') ? { ok: false, error: 'e2e-offline' } : u.includes('adminPushData') ? { ok: true } : { ok: false }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  })
}

async function loginToOps(page) {
  await page.goto('/login')
  await page.getByPlaceholder('your@email.com').fill('berrylin0911@gmail.com')
  await page.getByRole('button', { name: /模擬登入/ }).click()
  await expect(page).toHaveURL(/\/admin/)
  await page.locator('aside').getByRole('button', { name: '現場' }).click()
  await expect(page.getByTestId('walkin-seat')).toBeVisible()
}

const readState = (page) => page.evaluate(() => ({
  bookings: JSON.parse(localStorage.getItem('chicken_bookings_v1') || '[]'),
  tables: JSON.parse(localStorage.getItem('chicken_tables_v3') || '[]'),
}))
const mapTable = (page, n) => page.getByRole('button', { name: new RegExp(`^${n}桌`) })
const party = (page, n) => page.getByRole('button', { name: `${n} 位`, exact: true })
const strip = (page) => page.getByRole('list', { name: '可入座名單' })

test.beforeEach(async ({ page }) => {
  await interceptBackend(page)
})

// ───────────────────────── A：現場散客帶位 ─────────────────────────

test('A1 兩位散客 → 空 2 人桌：人數→點桌→確認入座', async ({ page }) => {
  await page.clock.setFixedTime(at('17:50'))
  await seed(page, { tables: [T('101', 2, '1F', 100, 100), T('102', 4, '1F', 260, 100), T('104', 6, '1F', 420, 100)] })
  await loginToOps(page)
  let steps = 0
  const defaultPressed = await party(page, 2).getAttribute('aria-pressed')
  if (defaultPressed !== 'true') { await party(page, 2).click(); steps++ }
  await mapTable(page, '101').click(); steps++
  await shot(page, 'A1-1-selected')
  await page.getByTestId('walkin-seat').click(); steps++
  await expect(page.getByText(/入座 101\s*·\s*可帶下一組/)).toBeVisible()
  const { bookings, tables } = await readState(page)
  expect(tables.find(t => t.number === '101')).toMatchObject({ status: 'dining' })
  const b = bookings.find(x => x.id === tables.find(t => t.number === '101').currentBookingId)
  expect(b).toMatchObject({ status: 'arrived', source: 'walkin', guests: 2 })
  record('A1', { steps, defaultPartyPressed: defaultPressed, bookingName: b.name })
})

test('A2 五位散客，只剩 4 人桌與 6 人桌', async ({ page }) => {
  await page.clock.setFixedTime(at('17:50'))
  await seed(page, {
    tables: [T('101', 2, '1F', 100, 100, dining('OCC1')), T('102', 4, '1F', 260, 100), T('104', 6, '1F', 420, 100)],
    bookings: [OCC('OCC1', '101')],
  })
  await loginToOps(page)
  let steps = 0
  await party(page, 5).click(); steps++
  const hint = page.getByText(/5 位 · 建議/)
  const hintText = await hint.textContent().catch(() => null)
  // 先誤點 4 人桌看提示
  await mapTable(page, '102').click()
  const warn102 = await page.getByText(/5 位 → 102/).textContent().catch(() => null)
  await shot(page, 'A2-1-pick-4top')
  await page.getByRole('button', { name: '移除桌 102' }).click()
  // 正解：6 人桌
  await mapTable(page, '104').click(); steps++
  await page.getByTestId('walkin-seat').click(); steps++
  await expect(page.getByText(/入座 104/)).toBeVisible()
  const { tables } = await readState(page)
  expect(tables.find(t => t.number === '104').status).toBe('dining')
  record('A2', { steps, hintText, warn102 })
})

test('A3 七位散客只剩兩張 4 人桌 → 建議併桌', async ({ page }) => {
  await page.clock.setFixedTime(at('17:50'))
  await seed(page, {
    tables: [T('102', 4, '1F', 100, 100), T('103', 4, '1F', 200, 100), T('104', 6, '1F', 420, 100, dining('OCC1'))],
    bookings: [OCC('OCC1', '104', 5)],
  })
  await loginToOps(page)
  let steps = 0
  await party(page, 7).click(); steps++
  const hintText = await page.getByText(/7 位/).first().textContent().catch(() => null)
  await shot(page, 'A3-1-suggest')
  const apply = page.getByTestId('walkin-apply-suggestion')
  const hasApply = await apply.isVisible().catch(() => false)
  if (hasApply) { await apply.click(); steps++ } else {
    await mapTable(page, '102').click(); steps++
    await mapTable(page, '103').click(); steps++
  }
  await shot(page, 'A3-2-two-tables')
  const confirmText = await page.getByTestId('walkin-seat').textContent()
  await page.getByTestId('walkin-seat').click(); steps++
  await expect(page.getByText(/入座 102 \+ 103/)).toBeVisible()
  const { bookings, tables } = await readState(page)
  const main = tables.find(t => t.number === '102')
  expect(main.status).toBe('dining')
  expect(tables.find(t => t.number === '103')).toMatchObject({ status: 'dining', currentBookingId: main.currentBookingId })
  expect(bookings.find(b => b.id === main.currentBookingId)).toMatchObject({ guests: 7, assignedTableId: '102', extraTableIds: ['103'] })
  record('A3', { steps, hintText, hasApply, confirmText })
})

test('A4 散客留電話：選填、鍵盤擋不擋桌況、舊客帶檔', async ({ page }) => {
  await page.clock.setFixedTime(at('17:50'))
  await seed(page, {
    tables: [T('102', 4, '1F', 100, 100), T('103', 4, '1F', 260, 100)],
    customers: { '0912000111': { phone: '0912000111', name: '林小姐', allergies: '花生', visits: 3, totalGuests: 6, vipTier: 'none', createdAt: '2026-01-01T00:00:00.000Z' } },
  })
  await loginToOps(page)
  let steps = 0
  await party(page, 3).click(); steps++
  // 不填電話也能入座（選填）：先確認按鈕已可用
  await mapTable(page, '102').click(); steps++
  const enabledWithoutPhone = await page.getByTestId('walkin-seat').isEnabled()
  const phone = page.getByRole('textbox', { name: '電話' })
  await phone.click(); steps++
  const pad = page.getByRole('dialog', { name: '電話數字鍵盤' })
  await expect(pad).toBeVisible()
  await phone.fill('0912000111'); steps++  // 實務上 10 下數字鍵；這裡以 fill 代表 1 步
  await expect(page.getByText(/忌花生/)).toBeVisible()
  await shot(page, 'A4-1-keypad-open')
  const padBox = await pad.boundingBox()
  const mapBox = await page.locator('svg').filter({ has: page.locator('[data-table-number]') }).first().boundingBox()
  const overlap = padBox && mapBox ? !(padBox.x + padBox.width <= mapBox.x || mapBox.x + mapBox.width <= padBox.x || padBox.y + padBox.height <= mapBox.y || mapBox.y + mapBox.height <= padBox.y) : null
  await page.getByRole('button', { name: 'OK', exact: true }).click(); steps++
  const nameAfter = await page.getByTestId('walkin-seat').textContent()
  await page.getByTestId('walkin-seat').click(); steps++
  await expect(page.getByText(/入座 102/)).toBeVisible()
  const { bookings, tables } = await readState(page)
  const b = bookings.find(x => x.id === tables.find(t => t.number === '102').currentBookingId)
  record('A4', { steps, enabledWithoutPhone, padBox, mapBox, overlap, confirmLabel: nameAfter, savedName: b.name, savedPhone: b.phone, savedNotes: b.notes })
})

test('A5 帶錯桌 → 5 秒內復原：桌回空桌', async ({ page }) => {
  await page.clock.setFixedTime(at('17:50'))
  await seed(page, { tables: [T('102', 4, '1F', 100, 100), T('103', 4, '1F', 200, 100)] })
  await loginToOps(page)
  await party(page, 2).click()
  await mapTable(page, '102').click()
  await page.getByTestId('walkin-seat').click()
  await expect(page.getByText(/入座 102/)).toBeVisible()
  const before = await readState(page)
  const bid = before.tables.find(t => t.number === '102').currentBookingId
  let steps = 0
  await shot(page, 'A5-1-toast')
  await page.getByRole('button', { name: '復原帶位 102', exact: true }).click(); steps++
  await expect(page.getByText(/已復原/)).toBeVisible()
  const panelAfter = await page.getByRole('button', { name: '移除桌 102' }).isVisible().catch(() => false)
  await shot(page, 'A5-2-undone')
  const { bookings, tables } = await readState(page)
  expect(tables.find(t => t.number === '102')).toMatchObject({ status: 'vacant', currentBookingId: null })
  const b = bookings.find(x => x.id === bid)
  // A5 修正：復原剛帶位的散客＝當作沒發生，chicken_bookings_v1 不再留一筆 cancelled 的散客
  expect(b).toBeUndefined()
  expect(bookings.some(x => x.source === 'walkin' && x.status === 'cancelled')).toBe(false)
  record('A5', { steps, undoneBookingStatus: b?.status ?? 'deleted', tableStatus: tables.find(t => t.number === '102').status, panelKeepsTable: panelAfter, opsLog: await page.evaluate(() => localStorage.getItem('chicken_ops_log_v1')) })
})

test('A6 1F 滿 → 切 2F 帶位：人數保留', async ({ page }) => {
  await page.clock.setFixedTime(at('17:50'))
  await seed(page, {
    tables: [T('101', 4, '1F', 100, 100, dining('OCC1')), T('102', 4, '1F', 260, 100, dining('OCC2')), T('201', 4, '2F', 100, 100), T('202', 2, '2F', 260, 100)],
    bookings: [OCC('OCC1', '101'), OCC('OCC2', '102')],
  })
  await loginToOps(page)
  let steps = 0
  await party(page, 3).click(); steps++
  const hint = await page.getByText(/3 位 · 建議/).textContent().catch(() => null)
  const tab2F = page.getByRole('tablist', { name: '樓層' }).getByRole('tab', { name: /2F/ })
  const nudge = await page.getByLabel(/另一層有/).count()
  await tab2F.click(); steps++
  await expect(tab2F).toHaveAttribute('aria-selected', 'true')
  const kept = await party(page, 3).getAttribute('aria-pressed')
  await mapTable(page, '201').click(); steps++
  await shot(page, 'A6-1-2F-selected')
  await page.getByTestId('walkin-seat').click(); steps++
  await expect(page.getByText(/入座 201/)).toBeVisible()
  const { tables } = await readState(page)
  expect(tables.find(t => t.number === '201').status).toBe('dining')
  record('A6', { steps, hint, nudgeDots: nudge, partyKept: kept })
})

test('A7 兩台同時帶同一桌（同 localStorage 兩個分頁模擬）', async ({ page, context }) => {
  await context.clock.setFixedTime(at('17:50'))
  await seed(page, { tables: [T('102', 4, '1F', 100, 100), T('103', 4, '1F', 260, 100)] })
  await loginToOps(page)
  const pageB = await context.newPage()
  await interceptBackend(pageB)
  await pageB.goto('/admin')
  await pageB.locator('aside').getByRole('button', { name: '現場' }).click()
  // 兩台都先選好 3 位＋102
  for (const p of [page, pageB]) { await party(p, 3).click(); await mapTable(p, '102').click() }
  await expect(pageB.getByRole('button', { name: '移除桌 102' })).toBeVisible()
  // A 先確認
  await page.getByTestId('walkin-seat').click()
  await expect(page.getByText(/入座 102/)).toBeVisible()
  await pageB.waitForTimeout(500)
  const bStillSelected = await pageB.getByRole('button', { name: '移除桌 102' }).isVisible().catch(() => false)
  const bConfirm = await pageB.getByTestId('walkin-seat').textContent()
  const bEnabled = await pageB.getByTestId('walkin-seat').isEnabled()
  await shot(pageB, 'A7-1-deviceB-before-confirm')
  let bMsg = null
  if (bEnabled) {
    await pageB.getByTestId('walkin-seat').click()
    bMsg = await pageB.getByText(/入座失敗|不是空桌|已被/).first().textContent({ timeout: 3000 }).catch(() => null)
    await shot(pageB, 'A7-2-deviceB-after-confirm')
  }
  const { bookings, tables } = await readState(page)
  const walkins = bookings.filter(b => b.source === 'walkin' && b.status === 'arrived')
  record('A7', { bStillSelected, bConfirm, bEnabled, bMsg, arrivedWalkins: walkins.length, table102: tables.find(t => t.number === '102') })
  expect(walkins.length).toBe(1)
})

test('A8 沿用上一組：同一家人分兩桌', async ({ page }) => {
  await page.clock.setFixedTime(at('17:50'))
  await seed(page, { tables: [T('102', 4, '1F', 100, 100), T('103', 4, '1F', 260, 100)] })
  await loginToOps(page)
  // 第一桌：4 位＋陳＋電話＋註記
  await party(page, 4).click()
  await page.getByRole('button', { name: '陳', exact: true }).click()
  const phone = page.getByRole('textbox', { name: '電話' })
  await phone.click(); await phone.fill('0922333444')
  await page.getByRole('button', { name: 'OK', exact: true }).click()
  await page.getByPlaceholder('例：靠窗、慶生、過敏').fill('同一家 A 桌')
  await mapTable(page, '102').click()
  await page.getByTestId('walkin-seat').click()
  await expect(page.getByText(/入座 102/)).toBeVisible()
  // 第二桌
  let steps = 0
  const reuse = page.getByRole('button', { name: /沿用上一組/ })
  const reuseText = await reuse.textContent()
  await reuse.click(); steps++
  await mapTable(page, '103').click(); steps++
  await shot(page, 'A8-1-reuse')
  const label = await page.getByTestId('walkin-seat').textContent()
  const phoneVal = await phone.inputValue()
  await page.getByTestId('walkin-seat').click(); steps++
  await expect(page.getByText(/入座 103/)).toBeVisible()
  const { bookings, tables } = await readState(page)
  const b1 = bookings.find(x => x.id === tables.find(t => t.number === '102').currentBookingId)
  const b2 = bookings.find(x => x.id === tables.find(t => t.number === '103').currentBookingId)
  record('A8', { steps, reuseText, label, phoneValAfterReuse: phoneVal, b1: { name: b1.name, phone: b1.phone, notes: b1.notes }, b2: { name: b2.name, phone: b2.phone, guests: b2.guests, notes: b2.notes } })
})

// ───────────────────────── B：訂位客人到店 ─────────────────────────

test('B1 預配桌的王先生 17:50 到 → 報到列一下入座', async ({ page }) => {
  await page.clock.setFixedTime(at('17:50'))
  const WANG = bk('B1-WANG', { assignedTableId: '104' })
  await seed(page, { tables: [T('102', 4, '1F', 100, 100), T('104', 6, '1F', 260, 100)], bookings: [WANG] })
  await loginToOps(page)
  let steps = 0
  await expect(strip(page).getByRole('listitem')).toContainText('王先生')
  await shot(page, 'B1-1-strip')
  await strip(page).getByRole('button', { name: '王先生 到了，入座 104' }).click(); steps++
  await expect(page.getByText(/王先生 已入座 104/)).toBeVisible()
  const { bookings, tables } = await readState(page)
  expect(bookings.find(b => b.id === WANG.id)).toMatchObject({ status: 'arrived', assignedTableId: '104' })
  expect(tables.find(t => t.number === '104')).toMatchObject({ status: 'dining', currentBookingId: WANG.id })
  record('B1', { steps })
})

test('B2 預訂客到了但沒預配桌 → 到了直接進選桌', async ({ page }) => {
  await page.clock.setFixedTime(at('17:50'))
  const LI = bk('B2-LI', { name: '李小姐', phone: '0911000002', guests: 3 })
  await seed(page, { tables: [T('102', 4, '1F', 100, 100), T('104', 6, '1F', 260, 100)], bookings: [LI] })
  await loginToOps(page)
  let steps = 0
  await strip(page).getByRole('button', { name: '李小姐 到了，選桌入座' }).click(); steps++
  await expect(page.getByText(/到了 · 選桌入座：李小姐 3 位/)).toBeVisible()
  await shot(page, 'B2-1-pick-mode')
  await mapTable(page, '102').click(); steps++
  await page.getByRole('button', { name: '確認入座', exact: true }).click(); steps++
  await expect(page.getByText('李小姐（3 位）已入座 102')).toBeVisible()
  const { bookings } = await readState(page)
  expect(bookings.find(b => b.id === LI.id)).toMatchObject({ status: 'arrived', assignedTableId: '102' })
  record('B2', { steps })
})

test('B3 預訂 4 人到了 6 人 → 選桌入座橫幅直接改人數 → 選桌', async ({ page }) => {
  await page.clock.setFixedTime(at('17:50'))
  const ZHANG = bk('B3-ZHANG', { name: '張先生', phone: '0911000003', guests: 4 })
  await seed(page, { tables: [T('102', 4, '1F', 100, 100), T('104', 6, '1F', 260, 100)], bookings: [ZHANG] })
  await loginToOps(page)
  // 計步：每個畫面動作 1 步；連按 ＋＋ 算「改人數」1 步（報告的合理步數口徑），另記實際點擊數
  let steps = 0, clicks = 0
  await strip(page).getByRole('button', { name: '張先生 到了，選桌入座' }).click(); steps++; clicks++
  const banner = page.getByTestId('mode-banner')
  await expect(banner).toContainText('到了 · 選桌入座：張先生 4 位')
  await banner.getByRole('button', { name: '人數加一' }).click(); clicks++
  await banner.getByRole('button', { name: '人數加一' }).click(); clicks++
  steps++
  await expect(banner.getByTestId('arrive-need')).toHaveText('6 位')
  await expect(banner).toContainText('到了 · 選桌入座：張先生 6 位')
  await expect(banner).toContainText('訂位 4 位 · 入座時一併改')
  await shot(page, 'B3-1-banner-need')
  // 4 人桌擠一擠最多 5 位 → 確認鈕不可按；改點 6 人桌
  await mapTable(page, '104').click(); steps++; clicks++
  await page.getByRole('button', { name: '確認入座', exact: true }).click(); steps++; clicks++
  await expect(page.getByText(/張先生（6 位，原訂 4 位）已入座 104/)).toBeVisible()
  const { bookings, tables } = await readState(page)
  expect(bookings.find(b => b.id === ZHANG.id)).toMatchObject({ status: 'arrived', guests: 6, assignedTableId: '104' })
  expect(tables.find(t => t.number === '104')).toMatchObject({ status: 'dining', currentBookingId: ZHANG.id })
  expect(steps).toBeLessThanOrEqual(4)
  record('B3', { steps, clicks, after: 'banner-stepper' })
})

test('B4 預訂客早到：40 分（窗內）與 75 分（窗外）都找得到、能入座', async ({ page }) => {
  await page.clock.setFixedTime(at('17:20'))
  const EARLY40 = bk('B4-E40', { name: '周先生', phone: '0911000004', guests: 2, timeSlot: '18:00', assignedTableId: '102' })
  const EARLY75 = bk('B4-E75', { name: '吳小姐', phone: '0911000005', guests: 2, timeSlot: '18:35' })
  await seed(page, { tables: [T('102', 4, '1F', 100, 100), T('103', 4, '1F', 260, 100)], bookings: [EARLY40, EARLY75] })
  await loginToOps(page)
  const inStrip40 = await strip(page).getByRole('listitem').filter({ hasText: '周先生' }).count()
  const inStrip75 = await strip(page).getByRole('listitem').filter({ hasText: '吳小姐' }).count().catch(() => 0)
  await shot(page, 'B4-1-strip')
  // 窗外：今日籤找
  let steps = 0
  await todayTab(page).click(); steps++
  const card = page.locator(`[data-booking-id="${EARLY75.id}"]`)
  await expect(card).toBeVisible()
  const cardButtons = await card.getByRole('button').allTextContents()
  await shot(page, 'B4-2-today-card')
  await card.getByRole('button', { name: '吳小姐 到了，選桌入座' }).click(); steps++
  await mapTable(page, '103').click(); steps++
  await page.getByRole('button', { name: '確認入座', exact: true }).click(); steps++
  await expect(page.getByText(/吳小姐（2 位）已入座 103/)).toBeVisible()
  const { bookings } = await readState(page)
  expect(bookings.find(b => b.id === EARLY75.id)).toMatchObject({ status: 'arrived', assignedTableId: '103' })
  record('B4', { steps, inStrip40, inStrip75, cardButtons })
})

test('B5 客人到了但預配桌還在用餐 → 到了·換桌入座一次完成＋復原', async ({ page }) => {
  await page.clock.setFixedTime(at('17:50'))
  const WANG = bk('B5-WANG', { assignedTableId: '102', guests: 4 })
  await seed(page, {
    tables: [T('102', 4, '1F', 100, 100, dining('OCC1')), T('103', 4, '1F', 260, 100), T('104', 6, '1F', 420, 100)],
    bookings: [OCC('OCC1', '102'), WANG],
  })
  await loginToOps(page)
  let steps = 0
  const item = strip(page).getByRole('listitem').filter({ hasText: '王先生' })
  await expect(item).toContainText('預配·桌被佔')
  await shot(page, 'B5-1-strip-taken')
  await item.getByRole('button', { name: '王先生 到了，換桌入座' }).click(); steps++
  const banner = page.getByTestId('mode-banner')
  await expect(banner).toContainText('到了 · 換桌入座：王先生 4 位')
  await expect(banner.getByTestId('arrive-reseat-from')).toContainText('原預配 102 被佔')
  await shot(page, 'B5-2-reseat-mode')
  await mapTable(page, '103').click(); steps++
  await page.getByRole('button', { name: '確認入座', exact: true }).click(); steps++
  await expect(page.getByText('王先生（4 位）已入座 103（原預配 102 被佔）')).toBeVisible()
  await shot(page, 'B5-3-seated-toast')
  let { bookings, tables } = await readState(page)
  expect(bookings.find(b => b.id === WANG.id)).toMatchObject({ status: 'arrived', assignedTableId: '103' })
  expect(tables.find(t => t.number === '103')).toMatchObject({ status: 'dining', currentBookingId: WANG.id })
  expect(tables.find(t => t.number === '102')).toMatchObject({ status: 'dining', currentBookingId: 'OCC1' })
  expect(bookings.find(b => b.id === 'OCC1')).toMatchObject({ status: 'arrived', assignedTableId: '102' })
  expect(steps).toBe(3)
  // 復原：訂位回待到＋原預配 102、103 回空桌；102 仍是別組
  await page.getByRole('button', { name: '復原', exact: true }).click()
  await expect(page.getByText(/已復原：王先生 回到待到/)).toBeVisible()
  ;({ bookings, tables } = await readState(page))
  expect(bookings.find(b => b.id === WANG.id)).toMatchObject({ status: 'confirmed', assignedTableId: '102' })
  expect(bookings.find(b => b.id === WANG.id).actualArrivalTime ?? null).toBeNull()
  expect(tables.find(t => t.number === '103')).toMatchObject({ status: 'vacant', currentBookingId: null })
  expect(tables.find(t => t.number === '102')).toMatchObject({ status: 'dining', currentBookingId: 'OCC1' })
  record('B5', { steps, after: 'arrive-reseat' })
})

test('B6 同名兩組同時段 → 報到列可分辨', async ({ page }) => {
  await page.clock.setFixedTime(at('17:50'))
  const C1 = bk('B6-C1', { name: '陳先生', phone: '0911222333', guests: 2, assignedTableId: '102' })
  const C2 = bk('B6-C2', { name: '陳先生', phone: '0988777666', guests: 5, assignedTableId: '104' })
  const C3 = bk('B6-C3', { name: '陳先生', phone: '', guests: 3 })
  await seed(page, { tables: [T('102', 4, '1F', 100, 100), T('104', 6, '1F', 260, 100), T('103', 4, '1F', 420, 100)], bookings: [C1, C2, C3] })
  await loginToOps(page)
  const items = strip(page).getByRole('listitem')
  await expect(items).toHaveCount(3)
  const texts = await items.allTextContents()
  // 預配／鎖桌／未配桌三種 pill 都顯示人數
  await expect(items.filter({ hasText: '0911-222-333' })).toContainText('2 位')
  await expect(items.filter({ hasText: '0988-777-666' })).toContainText('5 位')
  await expect(items.filter({ hasText: '未配桌' })).toContainText('3 位')
  // pill 高度不超過「到了」鈕高（44）＋邊框／內距：與未配桌 pill 同高
  const heights = await items.evaluateAll(els => els.map(e => Math.round(e.getBoundingClientRect().height)))
  expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(1)
  await shot(page, 'B6-1-strip-same-name')
  record('B6', { texts, heights })
})

test('B7 按錯「到了」→ 復原：booking＋table 都倒回（預配與鎖桌兩型）', async ({ page }) => {
  await page.clock.setFixedTime(at('17:50'))
  const PRE = bk('B7-PRE', { name: '黃先生', phone: '0911000007', assignedTableId: '102' })
  const HELD = bk('B7-HELD', { name: '許小姐', phone: '0911000008', assignedTableId: '103' })
  await seed(page, {
    tables: [T('102', 4, '1F', 100, 100), T('103', 4, '1F', 260, 100, { status: 'reserved', currentBookingId: HELD.id })],
    bookings: [PRE, HELD],
  })
  await loginToOps(page)
  const out = {}
  for (const [b, n, expectTable] of [[PRE, '102', 'vacant'], [HELD, '103', 'reserved']]) {
    let steps = 0
    await strip(page).getByRole('button', { name: `${b.name} 到了，入座 ${n}` }).click()
    await expect(page.getByText(`${b.name} 已入座 ${n}`)).toBeVisible()
    await shot(page, `B7-1-${b.id}-toast`)
    await page.getByRole('button', { name: '復原', exact: true }).click(); steps++
    await expect(page.getByText(new RegExp(`已復原：${b.name}`))).toBeVisible()
    const { bookings, tables } = await readState(page)
    const bb = bookings.find(x => x.id === b.id), tt = tables.find(t => t.number === n)
    out[b.id] = { steps, booking: { status: bb.status, assignedTableId: bb.assignedTableId, actualArrivalTime: bb.actualArrivalTime ?? null }, table: { status: tt.status, currentBookingId: tt.currentBookingId } }
    expect(bb).toMatchObject({ status: 'confirmed', assignedTableId: n })
    expect(tt.status).toBe(expectTable)
    await page.waitForTimeout(5500) // 讓第一個 toast 退場
  }
  record('B7', out)
})
