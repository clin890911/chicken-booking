import { test, expect } from '@playwright/test'
import { todayTab } from './helpers/opsToday'

// 選客入座 A 包（2026-11-27，docs/ux-review-seating-20261127）：
//   A1 選桌模式不再縮小地圖：iPad 橫 1180×820／直 820×1180 進「到了・換桌入座」前後，同一張桌的寬度差 ≤5%
//   A3 報到列「到了」後原位確認卡：下一位的「到了」不會移到剛按的座標；連點兩次只入座一組
//   A4 今日卡片對「預配桌被佔」直接是「到了 · 換桌入座」
// 第二輪（verify-after.md 驗收修正，iPad 橫 1180×820／直 820×1180 都測）：
//   #1 入座成功提示存在時，地圖每張桌中心的 elementFromPoint 仍是桌本身（提示不疊在地圖上）
//   #2 報到列「到了」只有原位確認卡一顆「復原」（不另發 toast）
//   #3 確認卡期間，原「到了」中心點不是「復原」；#4 復原時效一到佔位收起
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
    await expect(page.getByText(/✓ 陳小姐 4 位 → 105 已入座/)).toBeVisible()
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
  // #12 一桌都沒選：不顯示「擠一擠也還差」；#13 選第一桌時「＋再加一桌」不位移
  await expect(panel).not.toContainText('擠一擠也還差')
  const toggle = panel.getByRole('button', { name: '＋再加一桌（併桌）' })
  const tBefore = await toggle.boundingBox()
  await mapTable(page, '101').click()
  await expect(panel).toContainText('已選：101')
  const tAfter = await toggle.boundingBox()
  expect(Math.abs(tAfter.y - tBefore.y), `＋再加一桌 y ${tBefore.y} → ${tAfter.y}`).toBeLessThanOrEqual(1)
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
  await expect(strip(page).getByRole('listitem').first()).toContainText('林先生 3 位 → 105 已入座')
  const { bookings } = await readState(page)
  expect(bookings.find(b => b.id === LIN.id).status).toBe('arrived')
  expect(bookings.find(b => b.id === LI.id).status).toBe('confirmed')
  // 剛按的位置上不是下一位的「到了」；下一位的鈕沒動
  const hitLabel = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('button')?.getAttribute('aria-label') || '', [cx, cy])
  expect(hitLabel).not.toContain('李先生')
  const liAfter = await liBtn.boundingBox()
  expect(Math.abs(liAfter.x - liBefore.x)).toBeLessThanOrEqual(2)
  // 復原時效（8 秒）內：確認卡仍在，李先生的鈕仍不左移
  await page.clock.runFor(5500)
  await page.waitForTimeout(100)
  const liLater = await liBtn.boundingBox()
  expect(Math.abs(liLater.x - liBefore.x)).toBeLessThanOrEqual(2)
  // #4 時效一到：佔位以動畫收起、移除，報到列開頭不留空白（李先生回到第一格）
  await page.clock.runFor(3000)
  await expect(strip(page).locator('[data-seated-ghost]')).toHaveCount(0)
  await expect.poll(async () => (await liBtn.boundingBox()).x).toBeLessThan(liBefore.x - 20)
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
  await expect(page.getByText(/✓ 陳小姐 4 位 → 108 已入座/)).toBeVisible()
  const { bookings, tables } = await readState(page)
  expect(bookings.find(b => b.id === CHEN.id)).toMatchObject({ status: 'arrived', assignedTableId: '108' })
  expect(tables.find(t => t.number === '106')).toMatchObject({ status: 'dining', currentBookingId: WALK.id })
})

// 地圖上所有桌：中心點 elementFromPoint 必須落在該桌自己（aria-label 以「N桌」開頭），不能是提示或「復原」
const tableCentersHitSelf = (page) => page.evaluate(() => {
  const out = []
  document.querySelectorAll('[role="button"][aria-label]').forEach(el => {
    const m = /^(\d+)桌/.exec(el.getAttribute('aria-label') || '')
    if (!m) return
    const r = el.getBoundingClientRect()
    if (!r.width || !r.height) return
    const x = r.left + r.width / 2, y = r.top + r.height / 2
    const hit = document.elementFromPoint(x, y)
    const own = hit?.closest?.('[role="button"][aria-label]')
    out.push({ n: m[1], ok: own === el, hit: (hit?.closest?.('button,[role=button]')?.getAttribute('aria-label') || hit?.className?.baseVal || hit?.className || '').toString().slice(0, 60) })
  })
  return out
})

