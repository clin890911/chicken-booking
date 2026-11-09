import { test, expect } from '@playwright/test'
import { openGroupRow } from './helpers/opsToday'

// night-50 批 4：團體／旅行社 F1–F8 實走（QA，不改 src）。
// 本機模擬登入（localStorage 當後端）；所有非 localhost 請求一律攔截（不用 '**/admin*'，免得連 /admin 頁面一起攔）。
test.use({ timezoneId: 'Asia/Taipei' })

const SHOTS = '/private/tmp/claude-501/-Users-chingchunlin--claude-spares-spare-WtJFow/2abbcc7f-2edc-4b13-af84-1f34c069374e/scratchpad/shots-b4'
const TODAY = '2026-11-10'          // 週二
const NEXT_WED = '2026-11-18'       // 下週三
const at = (d, hhmm) => new Date(`${d}T${hhmm}:00+08:00`)

let steps = 0
const step = () => { steps += 1 }

const mkTables = (specs) => specs.map((s, i) => {
  const [number, over = {}] = Array.isArray(s) ? s : [s, {}]
  return { number, capacity: 6, floor: '1F', x: 100 + (i % 6) * 120, y: 300 + Math.floor(i / 6) * 120, w: 80, h: 75, rotation: 0, zoneId: null,
    isActive: true, outage: null, status: 'vacant', currentBookingId: null, currentRef: null, seatedAt: null, ...over }
})
const mkGroup = (over = {}) => ({
  id: 'G-B4', schemaVersion: 2, date: TODAY, agencyName: '夜走旅行社', guideName: '林導', guidePhone: '0911000111',
  counts: { total: 12, vegetarian: 0, child: 0, mobility: 0, wheelchair: 0 }, allergyText: '', status: 'confirmed',
  batches: [{ id: 'B-B4-1', label: '第一梯', timeSlot: '11:30', tableNumbers: ['101', '102'], guests: 12, note: '' }],
  createdAt: at(TODAY, '08:00').toISOString(), updatedAt: at(TODAY, '08:00').toISOString(), ...over,
})

async function seed(page, { tables = null, bookings = [], groups = [] } = {}) {
  await page.addInitScript(({ tables, bookings, groups }) => {
    if (sessionStorage.getItem('e2e-seeded')) return
    sessionStorage.setItem('e2e-seeded', '1')
    if (tables) localStorage.setItem('chicken_tables_v3', JSON.stringify(tables))
    else localStorage.removeItem('chicken_tables_v3')
    localStorage.setItem('chicken_bookings_v1', JSON.stringify(bookings))
    localStorage.setItem('chicken_group_reservations_v1', JSON.stringify(groups))
    localStorage.setItem('chicken_group_blank_purge_v1', '1')
    localStorage.removeItem('chicken_waitlist_v1')
  }, { tables, bookings, groups })
}
const readState = (page) => page.evaluate(() => ({
  bookings: JSON.parse(localStorage.getItem('chicken_bookings_v1') || '[]'),
  tables: JSON.parse(localStorage.getItem('chicken_tables_v3') || '[]'),
  groups: JSON.parse(localStorage.getItem('chicken_group_reservations_v1') || '[]'),
}))
const tableOf = (s, n) => s.tables.find(t => String(t.number) === String(n))
const mapTable = (page, n) => page.getByRole('button', { name: new RegExp(`^${n}桌`) })
const planTable = (page, n) => page.locator(`svg g:has(:text-is("${n}"))`).first()

async function login(page, tab) {
  await page.goto('/login')
  await page.getByPlaceholder('your@email.com').fill('berrylin0911@gmail.com')
  await page.getByRole('button', { name: /模擬登入/ }).click()
  await expect(page).toHaveURL(/\/admin/)
  steps = 0
  step(); await page.locator('aside').getByRole('button', { name: tab }).click()
}

test.beforeEach(async ({ page }) => {
  await page.route(url => url.hostname !== 'localhost' && url.hostname !== '127.0.0.1', route => {
    const u = route.request().url()
    const body = u.includes('adminPullData') ? { ok: false, error: 'e2e-offline' }
      : (u.includes('adminPushData') || u.includes('groupReserveTables')) ? { ok: true } : { ok: false }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  })
  await page.clock.setFixedTime(at(TODAY, '09:00'))
  page.on('dialog', d => d.accept())
})

