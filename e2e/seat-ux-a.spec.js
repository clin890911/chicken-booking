import { test, expect } from '@playwright/test'
import { todayTab } from './helpers/opsToday'

// 選客入座 A 包（2026-11-27，docs/ux-review-seating-20261127）：
//   A1 選桌模式不再縮小地圖：iPad 橫 1180×820／直 820×1180 進「到了・換桌入座」前後，同一張桌的寬度差 ≤5%
//   A3 報到列「到了」後原位確認卡：下一位的「到了」不會移到剛按的座標；連點兩次只入座一組
//   A4 今日卡片對「預配桌被佔」直接是「到了 · 換桌入座」
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
const WALK = bk('E2E-UXA-WALK', '現場散客', { status: 'arrived', source: 'walkin', assignedTableId: '106', timeSlot: '11:30', actualArrivalTime: at('11:30').toISOString() })
const CHEN = bk('E2E-UXA-CHEN', '陳小姐', { assignedTableId: '106', guests: 4, timeSlot: '12:00' })
const LIN = bk('E2E-UXA-LIN', '林先生', { assignedTableId: '105', timeSlot: '11:50' })
const LI = bk('E2E-UXA-LI', '李先生', { assignedTableId: '102', timeSlot: '11:55' })

const TABLES = () => [
  mkTable('101', 120, 120, { capacity: 6 }), mkTable('102', 280, 120), mkTable('103', 440, 120, { capacity: 6 }),
  mkTable('105', 120, 300), mkTable('106', 280, 300, { status: 'dining', currentBookingId: WALK.id, seatedAt: at('11:30').toISOString() }),
  mkTable('108', 440, 300, { capacity: 6 }),
]

async function seed(page, { tables, bookings }) {
  await page.addInitScript(({ tables, bookings }) => {
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
const strip = (page) => page.getByRole('list', { name: '可入座名單' })

test.beforeEach(async ({ page }) => {
  await page.route('**/adminPullData', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'e2e-offline' }) }))
  await page.route('**/adminPushData', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }))
  await page.route('**/admin*', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false }) }))
})

for (const vp of [{ name: 'iPad 橫', width: 1180, height: 820 }, { name: 'iPad 直', width: 820, height: 1180 }]) {
  test(`A1 ${vp.name} ${vp.width}×${vp.height}：進「到了・換桌入座」前後地圖桌子尺寸不變、確認鈕在左欄底部`, async ({ page }) => {
    await page.clock.setFixedTime(at('11:50'))
    // 李先生留在報到列：入座陳小姐後報到列仍在（報到列清空時本來就不佔高度，那是資料變動、不是模式切換）
    await seed(page, { tables: TABLES(), bookings: [WALK, CHEN, LI] })
    await loginToOps(page)
    await page.setViewportSize({ width: vp.width, height: vp.height })
    await expect(mapTable(page, '105')).toBeVisible()

    const before = await mapTable(page, '105').boundingBox()
    const before103 = await mapTable(page, '103').boundingBox()
    const item = strip(page).getByRole('listitem').filter({ hasText: '陳小姐' })
    await item.getByRole('button', { name: '陳小姐 到了，換桌入座' }).click()
    const panel = page.getByTestId('mode-banner')
    await expect(panel).toContainText('到了 · 換桌入座：陳小姐 4 位')
    await expect(panel).toHaveAttribute('data-layout', 'rail')
    await expect(panel.getByTestId('arrive-reseat-from')).toContainText('原預配 106 被佔')
    const after = await mapTable(page, '105').boundingBox()
    expect(Math.abs(after.width - before.width) / before.width, `105 寬 ${before.width} → ${after.width}`).toBeLessThanOrEqual(0.05)
    expect(Math.abs(after.height - before.height) / before.height).toBeLessThanOrEqual(0.05)

    // 確認鈕在左欄面板底部（面板內最下方、在地圖左邊）
    await mapTable(page, '105').click()
    const confirmBtn = panel.getByRole('button', { name: '確認入座', exact: true })
    await expect(confirmBtn).toBeEnabled()
    const cb = await confirmBtn.boundingBox()
    const pb = await panel.boundingBox()
    expect(cb.y + cb.height).toBeGreaterThan(pb.y + pb.height - 90)
    expect(cb.x + cb.width).toBeLessThanOrEqual(before.x)
    await confirmBtn.click()
    await expect(page.getByText(/陳小姐（4 位）已入座 105（原預配 106 被佔）/)).toBeVisible()
    // 模式結束也不重排地圖（105 剛入座有綠光外框，量旁邊沒被選的 103）
    const after2 = await mapTable(page, '103').boundingBox()
    expect(Math.abs(after2.width - before103.width) / before103.width).toBeLessThanOrEqual(0.05)
  })
}

