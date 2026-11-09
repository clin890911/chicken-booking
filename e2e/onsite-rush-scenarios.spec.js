import { test, expect } from '@playwright/test'
import { todayTab, openGroupRow } from './helpers/opsToday'

// 前台（現場頁）尖峰 15 情境實測。
//   S1–S7  團體「單桌離席／單桌清桌／復原／換桌／加桌」——寫成「修改後應有的行為」（UI 合約），修改前預期失敗。
//   S8–S15 現有功能（團體改派、團保防呆、帶位復原、併桌、預配被佔、換桌、改人數、過時未到）——修改前預期通過。
// 時間用 page.clock 固定、時區固定 Asia/Taipei；後台本機模式以 localStorage 為後端，攔截 admin* 雲端端點。
// 每個 test 自己灌資料、互不依賴。

test.use({ timezoneId: 'Asia/Taipei' })

const TODAY = '2026-09-19'
const at = (hhmm) => new Date(`${TODAY}T${hhmm}:00+08:00`)
const NOW = '12:20'
const SEATED_AT = () => at('11:50').toISOString() // 固定時間前 30 分（遠小於 5 小時自動清檯門檻）

// 桌子排成一列，number 依序往右；自帶座標避免重疊
const mkTables = (specs) => specs.map((s, i) => {
  const [number, over = {}] = Array.isArray(s) ? s : [s, {}]
  return {
    number, capacity: 4, floor: '1F', x: 100 + i * 120, y: 400, w: 80, h: 75, rotation: 0, zoneId: null,
    isActive: true, outage: null, status: 'vacant', currentBookingId: null, currentRef: null, seatedAt: null, ...over,
  }
})

const GID = 'G-RUSH'
const BID = 'B-RUSH1'
const REF = { type: 'group', groupId: GID, batchId: BID }
const groupDining = () => ({ status: 'dining', currentBookingId: null, currentRef: REF, seatedAt: SEATED_AT() })
const groupCleaning = () => ({ status: 'cleaning', currentBookingId: null, currentRef: REF, seatedAt: null })

const mkGroup = (tableNumbers, over = {}) => ({
  id: GID, schemaVersion: 2, date: TODAY, agencyName: '尖峰旅行社', guideName: '林導', guidePhone: '0911000111',
  counts: { total: 12, vegetarian: 0, child: 0, mobility: 0, wheelchair: 0 }, allergyText: '',
  status: 'arrived',
  batches: [{ id: BID, label: '第一梯', timeSlot: '11:30', tableNumbers, guests: 12, note: '' }],
  createdAt: at('08:00').toISOString(), updatedAt: at('08:00').toISOString(), ...over,
})

async function seed(page, { tables, bookings = [], groups = [] }) {
  await page.addInitScript(({ tables, bookings, groups }) => {
    if (sessionStorage.getItem('e2e-seeded')) return // reload 後保留 app 自己寫的狀態
    sessionStorage.setItem('e2e-seeded', '1')
    if (tables) localStorage.setItem('chicken_tables_v3', JSON.stringify(tables))
    else localStorage.removeItem('chicken_tables_v3')
    localStorage.setItem('chicken_bookings_v1', JSON.stringify(bookings))
    localStorage.setItem('chicken_group_reservations_v1', JSON.stringify(groups))
    localStorage.setItem('chicken_group_blank_purge_v1', '1')
    localStorage.removeItem('chicken_waitlist_v1')
  }, { tables, bookings, groups })
}

async function loginToOps(page) {
  await page.goto('/login')
  await page.getByPlaceholder('your@email.com').fill('berrylin0911@gmail.com')
  await page.getByRole('button', { name: /模擬登入/ }).click()
  await expect(page).toHaveURL(/\/admin/)
  await page.locator('aside').getByRole('button', { name: '現場' }).click()
}

const readState = (page) => page.evaluate(() => ({
  bookings: JSON.parse(localStorage.getItem('chicken_bookings_v1') || '[]'),
  tables: JSON.parse(localStorage.getItem('chicken_tables_v3') || '[]'),
  groups: JSON.parse(localStorage.getItem('chicken_group_reservations_v1') || '[]'),
}))
const tableOf = (state, n) => state.tables.find(t => t.number === n)
const mapTable = (page, n) => page.getByRole('button', { name: new RegExp(`^${n}桌`) })

