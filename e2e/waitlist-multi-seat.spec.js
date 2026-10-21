import { test, expect } from '@playwright/test'
import { startWaitlistBackend, FIREBASE_STUB } from './helpers/waitlistSharedBackend.js'
import { INITIAL_TABLES } from '../src/data/tables.js'

// 候位併桌入座 + 現場快速新增今日訂位（2026-08 店主回報／需求）。
//
// 重現截圖情境：候位 9 位、現場只剩幾張小桌 → 按「入座」原本只跳「目前無符合容量的空桌」，
// 即使併兩三張桌明明坐得下。修正後應自動進入併桌模式（不預選推薦，人工加減桌後確認）。
// 種子把全店（含 2F）其餘桌位佔滿，只留 105/106/109 三張空桌逼出「無單桌可容」的分支。

// 本地日（不可用 toISOString().slice：台灣 00:00–08:00 會拿到 UTC 的前一天）
const TODAY = (() => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
})()

// 全店只留 105 / 106 / 109 為空桌，其餘（含 2F）一律設成用餐中。
// 沿用佈局本身的容量（105=4、106=4、109=6，與店主截圖一致）：任一單桌都塞不下 9 位，
// 但三張加起來夠 → 正好逼出「無單桌可容 → 併桌」這條分支。
// ★ 必須連 2F 一起佔掉：suggestTableCombo 會挑同層湊得最快的組合，2F 留空的話它會選
//   201+202（兩張 6 人桌），測到的就不是這個情境。
const seedTables = (tables) =>
  tables.map(t => {
    if (['105', '106', '109'].includes(t.number)) {
      return { ...t, status: 'vacant', currentBookingId: null, currentRef: null, seatedAt: null }
    }
    return { ...t, status: 'dining', currentBookingId: `OCC-${t.number}`, seatedAt: new Date().toISOString() }
  })

let backend
// 採用同一 demo-only 真 handler/Firestore fixture，所有狀態來自 cloud pull。
test.beforeAll(async () => { backend = await startWaitlistBackend() })
test.afterAll(async () => { await backend?.close() })
test.beforeEach(async ({ page }) => {
  await backend.reset()
  const batch = backend.db.batch()
  for (const table of seedTables(INITIAL_TABLES)) batch.set(backend.db.collection('tables').doc(table.number), table)
  await batch.commit()
  await backend.db.collection('waitlist').doc('W-BIG').set({id:'W-BIG',queueNumber:3,name:'訪客',phone:'',partySize:9,adults:9,children:0,status:'waiting',queueVersion:1,serverManaged:true,takenAt:new Date().toISOString(),notes:''})
  await page.route('https://**/*', route => route.abort())
  await page.route('**/src/services/firebase.js*', route => route.fulfill({contentType:'application/javascript',body:FIREBASE_STUB}))
})