test('A2 iPad 橫：選桌模式點 101 再點 103 → 只選 103；按「＋再加一桌」後點 108 → 103＋108', async ({ page }) => {
  await page.clock.setFixedTime(at('11:50'))
  await seed(page, { tables: TABLES(), bookings: [WALK, CHEN] })
  await loginToOps(page)
  await page.setViewportSize({ width: 1180, height: 820 })
  await strip(page).getByRole('button', { name: '陳小姐 到了，換桌入座' }).click()
  const panel = page.getByTestId('mode-banner')
  await mapTable(page, '101').click()
  await expect(panel).toContainText('已選：101')
  await mapTable(page, '103').click()
  await expect(panel).toContainText('已選：103')
  await expect(panel).not.toContainText('101 +')
  await panel.getByRole('button', { name: '＋再加一桌（併桌）' }).click()
  await mapTable(page, '108').click()
  await expect(panel).toContainText('已選：103 + 108')
  await expect(panel.getByTestId('mode-excess')).toContainText('4 位用了 2 桌 12 席')
  await panel.getByRole('button', { name: '取消', exact: true }).click()
  const { bookings } = await readState(page)
  expect(bookings.find(b => b.id === CHEN.id)).toMatchObject({ status: 'confirmed', assignedTableId: '106' })
})

test('A3 iPad 直 820：報到列「到了」完整可見；按下後原位確認卡，下一位的「到了」不移到剛按的位置；連點只入座一組', async ({ page }) => {
  await page.clock.setFixedTime(at('11:50'))
  await seed(page, { tables: TABLES(), bookings: [WALK, LIN, LI] })
  await loginToOps(page)
  await page.setViewportSize({ width: 820, height: 1180 })

  const linBtn = strip(page).getByRole('button', { name: '林先生 到了，入座 105' })
  const liBtn = strip(page).getByRole('button', { name: '李先生 到了，入座 102' })
  // 直向：「到了」鈕完整落在報到列可視範圍內（過去只露出 11px）
  const listBox = await strip(page).boundingBox()
  const lb = await linBtn.boundingBox()
  expect(lb.x).toBeGreaterThanOrEqual(listBox.x - 1)
  expect(lb.x + lb.width).toBeLessThanOrEqual(listBox.x + listBox.width + 1)

  const liBefore = await liBtn.boundingBox()
  const cx = lb.x + lb.width / 2, cy = lb.y + lb.height / 2
  // 連點兩下同一個位置（第二下落在原位的確認卡上）
  await page.mouse.click(cx, cy)
  await page.mouse.click(cx, cy)
  await expect(strip(page).getByRole('listitem').first()).toContainText('林先生 → 105 已入座')
  const { bookings } = await readState(page)
  expect(bookings.find(b => b.id === LIN.id).status).toBe('arrived')
  expect(bookings.find(b => b.id === LI.id).status).toBe('confirmed')
  // 剛按的位置上不是下一位的「到了」；下一位的鈕沒動
  const hitLabel = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('button')?.getAttribute('aria-label') || '', [cx, cy])
  expect(hitLabel).not.toContain('李先生')
  const liAfter = await liBtn.boundingBox()
  expect(Math.abs(liAfter.x - liBefore.x)).toBeLessThanOrEqual(2)
  // 復原時效過後（5 秒）佔位仍在，李先生的鈕仍不左移
  await page.clock.runFor(5500)
  await page.waitForTimeout(100)
  const liLater = await liBtn.boundingBox()
  expect(Math.abs(liLater.x - liBefore.x)).toBeLessThanOrEqual(2)
})

test('A4 今日卡片：預配桌被佔 → 「到了 · 換桌入座」進同一個選桌入座流程（不跳「仍要入座」）', async ({ page }) => {
  await page.clock.setFixedTime(at('11:50'))
  await seed(page, { tables: TABLES(), bookings: [WALK, CHEN] })
  await loginToOps(page)
  await todayTab(page).click()
  const card = page.locator(`[data-booking-id="${CHEN.id}"]`)
  await expect(card.getByRole('button', { name: '客人到了', exact: true })).toHaveCount(0)
  await card.getByRole('button', { name: '陳小姐 到了，換桌入座' }).click()
  const panel = page.getByTestId('mode-banner')
  await expect(panel).toContainText('到了 · 換桌入座：陳小姐 4 位')
  await mapTable(page, '108').click()
  await panel.getByRole('button', { name: '確認入座', exact: true }).click()
  await expect(page.getByText(/陳小姐（4 位）已入座 108（原預配 106 被佔）/)).toBeVisible()
  const { bookings, tables } = await readState(page)
  expect(bookings.find(b => b.id === CHEN.id)).toMatchObject({ status: 'arrived', assignedTableId: '108' })
  expect(tables.find(t => t.number === '106')).toMatchObject({ status: 'dining', currentBookingId: WALK.id })
})
