import { test, expect } from '@playwright/test'

// 現場「帶位」主線（v3：順序不拘 + 滑動帶位）：
// 同仁登入 → 現場分頁（左欄預設「帶位」籤）→ 點桌況圖上的空桌（選進面板）+ 選人數
// → 兩者到齊底部滑桿解鎖 → 滑動帶位 → 入座成功（桌轉用餐中）。
// 舊版的「選座位帶入 →」按鈕與二步確認已移除，改由滑動手勢承擔防誤觸。
// 後台本機模式以 localStorage 為後端；攔截 admin* 雲端端點。

test.beforeEach(async ({ page }) => {
  await page.route('**/adminPullData', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'e2e-offline' }) }))
  await page.route('**/adminPushData', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }))
  await page.route('**/admin*', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false }) }))
  await page.addInitScript(() => {
    localStorage.removeItem('chicken_waitlist_v1')
    localStorage.removeItem('chicken_bookings_v1')
    localStorage.removeItem('chicken_group_reservations_v1')
  })
})

async function loginToOps(page) {
  await page.goto('/login')
  await page.getByPlaceholder('your@email.com').fill('berrylin0911@gmail.com')
  await page.getByRole('button', { name: /模擬登入/ }).click()
  await expect(page).toHaveURL(/\/admin/)
  await page.locator('aside').getByRole('button', { name: '現場' }).click()
}

// 拿到一個「可入座」的桌號：從帶位面板的建議文字讀（選好人數後會出現「建議 N」）
async function readSuggestedTable(page) {
  const hint = page.getByText(/建議\s*\d+/)
  await expect(hint).toBeVisible()
  const no = ((await hint.textContent()).match(/建議\s*(\d+)/) || [])[1]
  expect(no).toBeTruthy()
  return no
}

// 真的滑：對 knob 做 pointer 拖曳（Playwright 的 mouse 會產生真實 pointer 事件）
async function slideToSeat(page) {
  const track = page.getByRole('button', { name: '滑動帶位 →' })
  await expect(track).toBeVisible()
  const knob = page.locator('[data-slide-knob]')
  const kb = await knob.boundingBox()
  const tb = await track.boundingBox()
  await page.mouse.move(kb.x + kb.width / 2, kb.y + kb.height / 2)
  await page.mouse.down()
  // 拖過去整條軌道（遠超過 60% 門檻）
  await page.mouse.move(tb.x + tb.width, kb.y + kb.height / 2, { steps: 12 })
  await page.mouse.up()
}

test('現場：點桌 → 選人數 → 滑動帶位 → 入座成功', async ({ page }) => {
  await loginToOps(page)

  // 左欄預設就是「帶位」籤，未選桌時提示點桌況圖
  await expect(page.getByText(/點右邊桌況圖選一張桌/)).toBeVisible()

  // 先選人數 → 面板給出建議桌
  await page.getByRole('button', { name: '4 位', exact: true }).click()
  const tableNo = await readSuggestedTable(page)

  // 點該桌 → 選進面板（不是開抽屜、也不是二步確認）
  await page.locator(`svg g:has(:text-is("${tableNo}"))`).first().click()
  await expect(page.getByRole('button', { name: `移除桌 ${tableNo}` })).toBeVisible()

  // 桌與人數到齊 → 滑桿解鎖並可滑動入座
  await slideToSeat(page)
  await expect(page.getByText(new RegExp(`入座 ${tableNo}\\s*·\\s*可帶下一組`))).toBeVisible()

  // 入座後面板清空，可以直接帶下一組
  await expect(page.getByText(/點右邊桌況圖選一張桌/)).toBeVisible()
})

test('現場：先點桌再選人數（反序）也能帶位，且滑桿未湊齊時鎖住', async ({ page }) => {
  await loginToOps(page)

  // 還沒選人數/桌 → 滑桿是鎖住的（顯示提示文案而非「滑動帶位」）
  await expect(page.getByRole('button', { name: '滑動帶位 →' })).toHaveAttribute('aria-disabled', 'true')

  // 先選人數拿建議桌號，再重設人數以測試「先點桌」的順序
  await page.getByRole('button', { name: '2 位', exact: true }).click()
  const tableNo = await readSuggestedTable(page)

  // 先點桌
  await page.locator(`svg g:has(:text-is("${tableNo}"))`).first().click()
  await expect(page.getByRole('button', { name: `移除桌 ${tableNo}` })).toBeVisible()

  // 再選人數 → 解鎖
  await page.getByRole('button', { name: '3 位', exact: true }).click()
  await expect(page.getByRole('button', { name: '滑動帶位 →' })).not.toHaveAttribute('aria-disabled', 'true')

  await slideToSeat(page)
  await expect(page.getByText(new RegExp(`入座 ${tableNo}\\s*·\\s*可帶下一組`))).toBeVisible()
})

test('現場：稱謂＋姓氏快選組成姓名，全程不用鍵盤', async ({ page }) => {
  await loginToOps(page)

  await page.getByRole('button', { name: '2 位', exact: true }).click()
  const tableNo = await readSuggestedTable(page)

  // 稱謂在上、姓氏在下（領檯看到人先知道先生/小姐，才問貴姓）
  await page.getByRole('button', { name: '先生', exact: true }).click()
  await page.getByRole('button', { name: '陳', exact: true }).click()

  await page.locator(`svg g:has(:text-is("${tableNo}"))`).first().click()
  await slideToSeat(page)

  // 入座成功且姓名記成「陳先生」
  await expect(page.getByText(/陳先生（2 位）入座/)).toBeVisible()
})

