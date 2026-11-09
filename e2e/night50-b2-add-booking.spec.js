import { test, expect } from '@playwright/test'
import { todayTab } from './helpers/opsToday'

// night-50 批 2：C1–C8 新增訂位情境實走。時間固定 2026-09-19(六) 10:00 台北，明天＝9/20。
test.use({ timezoneId: 'Asia/Taipei' })
const SHOTS = '/private/tmp/claude-501/-Users-chingchunlin--claude-spares-spare-WtJFow/2abbcc7f-2edc-4b13-af84-1f34c069374e/scratchpad/shots-b2'
const shot = (page, n) => page.screenshot({ path: `${SHOTS}/${n}.png` })
const at = (hhmm, d = '2026-09-19') => new Date(`${d}T${hhmm}:00+08:00`)
const J = (o) => JSON.stringify(o)

async function setup(page, { time = '10:00', bookings = [], customers, settings, tables } = {}) {
  await page.route('https://**/*', r => r.abort())
  await page.clock.setFixedTime(at(time))
  await page.route('**/adminPullData', r => r.fulfill({ status: 200, contentType: 'application/json', body: J({ ok: false, error: 'e2e-offline' }) }))
  await page.route('**/adminPushData', r => r.fulfill({ status: 200, contentType: 'application/json', body: J({ ok: true }) }))
  await page.route('**/admin*', r => r.fulfill({ status: 200, contentType: 'application/json', body: J({ ok: false }) }))
  await page.addInitScript(({ bookings, customers, settings, tables }) => {
    if (localStorage.getItem('__seeded')) return
    localStorage.setItem('__seeded', '1')
    localStorage.setItem('chicken_bookings_v1', JSON.stringify(bookings))
    localStorage.setItem('chicken_group_reservations_v1', '[]')
    localStorage.setItem('chicken_group_blank_purge_v1', '1')
    localStorage.removeItem('chicken_waitlist_v1')
    if (tables) localStorage.setItem('chicken_tables_v3', JSON.stringify(tables)); else localStorage.removeItem('chicken_tables_v3')
    if (customers) localStorage.setItem('chicken_customers_v1', JSON.stringify(customers))
    if (settings) localStorage.setItem('chicken_settings_v1', JSON.stringify(settings))
  }, { bookings, customers, settings, tables })
}
async function login(page) {
  await page.goto('/login')
  await page.getByPlaceholder('your@email.com').fill('berrylin0911@gmail.com')
  await page.getByRole('button', { name: /模擬登入/ }).click()
  await expect(page).toHaveURL(/\/admin/)
}
const readB = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('chicken_bookings_v1') || '[]'))

test('C1 電話訂明天 18:00 四位：步數', async ({ page }) => {
  await setup(page); await login(page)
  let steps = 0
  await page.getByRole('button', { name: /新增/ }).click(); steps++            // 1 新增 sub-tab
  await page.getByPlaceholder('0912345678').fill('0933111222'); steps++        // 2 電話
  await page.getByPlaceholder('王小姐').fill('陳小姐'); steps++               // 3 姓名
  await page.getByRole('button', { name: /^4 位/ }).first().click(); steps++   // 4 人數
  await page.getByRole('button', { name: /^明天/ }).click(); steps++           // 5 日期
  await shot(page, 'C1-1-form')
  // 換到明天後時段是否保留/清空
  const hadSlot = await page.getByRole('button', { name: /確認新增/ }).count()
  await page.getByRole('button', { name: /18:00/ }).click(); steps++           // 6 時段
  await page.getByRole('button', { name: /確認新增 · .*18:00 · 4 位/ }).click(); steps++ // 7 送出
  await expect(page.getByText(/陳小姐 4 位 · .*18:00 已建立/)).toBeVisible()
  await shot(page, 'C1-2-done')
  console.log('C1 steps', steps, 'slotPreservedAfterDatePick', hadSlot)
  const b = await readB(page); expect(b[0].date).toBe('2026-09-20')
})

