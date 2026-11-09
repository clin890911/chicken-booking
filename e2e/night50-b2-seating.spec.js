import { test, expect } from '@playwright/test'

// night-50 批 2：G1–G4 當日排位／未來預配。時間固定 2026-09-19(六) 09:00 台北。
test.use({ timezoneId: 'Asia/Taipei', viewport: { width: 1180, height: 820 } })
const SHOTS = '/private/tmp/claude-501/-Users-chingchunlin--claude-spares-spare-WtJFow/2abbcc7f-2edc-4b13-af84-1f34c069374e/scratchpad/shots-b2'
const shot = (page, n) => page.screenshot({ path: `${SHOTS}/${n}.png` })
const J = (o) => JSON.stringify(o)
const mk = (i, name, guests, date, timeSlot, extra = {}) => ({ id: `E2E-B2-${i}`, name, phone: `09110000${String(i).padStart(2, '0')}`, guests, date, timeSlot, status: 'confirmed', source: 'phone', assignedTableId: null, extraTableIds: [], notes: {}, createdBy: 'staff', manageToken: `t${i}`, ...extra })
const table = (page, n) => page.locator(`svg g:has(:text-is("${n}"))`).first()
const row = (page, name) => page.getByTestId('day-seating').getByRole('button', { name: new RegExp(name) }).first()
const banner = (page) => page.getByTestId('seat-banner')
const readB = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('chicken_bookings_v1') || '[]'))
const readT = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('chicken_tables_v3') || 'null'))

async function setup(page, bookings) {
  await page.route('https://**/*', r => r.abort())
  await page.clock.setFixedTime(new Date('2026-09-19T09:00:00+08:00'))
  await page.route('**/adminPullData', r => r.fulfill({ status: 200, contentType: 'application/json', body: J({ ok: false, error: 'e2e-offline' }) }))
  await page.route('**/adminPushData', r => r.fulfill({ status: 200, contentType: 'application/json', body: J({ ok: true }) }))
  await page.route('**/admin*', r => r.fulfill({ status: 200, contentType: 'application/json', body: J({ ok: false }) }))
  await page.addInitScript((bookings) => {
    if (localStorage.getItem('__seeded')) return
    localStorage.setItem('__seeded', '1')
    localStorage.setItem('chicken_bookings_v1', JSON.stringify(bookings))
    localStorage.setItem('chicken_group_reservations_v1', '[]')
    localStorage.setItem('chicken_group_blank_purge_v1', '1')
    localStorage.removeItem('chicken_waitlist_v1'); localStorage.removeItem('chicken_tables_v3')
  }, bookings)
  await page.goto('/login')
  await page.getByPlaceholder('your@email.com').fill('berrylin0911@gmail.com')
  await page.getByRole('button', { name: /模擬登入/ }).click()
  await expect(page).toHaveURL(/\/admin/)
}
async function openDay(page, dayNum) {
  await page.getByRole('button', { name: /日曆/ }).click()
  await page.getByRole('button').filter({ has: page.getByText(String(dayNum), { exact: true }) }).filter({ hasText: '組' }).first().click()
  await expect(page.getByTestId('day-seating')).toBeVisible()
}
const confirmBtn = (page) => page.getByRole('button', { name: /^確認(併桌)?$/ })

test('G1 今天 12 組排桌：每組步數與總耗時', async ({ page }) => {
  const sizes = [2, 2, 3, 4, 4, 4, 5, 6, 5, 6, 6, 5]
  const t4 = ['105', '106', '107', '111', '112', '113'], t6 = ['101', '102', '103', '108', '109', '110']
  const bs = sizes.map((g, i) => mk(i + 1, `客${String(i + 1).padStart(2, '0')}`, g, '2026-09-19', i % 2 ? '12:00' : '11:30'))
  await setup(page, bs); await openDay(page, 19)
  await shot(page, 'G1-1-list')
  const t0 = Date.now(); let steps = 0; let n4 = 0, n6 = 0
  for (let i = 0; i < 12; i++) {
    const nm = `客${String(i + 1).padStart(2, '0')}`
    const tn = sizes[i] <= 4 ? t4[n4++] : t6[n6++]
    // 11:30 與 12:00 有重疊 → 每組用不同桌
    await row(page, nm).click(); steps++
    await table(page, tn).click(); steps++
    if (i === 0) await shot(page, 'G1-2-picked')
    await confirmBtn(page).click(); steps++
    await expect.poll(async () => (await readB(page)).find(b => b.name === nm).assignedTableId).toBe(tn)
  }
  console.log('G1 total steps', steps, 'per group', steps / 12, 'wall ms (含斷言等待)', Date.now() - t0)
  await shot(page, 'G1-3-done')
  const b = await readB(page)
  console.log('G1 assigned', b.filter(x => x.assignedTableId).length, '/12')
  console.log('G1 tables touched', JSON.stringify((await readT(page) || []).filter(t => t.status !== 'vacant').map(t => [t.number, t.status])))
  console.log('G1 summary', await page.getByTestId('day-seating-summary').innerText())
})

