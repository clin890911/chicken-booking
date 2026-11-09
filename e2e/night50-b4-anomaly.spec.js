import { test, expect } from '@playwright/test'
import { FIREBASE_STUB } from './helpers/firebaseStub.js'
import { todayTab } from './helpers/opsToday'

// night-50 批 4：異常 H1–H6、H8 實走（QA，不改 src）。
test.use({ timezoneId: 'Asia/Taipei' })

const TODAY = '2026-11-10'
const YDAY = '2026-11-09'
const at = (d, hhmm) => new Date(`${d}T${hhmm}:00+08:00`)
const mkTables = (specs) => specs.map((s, i) => {
  const [number, over = {}] = Array.isArray(s) ? s : [s, {}]
  return { number, capacity: 4, floor: '1F', x: 100 + i * 120, y: 400, w: 80, h: 75, rotation: 0, zoneId: null,
    isActive: true, outage: null, status: 'vacant', currentBookingId: null, currentRef: null, seatedAt: null, ...over }
})
const mkBooking = (over = {}) => ({ id: 'BK-H', name: '林先生', phone: '0911000003', guests: 3, date: TODAY, timeSlot: '11:00',
  status: 'confirmed', source: 'phone', assignedTableId: null, extraTableIds: [], notes: {}, createdBy: 'staff', ...over })

async function seed(page, { tables, bookings = [], groups = [], settings = null }) {
  await page.addInitScript(({ tables, bookings, groups, settings }) => {
    if (sessionStorage.getItem('e2e-seeded')) return
    sessionStorage.setItem('e2e-seeded', '1')
    if (tables) localStorage.setItem('chicken_tables_v3', JSON.stringify(tables))
    localStorage.setItem('chicken_bookings_v1', JSON.stringify(bookings))
    localStorage.setItem('chicken_group_reservations_v1', JSON.stringify(groups))
    localStorage.setItem('chicken_group_blank_purge_v1', '1')
    localStorage.removeItem('chicken_waitlist_v1')
    localStorage.removeItem('chicken_noshow_v1')
    if (settings) localStorage.setItem('chicken_settings_v1', JSON.stringify(settings))
  }, { tables, bookings, groups, settings })
}
const readState = (page) => page.evaluate(() => ({
  bookings: JSON.parse(localStorage.getItem('chicken_bookings_v1') || '[]'),
  tables: JSON.parse(localStorage.getItem('chicken_tables_v3') || '[]'),
  noshow: JSON.parse(localStorage.getItem('chicken_noshow_v1') || '{}'),
}))
const tableOf = (s, n) => s.tables.find(t => String(t.number) === String(n))
const mapTable = (page, n) => page.getByRole('button', { name: new RegExp(`^${n}桌`) })

async function localLogin(page) {
  await page.goto('/login')
  await page.getByPlaceholder('your@email.com').fill('berrylin0911@gmail.com')
  await page.getByRole('button', { name: /模擬登入/ }).click()
  await expect(page).toHaveURL(/\/admin/)
  const aside = page.locator('aside').getByRole('button', { name: '現場' })
  if (await aside.isVisible().catch(() => false)) await aside.click()
  else await page.locator('nav').getByRole('button', { name: /現場/ }).first().click()
}
async function localRoutes(page) {
  await page.route(url => url.hostname !== 'localhost' && url.hostname !== '127.0.0.1', route => {
    const u = route.request().url()
    const body = u.includes('adminPullData') ? { ok: false, error: 'e2e-offline' } : u.includes('adminPushData') ? { ok: true } : { ok: false }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  })
}