test('C2 今日 19:30：已過時段隱藏、預選下一個、送出後在今日清單', async ({ page }) => {
  await setup(page, { time: '19:10', settings: { closeTime: '21:00' } }); await login(page)
  await page.getByRole('button', { name: /新增/ }).click()
  const slotBtns = await page.getByRole('button', { name: /^\d\d:\d\d/ }).allInnerTexts()
  console.log('C2 slots visible', slotBtns.join('|').replace(/\n/g, ' '))
  expect(await page.getByRole('button', { name: /^12:00/ }).count()).toBe(0)
  await page.getByPlaceholder('0912345678').fill('0933111333')
  await page.getByPlaceholder('王小姐').fill('林先生')
  await shot(page, 'C2-1-today-slots')
  console.log('C2 confirm btn count before pick', await page.getByRole('button', { name: /確認新增/ }).count())
  await page.getByRole('button', { name: /19:30/ }).first().click()
  await shot(page, 'C2-2-picked')
  await page.getByRole('button', { name: /確認新增 · .*19:30/ }).click()
  await expect(page.getByText(/林先生 2 位 · .*19:30/)).toBeVisible()
  await shot(page, 'C2-3-toast')
  await page.getByRole('button', { name: /今日/ }).first().click()
  await expect(page.getByText('林先生').first()).toBeVisible()
  await shot(page, 'C2-4-today-list')
})

test('C3 舊客電話帶檔：姓名／徽章／過敏', async ({ page }) => {
  const customers = [{ phone: '0912345678', name: '黃太太', visits: 5, lastVisit: '2026-08-01T10:00:00.000Z', vipTier: 'gold', allergies: '蝦蟹', notes: '喜歡靠窗', blacklisted: false, archived: false, createdAt: '2026-01-01T00:00:00.000Z' },
    { phone: '0900111222', name: '黑名單客', visits: 1, lastVisit: '2026-08-01T10:00:00.000Z', vipTier: 'none', allergies: '', notes: '', blacklisted: true, blacklistReason: '多次爽約', archived: false, createdAt: '2026-01-01T00:00:00.000Z' }]
  await setup(page, { customers }); await login(page)
  await page.getByRole('button', { name: /新增/ }).click()
  await page.getByPlaceholder('0912345678').fill('0912345678')
  await expect(page.getByText('第 6 次')).toBeVisible()
  await expect(page.getByText('GOLD')).toBeVisible()
  await expect(page.getByText('過敏：蝦蟹')).toBeVisible()
  await expect(page.getByPlaceholder('王小姐')).toHaveValue('黃太太')
  const notesVal = await page.getByPlaceholder(/靠窗、慶生/).inputValue()
  console.log('C3 備註自動帶:', JSON.stringify(notesVal))
  await shot(page, 'C3-1-vip')
  await page.getByPlaceholder('0912345678').fill('0900111222')
  await page.waitForTimeout(300)
  const bl = await page.getByText(/黑名單：多次爽約/).count()
  console.log('C3 blacklist badge count', bl)
  await shot(page, 'C3-2-blacklist')
  // 送出後備註是否含過敏
  await page.getByPlaceholder('0912345678').fill('0912345678')
  await page.getByRole('button', { name: /^明天/ }).click()
  await page.getByRole('button', { name: /18:00/ }).click()
  await page.getByRole('button', { name: /確認新增/ }).click()
  await expect(page.getByText(/已建立/)).toBeVisible()
  const b = await readB(page)
  console.log('C3 saved notes', JSON.stringify(b[0].notes))
})

test('C4 線上已關時段店員可選且有標示', async ({ page }) => {
  await setup(page, { settings: { closures: { closedDates: [], closedSlots: { '2026-09-20': ['18:00'] }, closedSeatings: {} } } }); await login(page)
  await page.getByRole('button', { name: /新增/ }).click()
  await page.getByPlaceholder('0912345678').fill('0933111222'); await page.getByPlaceholder('王小姐').fill('關閉客')
  await page.getByRole('button', { name: /^明天/ }).click()
  const slot = page.getByRole('button', { name: /18:00/ })
  await expect(slot).toBeEnabled(); await expect(slot).toContainText('線上已關')
  await shot(page, 'C4-1-slots')
  await slot.click()
  await page.getByRole('button', { name: /確認新增/ }).click()
  await expect(page.getByText(/關閉客 2 位/)).toBeVisible()
})