test('候位 9 位、無單桌可容 → 自動進併桌模式，確認後入座成功', async ({ page }) => {
  await page.goto('/admin')
  await page.locator('aside').getByRole('button', { name: /現場/ }).click()

  await page.getByRole('button', { name: /^候位/ }).click()
  await expect(page.getByText('訪客')).toBeVisible()

  // 入座 → 沒有單桌容納 9 位，應進併桌模式而不是跳「目前無符合容量的空桌」
  await page.getByRole('button', { name: /^入座$/ }).click()
  await expect(page.getByText('目前無符合容量的空桌')).toHaveCount(0)
  await expect(page.getByText(/候位入座：訪客 #3 9 位/)).toBeVisible()

  // 初始不選桌；人工挑109六席與105四席，合計10席可坐9人。
  await expect(page.getByText(/已選 0\/9 席/)).toBeVisible()
  await page.locator('[data-table-number="105"]').first().click()
  await page.locator('[data-table-number="109"]').first().click()
  await expect(page.getByText(/^已選：/)).toBeVisible()
  await expect(page.getByText(/還差/)).toHaveCount(0)

  const confirm = page.getByRole('button', { name: /確認併桌入座/ })
  await expect(confirm).toBeEnabled()
  await confirm.click()

  await expect(page.getByText(/訪客（候位 #3・9 位）併桌入座/)).toBeVisible()
  const saved=await backend.read()
  expect(saved.waitlist[0].status).toBe('seated')
  expect(saved.bookings).toHaveLength(1)
  expect(saved.bookings[0].guests).toBe(9)
  expect(saved.tables.filter(t=>['105','109'].includes(t.number)).every(t=>t.status==='dining'&&t.currentBookingId===saved.bookings[0].id)).toBe(true)

  // 入座後不開桌況抽屜、直接切回「帶位」籤（店主指定 UX：候位客人選定位子後直接回帶位頁），
  // 不必再 ESC 收抽屜。切回「候位」籤即可看到列表已清空。
  await page.getByRole('button', { name: /^候位/ }).click()
  // 候位列表清空（該筆已轉為 seated）
  await expect(page.getByText('訪客')).toHaveCount(0)
})

test('併桌模式下把桌減到席數不足（擠一擠也不夠）→ 確認鈕鎖住並提示還差幾位', async ({ page }) => {
  await page.goto('/admin')
  await page.locator('aside').getByRole('button', { name: /現場/ }).click()

  await page.getByRole('button', { name: /^候位/ }).click()
  await page.getByRole('button', { name: /^入座$/ }).click()
  // 用橫幅專屬文案定位（PR #137/#138 後頁面上另有同名「候位入座」標題，裸 /候位入座/ 會撞 strict mode）
  await expect(page.getByText(/候位入座：訪客 #3/)).toBeVisible()

  // 人工先選六席109與四席105，再移除109，剩下四席不足9人。
  await page.locator('[data-table-number="109"]').first().click()
  await page.locator('[data-table-number="105"]').first().click()
  await expect(page.getByRole('button', { name: /確認併桌入座/ })).toBeEnabled()
  await page.locator('[data-table-number="109"]').first().click()
  await expect(page.getByText(/擠一擠也還差 \d+ 位/)).toBeVisible()
  await expect(page.getByRole('button', { name: /確認入座/ })).toBeDisabled()
  expect((await backend.db.collection('bookings').get()).empty).toBe(true)
  expect((await backend.db.collection('waitlist').doc('W-BIG').get()).data().status).toBe('waiting')
})

// 現場「今日訂位」籤的「＋ 新增今日訂位」按鈕（2026-08 店主需求）：
// 現場接到電話要加今天的訂位時，原本得自己跳去「訂位 → 新增」子分頁才找得到入口。
// 2026-09 店主改選「留在現場頁新增」：按鈕改成左欄原地的內嵌面板（桌況圖一直看得到，
// 完整流程見 onsite-inline-reserve.spec.js）；面板上的「其他日期」仍通往完整新增表單。
test('今日訂位籤的「＋ 新增今日訂位」→ 留在現場開內嵌面板；「其他日期」才到完整新增表單', async ({ page }) => {
  await page.goto('/admin')
  await page.locator('aside').getByRole('button', { name: /現場/ }).click()

  await page.getByRole('button', { name: /^今日訂位/ }).click()
  await page.getByRole('button', { name: '＋ 新增今日訂位' }).click()

  // 不跳頁：左欄換成內嵌面板，桌況圖仍在
  await expect(page.getByTestId('quick-reserve-panel')).toBeVisible()
  await expect(page.locator('svg').first()).toBeVisible()

  // 「其他日期」→ 訂位頁的「新增」子分頁，日期快選停在「今天」
  await page.getByRole('button', { name: '其他日期' }).click()
  await expect(page.getByPlaceholder('0912345678')).toBeVisible()
  await expect(page.getByRole('button', { name: /今天/ })).toBeVisible()
})

// 驗收 v4-6：「其他日期」把面板已填、且完整表單 prefill 支援的欄位帶過去（姓名／電話／來源）
test('內嵌面板填了姓名、來源＝現場 →「其他日期」→ 完整表單帶入姓名與來源（電話變選填）', async ({ page }) => {
  await page.goto('/admin')
  await page.locator('aside').getByRole('button', { name: /現場/ }).click()
  await page.getByRole('button', { name: /^今日訂位/ }).click()
  await page.getByRole('button', { name: '＋ 新增今日訂位' }).click()
  const panel = page.getByTestId('quick-reserve-panel')
  await panel.getByRole('button', { name: '來源：現場' }).click()
  await panel.getByRole('button', { name: '黃', exact: true }).click()
  await panel.getByRole('button', { name: '其他日期' }).click()

  await expect(page.getByPlaceholder('王小姐')).toHaveValue('黃先生')
  await expect(page.getByPlaceholder('現場客可不填')).toBeVisible()      // 來源＝現場才會出現
})

test('候位擠一擠：10 席帶 11 位、覆蓋同時段預配，5秒復原由真命令還原候位／桌／原預配',async({page})=>{
  await backend.db.collection('waitlist').doc('W-BIG').update({partySize:11,adults:11})
  const local=new Date(Date.now()+8*3600000),timeSlot=`${String(local.getUTCHours()).padStart(2,'0')}:${String(Math.floor(local.getUTCMinutes()/30)*30).padStart(2,'0')}`
  await backend.db.collection('bookings').doc('TEST_PREASSIGN').set({id:'TEST_PREASSIGN',date:TODAY,timeSlot,guests:4,name:'測試預配',status:'confirmed',assignedTableId:'109',extraTableIds:[],source:'phone',operationalVersion:1})
  await page.goto('/admin')
  await page.locator('aside').getByRole('button',{name:/現場/}).click()
  await page.getByRole('button',{name:/^候位\s*\d*$/}).click()
  await page.getByRole('button',{name:'入座',exact:true}).click()
  await page.locator('[data-table-number="105"]').first().click()
  await page.locator('[data-table-number="109"]').first().click()
  // Confirm the UI's actual preassignment warning before the command is allowed to clear it.
  await expect(page.getByText(/測試預配/).first()).toBeVisible()
  const warning=page.getByRole('checkbox',{name:/知道了，仍用這桌/})
  await expect(warning).toBeVisible()
  await warning.check()
  await page.getByRole('button',{name:/確認併桌入座|仍要覆蓋/}).first().click()
  await expect(page.getByRole('button',{name:'復原',exact:true})).toBeVisible()
  await page.getByRole('button',{name:'復原',exact:true}).click()
  await expect(page.getByText(/已復原入座，回到原候位/)).toBeVisible()
  expect((await backend.db.collection('waitlist').doc('W-BIG').get()).data().status).toBe('waiting')
  expect((await backend.db.collection('tables').doc('105').get()).data().status).toBe('vacant')
  expect((await backend.db.collection('tables').doc('109').get()).data().status).toBe('vacant')
  expect((await backend.db.collection('bookings').doc('TEST_PREASSIGN').get()).data().assignedTableId).toBe('109')
  expect((await backend.db.collection('bookings').get()).docs.filter(d=>d.data().status==='arrived')).toHaveLength(0)
})