async function newGroup(page, agency) {
  step(); await page.getByRole('button', { name: /新增團單/ }).first().click()
  await expect(page.getByRole('heading', { name: '場次與梯次' })).toBeVisible()
  step(); await page.locator('#group-editor-date').fill(NEXT_WED)
  step(); await page.getByPlaceholder('輸入名稱或電話，或直接點下面的常客').fill(agency)
  step(); await page.getByRole('button', { name: new RegExp(`新增旅行社「${agency}」`) }).click()
  await expect(page.getByText('已新增旅行社')).toBeVisible()
}

test('F1 旅行社電話訂下週三 40 人一梯：一頁完成、席位不足只警告', async ({ page }) => {
  await seed(page)
  await login(page, '規劃')
  await newGroup(page, 'F1旅行社')
  step(); await page.getByLabel('總人數', { exact: true }).fill('40')
  // 先只圈 2 張六人桌（12 席）→ 應只黃字、可存
  step(); await planTable(page, '101').click()
  step(); await planTable(page, '102').click()
  await page.screenshot({ path: `${SHOTS}/F1-short-warning.png`, fullPage: true })
  const save = page.getByRole('button', { name: /儲存並保留/ }).first()
  // F1 修法：差距超過一桌容量 → 「還差 N 席，請再圈桌或拆梯」，不再叫人擠一擠；仍可存
  await expect(page.getByText(/還差 \d+ 席，請再圈桌或拆梯/).first()).toBeVisible()
  const shortWarn = await page.getByText(/還差 \d+ 席/).first().textContent().catch(() => null)
  console.log('F1 席位不足文案:', shortWarn, 'save enabled:', await save.isEnabled())
  expect(await save.isEnabled()).toBe(true)
  // 改用一鍵推薦補滿
  step(); await page.getByRole('button', { name: /一鍵推薦桌位/ }).click()
  const hero = page.getByLabel(/^本梯已圈 \d+ 席、\d+ 桌$/)
  console.log('F1 推薦後:', await hero.getAttribute('aria-label'))
  await page.screenshot({ path: `${SHOTS}/F1-after-suggest.png`, fullPage: true })
  step(); await save.click()
  await expect(page.getByText(/團單已儲存/)).toBeVisible()
  const s = await readState(page)
  expect(s.groups).toHaveLength(1)
  expect(s.groups[0].date).toBe(NEXT_WED)
  expect(s.groups[0].counts.total).toBe(40)
  console.log('F1 steps', steps, 'batches', JSON.stringify(s.groups[0].batches.map(b => [b.label, b.timeSlot, b.guests, b.tableNumbers.length])))
})

test('F2 40 人拆兩梯（11:30／12:30）：每梯人數與圈桌', async ({ page }) => {
  await seed(page)
  await login(page, '規劃')
  await newGroup(page, 'F2旅行社')
  step(); await page.getByLabel('總人數', { exact: true }).fill('40')
  step(); await page.getByRole('button', { name: /拆第二梯（兩段用餐輪替）/ }).click()
  step(); await page.getByRole('button', { name: /^午餐第二批 12:30（/ }).click()
  const g1 = page.getByLabel('第一梯人數', { exact: true })
  const g2 = page.getByLabel('第二梯人數', { exact: true })
  const v1 = await g1.inputValue().catch(() => 'n/a'); const v2 = await g2.inputValue().catch(() => 'n/a')
  console.log('F2 拆梯後預設人數 第一梯=', v1, '第二梯=', v2)
  // F2 修法：單梯拆兩梯 → 對半分
  expect([v1, v2]).toEqual(['20', '20'])
  await page.screenshot({ path: `${SHOTS}/F2-split-default.png`, fullPage: true })
  // 店員分配 20/20
  step(); await g1.fill('20')
  step(); await g2.fill('20')
  // 第二梯是 active（新增後自動切過去）→ 圈 104..；先圈第二梯
  for (const n of ['103', '108', '110', '201']) { step(); await planTable(page, n).click().catch(() => {}) }
  // 切回第一梯圈桌
  step(); await page.getByRole('button', { name: '圈此梯桌' }).first().click()
  for (const n of ['101', '102', '105', '106']) { step(); await planTable(page, n).click().catch(() => {}) }
  await page.screenshot({ path: `${SHOTS}/F2-circled.png`, fullPage: true })
  const save = page.getByRole('button', { name: /儲存並保留/ }).first()
  if (await save.isEnabled()) {
    step(); await save.click()
    await expect(page.getByText(/團單已儲存/)).toBeVisible()
  }
  const s = await readState(page)
  console.log('F2 steps', steps, 'stored', JSON.stringify(s.groups.map(g => g.batches.map(b => [b.label, b.timeSlot, b.guests, b.tableNumbers]))))
  expect(s.groups).toHaveLength(1)
  expect(s.groups[0].batches.filter(b => !b.isEscort)).toHaveLength(2)
})

