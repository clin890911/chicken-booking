import { test, expect } from '@playwright/test'

// 批 3：D1-D8 桌務、E1-E5 候位（E 僅 UI 靜態實走，寫入需 Firebase ID token → 未驗）
test.use({ timezoneId: 'Asia/Taipei', viewport: { width: 1024, height: 1366 } })
const SHOTS = '/private/tmp/claude-501/-Users-chingchunlin--claude-spares-spare-WtJFow/2abbcc7f-2edc-4b13-af84-1f34c069374e/scratchpad/shots-b3'
const shot = (page, name) => page.screenshot({ path: `${SHOTS}/${name}.png` })
const TODAY = '2026-09-19'
const at = (hhmm) => new Date(`${TODAY}T${hhmm}:00+08:00`)
const NOW = new Date(`${TODAY}T12:20:00+08:00`)
let steps = 0
const step = () => { steps++ }

const mkTables = (specs) => specs.map((s, i) => {
  const [number, over = {}] = Array.isArray(s) ? s : [s, {}]
  return { number, capacity: 4, floor: '1F', x: 100 + (i % 6) * 120, y: 200 + Math.floor(i / 6) * 120, w: 80, h: 75, rotation: 0, zoneId: null,
    isActive: true, outage: null, status: 'vacant', currentBookingId: null, currentRef: null, seatedAt: null, ...over }
})
const mkBooking = (id, name, over = {}) => ({ id, name, phone: '0911000001', guests: 3, date: TODAY, timeSlot: '12:00', status: 'confirmed', source: 'phone',
  assignedTableId: null, extraTableIds: [], notes: {}, createdBy: 'staff', ...over })
const dining = (id, mins = 40) => ({ status: 'dining', currentBookingId: id, seatedAt: new Date(NOW.getTime() - mins * 60000).toISOString() })

async function seed(page, { tables, bookings = [], waitlist = null }) {
  await page.addInitScript(({ tables, bookings, waitlist }) => {
    if (sessionStorage.getItem('e2e-seeded')) return
    sessionStorage.setItem('e2e-seeded', '1')
    localStorage.setItem('chicken_tables_v3', JSON.stringify(tables))
    localStorage.setItem('chicken_bookings_v1', JSON.stringify(bookings))
    localStorage.setItem('chicken_group_reservations_v1', '[]')
    localStorage.setItem('chicken_group_blank_purge_v1', '1')
    if (waitlist) localStorage.setItem('chicken_waitlist_v1', JSON.stringify(waitlist)); else localStorage.removeItem('chicken_waitlist_v1')
  }, { tables, bookings, waitlist })
}
async function loginToOps(page) {
  await page.goto('/login')
  await page.getByPlaceholder('your@email.com').fill('berrylin0911@gmail.com')
  await page.getByRole('button', { name: /模擬登入/ }).click()
  await expect(page).toHaveURL(/\/admin/)
  await page.locator('aside').getByRole('button', { name: '現場' }).click()
  await page.waitForTimeout(800)
}
const readState = (page) => page.evaluate(() => ({
  bookings: JSON.parse(localStorage.getItem('chicken_bookings_v1') || '[]'),
  tables: JSON.parse(localStorage.getItem('chicken_tables_v3') || '[]'),
  log: JSON.parse(localStorage.getItem('chicken_ops_log_v1') || '[]'),
}))
const tb = (s, n) => s.tables.find(t => t.number === n)
const mapTable = (page, n) => page.getByRole('button', { name: new RegExp(`^${n}桌`) })
import fs from 'fs'
const note = (k, v) => { test.info().annotations.push({ type: k, description: String(v) }); fs.appendFileSync(SHOTS + '/../b3-notes.txt', test.info().title.split(' ')[0] + ' | ' + k + ' = ' + v + '\n') }

test.beforeEach(async ({ page }) => {
  steps = 0
  await page.route(u => u.hostname !== 'localhost' && u.hostname !== '127.0.0.1', r => r.abort())
  await page.route(u => u.hostname === 'localhost' && /^\/(admin(Pull|Push)Data|adminWaitlistTransition|adminHandoff|staffWhoAmI)/.test(u.pathname), r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'e2e-offline' }) }))
  await page.clock.setFixedTime(NOW)
})