// ───────────── H1／H2：Firebase stub（pull/push 真的送出）─────────────
// 雲端狀態由測試自己維護：push 成功就把送來的文件併進 server，pull 回 server 全量。
function cloudServer(page, { role = 'manager', pushMode }) {
  const server = { tables: [], bookings: [], waitlist: [], customers: [], agencies: [], guides: [], groupReservations: [] }
  const log = { pulls: 0, pushes: [], pushOk: 0, pushFail: 0, pushRejected: 0 }
  const keyOf = { bookings: 'id', tables: 'number', waitlist: 'id', customers: 'phone', agencies: 'id', guides: 'id', groupReservations: 'id' }
  return {
    server, log,
    async install(seedTables) {
      server.tables = seedTables.map(t => ({ ...t }))
      await page.route('**/src/services/firebase.js*', r => r.fulfill({ contentType: 'application/javascript', body: FIREBASE_STUB }))
      await page.route(url => url.hostname !== 'localhost' && url.hostname !== '127.0.0.1', async route => {
        const u = route.request().url()
        const json = (b) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) })
        if (u.includes('staffWhoAmI')) return json({ ok: true, role, email: 'berrylin0911@gmail.com' })
        if (u.includes('adminPullData')) { log.pulls += 1; return json({ ok: true, ...JSON.parse(JSON.stringify(server)) }) }
        if (u.includes('adminPushData')) {
          const body = JSON.parse(route.request().postData() || '{}')
          const mode = pushMode(log)
          log.pushes.push({ at: Date.now(), mode, cols: Object.keys(body.dataset || {}) })
          if (mode === 'abort') { log.pushFail += 1; return route.abort('internetdisconnected') }
          const ds = body.dataset || {}
          const rejectedCols = mode === 'reject' ? ['bookings'] : []
          for (const col of Object.keys(keyOf)) {
            if (!Array.isArray(ds[col]) || rejectedCols.includes(col)) continue
            for (const doc of ds[col]) {
              const k = keyOf[col]; const i = server[col].findIndex(d => d[k] === doc[k])
              if (i >= 0) server[col][i] = doc; else server[col].push(doc)
            }
          }
          if (mode === 'reject') { log.pushRejected += 1; return json({ ok: true, rejected: { writes: ['bookings'], deletes: [], settings: false }, rejectedMessage: '此帳號無權寫入「訂位」' }) }
          log.pushOk += 1
          return json({ ok: true })
        }
        return json({ ok: false })
      })
    },
  }
}

async function walkInSeat(page, tableNo) {
  await page.getByRole('button', { name: '4 位', exact: true }).click()
  await mapTable(page, tableNo).click()
  await expect(page.getByRole('button', { name: `移除桌 ${tableNo}` })).toBeVisible()
  await page.getByTestId('walkin-seat').click()
}

test('H1 網路斷線時帶位：本機先成功、回線自動補推、不丟', async ({ page, context }) => {
  test.setTimeout(120_000)
  const tables = mkTables(['105', '106'])
  let offline = false
  const cs = cloudServer(page, { pushMode: () => (offline ? 'abort' : 'ok') })
  await cs.install(tables)
  await seed(page, { tables })
  await page.clock.install({ time: at(TODAY, '12:00') })
  await page.goto('/admin')
  await page.locator('aside').getByRole('button', { name: '現場' }).click()
  await expect.poll(() => cs.log.pulls, { timeout: 20_000 }).toBeGreaterThan(0)
  // 斷線（瀏覽器層級 offline：navigator.onLine=false、所有請求失敗）
  offline = true
  await context.setOffline(true)
  await page.clock.runFor(1000)
  await walkInSeat(page, '105')
  await expect.poll(async () => tableOf(await readState(page), '105').status).toBe('dining')
  const seatedBooking = (await readState(page)).bookings.find(b => b.status === 'arrived')
  expect(seatedBooking).toBeTruthy()
  // 斷線期間時間往前推 40 秒（多輪拉取／補推退避）
  for (let i = 0; i < 8; i++) { await page.clock.runFor(5000); await page.waitForTimeout(150) }
  const toastOffline = await page.getByText(/雲端同步失敗|離線|未同步/).count()
  await page.screenshot({ path: test.info().outputPath(`H1-offline.png`), fullPage: true })
  console.log('H1 offline: pushes', cs.log.pushes.length, 'fail', cs.log.pushFail, 'visible offline hints', toastOffline)
  // 回線
  offline = false
  await context.setOffline(false)
  for (let i = 0; i < 20 && !cs.server.bookings.some(b => b.id === seatedBooking.id); i++) { await page.clock.runFor(5000); await page.waitForTimeout(200) }
  console.log('H1 online: pushes', cs.log.pushes.length, 'ok', cs.log.pushOk, 'server has booking', cs.server.bookings.some(b => b.id === seatedBooking.id),
    'server 105', JSON.stringify(cs.server.tables.find(t => t.number === '105')?.status))
  expect(cs.server.bookings.some(b => b.id === seatedBooking.id)).toBe(true)
  expect(cs.server.tables.find(t => t.number === '105').status).toBe('dining')
  // 再拉一輪：本機不被雲端洗掉
  await page.clock.runFor(6000); await page.waitForTimeout(300)
  expect(tableOf(await readState(page), '105').status).toBe('dining')
  await page.screenshot({ path: test.info().outputPath(`H1-online.png`), fullPage: true })
})

