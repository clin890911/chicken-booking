import { test, expect } from '@playwright/test'

// 規劃分頁主線：同仁登入 → 規劃（月曆+當日總覽一頁式，預設選今日）→ 編輯精靈（2 頁式）。
// 後台在「本機開發模式」(無 Firebase) 以 localStorage 為後端；攔截 admin* 雲端端點避免碰正式後端。
// 覆蓋五個重點：
//   1) 反覆「新增團單→返回」不會留下任何空白團單（草稿不落地）
//   2) 空白團單過不了驗證（第一頁就擋：請選擇或新增旅行社）
//   3) 當日總覽 ⇄ 排位地圖 三態切換（規劃分頁合併後的新動線）
//   4) 點團卡 → 詳情頁（唯讀確認 + 回傳單）→ 編輯往返
//   5) 散客名單出現在當日總覽，「→ 配桌」一鍵跳排位地圖預配模式

test.beforeEach(async ({ page }) => {
  await page.route('**/adminPullData', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'e2e-offline' }) }))
  await page.route('**/adminPushData', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }))
  await page.route('**/admin*', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false }) }))
  await page.route('**/groupReserveTables', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }))

  // 清空團體資料 + 預先標記清除旗標（避免清除提示干擾），確保每次測試從乾淨狀態開始
  await page.addInitScript(() => {
    localStorage.setItem('chicken_group_reservations_v1', JSON.stringify([]))
    localStorage.setItem('chicken_group_blank_purge_v1', '1')
  })
})

// 登入 → 規劃分頁（預設 day 態：月曆 + 當日總覽，selectedDate 即今日）
async function loginAndOpenPlanning(page) {
  await page.goto('/login')
  await page.getByPlaceholder('your@email.com').fill('berrylin0911@gmail.com')
  await page.getByRole('button', { name: /模擬登入/ }).click()
  await expect(page).toHaveURL(/\/admin/)
  await page.locator('aside').getByRole('button', { name: '規劃' }).click()
  // 當日總覽直接可見「新增團單」
  await expect(page.getByRole("button", { name: /新增團單/ }).first()).toBeVisible()
}

test('規劃：反覆「新增團單→返回」不留任何空白團單', async ({ page }) => {
  await loginAndOpenPlanning(page)

  // 初始：當日無任何團卡（有場次時顯示各場次「本場次尚無團單」）
  await expect(page.getByText('本場次尚無團單').first()).toBeVisible()
  await expect(page.getByText('（未填旅行社）')).toHaveCount(0)

  // 反覆「新增（進編輯精靈）→ 返回」：草稿在記憶體、不落地，回來後仍 0 卡
  for (let i = 0; i < 3; i++) {
    await page.getByRole("button", { name: /新增團單/ }).first().click()
    await expect(page.getByRole('button', { name: /返回當日總覽/ })).toBeVisible()
    await page.getByRole('button', { name: /返回當日總覽/ }).click()
    await expect(page.getByText('本場次尚無團單').first()).toBeVisible()
  }
  await expect(page.getByText('（未填旅行社）')).toHaveCount(0)
})

test('規劃：空白團單過不了驗證（第一頁就擋）', async ({ page }) => {
  await loginAndOpenPlanning(page)
  await page.getByRole("button", { name: /新增團單/ }).first().click()
  // 2 頁式精靈：未選旅行社就點「下一步：圈選座位」→ 驗證擋下、停在第一頁
  await page.getByRole('button', { name: /下一步：圈選座位/ }).click()
  await expect(page.getByText(/請選擇或新增旅行社/)).toBeVisible()
  await expect(page.getByText(/團單已儲存/)).toHaveCount(0)
})

test('規劃：當日總覽 ⇄ 排位地圖 切換共享同一天', async ({ page }) => {
  await loginAndOpenPlanning(page)

  // 切到排位地圖（頂部 segmented control）→ 場次選擇與日期列可見
  await page.getByRole('button', { name: /排位地圖/ }).first().click()
  await expect(page.getByText('場次（批次）')).toBeVisible()
  await expect(page.getByRole('button', { name: /前一日/ })).toBeVisible()
  await expect(page.getByText(/全店座位/)).toBeVisible()

  // 換日仍在地圖態
  await page.getByRole('button', { name: /後一日/ }).click()
  await expect(page.getByText('場次（批次）')).toBeVisible()

  // 切回當日總覽 → 月曆與新增團單回來
  await page.getByRole('button', { name: /當日總覽/ }).first().click()
  await expect(page.getByRole("button", { name: /新增團單/ }).first()).toBeVisible()
})