test('D1 換桌（用餐中→另一張空桌）', async ({ page }) => {
  const b = mkBooking('B-D1', '王先生', { status: 'arrived', assignedTableId: '105' })
  await seed(page, { tables: mkTables([['105', dining('B-D1')], '106', '107']), bookings: [b] })
  await loginToOps(page)
  await mapTable(page, 105).click(); step()
  await shot(page, 'D1-1-drawer')
  await page.getByRole('button', { name: /換桌/ }).first().click(); step()
  await mapTable(page, 106).click(); step()
  await shot(page, 'D1-2-pick')
  await page.getByRole('button', { name: /確認改桌/ }).click(); step()
  await page.waitForTimeout(500)
  await shot(page, 'D1-3-done')
  const s = await readState(page)
  note('steps', steps); note('old', tb(s, '105').status); note('new', tb(s, '106').status)
  expect(tb(s, '106').status).toBe('dining')
  expect(tb(s, '105').status).not.toBe('dining')
  // 有無復原鈕
  const undo = await page.getByRole('button', { name: /復原/ }).count()
  note('undoBtnAfterMove', undo)
})

test('D2 離席 → D3 清桌 → 復原', async ({ page }) => {
  const b = mkBooking('B-D2', '李小姐', { status: 'arrived', assignedTableId: '105' })
  await seed(page, { tables: mkTables([['105', dining('B-D2', 60)], '106']), bookings: [b] })
  await loginToOps(page)
  await mapTable(page, 105).click(); step()
  await page.getByRole('button', { name: '客人已離席' }).click(); step()
  await shot(page, 'D2-1-confirm')
  await page.getByRole('button', { name: '已離席', exact: true }).click(); step()
  await page.waitForTimeout(500)
  await shot(page, 'D2-2-toast')
  let s = await readState(page)
  note('D2steps', steps); note('D2table', tb(s, '105').status)
  expect(tb(s, '105').status).toBe('cleaning')
  note('D2undoBtn', await page.getByRole('button', { name: /復原/ }).count())
  // D3：待清桌 → 清桌
  steps = 0
  const drawerOpen = await page.getByRole('button', { name: '清桌完成' }).count()
  note('D3drawerStillOpen', drawerOpen)
  if (!drawerOpen) { await mapTable(page, 105).click(); step() }
  await shot(page, 'D3-1-drawer')
  await page.getByRole('button', { name: '清桌完成' }).click(); step()
  await page.waitForTimeout(400)
  await shot(page, 'D3-2-vacant')
  s = await readState(page)
  note('D3steps', steps)
  expect(tb(s, '105').status).toBe('vacant')
  // 復原
  await page.getByRole('button', { name: /復原/ }).first().click()
  await page.waitForTimeout(400)
  s = await readState(page)
  note('undoClear→', tb(s, '105').status + ' booking=' + tb(s, '105').currentBookingId)
  expect(tb(s, '105').status).toBe('cleaning')
})

test('D4 清錯桌→復原；桌被下一組佔走後復原要安全失敗', async ({ page }) => {
  const b = mkBooking('B-D4', '陳先生', { status: 'arrived', assignedTableId: '105' })
  await seed(page, { tables: mkTables([['105', { status: 'cleaning', currentBookingId: 'B-D4' }], '106']), bookings: [{ ...b, status: 'completed' }] })
  await loginToOps(page)
  await mapTable(page, 105).click()
  await page.getByRole('button', { name: '清桌完成' }).click()
  await page.waitForTimeout(300)
  // 下一組直接入座同一張桌（散客直接入座）
  await mapTable(page, 105).click()
  await shot(page, 'D4-1-vacant-click')
  const ok = page.getByRole('button', { name: /^確認入座/ })
  note('walkPanelConfirm', await ok.count())
  if (await ok.count()) { await ok.click(); await page.waitForTimeout(600) }
  await shot(page, 'D4-2-after-walkin')
  let s = await readState(page)
  note('105 after walkin', tb(s, '105').status)
  const undo = page.getByRole('button', { name: /^↩ 復原$|復原/ })
  note('undoVisible', await undo.count())
  if (await undo.count()) { await undo.first().click(); await page.waitForTimeout(400) }
  await shot(page, 'D4-3-after-undo')
  s = await readState(page)
  note('105 after undo', tb(s, '105').status + ' bk=' + tb(s, '105').currentBookingId)
  note('toastText', (await page.locator('[role=status],[role=alert]').allInnerTexts()).join(' | ').slice(0, 200))
})

