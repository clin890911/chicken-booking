import { test, expect } from '@playwright/test'
import { INITIAL_TABLES } from '../src/data/tables.js'

// 管理端指派主線：同仁登入 → 後台今日列表看到訂位 → 指派桌位（A6 人工選桌確認）→ 指派成功。
// 後台在「本機開發模式」(無 Firebase) 以 localStorage 為後端；攔截 admin* 雲端端點，
// 避免雲端 pull 覆蓋種子資料、也不碰正式後端。
// 鎖桌時機（「接近時段才鎖」：離用餐 30 分內指派才鎖桌，更早只預配）會讓確認句／toast 隨時刻不同，
// 故一律用 page.clock 固定時間、時區固定 Asia/Taipei，兩種語意各自 deterministic。

test.use({ timezoneId: 'Asia/Taipei' })

const TODAY = '2026-09-19'
const at = (hhmm) => new Date(`${TODAY}T${hhmm}:00+08:00`)

const BOOKING = {
  id: 'E2E-ADM-1',
  name: '王大明',
  phone: '0912000111',
  guests: 4,
  date: TODAY,
  timeSlot: '18:00',
  source: 'online',
  status: 'confirmed',
  assignedTableId: null,
  notes: {},
  manageToken: 't-e2e',
  createdBy: 'guest',
}

test.beforeEach(async ({ page }) => {
  // 未被下方 mock 覆蓋的 HTTPS 一律阻擋，測試不得連正式資料或通知。
  await page.route('https://**/*', route => route.abort())
  // 預設 17:40：離 18:00 的種子訂位 20 分 → 指派即鎖桌（各條可再覆寫）
  await page.clock.setFixedTime(at('17:40'))
  // 攔截雲端端點：pull 回 ok:false（會被 catch、保留本機種子資料）、push 回 ok:true（no-op）
  await page.route('**/adminPullData', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'e2e-offline' }) }))
  await page.route('**/adminPushData', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }))
  await page.route('**/admin*', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false }) }))

  // 在每次頁面載入前種入一筆今日確認訂位（app 掛載時即可從 localStorage 讀到）
  await page.addInitScript(b => {
    localStorage.setItem('chicken_bookings_v1', JSON.stringify([b]))
  }, BOOKING)
})

test('管理端：登入 → 指派桌位（人工選桌確認）→ 指派成功（17:40 指派 18:00＝鎖桌）', async ({ page }) => {
  // 1) 同仁登入（開發模式 email 表單）
  await page.goto('/login')
  await page.getByPlaceholder('your@email.com').fill('berrylin0911@gmail.com')
  await page.getByRole('button', { name: /模擬登入/ }).click()
  await expect(page).toHaveURL(/\/admin/)

  // 2) 今日列表應顯示種子訂位
  await expect(page.getByText('王大明').first()).toBeVisible()

  // 3) 點「指派桌位」→ 切到桌位頁進入指派模式
  await page.getByRole('button', { name: '指派桌位' }).click()
  await expect(page.getByText(/指派桌位：王大明\s*4\s*位/)).toBeVisible()

  // 4) 讀出系統建議桌號（💡 建議 N）
  const suggestChip = page.getByText(/^建議\s*\d+/)
  await expect(suggestChip).toBeVisible()
  const chipText = await suggestChip.textContent()
  const tableNo = (chipText.match(/\d+/) || [])[0]
  expect(tableNo).toBeTruthy()

  // 5) 點該桌（SVG 內 <g> 含桌號文字）→ 進入待確認預覽（A6 二步）
  await page.locator(`svg g:has(:text-is("${tableNo}"))`).first().click()
  await expect(page.getByText(`已選：${tableNo}`)).toBeVisible()

  // 6) 按「✓ 確認指派」→ 指派成功（成功 toast）
  await page.getByRole('button', { name: /確認指派/ }).click()
  await expect(page.getByText(new RegExp(`指派至 ${tableNo}.*可指派下一組`))).toBeVisible()
  const tables = await page.evaluate(() => JSON.parse(localStorage.getItem('chicken_tables_v3') || '[]'))
  expect(tables.find(t => t.number === tableNo).status).toBe('reserved')
})