// 迴歸：iPad 觸控可能在同一個 React batch 內送出兩次 click（touch → 合成 click）。
// 若加/移是用 render 當下的值判斷，兩次都會判「加入」→ 同一張桌進陣列兩次 → 席數加倍。
test('現場：連點同一張桌不會重複加入（席數不可加倍）', async ({ page }) => {
  await loginToOps(page)

  await page.getByRole('button', { name: '2 位', exact: true }).click()
  const tableNo = await readSuggestedTable(page)
  const seat = page.locator(`svg g:has(:text-is("${tableNo}"))`).first()

  // 從「未選」狀態快速連點兩下＝加入→移除，回到未選。
  // 關鍵是任何一刻都不該出現「兩張同號卡」（那代表同一張桌被重複加入、席數加倍）。
  await seat.dblclick()
  await expect(page.getByRole('button', { name: `移除桌 ${tableNo}` })).toHaveCount(0)
  await expect(page.getByText(/點右邊桌況圖選一張桌/)).toBeVisible()

  // 單擊：剛好一張，不多不少
  await seat.click()
  await expect(page.getByRole('button', { name: `移除桌 ${tableNo}` })).toHaveCount(1)

  // 再單擊：取消選取
  await seat.click()
  await expect(page.getByRole('button', { name: `移除桌 ${tableNo}` })).toHaveCount(0)
})

test('現場：滑不到門檻不會入座（防誤觸）', async ({ page }) => {
  await loginToOps(page)

  await page.getByRole('button', { name: '2 位', exact: true }).click()
  const tableNo = await readSuggestedTable(page)
  await page.locator(`svg g:has(:text-is("${tableNo}"))`).first().click()

  // 只拖一小段（遠低於 60%）→ 放手應彈回，不入座
  const knob = page.locator('[data-slide-knob]')
  const kb = await knob.boundingBox()
  await page.mouse.move(kb.x + kb.width / 2, kb.y + kb.height / 2)
  await page.mouse.down()
  await page.mouse.move(kb.x + kb.width / 2 + 30, kb.y + kb.height / 2, { steps: 5 })
  await page.mouse.up()

  await expect(page.getByText(/可帶下一組/)).toHaveCount(0)
  // 桌仍選在面板上，人數也還在，店員可以直接補滑
  await expect(page.getByRole('button', { name: `移除桌 ${tableNo}` })).toBeVisible()
})

// M6 沿用上一組：連續同型客人（一直來 4 位）不必每組重選人數。
// 刻意只沿用人數與註記，不沿用姓名／電話——那是每組不同的資料。
test('現場：帶完一組後可「沿用上一組」快速帶下一組', async ({ page }) => {
  await loginToOps(page)

  // 第一組：4 位 + 註記，帶位完成
  await page.getByRole('button', { name: '4 位', exact: true }).click()
  const t1 = await readSuggestedTable(page)
  await page.getByPlaceholder('例：靠窗、慶生、過敏').fill('靠窗')
  await page.locator(`svg g:has(:text-is("${t1}"))`).first().click()
  await slideToSeat(page)
  await expect(page.getByText(new RegExp(`入座 ${t1}\\s*·\\s*可帶下一組`))).toBeVisible()

  // 面板已重置成預設 2 位 → 出現「沿用上一組（4 位 · 靠窗）」
  const reuse = page.getByRole('button', { name: /沿用上一組/ })
  await expect(reuse).toBeVisible()
  await expect(reuse).toContainText('4 位')
  await expect(reuse).toContainText('靠窗')

  // 按下去 → 人數與註記一起帶回來
  await reuse.click()
  await expect(page.getByRole('button', { name: '4 位', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByPlaceholder('例：靠窗、慶生、過敏')).toHaveValue('靠窗')

  // 已經跟上一組一樣了 → 按鈕收起來，不佔版面也不讓人白按
  await expect(reuse).toHaveCount(0)
})

// 🔴 迴歸：電話帶出顧客檔時，備註會被合成「店員打的字；過敏：xxx」一起寫進訂位。
// 「沿用上一組」若沿用這整串，上一位客人的過敏資訊會被掛到下一組客人身上
// （個資外洩＋出餐安全）。只能沿用店員手打的那段。
test('現場：「沿用上一組」不可把上一組的過敏註記帶給下一組', async ({ page }) => {
  // 先種一筆有過敏註記的顧客檔
  await page.addInitScript(() => {
    localStorage.setItem('chicken_customers_v1', JSON.stringify({
      '0912000111': {
        phone: '0912000111', name: '過敏客', allergies: '花生',
        visits: 3, totalGuests: 6, vipTier: 'none', createdAt: new Date().toISOString(),
      },
    }))
  })
  await loginToOps(page)

  // 第一組：輸入該電話帶出顧客檔（過敏：花生）＋店員自己打「靠窗」
  await page.getByRole('button', { name: '2 位', exact: true }).click()
  await page.getByRole('button', { name: /電話（帶顧客檔/ }).click()
  await page.getByPlaceholder('0912345678').fill('0912000111')
  await expect(page.getByText(/過敏：花生/)).toBeVisible()
  await page.getByPlaceholder('例：靠窗、慶生、過敏').fill('靠窗')

  const t1 = await readSuggestedTable(page)
  await page.locator(`svg g:has(:text-is("${t1}"))`).first().click()
  await slideToSeat(page)
  await expect(page.getByText(new RegExp(`入座 ${t1}`))).toBeVisible()

  // 沿用按鈕只能帶「靠窗」，絕不能出現「花生」
  const reuse = page.getByRole('button', { name: /沿用上一組/ })
  await expect(reuse).toBeVisible()
  await expect(reuse).toContainText('靠窗')
  await expect(reuse).not.toContainText('花生')

  await reuse.click()
  await expect(page.getByPlaceholder('例：靠窗、慶生、過敏')).toHaveValue('靠窗')
})
