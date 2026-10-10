import { test, expect } from '@playwright/test'

// 現場直接改單＋建議桌一鍵套用（2026-10 前台尖峰 A2／A3／A4）：
//   1) 今日訂位卡「⋯ 更多 → 改人數／時段／備註」：4 人變 6 人、同桌坐得下 → 桌位保留（過去 19 下、換 3 次頁）
//   2) 同上但坐不下 → 解除桌位並明講「已解除桌位，請重新指派」
//   3) 已入座：桌抽屜「改人數／備註」補過敏備註，桌不動（過去沒有入口）
//   4) 今日訂位卡可取消（保留確認框）＋復原把訂位與桌一起倒回
//   5) 未配桌訂位的「詳情 ›」開訂位詳情（過去點了沒反應）
//   6) 帶位面板「用建議桌」：一下切到建議桌樓層並選好，按確認才入座
//   7) 到了 · 選桌入座：「用建議桌」選好併桌組合（含切樓層），確認後整組入座
//   8) 「用建議桌」選好後，那張桌才被別筆預配（時段重疊）→ 確認鈕鎖住，勾「仍要帶這桌」才解鎖（帶位面板＋選桌入座模式）
// 時間用 page.clock 固定、時區固定 Asia/Taipei；後台本機模式以 localStorage 為後端，攔截 admin* 雲端端點。

test.use({ timezoneId: 'Asia/Taipei' })

const TODAY = '2026-09-19'
const at = (hhmm) => new Date(`${TODAY}T${hhmm}:00+08:00`)

const mkTable = (number, over = {}) => ({
  number, capacity: 4, floor: '1F', x: 360, y: over.y ?? 612, w: 80, h: 75, rotation: 0, zoneId: null,
  isActive: true, outage: null, status: 'vacant', currentBookingId: null, currentRef: null, seatedAt: null, ...over,
})
const mkBooking = (over) => ({
  phone: '0911000008', date: TODAY, timeSlot: '12:00', status: 'confirmed', source: 'phone',
  assignedTableId: null, extraTableIds: [], notes: {}, createdBy: 'staff', ...over,
})

async function seed(page, { tables, bookings }) {
  await page.addInitScript(({ tables, bookings }) => {
    // 只在第一次載入時灌資料（reload 後保留 app 自己寫的狀態）
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
  await page.locator('aside').getByRole('button', { name: '現場' }).click()
}

const readState = (page) => page.evaluate(() => ({
  bookings: JSON.parse(localStorage.getItem('chicken_bookings_v1') || '[]'),
  tables: JSON.parse(localStorage.getItem('chicken_tables_v3') || '[]'),
}))
const mapTable = (page, n) => page.getByRole('button', { name: new RegExp(`^${n}桌`) })

test.beforeEach(async ({ page }) => {
  await page.route('**/adminPullData', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'e2e-offline' }) }))
  await page.route('**/adminPushData', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }))
  await page.route('**/admin*', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false }) }))
})

const WANG = mkBooking({ id: 'E2E-ED-WANG', name: '王先生', guests: 4, assignedTableId: '105' })

test('現場改人數：4 人變 6 人、同桌坐得下 → 不換頁、≤6 下、桌位保留', async ({ page }) => {
  await page.clock.setFixedTime(at('11:40'))
  await seed(page, {
    tables: [mkTable('105', { capacity: 6, status: 'reserved', currentBookingId: WANG.id }), mkTable('106', { y: 462 })],
    bookings: [WANG],
  })
  await loginToOps(page)
  await page.getByRole('button', { name: /^今日訂位/ }).click()   // 進入今日訂位籤（前置，不計入改單步數）

  const card = page.locator(`[data-booking-id="${WANG.id}"]`)
  let taps = 0
  await card.getByLabel('王先生 更多操作').click(); taps++
  await card.getByRole('button', { name: '改人數／時段／備註' }).click(); taps++
  await page.getByRole('button', { name: '6 位', exact: true }).click(); taps++
  await expect(page.getByTestId('edit-table-note')).toHaveText('105 坐得下，桌位保留')
  await page.getByRole('button', { name: '儲存變更' }).click(); taps++
  expect(taps).toBeLessThanOrEqual(6)

  await expect(page.getByText('已更新 王先生 的訂位')).toBeVisible()
  await expect(page).toHaveURL(/tab=ops|\/admin/)
  await expect(card).toContainText('6 位')
  await expect(card).toContainText('已指派 105')
  const { bookings, tables } = await readState(page)
  expect(bookings.find(b => b.id === WANG.id)).toMatchObject({ guests: 6, assignedTableId: '105' })
  expect(tables.find(t => t.number === '105')).toMatchObject({ status: 'reserved', currentBookingId: WANG.id })
})