// 若 UI 有二次確認（自訂 confirm modal）就按掉；沒有就不等
async function confirmIfAny(page, label) {
  const btn = page.getByRole('button', { name: label, exact: true })
  try { await btn.waitFor({ state: 'visible', timeout: 1500 }); await btn.click() } catch { /* 無確認框 */ }
}

test.beforeEach(async ({ page }) => {
  await page.route('https://**/*', route => route.abort())
  await page.route('**/adminPullData', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'e2e-offline' }) }))
  await page.route('**/adminPushData', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }))
  await page.route('**/admin*', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false }) }))
  await page.clock.setFixedTime(at(NOW))
  page.on('dialog', d => d.accept())
})

// ───────────────────────── S1–S7：團體（UI 合約，修改前預期失敗）─────────────────────────

test('S1 團體 3 桌用餐中 → 點 102「這桌離席」→ 只有 102 待清，101/103 照常計時', async ({ page }) => {
  const tables = mkTables([['101', groupDining()], ['102', groupDining()], ['103', groupDining()], '105'])
  const seated = tables[0].seatedAt
  await seed(page, { tables, groups: [mkGroup(['101', '102', '103'])] })
  await loginToOps(page)

  await mapTable(page, '102').click()
  await page.getByRole('button', { name: /這桌離席/ }).click()

  await expect.poll(async () => tableOf(await readState(page), '102').status).toBe('cleaning')
  const s = await readState(page)
  expect(tableOf(s, '101')).toMatchObject({ status: 'dining', seatedAt: seated })
  expect(tableOf(s, '103')).toMatchObject({ status: 'dining', seatedAt: seated })
})