for (const vp of [{ name: 'iPad 橫', width: 1180, height: 820 }, { name: 'iPad 直', width: 820, height: 1180 }]) {
  test(`#1 ${vp.name}：入座成功提示存在時，地圖每張桌中心點仍是桌本身；提示不蓋左欄確認鈕`, async ({ page }) => {
    await page.clock.setFixedTime(at('11:50'))
    await seed(page, { tables: TABLES(), bookings: [WALK, CHEN, LI] })
    await loginToOps(page)
    await page.setViewportSize({ width: vp.width, height: vp.height })
    await strip(page).getByRole('button', { name: '陳小姐 到了，換桌入座' }).click()
    const panel = page.getByTestId('mode-banner')
    await mapTable(page, '108').click()
    const confirmBtn = panel.getByRole('button', { name: '確認入座', exact: true })
    const cb = await confirmBtn.boundingBox()
    await confirmBtn.click()
    const toastEl = page.locator('[data-placement="seat"]').filter({ hasText: '✓ 陳小姐 4 位 → 108 已入座' })
    await expect(toastEl).toBeVisible()
    // 提示仍在的期間逐桌檢查（含最底排）
    const hits = await tableCentersHitSelf(page)
    expect(hits.length).toBeGreaterThanOrEqual(6)
    expect(hits.filter(h => !h.ok), JSON.stringify(hits)).toEqual([])
    await expect(toastEl).toBeVisible()
    // 提示框與任何一張桌都不相交、也不蓋到剛才左欄確認鈕的位置
    const tb = await toastEl.boundingBox()
    const overlaps = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
    for (const n of ['101', '102', '103', '105', '106', '108']) {
      const box = await mapTable(page, n).boundingBox()
      expect(overlaps(tb, box), `提示 ${JSON.stringify(tb)} 蓋到 ${n} ${JSON.stringify(box)}`).toBe(false)
    }
    expect(overlaps(tb, cb)).toBe(false)
  })

  test(`#2／#3 ${vp.name}：報到列「到了」只有原位確認卡一顆復原；原「到了」中心點不是復原`, async ({ page }) => {
    await page.clock.setFixedTime(at('11:50'))
    await seed(page, { tables: TABLES(), bookings: [WALK, LIN, LI] })
    await loginToOps(page)
    await page.setViewportSize({ width: vp.width, height: vp.height })
    const linBtn = strip(page).getByRole('button', { name: '林先生 到了，入座 105' })
    const lb = await linBtn.boundingBox()
    const cx = lb.x + lb.width / 2, cy = lb.y + lb.height / 2
    await page.mouse.click(cx, cy)
    const ghost = strip(page).locator('[data-seated-ghost="E2E-UXA-LIN"]')
    await expect(ghost).toContainText('✓ 林先生 3 位 → 105 已入座')
    // #2：沒有 toast；畫面上只有一顆「復原」（原位卡的，讀屏名帶對象）
    await expect(page.locator('[data-placement="seat"]')).toHaveCount(0)
    await expect(page.getByTestId('toast-action')).toHaveCount(0)
    const undoBtns = page.getByRole('button', { name: /^復原/ })
    await expect(undoBtns).toHaveCount(1)
    await expect(undoBtns.first()).toHaveAccessibleName('復原入座 林先生')
    await expect(undoBtns.first()).toHaveText('復原')
    // #3：確認卡期間（剛出現、800ms 解鎖後各量一次），原「到了」中心點不是「復原」
    const hitAt = () => page.evaluate(([x, y]) => {
      const b = document.elementFromPoint(x, y)?.closest('button')
      return b ? (b.getAttribute('aria-label') || b.textContent || '') : ''
    }, [cx, cy])
    expect(await hitAt()).not.toMatch(/復原/)
    await expect(undoBtns.first()).toBeEnabled()
    expect(await hitAt()).not.toMatch(/復原/)
    // 再按一次原位置（「不確定有沒有按到」）：不會復原
    await page.mouse.click(cx, cy)
    const { bookings } = await readState(page)
    expect(bookings.find(b => b.id === LIN.id).status).toBe('arrived')
    // 真的要復原：按卡片上的「復原」
    await undoBtns.first().click()
    await expect(page.getByText('已復原：林先生 回到待到')).toBeVisible()
    const after = await readState(page)
    expect(after.bookings.find(b => b.id === LIN.id).status).toBe('confirmed')
    expect(after.tables.find(t => t.number === '105')).toMatchObject({ status: 'vacant' })
  })
}