test('D5 五張待清桌', async ({ page }) => {
  const nums = ['101', '102', '103', '104', '105']
  const tables = mkTables([...nums.map(n => [n, { status: 'cleaning', currentBookingId: 'X' + n }]), '106'])
  await seed(page, { tables, bookings: nums.map(n => mkBooking('X' + n, '客' + n, { status: 'completed', assignedTableId: n })) })
  await loginToOps(page)
  await shot(page, 'D5-1-map')
  const batch = await page.getByRole('button', { name: /全部清桌|批次|一次清|全部釋出/ }).count()
  note('batchBtn', batch)
  const hint = page.getByRole('button', { name: /待清/ })
  note('hintBtnCount', await hint.count())
  let clicks = 0
  for (const n of nums) {
    await mapTable(page, Number(n)).click(); clicks++
    await page.getByRole('button', { name: '清桌完成' }).click(); clicks++
    await page.waitForTimeout(200)
  }
  await shot(page, 'D5-2-after')
  const s = await readState(page)
  note('clicks', clicks); note('vacant', s.tables.filter(t => t.status === 'vacant').length)
  expect(s.tables.filter(t => t.status === 'cleaning').length).toBe(0)
})

test('D6 維修停用到今日', async ({ page }) => {
  await seed(page, { tables: mkTables(['105', '106']), bookings: [] })
  await loginToOps(page)
  await mapTable(page, 105).click(); step()
  note('afterVacantClick_drawer?', await page.getByRole('button', { name: '維修停用' }).count())
  await shot(page, 'D6-0-click-vacant')
  await page.getByRole('button', { name: '桌 105 詳情' }).click(); step()
  await shot(page, 'D6-0b-detail')
  await page.getByRole('button', { name: '維修停用' }).click(); step()
  await shot(page, 'D6-1-modal')
  const modal = page.getByRole('dialog')
  await shot(page, 'D6-1b')
  // 確認鈕
  const confirmBtn = page.getByRole('button', { name: /^(確認|儲存|設為維修|維修停用)/ }).last()
  note('confirmLabel', await confirmBtn.innerText())
  await confirmBtn.click(); step()
  await page.waitForTimeout(500)
  await shot(page, 'D6-2-after')
  let s = await readState(page)
  note('D6steps', steps); note('outage', JSON.stringify(tb(s, '105').outage))
  expect(tb(s, '105').outage).toBeTruthy()
  // 再開抽屜：不可入座
  await mapTable(page, 105).click()
  await shot(page, 'D6-3-click-outage')
  note('walkBtnOnOutage', await page.getByRole('button', { name: /確認入座/ }).count())
  note('panelText', (await page.getByText(/維修|不可/).allInnerTexts()).join(' | ').slice(0,200))
  note('mapLabel', await mapTable(page, 105).getAttribute('aria-label'))
  // 隔天自動回
  await page.clock.setFixedTime(new Date('2026-09-20T11:00:00+08:00'))
  await page.reload(); await page.waitForTimeout(1000)
  await page.locator('aside').getByRole('button', { name: '現場' }).click()
  await shot(page, 'D6-4-nextday')
  note('nextDayLabel', await mapTable(page, 105).getAttribute('aria-label'))
})

test('D7 用餐超 5 小時自動清檯', async ({ page }) => {
  const b = mkBooking('B-D7', '周先生', { status: 'arrived', assignedTableId: '105' })
  await seed(page, { tables: mkTables([['105', dining('B-D7', 360)], '106']), bookings: [b] })
  await loginToOps(page)
  await page.waitForTimeout(1500)
  await shot(page, 'D7-1-after-boot')
  const s = await readState(page)
  note('105', tb(s, '105').status); note('booking', s.bookings[0].status); note('logLen', s.log.length)
  note('toasts', (await page.locator('[role=status],[role=alert]').allInnerTexts()).join(' | ').slice(0, 300))
  note('undoBtn', await page.getByRole('button', { name: /復原/ }).count())
  // 紀錄入口
  const logBtn = page.getByRole('button', { name: /自動處理|紀錄|詳見/ })
  note('logEntryCount', await logBtn.count())
  if (await logBtn.count()) { await logBtn.first().click(); await page.waitForTimeout(300); await shot(page, 'D7-2-log'); note('logHasUndo', await page.getByRole('dialog').getByRole('button', { name: /復原/ }).count()) }
})

test('D8 換桌到有預配的桌（黃字可解鎖）', async ({ page }) => {
  const a = mkBooking('B-D8A', '黃先生', { status: 'arrived', assignedTableId: '105' })
  const pre = mkBooking('B-D8P', '預配林', { timeSlot: '12:30', assignedTableId: '106', guests: 2 })
  await seed(page, { tables: mkTables([['105', dining('B-D8A')], '106', '107']), bookings: [a, pre] })
  await loginToOps(page)
  await mapTable(page, 105).click(); step()
  await page.getByRole('button', { name: /換桌/ }).first().click(); step()
  await mapTable(page, 106).click(); step()
  await shot(page, 'D8-1-warning')
  const cb = page.getByRole('checkbox', { name: /知道了/ })
  note('warnCheckbox', await cb.count())
  const confirm = page.getByRole('button', { name: /確認改桌/ })
  note('confirmDisabledBefore', await confirm.isDisabled())
  note('banner', (await page.getByText(/預配|保留/).allInnerTexts()).join(' | ').slice(0, 300))
  if (await cb.count()) { await cb.check(); step() }
  await confirm.click(); step()
  await page.waitForTimeout(500)
  await shot(page, 'D8-2-done')
  const s = await readState(page)
  note('D8steps', steps); note('106', tb(s, '106').status); note('pre.assigned', s.bookings.find(x => x.id === 'B-D8P').assignedTableId)
  expect(tb(s, '106').status).toBe('dining')
})