test('S2 團體 102 已待清、101/103 用餐中 → 單桌清桌 → 102 空桌（不變回團保），可當散客桌', async ({ page }) => {
  const tables = mkTables([['101', groupDining()], ['102', groupCleaning()], ['103', groupDining()], '105'])
  await seed(page, { tables, groups: [mkGroup(['101', '102', '103'])] })
  await loginToOps(page)

  await mapTable(page, '102').click()
  await page.getByRole('button', { name: /^清桌完成$|只清此桌|只清桌/ }).first().click()
  await confirmIfAny(page, '確認')

  await expect.poll(async () => tableOf(await readState(page), '102').status).toBe('vacant')
  expect(tableOf(await readState(page), '102').currentRef).toBeNull()

  // 再點 102：點空桌＝選進帶位面板。不可變回團保（無預留警示、滑桿不鎖），且要有散客可入座的介面
  await mapTable(page, '102').click()
  await expect(page.getByRole('button', { name: '移除桌 102' })).toBeVisible()
  await expect(page.getByText(/為今日團體.*預留/)).toHaveCount(0)
  await expect(page.getByRole('button', { name: /入座[（(]整梯|梯次入座/ })).toHaveCount(0)
  await expect(page.getByTestId('walkin-seat')).toBeEnabled()
})

test('S2b 團體整梯離席後（3 桌全待清）只清 102 → 102 不可被畫回團保／梯次入座', async ({ page }) => {
  // 補 S2 的盲點：S2 種的是「其他桌還在用餐」，梯次仍算已入座所以不會變團保；
  // 這裡是真實基準線路徑（整梯離席後逐桌清）——最後 1 梯沒有任何 dining 桌，團保推導會復活。
  const tables = mkTables([['101', groupCleaning()], ['102', groupCleaning()], ['103', groupCleaning()], '105'])
  await seed(page, { tables, groups: [mkGroup(['101', '102', '103'])] })
  await loginToOps(page)

  await mapTable(page, '102').click()
  await page.getByRole('button', { name: /^清桌完成$|只清此桌|只清桌/ }).first().click()
  await confirmIfAny(page, '確認')
  await expect.poll(async () => tableOf(await readState(page), '102').status).toBe('vacant')

  await mapTable(page, '102').click()
  await expect.soft(page.getByRole('button', { name: '移除桌 102' })).toBeVisible()
  await expect.soft(page.getByText(/為今日團體.*預留/), '102 不可變回團保').toHaveCount(0)
  await expect.soft(page.getByTestId('walkin-seat'), '散客可直接帶位').toBeEnabled()
})

test('S3 單梯團 2 桌都待清 → 逐桌單桌清桌 → 兩桌空桌、梯 releasedAt、團 completed、梯次入座不復活', async ({ page }) => {
  const tables = mkTables([['101', groupCleaning()], ['102', groupCleaning()], '105'])
  await seed(page, { tables, groups: [mkGroup(['101', '102'])] })
  await loginToOps(page)

  for (const n of ['101', '102']) {
    await mapTable(page, n).click()
    await page.getByRole('button', { name: /^清桌完成$|只清此桌|只清桌/ }).first().click()
    await confirmIfAny(page, '確認')
    await expect.poll(async () => tableOf(await readState(page), n).status).toBe('vacant')
  }

  const s = await readState(page)
  expect.soft(tableOf(s, '101').currentRef).toBeNull()
  expect.soft(tableOf(s, '102').currentRef).toBeNull()
  const g = s.groups.find(x => x.id === GID)
  expect.soft(g.batches.find(b => b.id === BID).releasedAt, '該梯 releasedAt').toBeTruthy()
  expect.soft(g.status, '單梯團自動整團完成').toBe('completed')

  // 左欄「今日」清單（團體籤已併進來）不可再出現該梯／梯次入座
  await todayTab(page).click()
  await expect.soft(page.locator('[data-group-batch]'), '已消化的梯不列').toHaveCount(0)
  await expect.soft(page.getByRole('button', { name: /梯次入座/ }), '梯次入座不可復活').toHaveCount(0)
})

test('S4 團體待清桌單桌清桌 → 出現「復原」→ 桌回待清並指回原團梯', async ({ page }) => {
  const tables = mkTables([['101', groupCleaning()], ['102', groupDining()], '105'])
  await seed(page, { tables, groups: [mkGroup(['101', '102'])] })
  await loginToOps(page)

  await mapTable(page, '101').click()
  await page.getByRole('button', { name: /^清桌完成$|只清此桌|只清桌/ }).first().click()
  await confirmIfAny(page, '確認')
  await expect.poll(async () => tableOf(await readState(page), '101').status).toBe('vacant')

  await page.getByRole('button', { name: /復原/ }).click()
  await expect.poll(async () => tableOf(await readState(page), '101').status).toBe('cleaning')
  expect(tableOf(await readState(page), '101').currentRef).toMatchObject({ groupId: GID, batchId: BID })
})

test('S5 團體 2 桌用餐中 → 整梯離席 → 復原 → 兩桌回用餐中、seatedAt 不變', async ({ page }) => {
  const tables = mkTables([['101', groupDining()], ['102', groupDining()], '105'])
  const seated = tables[0].seatedAt
  await seed(page, { tables, groups: [mkGroup(['101', '102'])] })
  await loginToOps(page)

  await mapTable(page, '101').click()
  await page.getByRole('button', { name: /整梯離席/ }).click()
  await confirmIfAny(page, '確認離席')
  await expect.poll(async () => tableOf(await readState(page), '101').status).toBe('cleaning')
  expect(tableOf(await readState(page), '102').status).toBe('cleaning')

  await page.getByRole('button', { name: /復原/ }).click()
  await expect.poll(async () => tableOf(await readState(page), '101').status).toBe('dining')
  const s = await readState(page)
  for (const n of ['101', '102']) {
    expect(tableOf(s, n)).toMatchObject({ status: 'dining', seatedAt: seated })
    expect(tableOf(s, n).currentRef).toMatchObject({ groupId: GID, batchId: BID })
  }
})

test('S6 團體已入座 → 點 102「換桌」→ 點空桌 105 →「確認換桌」→ 105 用餐中、102 空桌、團單桌號更新', async ({ page }) => {
  const tables = mkTables([['101', groupDining()], ['102', groupDining()], '105'])
  await seed(page, { tables, groups: [mkGroup(['101', '102'])] })
  await loginToOps(page)

  await mapTable(page, '102').click()
  await page.getByRole('button', { name: /換桌/ }).click()
  await mapTable(page, '105').click()
  await page.getByRole('button', { name: /確認換桌/ }).click()

  await expect.poll(async () => tableOf(await readState(page), '105').status).toBe('dining')
  const s = await readState(page)
  expect(tableOf(s, '105').currentRef).toMatchObject({ groupId: GID, batchId: BID })
  expect(tableOf(s, '102')).toMatchObject({ status: 'vacant', currentRef: null })
  const nums = s.groups.find(x => x.id === GID).batches[0].tableNumbers.map(String)
  expect(nums).toContain('105')
  expect(nums).not.toContain('102')
})

test('S7 團體已入座 → 點 101「加桌」→ 點空桌 105 →「確認加桌」→ 105 直接算該梯用餐中', async ({ page }) => {
  const tables = mkTables([['101', groupDining()], ['102', groupDining()], '105'])
  await seed(page, { tables, groups: [mkGroup(['101', '102'])] })
  await loginToOps(page)

  await mapTable(page, '101').click()
  await page.getByRole('button', { name: /加桌/ }).click()
  await mapTable(page, '105').click()
  await page.getByRole('button', { name: /確認加桌/ }).click()

  await expect.poll(async () => tableOf(await readState(page), '105').status).toBe('dining')
  const s = await readState(page)
  expect(tableOf(s, '105').currentRef).toMatchObject({ groupId: GID, batchId: BID })
  const nums = s.groups.find(x => x.id === GID).batches[0].tableNumbers.map(String)
  expect(nums).toEqual(expect.arrayContaining(['101', '102', '105']))
})

// ───────────────────────── S8–S15：現有功能（預期通過）─────────────────────────

test('S8 團體圈 101/102、101 被散客佔走 → 梯次入座被擋 → 改派 105 → 整梯入座', async ({ page }) => {
  const tables = mkTables(['101', '102', '105'])
  await seed(page, { tables, groups: [mkGroup(['101', '102'], { status: 'confirmed' })] })
  await loginToOps(page)

  // 散客先佔走 101（從「今日」清單的團體梯次列展開 → 桌號鈕開抽屜 → 覆蓋團體預留 → 入座）
  await openGroupRow(page, '尖峰旅行社')
  await page.getByRole('button', { name: '101', exact: true }).click()
  await page.getByRole('button', { name: /散客入座（覆蓋團體預留）/ }).click()
  await page.getByRole('button', { name: '改散客入座', exact: true }).click()
  await page.getByRole('button', { name: '確認入座', exact: true }).click()
  await expect(page.getByText(/已入座 101/)).toBeVisible()

  // 團體梯次入座 → 101 被佔 → 自動進改派模式
  await page.keyboard.press('Escape') // 關掉 101 抽屜回左欄
  await openGroupRow(page, '尖峰旅行社')
  await page.getByRole('button', { name: /梯次入座/ }).first().click()
  await page.getByRole('button', { name: '確認入座', exact: true }).click()
  await expect(page.getByText(/101（用餐中）被佔用/)).toBeVisible()
  await expect(page.getByText(/改派桌位：尖峰旅行社/)).toBeVisible()

  // 點空桌 105 → 二步確認 → 整梯入座
  await mapTable(page, '105').click()
  await expect(page.getByText(/把 101 改派為 105 並整梯入座/)).toBeVisible()
  await page.getByRole('button', { name: /確認改派/ }).click()
  await expect(page.getByText(/已改派 101 → 105/)).toBeVisible()

  const s = await readState(page)
  expect(tableOf(s, '105')).toMatchObject({ status: 'dining' })
  expect(tableOf(s, '105').currentRef).toMatchObject({ groupId: GID })
  expect(tableOf(s, '102')).toMatchObject({ status: 'dining' })
  expect(tableOf(s, '102').currentRef).toMatchObject({ groupId: GID })
})

test('S9 散客帶位到團體預留桌 105 → 團保防呆，未勾「仍要帶」不能入座', async ({ page }) => {
  const tables = mkTables(['105', '106'])
  await seed(page, { tables, groups: [mkGroup(['105'], { status: 'confirmed' })] })
  await loginToOps(page)

  await mapTable(page, '105').click()
  await expect(page.getByRole('button', { name: '移除桌 105' })).toBeVisible()
  await expect(page.getByText(/105 為今日團體 尖峰旅行社 預留/)).toBeVisible()
  const seat = page.getByTestId('walkin-seat')
  await expect(seat).toBeDisabled()
  expect(tableOf(await readState(page), '105').status).toBe('vacant')

  await page.getByRole('checkbox', { name: /仍要帶這桌/ }).check()
  await expect(seat).toBeEnabled()
  await seat.click()
  await expect(page.getByText(/入座 105\s*·\s*可帶下一組/)).toBeVisible()
  expect(tableOf(await readState(page), '105').status).toBe('dining')
})

test('S10 散客 4 人帶位入座 → 8 秒內復原 → 桌回空桌', async ({ page }) => {
  await seed(page, { tables: mkTables(['105', '106']) })
  await loginToOps(page)

  await page.getByRole('button', { name: '4 位', exact: true }).click()
  await mapTable(page, '105').click()
  await expect(page.getByRole('button', { name: '移除桌 105' })).toBeVisible()
  await page.getByTestId('walkin-seat').click()
  await expect(page.getByText(/入座 105\s*·\s*可帶下一組/)).toBeVisible()
  let s = await readState(page)
  expect(tableOf(s, '105').status).toBe('dining')
  expect(s.bookings).toHaveLength(1)

  await page.getByRole('button', { name: '復原帶位 105', exact: true }).click()   // H6：鈕文案帶對象
  await expect(page.getByText(/已復原：105 回到空桌/)).toBeVisible()
  s = await readState(page)
  expect(tableOf(s, '105')).toMatchObject({ status: 'vacant', currentBookingId: null })
})

test('S11 散客 8 人沒有單桌容得下 → 用建議併桌 → 一次入座兩桌指向同一筆訂位', async ({ page }) => {
  const tables = mkTables([
    ['105', { status: 'dining', currentBookingId: 'X', seatedAt: SEATED_AT() }],
    '106', '107',
  ])
  await seed(page, { tables, bookings: [{
    id: 'X', name: '先到客', phone: '', guests: 2, date: TODAY, timeSlot: '11:50', status: 'arrived',
    source: 'walkin', assignedTableId: '105', extraTableIds: [], notes: {}, createdBy: 'staff',
  }] })
  await loginToOps(page)

  await page.getByRole('button', { name: '8 位', exact: true }).click()
  await page.getByTestId('walkin-apply-suggestion').click()
  const seat = page.getByTestId('walkin-seat')
  await expect(seat).toBeEnabled()
  await seat.click()
  await expect(page.getByText(/入座 10[67]\s*\+\s*10[67]/)).toBeVisible()

  const s = await readState(page)
  const b = s.bookings.find(x => x.id !== 'X')
  expect(b.guests).toBe(8)
  expect([b.assignedTableId, ...b.extraTableIds].sort()).toEqual(['106', '107'])
  for (const n of ['106', '107']) expect(tableOf(s, n)).toMatchObject({ status: 'dining', currentBookingId: b.id })
})

test('S12 訂位預配 105、105 被別人佔走 → 報到列標桌被佔、「到了 · 換桌」選空桌即入座', async ({ page }) => {
  const OCC = {
    id: 'E2E-OCC', name: '別組', phone: '', guests: 2, date: TODAY, timeSlot: '11:00', status: 'arrived',
    source: 'walkin', assignedTableId: '105', extraTableIds: [], notes: {}, createdBy: 'staff',
  }
  const YU = {
    id: 'E2E-PRE-YU', name: '余先生', phone: '0911000002', guests: 2, date: TODAY, timeSlot: '12:30',
    status: 'confirmed', source: 'phone', assignedTableId: '105', extraTableIds: [], notes: {}, createdBy: 'staff',
  }
  await seed(page, {
    tables: mkTables([['105', { status: 'dining', currentBookingId: OCC.id, seatedAt: at('11:05').toISOString() }], '106']),
    bookings: [OCC, YU],
  })
  await loginToOps(page)

  const strip = page.getByRole('list', { name: '可入座名單' })
  await expect(strip.getByRole('listitem')).toContainText('預配·桌被佔')
  // night-50 B5：直接進換桌入座（不先撞入座失敗）；確認前什麼都不寫
  await strip.getByRole('button', { name: '余先生 到了，換桌入座' }).click()
  await expect(page.getByText(/到了 · 換桌入座：余先生/)).toBeVisible()
  let s = await readState(page)
  expect(s.bookings.find(b => b.id === YU.id)).toMatchObject({ status: 'confirmed', assignedTableId: '105' })
  expect(tableOf(s, '105').currentBookingId).toBe(OCC.id)

  await mapTable(page, '106').click()
  await page.getByRole('button', { name: '確認入座', exact: true }).click()
  await expect(page.getByText(/已入座 106（原預配 105 被佔）/)).toBeVisible()
  s = await readState(page)
  expect(s.bookings.find(b => b.id === YU.id)).toMatchObject({ status: 'arrived', assignedTableId: '106' })
  expect(tableOf(s, '106')).toMatchObject({ status: 'dining', currentBookingId: YU.id })
  expect(tableOf(s, '105').currentBookingId).toBe(OCC.id)
})

test('S13 散客用餐中在 106 → 抽屜換桌 → 點空桌 105 → 新桌用餐中、原桌釋出', async ({ page }) => {
  const WANG = {
    id: 'E2E-MOVE', name: '王先生', phone: '0911000009', guests: 2, date: TODAY, timeSlot: '11:50', status: 'arrived',
    source: 'walkin', assignedTableId: '106', extraTableIds: [], notes: {}, createdBy: 'staff',
    actualArrivalTime: SEATED_AT(),
  }
  await seed(page, {
    tables: mkTables(['105', ['106', { status: 'dining', currentBookingId: WANG.id, seatedAt: SEATED_AT() }]]),
    bookings: [WANG],
  })
  await loginToOps(page)

  await mapTable(page, '106').click()
  await page.getByRole('button', { name: /換桌/ }).click()
  await mapTable(page, '105').click()
  await page.getByRole('button', { name: /確認換桌|確認/ }).first().click()

  await expect.poll(async () => tableOf(await readState(page), '105').status).toBe('dining')
  const s = await readState(page)
  expect(tableOf(s, '105').currentBookingId).toBe(WANG.id)
  // 「原桌釋出」＝原桌不再被這筆訂位持有。現行產品把它設成「待清」（髒桌要擦），不是直接空桌。
  expect(tableOf(s, '106').currentBookingId).toBeNull()
  expect(['cleaning', 'vacant']).toContain(tableOf(s, '106').status)
  expect(s.bookings.find(b => b.id === WANG.id).assignedTableId).toBe('105')
})

test('S14 散客用餐中 4 人 → 抽屜「改人數」改 6 → guests=6、桌號不變', async ({ page }) => {
  const ZHAO = {
    id: 'E2E-ED-ZHAO', name: '趙先生', phone: '0911000008', guests: 4, date: TODAY, timeSlot: '11:50', status: 'arrived',
    source: 'phone', assignedTableId: '101', extraTableIds: [], notes: {}, createdBy: 'staff',
    actualArrivalTime: SEATED_AT(),
  }
  await seed(page, {
    tables: mkTables([['101', { capacity: 6, status: 'dining', currentBookingId: ZHAO.id, seatedAt: SEATED_AT() }], '106']),
    bookings: [ZHAO],
  })
  await loginToOps(page)

  await mapTable(page, '101').click()
  await page.getByRole('button', { name: '改人數／備註' }).click()
  await page.getByRole('button', { name: '6 位', exact: true }).click()
  await page.getByRole('button', { name: '儲存變更' }).click()

  await expect(page.getByText('已更新 趙先生 的訂位')).toBeVisible()
  const s = await readState(page)
  expect(s.bookings.find(b => b.id === ZHAO.id)).toMatchObject({ guests: 6, status: 'arrived', assignedTableId: '101' })
  expect(tableOf(s, '101')).toMatchObject({ status: 'dining', currentBookingId: ZHAO.id })
})

test('S15 訂位時段早 40 分鐘未報到 → 過時未到找得到 → 客人到了入座', async ({ page }) => {
  const LATE = {
    id: 'E2E-LATE', name: '遲到客', phone: '0900111222', guests: 2, date: TODAY, timeSlot: '11:40', status: 'confirmed',
    source: 'phone', assignedTableId: '105', extraTableIds: [], notes: {}, createdBy: 'staff',
  }
  await seed(page, { tables: mkTables(['105', '106']), bookings: [LATE] })
  await loginToOps(page)

  await todayTab(page).click()
  await expect(page.getByText('過時未到（1 組）— 請聯絡或標記')).toBeVisible()
  await expect(page.getByText('遲到客').first()).toBeVisible()
  await page.getByRole('button', { name: /客人到了/ }).first().click()

  await expect(page.getByText(/遲到客 已入座 105/)).toBeVisible()
  const s = await readState(page)
  expect(s.bookings.find(b => b.id === LATE.id).status).toBe('arrived')
  expect(tableOf(s, '105')).toMatchObject({ status: 'dining', currentBookingId: LATE.id })
  await expect(page.getByText('過時未到（1 組）— 請聯絡或標記')).toHaveCount(0)
})