test('H2 推送被拒（部分）：警示是否在 5 秒拉取後仍在、現場頁有無常駐提示（真實時間）', async ({ page }) => {
  test.setTimeout(120_000)
  // 註：berrylin 在建置期白名單＝店長，staffWhoAmI 不會被問；這裡直接讓 adminPushData 回 partial rejected（形狀同後端 functions/index.js:483）。
  const tables = mkTables(['105', '106'])
  const cs = cloudServer(page, { pushMode: () => 'reject' })
  await cs.install(tables)
  await seed(page, { tables })
  await page.goto('/admin')
  await page.locator('aside').getByRole('button', { name: '現場' }).click()
  await expect.poll(() => cs.log.pulls, { timeout: 20_000 }).toBeGreaterThan(0)
  await walkInSeat(page, '105')
  await expect.poll(() => cs.log.pushRejected, { timeout: 15_000 }).toBeGreaterThan(0)
  const t0 = Date.now()
  const toast = page.getByText(/部分變更未能上雲/)
  await expect(toast.first()).toBeVisible({ timeout: 5000 })
  await page.screenshot({ path: test.info().outputPath(`H2-toast.png`), fullPage: true })
  // 等 toast 自然消失，量存活秒數
  await expect(toast).toHaveCount(0, { timeout: 30_000 })
  const toastLife = Math.round((Date.now() - t0) / 1000)
  const pullsBefore = cs.log.pulls
  await page.waitForTimeout(11_000) // 至少再兩輪 5 秒拉取
  const onOps = await page.getByText(/未能上雲|未同步|同步失敗|被拒/).count()
  await page.screenshot({ path: test.info().outputPath(`H2-ops-after-toast.png`), fullPage: true })
  console.log('H2 toast life ~s', toastLife, 'pulls during wait', cs.log.pulls - pullsBefore, 'ops page persistent hint count:', onOps, 'rejected pushes', cs.log.pushRejected)
  // 設定頁
  await page.locator('aside').getByRole('button', { name: '設定' }).click()
  const banner = page.getByText(/部分變更未能上雲：/)
  await expect(banner.first()).toBeVisible({ timeout: 5000 })
  const discard = await page.getByRole('button', { name: /放棄/ }).count()
  await page.screenshot({ path: test.info().outputPath(`H2-settings.png`), fullPage: true })
  console.log('H2 settings banner visible; discard buttons', discard)
  expect(tableOf(await readState(page), '105').status).toBe('dining')
  expect(cs.server.bookings.length).toBe(0)
})

// ───────────── H3–H6、H8：本機模式 ─────────────