// ===== 候位：UI 靜態實走（寫入未驗）=====
const mkWait = (i, over = {}) => ({ id: 'W' + i, queueNumber: i, takenAt: new Date(NOW.getTime() - (60 - i * 5) * 60000).toISOString(),
  name: ['王先生', '李小姐', '陳先生', '林太太', '張先生', '黃小姐', '吳先生', '蔡小姐', '劉先生', '歐陽小姐'][i - 1], phone: '09120000' + String(10 + i),
  partySize: [2, 3, 4, 6, 2, 5, 3, 8, 2, 4][i - 1], children: 0, adults: [2, 3, 4, 6, 2, 5, 3, 8, 2, 4][i - 1], lineUserId: null, estimatedMin: 20, status: 'waiting',
  calledAt: null, seatedAt: null, leftAt: null, assignedTableNumber: null, notes: '', ...over })

async function openWaitlist(page, waitlist) {
  await seed(page, { tables: mkTables([['105', dining('Z')], ['106', dining('Z2')]]), bookings: [], waitlist })
  await loginToOps(page)
  await page.getByRole('button', { name: /^候位/ }).first().click()
  await page.waitForTimeout(500)
}

test('E1-E3,E5 候位清單 10 組（靜態）', async ({ page }) => {
  const list = Array.from({ length: 10 }, (_, i) => mkWait(i + 1, i === 1 ? { status: 'called', calledAt: NOW.toISOString() } : i === 2 ? { status: 'skipped' } : {}))
  await openWaitlist(page, list)
  await shot(page, 'E5-1-list10')
  note('取號鈕', await page.getByRole('button', { name: /新增取號/ }).count())
  for (const l of ['叫號', '入座', '暫過號', '棄號', '回來了']) note('btn:' + l, await page.getByRole('button', { name: l, exact: true }).count())
  note('等待文字', (await page.getByText(/已等 \d+ 分/).count()))
  note('歷史', await page.getByRole('button', { name: '歷史' }).count())
  note('轉訂位', await page.getByText(/轉訂位|改訂位/).count())
  // 取號 modal
  await page.getByRole('button', { name: /新增取號/ }).click()
  await shot(page, 'E1-1-modal')
  note('取號modal預估', (await page.getByText(/預估約/).innerText().catch(() => 'n/a')))
  note('取號鈕在modal', await page.getByRole('button', { name: '取號', exact: true }).count())
  // 嘗試取號（預期無 token → 失敗訊息）
  await page.getByRole('button', { name: '取號', exact: true }).click().catch(() => {})
  await page.waitForTimeout(800)
  await shot(page, 'E1-2-after-submit')
  note('取號後toast', (await page.locator('[role=status],[role=alert]').allInnerTexts()).join(' | ').slice(0, 300))
})

test('E2 候位按「入座」進選桌模式（靜態，不寫入）', async ({ page }) => {
  const list = Array.from({ length: 3 }, (_, i) => mkWait(i + 1, i === 0 ? { status: 'called', calledAt: NOW.toISOString() } : {}))
  await seed(page, { tables: mkTables([['105', dining('Z')], '106', '107']), bookings: [], waitlist: list })
  await loginToOps(page)
  await page.getByRole('button', { name: /^候位/ }).first().click(); step()
  await page.getByRole('button', { name: '入座', exact: true }).first().click(); step()
  await page.waitForTimeout(400)
  await shot(page, 'E2-1-seat-mode')
  note('E2banner', (await page.getByText(/候位入座/).allInnerTexts()).join(' | ').slice(0, 200))
  note('E2asksPartySize', await page.getByText(/人數|幾位/).count())
  await mapTable(page, 106).click(); step()
  await shot(page, 'E2-2-picked')
  note('E2confirmBtns', (await page.getByRole('button', { name: /確認|入座/ }).allInnerTexts()).join(' | ').slice(0, 300))
  note('E2steps(to confirm, excl. confirm click)', steps)
})