test('C5 公休日：擋住＋原因', async ({ page }) => {
  await setup(page, { settings: { closures: { closedDates: ['2026-09-20'], closedSlots: {}, closedSeatings: {} } } }); await login(page)
  await page.getByRole('button', { name: /新增/ }).click()
  await page.getByPlaceholder('0912345678').fill('0933111222'); await page.getByPlaceholder('王小姐').fill('公休客')
  await page.getByRole('button', { name: /^明天/ }).click()
  await shot(page, 'C5-1-closed-day')
  await expect(page.getByTestId('add-day-closed')).toContainText('本日公休')
  const body = await page.locator('body').innerText()
  console.log('C5 has 公休 wording:', /公休/.test(body), '| 已關閉 count', (body.match(/已關閉/g) || []).length)
  await expect(page.getByRole('button', { name: /18:00/ })).toBeDisabled()
  // 日期 chip 本身有無標示
  console.log('C5 tomorrow chip text:', (await page.getByRole('button', { name: /^明天/ }).innerText()).replace(/\n/g, ' '))
  // 確認鈕應不可出現（沒選時段）
  console.log('C5 confirm btn count', await page.getByRole('button', { name: /確認新增/ }).count())
  console.log('C5 missing pills text', await page.getByText('還差').locator('..').innerText())
})

test('C6 15 位散客可送出', async ({ page }) => {
  await setup(page); await login(page)
  await page.getByRole('button', { name: /新增/ }).click()
  await page.getByPlaceholder('0912345678').fill('0933111222'); await page.getByPlaceholder('王小姐').fill('大桌客')
  await page.getByRole('button', { name: /^明天/ }).click()
  await page.getByRole('button', { name: /9\+/ }).click()
  const input = page.getByLabel('自訂人數')
  await input.focus(); await input.pressSequentially('15', { delay: 50 }); await input.blur()
  await expect(page.getByText(/已選：15 位/)).toBeVisible()
  await page.getByRole('button', { name: /18:00/ }).click()
  await shot(page, 'C6-1-15')
  console.log('C6 hint:', await page.getByText(/大桌建議/).count())
  await page.getByRole('button', { name: /確認新增 · .*18:00 · 15 位/ }).click()
  await expect(page.getByText(/大桌客 15 位/)).toBeVisible()
  expect((await readB(page))[0].guests).toBe(15)
})

test('C7 現場頁原地新增', async ({ page }) => {
  await setup(page, { time: '14:00', settings: { closeTime: '21:00' } }); await login(page)
  let steps = 0
  await page.locator('aside').getByRole('button', { name: '現場' }).click(); steps++
  await todayTab(page).click(); steps++
  await page.getByRole('button', { name: '＋ 新增今日訂位' }).click(); steps++
  await expect(page).toHaveURL(/tab=ops|\/admin/)
  await expect(page.getByTestId('quick-reserve-panel')).toBeVisible()
  await shot(page, 'C7-1-panel')
  const panel = page.getByTestId('quick-reserve-panel')
  console.log('C7 panel text:', (await panel.innerText()).replace(/\n+/g, ' / ').slice(0, 400))
  const has2000 = await panel.getByRole('button', { name: /20:00/ }).count()
  console.log('C7 20:00 slot count', has2000, 'url', page.url())
  // C7 修法：來源預設「現場」、電話選填
  await expect(panel.getByRole('button', { name: '來源：現場' })).toHaveAttribute('aria-pressed', 'true')
  await panel.getByRole('button', { name: '陳', exact: true }).click()
  await panel.getByRole('button', { name: /20:00/ }).click()
  await panel.getByRole('button', { name: /確認|存檔|新增/ }).last().click()
  await page.waitForTimeout(500)
  const saved = (await readB(page)).find(x => x.timeSlot === '20:00')
  expect(saved).toBeTruthy()
  expect(saved.source).toBe('walkin')
})