test('現場改人數：坐不下 → 解除桌位並提示重新指派', async ({ page }) => {
  await page.clock.setFixedTime(at('11:40'))
  await seed(page, {
    tables: [mkTable('105', { status: 'reserved', currentBookingId: WANG.id }), mkTable('106', { y: 462 })],
    bookings: [WANG],
  })
  await loginToOps(page)
  await page.getByRole('button', { name: /^今日訂位/ }).click()
  const card = page.locator(`[data-booking-id="${WANG.id}"]`)
  await card.getByLabel('王先生 更多操作').click()
  await card.getByRole('button', { name: '改人數／時段／備註' }).click()
  await page.getByRole('button', { name: '6 位', exact: true }).click()
  await expect(page.getByTestId('edit-table-note')).toContainText('會解除桌位')
  await page.getByRole('button', { name: '儲存變更' }).click()

  await expect(page.getByText('已更新 王先生，已解除桌位 105，請重新指派')).toBeVisible()
  await expect(card.getByRole('button', { name: '指派桌位' })).toBeVisible()
  const { bookings, tables } = await readState(page)
  expect(bookings.find(b => b.id === WANG.id)).toMatchObject({ guests: 6, assignedTableId: null })
  expect(tables.find(t => t.number === '105')).toMatchObject({ status: 'vacant', currentBookingId: null })
})

test('已入座加過敏備註：桌抽屜「改人數／備註」≤4 下，桌不動', async ({ page }) => {
  await page.clock.setFixedTime(at('12:20'))
  const ZHAO = mkBooking({ id: 'E2E-ED-ZHAO', name: '趙先生', guests: 4, status: 'arrived', assignedTableId: '101', actualArrivalTime: at('12:00').toISOString() })
  await seed(page, {
    tables: [mkTable('101', { status: 'dining', currentBookingId: ZHAO.id, seatedAt: at('12:00').toISOString() }), mkTable('106', { y: 462 })],
    bookings: [ZHAO],
  })
  await loginToOps(page)

  let taps = 0
  await mapTable(page, '101').click(); taps++
  await page.getByRole('button', { name: '改人數／備註' }).click(); taps++
  await expect(page.getByText('改人數／備註 · 趙先生')).toBeVisible()
  // 已入座：日期／時段／電話不開放
  await expect(page.getByText(/^時段（/)).toHaveCount(0)
  await page.getByRole('textbox', { name: '訂位備註' }).fill('過敏：花生'); taps++
  await page.getByRole('button', { name: '儲存變更' }).click(); taps++
  expect(taps).toBeLessThanOrEqual(4)
  await expect(page.getByRole('button', { name: '訂單明細' })).toHaveCount(0)

  await expect(page.getByText('已更新 趙先生 的訂位')).toBeVisible()
  const { bookings, tables } = await readState(page)
  expect(bookings.find(b => b.id === ZHAO.id)).toMatchObject({ status: 'arrived', assignedTableId: '101', notes: expect.objectContaining({ text: '過敏：花生' }) })
  expect(tables.find(t => t.number === '101')).toMatchObject({ status: 'dining', currentBookingId: ZHAO.id })
})