test('F3 團體到店整梯入座：一下整梯、桌況圖變用餐中', async ({ page }) => {
  await page.clock.setFixedTime(at(TODAY, '11:25'))
  await seed(page, { tables: mkTables(['101', '102', '103', '105']), groups: [mkGroup()] })
  await login(page, '現場')
  step() // 今日籤
  step() // 展開團體列（openGroupRow 內含 fill 搜尋，店員實際不需要搜尋，故只算 2 步）
  const row = await openGroupRow(page, '夜走旅行社')
  await page.screenshot({ path: `${SHOTS}/F3-row.png`, fullPage: true })
  step(); await row.getByRole('button', { name: /梯次入座/ }).click()
  await expect(page.getByText(/整梯 2 桌：101、102/)).toBeVisible()
  step(); await page.getByRole('button', { name: '確認入座', exact: true }).click()
  await expect(page.getByText(/第一梯 已入座/)).toBeVisible()
  const s = await readState(page)
  expect(tableOf(s, '101').status).toBe('dining')
  expect(tableOf(s, '102').status).toBe('dining')
  await page.screenshot({ path: `${SHOTS}/F3-seated.png`, fullPage: true })
  console.log('F3 steps', steps, 'group status', s.groups[0].status)
})

const REF = { type: 'group', groupId: 'G-B4', batchId: 'B-B4-1' }
const dining = () => ({ status: 'dining', currentBookingId: null, currentRef: REF, seatedAt: at(TODAY, '11:30').toISOString() })

test('F4 團體這桌先走：單桌釋出、不結團', async ({ page }) => {
  await page.clock.setFixedTime(at(TODAY, '12:20'))
  await seed(page, { tables: mkTables([['101', dining()], ['102', dining()], ['103', dining()], '105']),
    groups: [mkGroup({ status: 'arrived', batches: [{ id: 'B-B4-1', label: '第一梯', timeSlot: '11:30', tableNumbers: ['101', '102', '103'], guests: 18, note: '' }] })] })
  await login(page, '現場')
  step(); await mapTable(page, '102').click()
  await page.screenshot({ path: `${SHOTS}/F4-drawer.png`, fullPage: true })
  step(); await page.getByRole('button', { name: /這桌離席/ }).click()
  const confirmBtn = page.getByRole('button', { name: /^確認/ })
  if (await confirmBtn.first().isVisible().catch(() => false)) { step(); await confirmBtn.first().click() }
  await expect.poll(async () => tableOf(await readState(page), '102').status).toBe('cleaning')
  const s = await readState(page)
  expect(tableOf(s, '101').status).toBe('dining')
  expect(tableOf(s, '103').status).toBe('dining')
  expect(s.groups[0].status).not.toBe('completed')
  const undo = await page.getByRole('button', { name: /復原/ }).count()
  console.log('F4 steps', steps, 'group status', s.groups[0].status, 'undo buttons', undo)
})

test('F5 團體臨時加 4 人要加桌：現場加桌、不回規劃頁', async ({ page }) => {
  await page.clock.setFixedTime(at(TODAY, '12:20'))
  await seed(page, { tables: mkTables([['101', dining()], ['102', dining()], '105']),
    groups: [mkGroup({ status: 'arrived' })] })
  await login(page, '現場')
  step(); await mapTable(page, '101').click()
  step(); await page.getByRole('button', { name: /加桌/ }).click()
  step(); await mapTable(page, '105').click()
  await page.screenshot({ path: `${SHOTS}/F5-addtable.png`, fullPage: true })
  step(); await page.getByRole('button', { name: /確認加桌/ }).click()
  await expect.poll(async () => tableOf(await readState(page), '105').status).toBe('dining')
  const s = await readState(page)
  expect(s.groups[0].batches[0].tableNumbers.map(String)).toEqual(expect.arrayContaining(['101', '102', '105']))
  expect(page.url()).not.toMatch(/tab=planning/)
  console.log('F5 steps', steps, 'guests after add', s.groups[0].batches[0].guests, 'counts.total', s.groups[0].counts.total)
})