test.describe('本機模式', () => {
  test.beforeEach(async ({ page }) => { await localRoutes(page); page.on('dialog', d => d.accept()) })

  for (const autoNoshow of [false, true]) {
    test(`H3 換日掃除（autoNoshowOnRollover=${autoNoshow}）：昨日殘留桌釋出、未到是否標 No-show、不計罰`, async ({ page }) => {
      await page.clock.setFixedTime(at(TODAY, '10:00'))
      const yNo = mkBooking({ id: 'BK-Y-NO', date: YDAY, timeSlot: '18:00', assignedTableId: '105' })
      const yAte = mkBooking({ id: 'BK-Y-ATE', name: '王小姐', phone: '0911000004', date: YDAY, timeSlot: '17:30', status: 'arrived', assignedTableId: '106' })
      await seed(page, {
        tables: mkTables([['105', { status: 'reserved', currentBookingId: 'BK-Y-NO' }], ['106', { status: 'dining', currentBookingId: 'BK-Y-ATE', seatedAt: at(YDAY, '17:30').toISOString() }], '107']),
        bookings: [yNo, yAte], settings: autoNoshow ? { autoNoshowOnRollover: true } : null,
      })
      await localLogin(page)
      await expect.poll(async () => tableOf(await readState(page), '105').status, { timeout: 25_000 }).toBe('vacant')
      const s = await readState(page)
      const no = s.bookings.find(b => b.id === 'BK-Y-NO'); const ate = s.bookings.find(b => b.id === 'BK-Y-ATE')
      console.log(`H3[auto=${autoNoshow}] 105`, tableOf(s, '105').status, '106', tableOf(s, '106').status, 'yNo', no.status, no.autoFlag, 'yAte', ate.status, 'noshowStore', JSON.stringify(s.noshow))
      await page.screenshot({ path: test.info().outputPath(`H3-auto${autoNoshow}.png`), fullPage: true })
      expect(tableOf(s, '106').status).toBe('vacant')
      expect(ate.status).toBe('completed')
      expect(Object.keys(s.noshow).length).toBe(0)
      if (autoNoshow) expect(no.status).toBe('noshow')
    })
  }

  const overdueSeed = (page) => seed(page, {
    tables: mkTables([['105', { status: 'reserved', currentBookingId: 'BK-H' }], '106', '107']),
    bookings: [mkBooking({ assignedTableId: '105' })],
  })
  async function openMore(page) {
    await todayTab(page).click()
    await page.getByLabel('林先生 更多操作').click()
  }

  test('H4 過時未到補登「來過、已吃完」→ 桌釋成空桌、不扣信用 → 復原', async ({ page }) => {
    await page.clock.setFixedTime(at(TODAY, '12:40'))
    await overdueSeed(page)
    await localLogin(page)
    await openMore(page)
    await page.screenshot({ path: test.info().outputPath(`H4-menu.png`), fullPage: true })
    await page.getByRole('button', { name: '補登：來過、已吃完' }).click()
    await expect.poll(async () => (await readState(page)).bookings[0].status).toBe('completed')
    let s = await readState(page)
    expect(tableOf(s, '105').status).toBe('vacant')
    expect(Object.keys(s.noshow).length).toBe(0)
    await page.getByRole('button', { name: /復原/ }).first().click()
    await expect.poll(async () => (await readState(page)).bookings[0].status).toBe('confirmed')
    s = await readState(page)
    console.log('H4 after undo 105', tableOf(s, '105').status, tableOf(s, '105').currentBookingId, 'assigned', s.bookings[0].assignedTableId)
    expect(tableOf(s, '105')).toMatchObject({ status: 'reserved', currentBookingId: 'BK-H' })
  })

  test('H5 手動標 No-show 又按錯 → 復原：罰則撤回、桌倒回', async ({ page }) => {
    await page.clock.setFixedTime(at(TODAY, '12:40'))
    await overdueSeed(page)
    await localLogin(page)
    await openMore(page)
    await page.getByRole('button', { name: '沒來：標 No-show' }).click()
    await page.getByRole('button', { name: '確認標記', exact: true }).click()
    await expect.poll(async () => (await readState(page)).bookings[0].status).toBe('noshow')
    let s = await readState(page)
    console.log('H5 after noshow store', JSON.stringify(s.noshow), '105', tableOf(s, '105').status)
    await page.screenshot({ path: test.info().outputPath(`H5-noshow-toast.png`), fullPage: true })
    expect(JSON.stringify(s.noshow)).toContain('0911000003')
    await page.getByRole('button', { name: /復原/ }).first().click()
    await expect.poll(async () => (await readState(page)).bookings[0].status).toBe('confirmed')
    s = await readState(page)
    console.log('H5 after undo store', JSON.stringify(s.noshow), '105', tableOf(s, '105').status)
    const cnt = await page.evaluate(async () => (await import('/src/services/bookingService.js')).getNoshowCount?.('0911000003'))
    console.log('H5 getNoshowCount after undo', cnt)
    expect(cnt ?? 0).toBe(0)
    expect(tableOf(s, '105')).toMatchObject({ status: 'reserved', currentBookingId: 'BK-H' })
  })

  test('H6 取消訂位又復原：桌一起倒回', async ({ page }) => {
    await page.clock.setFixedTime(at(TODAY, '10:30'))
    await overdueSeed(page)
    await localLogin(page)
    await openMore(page)
    await page.getByRole('button', { name: '取消訂位' }).first().click()
    await page.getByRole('button', { name: '取消訂位' }).last().click()
    await expect.poll(async () => (await readState(page)).bookings[0].status).toBe('cancelled')
    expect(tableOf(await readState(page), '105').status).toBe('vacant')
    await page.screenshot({ path: test.info().outputPath(`H6-cancel-toast.png`), fullPage: true })
    // H6：取消的復原鈕帶對象（復原取消），與入座的「復原入座 105」分得清
    await expect(page.getByTestId('toast-action').filter({ hasText: '復原取消' })).toBeVisible()
    await page.getByRole('button', { name: /復原取消/ }).click()
    await expect.poll(async () => (await readState(page)).bookings[0].status).toBe('confirmed')
    const s = await readState(page)
    expect(tableOf(s, '105')).toMatchObject({ status: 'reserved', currentBookingId: 'BK-H' })
    expect(s.bookings[0].assignedTableId).toBe('105')
  })

  test('H6b 取消後桌被別組佔走再復原：安全失敗、不搶桌', async ({ page }) => {
    await page.clock.setFixedTime(at(TODAY, '10:30'))
    await overdueSeed(page)
    await localLogin(page)
    await openMore(page)
    await page.getByRole('button', { name: '取消訂位' }).first().click()
    await page.getByRole('button', { name: '取消訂位' }).last().click()
    await expect.poll(async () => (await readState(page)).bookings[0].status).toBe('cancelled')
    await page.screenshot({ path: test.info().outputPath(`H6b-cancel-toast.png`), fullPage: true })
    // 另一台平板在這幾秒把 105 帶給散客（直接寫本機資料模擬別台同步進來）
    await page.evaluate(() => {
      const ts = JSON.parse(localStorage.getItem('chicken_tables_v3'))
      const t = ts.find(x => x.number === '105'); Object.assign(t, { status: 'dining', currentBookingId: 'BK-OTHER', seatedAt: new Date().toISOString() })
      localStorage.setItem('chicken_tables_v3', JSON.stringify(ts))
      const bs = JSON.parse(localStorage.getItem('chicken_bookings_v1'))
      bs.push({ id: 'BK-OTHER', name: '散客', phone: '', guests: 2, date: '2026-11-10', timeSlot: '10:30', status: 'arrived', source: 'walkin', assignedTableId: '105', extraTableIds: [], notes: {} })
      localStorage.setItem('chicken_bookings_v1', JSON.stringify(bs))
    })
    await page.getByRole('button', { name: /復原/ }).first().click()
    await page.waitForTimeout(500)
    const s = await readState(page)
    const msg = await page.getByText(/已被占用|復原失敗|已復原 林先生/).allTextContents()
    console.log('H6b booking', s.bookings.find(b => b.id === 'BK-H').status, 'assigned', s.bookings.find(b => b.id === 'BK-H').assignedTableId, '105', tableOf(s, '105').status, tableOf(s, '105').currentBookingId, 'msg', JSON.stringify(msg))
    await page.screenshot({ path: test.info().outputPath(`H6b-after-undo.png`), fullPage: true })
    expect(tableOf(s, '105').currentBookingId).not.toBe('BK-H')
    expect(tableOf(s, '105').status).toBe('dining')
  })
})

