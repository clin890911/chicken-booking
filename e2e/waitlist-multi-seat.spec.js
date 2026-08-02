import { test, expect } from '@playwright/test'

// 候位併桌入座 + 現場快速新增今日訂位（2026-08 店主回報／需求）。
//
// 重現截圖情境：候位 9 位、現場只剩幾張小桌 → 按「入座」原本只跳「目前無符合容量的空桌」，
// 即使併兩三張桌明明坐得下。修正後應自動進入併桌模式（預選建議組合，可加減桌後確認）。
// 種子把全店（含 2F）其餘桌位佔滿，只留 105/106/109 三張空桌逼出「無單桌可容」的分支。

const TODAY = new Date().toISOString().slice(0, 10)

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

test.beforeEach(async ({ page }) => {
  await page.route('**/adminPullData', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'e2e-offline' }) }))
  await page.route('**/adminPushData', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }))
  await page.route('**/admin*', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false }) }))

  await page.addInitScript(({ today, seedSrc }) => {
    localStorage.removeItem('chicken_bookings_v1')
    localStorage.removeItem('chicken_group_reservations_v1')
    // 候位：9 位，超過任何單桌容量
    localStorage.setItem('chicken_waitlist_v1', JSON.stringify([
      { id: 'W-BIG', queueNumber: 3, name: '訪客', phone: '0900222333', partySize: 9,
        status: 'waiting', createdAt: new Date().toISOString(), notes: '' },
    ]))
    // 桌位改造在頁面載入後由 app 自己 seed，故先讀既有值再覆寫（key 是 v3）
    const KEY = 'chicken_tables_v3'
    const apply = () => {
      const raw = localStorage.getItem(KEY)
      if (!raw) return false
      // eslint-disable-next-line no-new-func
      const seed = new Function('tables', `return (${seedSrc})(tables)`)
      localStorage.setItem(KEY, JSON.stringify(seed(JSON.parse(raw))))
      return true
    }
    if (!apply()) {
      // app 尚未寫入預設桌位 → 等它寫完再改（tableService 首次讀取時才 seed）
      const orig = localStorage.setItem.bind(localStorage)
      localStorage.setItem = function (k, v) {
        orig(k, v)
        if (k === KEY) { localStorage.setItem = orig; apply() }
      }
    }
    void today
  }, { today: TODAY, seedSrc: seedTables.toString() })
})

test('候位 9 位、無單桌可容 → 自動進併桌模式，確認後入座成功', async ({ page }) => {
  await page.goto('/login')
  await page.getByPlaceholder('your@email.com').fill('berrylin0911@gmail.com')
  await page.getByRole('button', { name: /模擬登入/ }).click()
  await expect(page).toHaveURL(/\/admin/)
  await page.locator('aside').getByRole('button', { name: '現場' }).click()

  await page.getByRole('button', { name: /^候位/ }).click()
  await expect(page.getByText('訪客')).toBeVisible()

  // 入座 → 沒有單桌容納 9 位，應進併桌模式而不是跳「目前無符合容量的空桌」
  await page.getByRole('button', { name: /^入座$/ }).click()
  await expect(page.getByText('目前無符合容量的空桌')).toHaveCount(0)
  await expect(page.getByText(/候位入座（併桌）：訪客 #3 9 位/)).toBeVisible()

  // 已預選一組建議桌且席數足夠。不寫死是哪幾桌、幾席——那綁死 suggestTableCombo 的挑選
  // 策略與佈局容量，改任一邊就假紅；要驗的是「有預選、席數夠（沒有『還差』）、確認鈕開得起來」。
  await expect(page.getByText(/^已選：/)).toBeVisible()
  await expect(page.getByText(/還差/)).toHaveCount(0)

  const confirm = page.getByRole('button', { name: /確認併桌入座/ })
  await expect(confirm).toBeEnabled()
  await confirm.click()

  await expect(page.getByText(/訪客（候位 #3・9 位）併桌入座/)).toBeVisible()

  // 入座後右欄被該桌的抽屜取代（籤列暫時不在），ESC 收掉才回得到候位籤。
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: /^候位/ }).click()
  // 候位列表清空（該筆已轉為 seated）
  await expect(page.getByText('訪客')).toHaveCount(0)
})

test('併桌模式下把桌減到席數不足 → 確認鈕鎖住並提示還差幾席', async ({ page }) => {
  await page.goto('/login')
  await page.getByPlaceholder('your@email.com').fill('berrylin0911@gmail.com')
  await page.getByRole('button', { name: /模擬登入/ }).click()
  await expect(page).toHaveURL(/\/admin/)
  await page.locator('aside').getByRole('button', { name: '現場' }).click()

  await page.getByRole('button', { name: /^候位/ }).click()
  await page.getByRole('button', { name: /^入座$/ }).click()
  await expect(page.getByText(/候位入座（併桌）/)).toBeVisible()

  // 109 是店內最大的空桌（6 人），建議組合一定包含它——先確認，否則下面那一點會變成「加桌」。
  await expect(page.getByText(/^已選：/)).toContainText('109')
  // 點掉它 → 剩下的都是 4 人桌，湊不到 9 席
  await page.locator('svg g:has(:text-is("109"))').first().click()
  await expect(page.getByText(/還差 \d+ 席/)).toBeVisible()
  await expect(page.getByRole('button', { name: /確認併桌入座/ })).toBeDisabled()
})

// 現場「今日訂位」籤的「＋ 新增今日訂位」按鈕（2026-08 店主需求）：
// 現場接到電話要加今天的訂位時，原本得自己跳去「訂位 → 新增」子分頁才找得到入口。
test('今日訂位籤的「＋ 新增今日訂位」→ 直接開到訂位新增表單，日期預設今天', async ({ page }) => {
  await page.goto('/login')
  await page.getByPlaceholder('your@email.com').fill('berrylin0911@gmail.com')
  await page.getByRole('button', { name: /模擬登入/ }).click()
  await expect(page).toHaveURL(/\/admin/)
  await page.locator('aside').getByRole('button', { name: '現場' }).click()

  await page.getByRole('button', { name: /^今日訂位/ }).click()
  await page.getByRole('button', { name: '＋ 新增今日訂位' }).click()

  // 落在訂位頁的「新增」子分頁，且日期快選停在「今天」
  await expect(page.getByPlaceholder('0912345678')).toBeVisible()
  await expect(page.getByRole('button', { name: /今天/ })).toBeVisible()
})