test('今日訂位卡取消：有確認框；復原把訂位與桌一起倒回', async ({ page }) => {
  await page.clock.setFixedTime(at('11:40'))
  await seed(page, {
    tables: [mkTable('105', { status: 'reserved', currentBookingId: WANG.id }), mkTable('106', { y: 462 })],
    bookings: [WANG],
  })
  await loginToOps(page)
  await page.getByRole('button', { name: /^今日訂位/ }).click()
  const card = page.locator(`[data-booking-id="${WANG.id}"]`)
  await card.getByLabel('王先生 更多操作').click()
  await card.getByRole('button', { name: '取消訂位' }).click()
  // 確認框必須保留（取消會通知客人，復原收不回通知）
  await expect(page.getByText('取消 王先生 12:00 的訂位？')).toBeVisible()
  await page.getByRole('button', { name: '取消訂位', exact: true }).last().click()

  await expect(page.getByText('已取消 王先生 的訂位')).toBeVisible()
  let { bookings, tables } = await readState(page)
  expect(bookings.find(b => b.id === WANG.id).status).toBe('cancelled')
  expect(tables.find(t => t.number === '105')).toMatchObject({ status: 'vacant', currentBookingId: null })

  await page.getByRole('button', { name: '↩ 復原' }).click()
  await expect(page.getByText(/已復原 王先生 的訂位/)).toBeVisible()
  ;({ bookings, tables } = await readState(page))
  expect(bookings.find(b => b.id === WANG.id)).toMatchObject({ status: 'confirmed', assignedTableId: '105' })
  expect(tables.find(t => t.number === '105')).toMatchObject({ status: 'reserved', currentBookingId: WANG.id })
})

test('未配桌訂位「詳情 ›」開訂位詳情（不換頁），可直接改人數', async ({ page }) => {
  await page.clock.setFixedTime(at('11:40'))
  const LIN = mkBooking({ id: 'E2E-ED-LIN', name: '林先生', guests: 3 })
  await seed(page, { tables: [mkTable('105'), mkTable('106', { y: 462 })], bookings: [LIN] })
  await loginToOps(page)
  await page.getByRole('button', { name: /^今日訂位/ }).click()
  await page.locator(`[data-booking-id="${LIN.id}"]`).getByRole('button', { name: '詳情 ›' }).click()
  await expect(page.getByRole('button', { name: '改人數／時段／備註' })).toBeVisible()
  await expect(page.getByRole('button', { name: '指派桌位', exact: true }).last()).toBeVisible()
})

test('帶位面板「用建議桌」：一下切到建議桌樓層並選好，按確認才入座', async ({ page }) => {
  await page.clock.setFixedTime(at('11:40'))
  await seed(page, {
    tables: [
      mkTable('105', { status: 'dining', currentBookingId: 'X', seatedAt: at('11:30').toISOString() }),
      mkTable('201', { floor: '2F' }),
    ],
    bookings: [],
  })
  await loginToOps(page)
  await expect(page.getByText(/建議 2F・201/)).toBeVisible()
  await page.getByTestId('walkin-apply-suggestion').click()
  await expect(page.getByLabel('2F 桌況圖')).toBeVisible()
  const seat = page.getByTestId('walkin-seat')
  await expect(seat).toBeEnabled()
  await expect(seat).toContainText('201')
  // 尚未入座：要店員自己按確認
  let { tables } = await readState(page)
  expect(tables.find(t => t.number === '201').status).toBe('vacant')
  await seat.click()
  ;({ tables } = await readState(page))
  expect(tables.find(t => t.number === '201').status).toBe('dining')
})

test('到了 · 選桌入座：「用建議桌」選好併桌組合（含切樓層），確認後整組入座', async ({ page }) => {
  await page.clock.setFixedTime(at('11:40'))
  const BIG = mkBooking({ id: 'E2E-ED-BIG', name: '大組', guests: 8 })
  await seed(page, {
    tables: [
      mkTable('105', { status: 'dining', currentBookingId: 'X', seatedAt: at('11:30').toISOString() }),
      mkTable('201', { floor: '2F', x: 100 }),
      mkTable('202', { floor: '2F', x: 220 }),
    ],
    bookings: [BIG],
  })
  await loginToOps(page)
  await page.getByRole('button', { name: /^今日訂位/ }).click()
  await page.locator(`[data-booking-id="${BIG.id}"]`).getByRole('button', { name: '大組 到了，選桌入座' }).click()
  // 進模式不自動勾（PR #137）
  await expect(page.getByText(/已選 0\/8 席/)).toBeVisible()
  await page.getByTestId('mode-apply-suggestion').click()
  await expect(page.getByLabel('2F 桌況圖')).toBeVisible()
  await expect(page.getByText(/已選 8\/8 席 · 2 桌/)).toBeVisible()
  await page.getByRole('button', { name: '✓ 確認併桌入座' }).click()

  await expect(page.getByText(/大組（8 位）已入座 20[12] \+ 20[12]/)).toBeVisible()
  const { bookings, tables } = await readState(page)
  const b = bookings.find(x => x.id === BIG.id)
  expect(b.status).toBe('arrived')
  expect([b.assignedTableId, ...b.extraTableIds].sort()).toEqual(['201', '202'])
  expect(tables.filter(t => ['201', '202'].includes(t.number)).every(t => t.status === 'dining' && t.currentBookingId === BIG.id)).toBe(true)
})