test.describe('H8 iPad 直向 768×1024', () => {
  test.use({ viewport: { width: 768, height: 1024 }, hasTouch: true })
  test.beforeEach(async ({ page }) => { await localRoutes(page); page.on('dialog', d => d.accept()) })

  test('H8 一面式：body 不可捲；A1 散客帶位、B1 報到一下入座都不用捲', async ({ page }) => {
    await page.clock.setFixedTime(at(TODAY, '11:55'))
    await seed(page, {
      tables: mkTables(['105', '106', '107', ['108', { status: 'reserved', currentBookingId: 'BK-H' }]]),
      bookings: [mkBooking({ timeSlot: '12:00', assignedTableId: '108' })],
    })
    await localLogin(page)
    await page.waitForTimeout(500)
    const m = await page.evaluate(() => {
      const se = document.scrollingElement
      const c = document.querySelector('[data-testid=admin-content]')
      return { doc: se.scrollHeight - se.clientHeight, body: document.body.scrollHeight - document.body.clientHeight,
        content: c ? c.scrollHeight - c.clientHeight : null, contentOverflowY: c ? getComputedStyle(c).overflowY : null }
    })
    console.log('H8 overflow', JSON.stringify(m))
    await page.screenshot({ path: test.info().outputPath(`H8-ops-portrait.png`) })
    expect(m.doc).toBeLessThanOrEqual(0)
    // B1：報到列「到了」
    const arrive = page.getByRole('button', { name: /到了/ }).first()
    await expect(arrive).toBeInViewport()
    // A1：帶位籤 → 4 位 → 點桌 → 確認入座
    await page.getByRole('button', { name: /^帶位/ }).first().click().catch(() => {})
    await page.getByRole('button', { name: '4 位', exact: true }).click()
    await mapTable(page, '105').click()
    const seat = page.getByTestId('walkin-seat')
    await expect(seat).toBeInViewport()
    await page.screenshot({ path: test.info().outputPath(`H8-walkin-ready.png`) })
    await seat.click()
    await expect.poll(async () => tableOf(await readState(page), '105').status).toBe('dining')
    const m2 = await page.evaluate(() => document.scrollingElement.scrollHeight - document.scrollingElement.clientHeight)
    expect(m2).toBeLessThanOrEqual(0)
  })
})