test('管理端：09:00 指派 18:00 的訂位 → 只預配（確認句／toast 講預配，桌況仍空）', async ({ page }) => {
  await page.clock.setFixedTime(at('09:00'))
  await page.goto('/login')
  await page.getByPlaceholder('your@email.com').fill('berrylin0911@gmail.com')
  await page.getByRole('button', { name: /模擬登入/ }).click()
  await expect(page).toHaveURL(/\/admin/)

  await page.getByRole('button', { name: '指派桌位' }).click()
  await expect(page.getByText(/指派桌位：王大明\s*4\s*位/)).toBeVisible()
  await expect(page.getByText('預配 · 桌子先不鎖')).toBeVisible()
  const chipText = await page.getByText(/^建議\s*\d+/).textContent()
  const tableNo = (chipText.match(/\d+/) || [])[0]

  await page.locator(`svg g:has(:text-is("${tableNo}"))`).first().click()
  await expect(page.getByText(`已選：${tableNo}`)).toBeVisible()
  await expect(page.getByText(/確認指派 王大明/)).toHaveCount(0)
  await page.getByRole('button', { name: '✓ 確認預配' }).click()
  await expect(page.getByText(new RegExp(`王大明（4 位）已預配 ${tableNo}（桌子現在仍可帶位）`))).toBeVisible()

  const state = await page.evaluate(() => ({
    bookings: JSON.parse(localStorage.getItem('chicken_bookings_v1') || '[]'),
    tables: JSON.parse(localStorage.getItem('chicken_tables_v3') || '[]'),
  }))
  expect(state.bookings.find(b => b.id === 'E2E-ADM-1').assignedTableId).toBe(tableNo)
  expect(state.tables.find(t => t.number === tableNo).status).toBe('vacant')
})

// 大組多桌指派（2026-06-12）：散客訂位人數超過任何單桌容量（最大 6 人桌）時，
// 指派桌不再卡死，改進「併桌」模式——累加選多張同層空桌湊滿席數後一鍵指派。
test('管理端：12 人訂位無單桌可容 → 併桌指派（選多張桌）成功', async ({ page }) => {
  // 只種一筆 12 人訂位（覆蓋 beforeEach 的 4 人種子，避免列表有多個「指派桌位」鈕）
  await page.addInitScript(b => {
    localStorage.setItem('chicken_bookings_v1', JSON.stringify([{
      ...b, id: 'E2E-BIG-1', name: '李大團', phone: '0922333444', guests: 12, assignedTableId: null,
    }]))
  }, BOOKING)

  await page.goto('/login')
  await page.getByPlaceholder('your@email.com').fill('berrylin0911@gmail.com')
  await page.getByRole('button', { name: /模擬登入/ }).click()
  await expect(page).toHaveURL(/\/admin/)
  await expect(page.getByText('李大團').first()).toBeVisible()

  // 點「指派桌位」→ 無單桌容納 12 人 → 進入「併桌」指派模式
  await page.getByRole('button', { name: '指派桌位' }).click()
  await expect(page.getByText(/指派桌位：李大團\s*12\s*位/)).toBeVisible()

  // 不自動勾推薦：店員選兩张六人桌，席數湊滿才可確認。
  await expect(page.getByText(/已選 0\/12 席/)).toBeVisible()
  await page.locator('svg g:has(:text-is("101"))').first().click()
  await page.locator('svg g:has(:text-is("103"))').first().click()
  const confirmBtn = page.getByRole('button', { name: /確認併桌指派/ })
  await expect(confirmBtn).toBeEnabled()

  // 確認 → 併桌指派成功
  await confirmBtn.click()
  await expect(page.getByText(/併桌指派至.*可指派下一組/)).toBeVisible()
})