// 模擬別台裝置把這筆預配寫進來：改 localStorage 後發 storage 事件（BookingContext 收到 chicken_* 就 refresh）
async function preassignFromAnotherDevice(page, bookingId, tableNumber) {
  await page.evaluate(({ bookingId, tableNumber }) => {
    const list = JSON.parse(localStorage.getItem('chicken_bookings_v1') || '[]')
    const b = list.find(x => x.id === bookingId)
    b.assignedTableId = tableNumber
    b.extraTableIds = []
    localStorage.setItem('chicken_bookings_v1', JSON.stringify(list))
    window.dispatchEvent(new StorageEvent('storage', { key: 'chicken_bookings_v1' }))
  }, { bookingId, tableNumber })
}

test('帶位面板「用建議桌」後該桌被別筆預配（時段重疊）→ 確認入座鎖住，勾「仍要帶這桌」才解鎖', async ({ page }) => {
  await page.clock.setFixedTime(at('11:40'))
  const CHEN = mkBooking({ id: 'E2E-ED-CHEN', name: '陳小姐', guests: 2, timeSlot: '12:30' })
  await seed(page, {
    tables: [
      mkTable('105', { status: 'dining', currentBookingId: 'X', seatedAt: at('11:30').toISOString() }),
      mkTable('201', { floor: '2F' }),
    ],
    bookings: [CHEN],
  })
  await loginToOps(page)
  await page.getByTestId('walkin-apply-suggestion').click()
  const seat = page.getByTestId('walkin-seat')
  await expect(seat).toBeEnabled()
  await expect(seat).toContainText('201')

  await preassignFromAnotherDevice(page, CHEN.id, '201')
  await expect(page.getByText(/201.*陳小姐/).first()).toBeVisible()
  await expect(seat).toBeDisabled()
  await seat.click({ force: true })
  let { tables } = await readState(page)
  expect(tables.find(t => t.number === '201').status).toBe('vacant')

  await page.getByLabel('我知道，仍要帶這桌').check()
  await expect(seat).toBeEnabled()
  await seat.click()
  ;({ tables } = await readState(page))
  expect(tables.find(t => t.number === '201').status).toBe('dining')
})

test('選桌入座「用建議桌」後其中一張被別筆預配（時段重疊）→ 確認鈕鎖住，勾選確認才解鎖', async ({ page }) => {
  await page.clock.setFixedTime(at('11:40'))
  const BIG = mkBooking({ id: 'E2E-ED-BIG2', name: '大組', guests: 8 })
  const CHEN = mkBooking({ id: 'E2E-ED-CHEN2', name: '陳小姐', guests: 2, timeSlot: '12:30' })
  await seed(page, {
    tables: [
      mkTable('105', { status: 'dining', currentBookingId: 'X', seatedAt: at('11:30').toISOString() }),
      mkTable('201', { floor: '2F', x: 100 }),
      mkTable('202', { floor: '2F', x: 220 }),
    ],
    bookings: [BIG, CHEN],
  })
  await loginToOps(page)
  await page.getByRole('button', { name: /^今日訂位/ }).click()
  await page.locator(`[data-booking-id="${BIG.id}"]`).getByRole('button', { name: '大組 到了，選桌入座' }).click()
  await page.getByTestId('mode-apply-suggestion').click()
  await expect(page.getByText(/已選 8\/8 席 · 2 桌/)).toBeVisible()
  const confirmBtn = page.getByRole('button', { name: '✓ 確認併桌入座' })
  await expect(confirmBtn).toBeEnabled()

  await preassignFromAnotherDevice(page, CHEN.id, '201')
  const ack = page.getByLabel('我已確認上述預配／團體保留，仍要使用所選桌')
  await expect(ack).toBeVisible()
  await expect(confirmBtn).toBeDisabled()

  await ack.check()
  await expect(confirmBtn).toBeEnabled()
  await confirmBtn.click()
  await expect(page.getByText(/大組（8 位）已入座/)).toBeVisible()
  const { bookings } = await readState(page)
  expect(bookings.find(x => x.id === BIG.id).status).toBe('arrived')
})
