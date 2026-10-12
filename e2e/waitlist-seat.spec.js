import { test, expect } from '@playwright/test'

import { startWaitlistBackend, FIREBASE_STUB } from './helpers/waitlistSharedBackend.js'
let backend
// 真雲端命令＋隔離 Firestore；不以 localStorage 或 ok:false mock 宣稱候位成功。
test.beforeAll(async () => { backend = await startWaitlistBackend() })
test.afterAll(async () => { await backend?.close() })
test.beforeEach(async ({ page }) => {
  await backend.reset()
  await page.route('https://**/*', route => route.abort())
  await page.route('**/src/services/firebase.js*', route => route.fulfill({ contentType: 'application/javascript', body: FIREBASE_STUB }))
})

test('管理端：現場頁內 取號 → 叫號 → 入座（人工選桌確認）→ 入座成功', async ({ page }) => {
  // 登入
  await page.goto('/admin')

  // 進現場分頁（鎖定側邊欄，避免與訂位來源篩選的「現場」chip 撞名）→ 右側欄切到「候位」籤
  await page.locator('aside').getByRole('button', { name: /現場/ }).click()
  await page.getByRole('button', { name: /^候位\s*\d*$/ }).click()

  // 新增取號
  await page.getByRole('button', { name: /新增取號/ }).click()
  // M5：姓名改用稱謂＋姓氏快選（免切注音），組出來的字串一樣進 waitlist.name
  // iPad v2：稱謂併進姓氏格且預設「先生」→ 常態只要點姓氏一下
  await page.getByRole('button', { name: '陳', exact: true }).click()
  await page.getByRole('button', { name: '取號', exact: true }).click()

  // 候位卡出現在右側欄
  await expect(page.getByText('陳先生').first()).toBeVisible()

  // 叫號
  await page.getByRole('button', { name: '叫號', exact: true }).click()

  // 入座 → 頁內直接進入「候位入座」模式（不再跨分頁）
  await page.getByRole('button', { name: '入座', exact: true }).click()
  await expect(page.getByText(/候位入座：陳先生/)).toBeVisible()

  // 讀建議桌號 → 點該桌 → 人工選桌確認 → 入座成功
  const suggestChip = page.getByText(/^建議\s*(?:\d+F・)?\d+/)
  await expect(suggestChip).toBeVisible()
  const tableNo = ((await suggestChip.textContent()).match(/建議\s*(?:\d+F・)?(\d+)/) || [])[1]
  expect(tableNo).toBeTruthy()

  await page.locator(`[data-table-number="${tableNo}"]`).first().click()
  await expect(page.getByText(`已選：${tableNo}`)).toBeVisible()
  await page.getByRole('button', { name: /確認入座/ }).click()
  await expect(page.getByText(/入座.*可指派下一組/)).toBeVisible()
  const stored = await backend.read()
  expect(stored.waitlist).toHaveLength(1)
  expect(stored.waitlist[0].status).toBe('seated')
  expect(stored.bookings).toHaveLength(1)
  expect(stored.tables.find(t=>t.number===tableNo).currentBookingId).toBe(stored.bookings[0].id)

  // 入座後不開桌況抽屜、直接切回「帶位」籤讓店員接著帶下一組（店主指定 UX：
  // 「候位的客人選定位子後，會直接回到帶位頁面，這樣 UX 比較順」）。
  // toast 帶「查看」動作，按下才回頭開該桌抽屜確認
  await page.getByRole('button', { name: '查看', exact: true }).click()
  await expect(page.getByText(/人桌 ·/)).toBeVisible() // 桌況抽屜的容量列，證明抽屜真的開了
  await page.keyboard.press('Escape')

  // 歷史 Sheet 在「候位」籤內（入座後預設落點是帶位籤，要切回候位籤才看得到）
  await page.getByRole('button', { name: /^候位\s*\d*$/ }).click()
  await page.getByRole('button', { name: '歷史', exact: true }).click()
  await expect(page.getByText('候位歷史與統計')).toBeVisible()
  await expect(page.getByText(/入座 \d+/).first()).toBeVisible()
})