test('C7b 現場原地新增 20:00（closeTime 21:00）送出', async ({ page }) => {
  await setup(page, { time: '14:00', settings: { closeTime: '21:00' } }); await login(page)
  await page.locator('aside').getByRole('button', { name: '現場' }).click()
  await todayTab(page).click()
  await page.getByRole('button', { name: '＋ 新增今日訂位' }).click()
  const panel = page.getByTestId('quick-reserve-panel')
  let steps = 3
  console.log('C7b slot 20:00 count', await panel.getByRole('button', { name: /20:00/ }).count())
  await panel.getByRole('button', { name: '陳', exact: true }).click(); steps++
  await panel.getByRole('button', { name: /20:00/ }).click(); steps++
  await panel.getByLabel('電話', { exact: true }).click(); steps++
  const pad = page.getByRole('dialog', { name: '電話數字鍵盤' })
  for (const d of '0933111444') { await pad.getByRole('button', { name: d, exact: true }).click(); steps++ }
  await pad.getByRole('button', { name: 'OK' }).click(); steps++
  await shot(page, 'C7-2-filled')
  const confirm = panel.getByRole('button', { name: /確認|存檔|新增/ }).last()
  console.log('C7b confirm label', await confirm.innerText())
  await confirm.click(); steps++
  await page.waitForTimeout(500)
  await shot(page, 'C7-3-after')
  const b = await readB(page)
  console.log('C7b steps(含電話10鍵)', steps, 'saved', JSON.stringify(b.map(x => [x.name, x.timeSlot, x.date, x.assignedTableId])), 'url', page.url())
})

test('C8 日曆選日後新增：空日與有單日', async ({ page }) => {
  const bk = { id: 'E2E-C8-1', name: '舊單', phone: '0911000001', guests: 2, date: '2026-09-22', timeSlot: '12:00', status: 'confirmed', source: 'phone', assignedTableId: null, extraTableIds: [], notes: {}, createdBy: 'staff' }
  await setup(page, { bookings: [bk] }); await login(page)
  await page.getByRole('button', { name: /日曆/ }).click()
  await shot(page, 'C8-1-calendar')
  // 非空日 22
  await page.getByRole('button').filter({ has: page.getByText('22', { exact: true }) }).filter({ hasText: '組' }).first().click()
  await expect(page.getByTestId('day-seating')).toBeVisible()
  console.log('C8 non-empty day: 新增訂位 button count', await page.getByRole('button', { name: /新增訂位/ }).count())
  // C8 修法：有訂位的日子排位畫面也有「新增訂位」，預填該日
  await expect(page.getByTestId('day-seating-add')).toBeVisible()
  await shot(page, 'C8-2-nonempty-day')
  await page.getByRole('button', { name: '月曆', exact: true }).click()
  // 空日 24
  await page.getByRole('button').filter({ has: page.getByText('24', { exact: true }) }).first().click()
  await shot(page, 'C8-3-empty-day')
  console.log('C8 empty day: 新增訂位 count', await page.getByRole('button', { name: /新增訂位/ }).count())
  await page.getByRole('button', { name: /新增訂位/ }).first().click()
  await shot(page, 'C8-4-add-prefilled')
  const label = await page.getByText(/時段（/).first().innerText()
  console.log('C8 slot label', label)
  await page.getByPlaceholder('0912345678').fill('0933111222'); await page.getByPlaceholder('王小姐').fill('日曆客')
  await page.getByRole('button', { name: /18:00/ }).click()
  await page.getByRole('button', { name: /確認新增 · .*18:00/ }).click()
  await expect(page.getByText(/日曆客 2 位 · 2026-09-24/)).toBeVisible()
  await shot(page, 'C8-5-after-submit')
  console.log('C8 after submit: add form still visible?', await page.getByPlaceholder('0912345678').isVisible(), 'url', page.url())
  expect((await readB(page)).find(b => b.name === '日曆客').date).toBe('2026-09-24')
})

test('C5b 公休日文字出處', async ({ page }) => {
  await setup(page, { settings: { closures: { closedDates: ['2026-09-20'], closedSlots: {}, closedSeatings: {} } } }); await login(page)
  await page.getByRole('button', { name: /新增/ }).click()
  await page.getByRole('button', { name: /^明天/ }).click()
  await page.waitForTimeout(800)
  const hits = await page.locator('body *:not(script):not(style)').evaluateAll(els => els.filter(e => e.children.length === 0 && /公休/.test(e.textContent)).map(e => e.tagName + ':' + e.textContent.trim().slice(0, 60)))
  console.log('C5b 公休 text nodes:', JSON.stringify(hits))
  await shot(page, 'C5-2-settled')
})