// ───────────── P3：同步失敗／離線的常駐警示小條 ─────────────
test.describe('P3 常駐同步警示小條', () => {
  test('P3-a 推送被拒：toast 消失後小條仍在（含筆數）、點「查看」到設定頁同步區', async ({ page }) => {
    test.setTimeout(120_000)
    const tables = mkTables(['105', '106'])
    const cs = cloudServer(page, { pushMode: () => 'reject' })
    await cs.install(tables)
    await seed(page, { tables })
    await page.goto('/admin')
    await page.locator('aside').getByRole('button', { name: '現場' }).click()
    await expect.poll(() => cs.log.pulls, { timeout: 20_000 }).toBeGreaterThan(0)
    await walkInSeat(page, '105')
    const bar = page.getByTestId('sync-alert-rejected')
    await expect(bar).toBeVisible({ timeout: 15_000 })
    await expect(bar).toContainText(/有 \d+ 筆變更雲端拒收/)
    const pulls0 = cs.log.pulls
    await page.waitForTimeout(12_000) // 跨兩輪拉取
    expect(cs.log.pulls).toBeGreaterThan(pulls0)
    await expect(bar).toBeVisible()
    expect((await bar.boundingBox()).height).toBeLessThanOrEqual(44)
    // 「查看」撐滿條高（扣 1px 上下框＝42），不再是 28px 小鈕
    expect((await bar.getByRole('button', { name: '查看' }).boundingBox()).height).toBeGreaterThanOrEqual(42)
    await bar.getByRole('button', { name: '查看' }).click()
    await expect(page).toHaveURL(/tab=settings/)
    await expect(page).toHaveURL(/block=firestore/)
    await expect(page.getByText(/部分變更未能上雲：/).first()).toBeVisible({ timeout: 5000 })
  })

  test('P3-b 離線：小條顯示離線文案，恢復後消失', async ({ page }) => {
    test.setTimeout(120_000)
    const tables = mkTables(['105', '106'])
    let offline = false
    const cs = cloudServer(page, { pushMode: () => (offline ? 'abort' : 'ok') })
    await cs.install(tables)
    await seed(page, { tables })
    await page.goto('/admin')
    await page.locator('aside').getByRole('button', { name: '現場' }).click()
    await expect.poll(() => cs.log.pulls, { timeout: 20_000 }).toBeGreaterThan(0)
    offline = true
    await walkInSeat(page, '105')
    await expect(page.getByTestId('sync-alert-offline')).toContainText('離線中，變更會在連線後補推', { timeout: 60_000 })
    offline = false
    await expect(page.getByTestId('sync-alert-offline')).toHaveCount(0, { timeout: 90_000 })
  })

  test.describe('iPad 直向', () => {
    test.use({ viewport: { width: 768, height: 1024 }, hasTouch: true })
    test('P3-c 加了小條後現場頁 body 仍不可捲', async ({ page }) => {
      test.setTimeout(120_000)
      const tables = mkTables(['105', '106'])
      const cs = cloudServer(page, { pushMode: () => 'reject' })
      await cs.install(tables)
      await seed(page, { tables })
      await page.goto('/admin')
      await page.locator('nav').getByRole('button', { name: /現場/ }).first().click().catch(() => {})
      await expect.poll(() => cs.log.pulls, { timeout: 20_000 }).toBeGreaterThan(0)
      await walkInSeat(page, '105')
      await expect(page.getByTestId('sync-alert-rejected')).toBeVisible({ timeout: 15_000 })
      const m = await page.evaluate(() => document.scrollingElement.scrollHeight - document.scrollingElement.clientHeight)
      expect(m).toBeLessThanOrEqual(0)
    })
  })
})