test('規劃：點團卡進詳情頁（回傳單可見）→ 編輯往返 → 返回當日總覽', async ({ page }) => {
  // 種一筆今日 confirmed 團單（覆寫 beforeEach 的空陣列；initScript 依加入順序執行）
  await page.addInitScript(() => {
    const d = new Date()
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    localStorage.setItem('chicken_group_reservations_v1', JSON.stringify([{
      id: 'GE2E_DETAIL', schemaVersion: 2, date: today,
      agencyName: '快樂旅行社', guideName: '張導', guidePhone: '0911222333',
      counts: { total: 22, vegetarian: 2, child: 0, mobility: 0, wheelchair: 0 },
      allergyText: '兩位海鮮過敏', status: 'confirmed',
      batches: [{ id: 'BE2E1', label: '第一梯', timeSlot: '11:30', tableNumbers: ['101', '102'], guests: 22, note: '' }],
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    }]))
  })
  await loginAndOpenPlanning(page)

  // 點團卡 → 詳情頁（唯讀確認）：回傳單 + 編輯可見、不是編輯精靈
  // 注意：抵達時間軸的梯次列也是含旅行社名的按鈕（點它是跳地圖標示），故鎖定不含「看地圖」的團卡。
  await page.getByRole('button', { name: /快樂旅行社/ }).filter({ hasNotText: '看地圖' }).first().click()
  await expect(page.getByRole('button', { name: /回傳單/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /✏️ 編輯/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /下一步：圈選座位/ })).toHaveCount(0)
  // 領位/備餐重點有呈現
  await expect(page.getByText(/兩位海鮮過敏/)).toBeVisible()
  await expect(page.getByText('梯次與桌位')).toBeVisible()

  // 進編輯精靈 → 返回落回詳情頁
  await page.getByRole('button', { name: /✏️ 編輯/ }).click()
  await expect(page.getByRole('button', { name: /下一步：圈選座位/ })).toBeVisible()
  await page.getByRole('button', { name: /返回當日總覽/ }).click()
  await expect(page.getByRole('button', { name: /✏️ 編輯/ })).toBeVisible()

  // 詳情頁返回 → 回當日總覽
  await page.getByRole('button', { name: /返回當日總覽/ }).click()
  await expect(page.getByRole("button", { name: /新增團單/ }).first()).toBeVisible()
})

test('規劃：散客名單出現在當日總覽，「→ 配桌」跳排位地圖預配模式', async ({ page }) => {
  // 種一筆今日 confirmed 未配桌散客（11:30 落在預設「午餐第一批」場次）
  await page.addInitScript(() => {
    const d = new Date()
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    localStorage.setItem('chicken_bookings_v1', JSON.stringify([{
      id: 'BKE2E_WALKIN', name: '王小明', phone: '0987654321', guests: 4,
      date: today, timeSlot: '11:30', status: 'confirmed', assignedTableId: null,
      source: 'phone', notes: { pet: false, child: false, mobility: false, text: '' },
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    }]))
  })
  await loginAndOpenPlanning(page)

  // Hero 散客格 + 場次區塊內散客列可見
  await expect(page.getByText('🧍 散客', { exact: true })).toBeVisible()
  await expect(page.getByText(/🧍 散客 1 組 · 4 位/)).toBeVisible()
  await expect(page.getByText('王小明')).toBeVisible()

  // 點「→ 配桌」→ 跳排位地圖並自動進入預配模式
  await page.getByRole('button', { name: /→ 配桌/ }).click()
  await expect(page.getByText('場次（批次）')).toBeVisible()
  await expect(page.getByText(/預先配桌：王小明/)).toBeVisible()

  // 點地圖上的空桌 101（六人桌、容量足夠）完成預配
  await page.locator('svg g:has(:text-is("101"))').first().click()
  await expect(page.getByText(/已預先配到 101/)).toBeVisible()
})

test('規劃：抵達時間軸點團 → 跳排位地圖、白圈標示這團座位', async ({ page }) => {
  // 種一筆今日 confirmed、已圈桌（101/102）的團單；11:30 落在預設「午餐第一批」場次
  await page.addInitScript(() => {
    const d = new Date()
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    localStorage.setItem('chicken_group_reservations_v1', JSON.stringify([{
      id: 'GE2E_FOCUS', schemaVersion: 2, date: today,
      agencyName: '上置旅行社', guideName: '李導', guidePhone: '0911000111',
      counts: { total: 20, vegetarian: 0, child: 0, mobility: 0, wheelchair: 0 },
      allergyText: '', status: 'confirmed',
      batches: [{ id: 'BF1', label: '第一梯', timeSlot: '11:30', tableNumbers: ['101', '102'], guests: 20, note: '' }],
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    }]))
  })
  await loginAndOpenPlanning(page)

  // 抵達時間軸出現，且該梯次列可點（有「看地圖」入口）
  await expect(page.getByRole('heading', { name: /遊覽車抵達時間軸/ })).toBeVisible()
  await page.getByRole('button', { name: /看地圖/ }).first().click()

  // 跳到排位地圖，且出現白圈標示橫幅（含旅行社 + 桌號）
  await expect(page.getByText('場次（批次）')).toBeVisible()
  await expect(page.getByText(/🎯/)).toBeVisible()
  await expect(page.getByText(/桌 101、102/)).toBeVisible()

  // 關閉標示後橫幅消失
  await page.getByRole('button', { name: /關閉標示/ }).click()
  await expect(page.getByText(/🎯/)).toHaveCount(0)
})

test('規劃：當日總覽「新增散客」快速表單 → 落地當日散客名單', async ({ page }) => {
  // 確保 bookings 乾淨，散客數從 0 起算
  await page.addInitScript(() => localStorage.setItem('chicken_bookings_v1', JSON.stringify([])))
  await loginAndOpenPlanning(page)

  // Hero 散客格初始 0；點「新增散客」開快速表單
  await expect(page.getByText('🧍 散客', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: /新增散客/ }).click()

  // 填姓名 + 人數 4 + 時段（11:30 → 午餐第一批）。人數 chip 與月曆日期格同字，需限縮在彈窗內
  await expect(page.getByText(/新增散客 ·/)).toBeVisible()
  const dialog = page.locator('.fixed.inset-0.z-50')
  await page.getByPlaceholder('王小姐').fill('規劃散客')
  await dialog.getByRole('button', { name: '4 位', exact: true }).click()
  await dialog.getByRole('button', { name: /11:30/ }).first().click()
  await page.getByRole('button', { name: /確認新增/ }).click()

  // 成功 toast + 散客出現在當日總覽（場次散客列，exact 避開 toast 長字串）
  await expect(page.getByText(/規劃散客 4 位 .* 已新增/)).toBeVisible()
  await expect(page.getByText('規劃散客', { exact: true })).toBeVisible()
})