// M5：滿場尖峰的最短路徑——開取號單 → 點人數 → 取號，全程不叫出鍵盤。
// 姓名可以完全不填（靠號碼叫人），這是尖峰時真正會發生的用法。
test('候位：只點人數就能取號，全程不用鍵盤', async ({ page }) => {
  await page.goto('/admin')
  await page.locator('aside').getByRole('button', { name: /現場/ }).click()
  await page.getByRole('button', { name: /^候位\s*\d*$/ }).click()

  await page.getByRole('button', { name: /新增取號/ }).click()
  // 人數擺第一個（唯一必填）：點「6 位」→ 取號，就這兩下
  await page.getByRole('button', { name: '6 位', exact: true }).click()
  await page.getByRole('button', { name: '取號', exact: true }).click()

  await expect(page.getByText(/已取號 #\d+/)).toBeVisible()
  expect((await backend.db.collection('waitlist').get()).docs[0].data().partySize).toBe(6)
  await expect(page.getByText('6 位').first()).toBeVisible()
})

// M5 回退路徑：罕見姓／複姓走「其他…」手打，仍要能取號
test('候位：罕見姓走「其他…」手打也能取號', async ({ page }) => {
  await page.goto('/admin')
  await page.locator('aside').getByRole('button', { name: /現場/ }).click()
  await page.getByRole('button', { name: /^候位\s*\d*$/ }).click()

  await page.getByRole('button', { name: /新增取號/ }).click()
  // 稱謂是循環鈕：預設「先生」→ 點一下換「小姐」
  await page.getByRole('button', { name: /^稱謂：先生/ }).click()
  await expect(page.getByRole('button', { name: /^稱謂：小姐/ })).toBeVisible()
  await page.getByRole('button', { name: '其他', exact: true }).click()

  // 單姓手打 → 仍接稱謂
  await page.getByLabel('自訂姓氏').fill('鄭')
  await page.getByRole('button', { name: '取號', exact: true }).click()
  await expect(page.locator('div.rounded-xl.border-2').filter({has:page.getByText('鄭小姐',{exact:true})})).toBeVisible()
  await expect.poll(async()=>(await backend.db.collection('waitlist').get()).docs.some(d=>d.data().name==='鄭小姐')).toBe(true)

  // 全名（≥2 字，含兩字複姓）→ 原樣使用，不接稱謂
  await page.getByRole('button', { name: /新增取號/ }).click()
  await page.getByRole('button', { name: '其他', exact: true }).click()
  await page.getByLabel('自訂姓氏').fill('歐陽')
  await page.getByRole('button', { name: '取號', exact: true }).click()
  await expect(page.locator('div.rounded-xl.border-2').filter({has:page.getByText('歐陽',{exact:true})})).toBeVisible()
  await expect.poll(async()=>(await backend.db.collection('waitlist').get()).docs.map(d=>d.data().name).sort()).toEqual(['歐陽','鄭小姐'].sort())
})

test('候位離線：保留稱呼與人數草稿／原命令，未確認不得顯示號碼；復線確認只發一號', async ({page,context})=>{
  await page.goto('/admin')
  await page.locator('aside').getByRole('button',{name:/現場/}).click()
  await page.getByRole('button',{name:/^候位\s*\d*$/}).click()
  await page.getByRole('button',{name:/新增取號/}).click()
  await page.getByRole('button',{name:'6 位',exact:true}).click()
  await page.getByRole('button',{name:'陳',exact:true}).click()
  await context.setOffline(true)
  await page.getByRole('button',{name:'取號',exact:true}).click()
  await expect(page.getByRole('button',{name:'確認原取號',exact:true})).toBeVisible()
  expect((await backend.db.collection('waitlist').get()).empty).toBe(true)
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('chicken_waitlist_commands_v1')||'[]')[0]?.command.payload)).toMatchObject({name:'陳先生',partySize:6})
  await expect(page.getByText(/已取號 #/)).toHaveCount(0)
  await context.setOffline(false)
  await page.getByRole('button',{name:'確認原取號',exact:true}).click()
  await expect(page.getByText(/已取號 #1/)).toBeVisible()
  expect((await backend.db.collection('waitlist').get()).size).toBe(1)
})