// 預配標記（2026-06-12）：預先配桌只記在訂位上、不動桌況（桌況資料仍是 vacant）——
// 地圖須顯示「📌 時段 預配」視覺線索，否則店員要到帶位確認那步才被警告撞桌。
// 2026-08 更新：預配桌的填色由綠改為訂位藍＋虛線框（桌況資料仍不動），故這裡驗的是
// 「標籤取代可入座字樣」與「其他空桌不受影響」，不再宣稱預配桌本身是可入座色。
test('管理端：今日預配的空桌顯示「📌 時段 預配」標籤、其他空桌不受影響', async ({ page }) => {
  await page.addInitScript(b => {
    localStorage.setItem('chicken_bookings_v1', JSON.stringify([b, {
      ...b,
      id: 'E2E-PRE-1',
      name: '鄭年亨',
      phone: '0939350329',
      timeSlot: '18:00',
      assignedTableId: '113',   // 預配：只寫 booking、桌況不動
    }]))
  }, BOOKING)

  await page.goto('/login')
  await page.getByPlaceholder('your@email.com').fill('berrylin0911@gmail.com')
  await page.getByRole('button', { name: /模擬登入/ }).click()
  await expect(page).toHaveURL(/\/admin/)
  await page.locator('aside').getByRole('button', { name: '現場' }).click()

  // 113 顯示預配標籤（取代「✓ 可入座」），其他空桌不受影響
  await expect(page.getByText('18:00 預配')).toBeVisible()
  await expect(page.locator('svg g:has(:text-is("112"))').getByText('✓ 可入座')).toBeVisible()
})

for (const { label, original, selected } of [
  {label:'多桌改多桌4+4',original:['101','107'],selected:['105','106']},
  {label:'多桌改單桌8',original:['101','107'],selected:['113']},
  {label:'單桌改多桌6+4',original:['113'],selected:['108','105']},
]) test(`未到訂位：${label}，取消保留原桌、確認後才替換`, async ({page}) => {
  const booking={...BOOKING,guests:8,assignedTableId:original[0],extraTableIds:original.slice(1)}
  const tables=INITIAL_TABLES.map(t=>({...t,capacity:t.number==='113'?8:t.capacity,...(original.includes(t.number)?{status:'reserved',currentBookingId:booking.id}:{})}))
  await page.addInitScript(({booking,tables})=>{
    localStorage.setItem('chicken_bookings_v1',JSON.stringify([booking]))
    localStorage.setItem('chicken_tables_v3',JSON.stringify(tables))
  },{booking,tables})
  await page.goto('/login')
  await page.getByPlaceholder('your@email.com').fill('berrylin0911@gmail.com')
  await page.getByRole('button',{name:/模擬登入/}).click()
  await page.getByRole('button',{name:'↔ 改桌',exact:true}).click()
  await expect(page.getByText(`原配桌 ${original.join(' + ')} · 確認成功前保留`)).toBeVisible()
  await expect(page.getByText(/已選 0\/8 席/)).toBeVisible()
  for(const n of selected) await page.locator(`svg g:has(:text-is("${n}"))`).first().click()
  await page.getByRole('button',{name:'取消',exact:true}).click()
  const read=()=>page.evaluate(()=>({booking:JSON.parse(localStorage.getItem('chicken_bookings_v1'))[0],tables:JSON.parse(localStorage.getItem('chicken_tables_v3'))}))
  let state=await read()
  expect([state.booking.assignedTableId,...state.booking.extraTableIds]).toEqual(original)
  expect(state.booking.status).toBe('confirmed')
  // 回今日訂位入口重新改桌。
  await page.locator('aside').getByRole('button',{name:'訂位',exact:true}).click()
  await page.getByRole('button',{name:'↔ 改桌',exact:true}).click()
  for(const n of selected) await page.locator(`svg g:has(:text-is("${n}"))`).first().click()
  await page.getByRole('button',{name:'✓ 確認改桌',exact:true}).click()
  await expect(page.getByText(/已改桌至.*原訂位保留/)).toBeVisible()
  state=await read()
  expect([state.booking.assignedTableId,...state.booking.extraTableIds]).toEqual(selected)
  expect(state.booking.status).toBe('confirmed')
  expect(state.booking.id).toBe(booking.id)
  for(const n of original.filter(n=>!selected.includes(n))) expect(state.tables.find(t=>t.number===n).status).toBe('vacant')
  for(const n of selected) expect(state.tables.find(t=>t.number===n)).toMatchObject({status:'reserved',currentBookingId:booking.id})
})