test('F6 團體改期：原日釋出、新日重圈桌', async ({ page }) => {
  await seed(page, { groups: [mkGroup({ id: 'G-B4-RS', agencyName: '改期旅行社', counts: { total: 6, vegetarian: 0, child: 0, mobility: 0, wheelchair: 0 },
    batches: [{ id: 'B-RS', label: '第一梯', timeSlot: '11:30', tableNumbers: ['101'], guests: 6, note: '' }] })] })
  await login(page, '規劃')
  step(); await page.getByRole('button', { name: /改期旅行社/ }).filter({ hasNotText: '看地圖' }).first().click()
  step(); await page.getByRole('button', { name: /改期/ }).click()
  step(); await page.getByRole('button', { name: NEXT_WED, exact: true }).click()
  step(); await page.getByRole('button', { name: /下一步：重新圈桌/ }).click()
  await expect(page.getByText(/改期中：/)).toBeVisible()
  await page.screenshot({ path: `${SHOTS}/F6-reschedule-editor.png`, fullPage: true })
  step(); await planTable(page, '101').click()
  step(); await page.getByRole('button', { name: /儲存並保留/ }).first().click()
  await expect(page.getByText(/團單已儲存/)).toBeVisible()
  const s = await readState(page)
  expect(s.groups).toHaveLength(1)
  expect(s.groups[0].date).toBe(NEXT_WED)
  expect(s.groups[0].batches[0].tableNumbers).toEqual(['101'])
  // 回當日總覽（今天）→ 原日不應再有這團
  step(); await page.getByRole('button', { name: /返回當日總覽/ }).click()
  const left = await page.getByRole('button', { name: /改期旅行社/ }).count()
  await page.screenshot({ path: `${SHOTS}/F6-after.png`, fullPage: true })
  console.log('F6 steps', steps, 'today still shows group buttons:', left, 'selected date after back?')
})

test('F7+F8 司領桌不計人數＋遊覽車三格合成、CSV 匯得出', async ({ page }) => {
  await seed(page)
  await login(page, '規劃')
  await newGroup(page, 'F7旅行社')
  step(); await page.getByLabel('總人數', { exact: true }).fill('20')
  for (const n of ['101', '102', '103', '108']) { step(); await planTable(page, n).click() }
  step(); await page.getByRole('button', { name: /^司領桌/ }).first().click()
  step(); await planTable(page, '110').click()
  await page.screenshot({ path: `${SHOTS}/F7-escort.png`, fullPage: true })
  // F8 遊覽車資訊（Disclosure 預設收合）
  step(); await page.getByText('遊覽車資訊').click()
  step(); await page.getByLabel('車號').fill('KAA-1234')
  step(); await page.getByLabel('司機電話').fill('0912345678')
  step(); await page.getByLabel('預計抵達').fill('11:15')
  await page.screenshot({ path: `${SHOTS}/F8-bus.png`, fullPage: true })
  step(); await page.getByRole('button', { name: /儲存並保留/ }).first().click()
  await expect(page.getByText(/團單已儲存/)).toBeVisible()
  const s = await readState(page)
  const g = s.groups[0]
  const esc = g.batches.find(b => b.isEscort)
  expect(g.counts.total).toBe(20)
  expect(esc?.tableNumbers).toEqual(['110'])
  console.log('F7 escort', JSON.stringify(esc), 'F8 busInfo', JSON.stringify(g.busInfo), 'steps', steps)
  expect(g.busInfo).toContain('KAA-1234')
  expect(g.busInfo).toContain('0912345678')
  expect(g.busInfo).toContain('11:15')
  // 詳情頁顯示
  const detail = await page.getByText(g.busInfo).count()
  // CSV：用 vite dev server 動態載入匯出模組（與設定頁匯出同一支函式）
  const csv = await page.evaluate(async (groups) => {
    const m = await import('/src/utils/exportData.js')
    return m.buildGroupsCSV(groups, JSON.parse(localStorage.getItem('chicken_settings_v1') || '{}'))
  }, s.groups)
  console.log('F8 detail shows busInfo:', detail, 'CSV:', csv.split('\n').slice(0, 3).join(' || '))
  expect(csv).toContain('KAA-1234')
  // 人數口徑：詳情頁總人數
  const txt = await page.locator('main').innerText()
  console.log('F7 detail has 22人?', /22\s*人/.test(txt), 'has 20人?', /20\s*人/.test(txt))
})