test('G2 撞桌：第二組選同桌的回饋', async ({ page }) => {
  const bs = [mk(1, '甲先生', 2, '2026-09-19', '12:00'), mk(2, '乙先生', 2, '2026-09-19', '12:00')]
  await setup(page, bs); await openDay(page, 19)
  await row(page, '甲先生').click(); await table(page, '105').click(); await confirmBtn(page).click()
  await row(page, '乙先生').click(); await table(page, '105').click()
  await shot(page, 'G2-1-conflict')
  const msg = page.getByText('105 在此場次已被佔用')
  await expect(msg).toBeVisible()
  // G2 修法：橫幅常駐紅字點名佔用者，toast 消失後仍在
  await expect(page.getByTestId('pick-conflict')).toContainText('已有甲先生，請選別桌')
  const color = await msg.evaluate(e => getComputedStyle(e).color)
  const bg = await msg.evaluate(e => getComputedStyle(e.closest('div') || e).backgroundColor)
  console.log('G2 msg color', color, 'bg', bg, 'class', await msg.evaluate(e => e.className))
  console.log('G2 override/unlock buttons', await page.getByRole('button', { name: /解鎖|覆蓋|仍要/ }).count())
  console.log('G2 banner', await banner(page).innerText())
  console.log('G2 confirm enabled?', await confirmBtn(page).isEnabled().catch(() => 'no-confirm-btn'))
  expect((await readB(page)).find(b => b.name === '乙先生').assignedTableId).toBeNull()
  // 能否看到 105 是誰佔的
  console.log('G2 table 105 aria', await table(page, '105').getAttribute('aria-label'))
  await page.waitForTimeout(6000)
  await expect(page.getByTestId('pick-conflict')).toBeVisible()
})

test('G3 明天預配不寫現場桌況；G4 店員改時間→預配解除', async ({ page }) => {
  const bs = [mk(1, '明天客', 4, '2026-09-20', '18:00')]
  await setup(page, bs); await openDay(page, 20)
  let steps = 0
  await row(page, '明天客').click(); steps++
  await table(page, '105').click(); steps++
  await confirmBtn(page).click(); steps++
  await expect(page.getByText(/明天客.*已配到 105/)).toBeVisible()
  await shot(page, 'G3-1-preassigned')
  let b = (await readB(page))[0]
  const tb = await readT(page)
  const t105 = (tb || []).find(t => t.number === '105')
  console.log('G3 steps', steps, 'booking.assignedTableId', b.assignedTableId, 'table105', JSON.stringify(t105 && { status: t105.status, cur: t105.currentBookingId }), 'anyNonVacant', JSON.stringify((tb || []).filter(t => t.status !== 'vacant').map(t => t.number)))
  expect(b.assignedTableId).toBe('105')
  // 現場頁看桌況
  await page.locator('aside').getByRole('button', { name: '現場' }).click()
  await shot(page, 'G3-2-ops')
  // G4：店員（模擬客人端改時間）改時段
  await page.locator('aside').getByRole('button', { name: '訂位' }).click()
  await page.getByRole('button', { name: /日曆/ }).click()
  await page.getByRole('button').filter({ has: page.getByText('20', { exact: true }) }).filter({ hasText: '組' }).first().click()
  await row(page, '明天客').click()
  await shot(page, 'G4-1-selected')
  const names = await page.getByRole('button').evaluateAll(els => els.map(e => (e.getAttribute('aria-label') || e.innerText || '').replace(/\s+/g, ' ').trim()).filter(Boolean))
  console.log('G4 buttons', names.filter(x => /配|詳情|改|取消|到/.test(x)).join(' | '))
  await page.getByRole('button', { name: '編輯', exact: true }).click()
  await page.waitForTimeout(400)
  await shot(page, 'G4-2-edit')
  await page.getByRole('button', { name: /^19:00/ }).click()
  await shot(page, 'G4-3-slot-picked')
  console.log('G4 preview hint', await page.getByText(/儲存後會解除/).first().innerText().catch(() => 'NO HINT'))
  await page.getByRole('button', { name: '儲存變更' }).click()
  await page.waitForTimeout(600)
  await shot(page, 'G4-4-after-save')
  b = (await readB(page))[0]
  const tb2 = await readT(page)
  console.log('G4 after: timeSlot', b.timeSlot, 'assignedTableId', b.assignedTableId, 'extra', JSON.stringify(b.extraTableIds), 'nonVacant', JSON.stringify((tb2 || []).filter(t => t.status !== 'vacant').map(t => t.number)))
  console.log('G4 toasts', (await page.locator('[role=status], [role=alert], [data-testid^=toast]').allInnerTexts()).join(' | '))
})
