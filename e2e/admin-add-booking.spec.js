import { test, expect } from '@playwright/test'

// 後台新增訂位（緊湊單頁＋缺漏清單）主線：
// 缺漏欄位即時列在底部黏性列的「還差」pills（手機上收成一列免遮擋）→ 逐項補齊（日期用「明天」chip）
// → 填齊後才出現確認鈕 → 建立成功。
// 後台本機模式以 localStorage 為後端；攔截 admin* 雲端端點。

test.beforeEach(async ({ page }) => {
  await page.route('**/adminPullData', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'e2e-offline' }) }))
  await page.route('**/adminPushData', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }))
  await page.route('**/admin*', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false }) }))
  await page.addInitScript(() => {
    localStorage.setItem('chicken_bookings_v1', JSON.stringify([]))
  })
})

test('新增訂位：缺漏清單即時提示 → 補齊 → 建立成功', async ({ page }) => {
  await page.goto('/login')
  await page.getByPlaceholder('your@email.com').fill('berrylin0911@gmail.com')
  await page.getByRole('button', { name: /模擬登入/ }).click()
  await expect(page).toHaveURL(/\/admin/)

  // 進「新增」sub-tab
  await page.getByRole('button', { name: /新增/ }).click()

  // 初始：人數預設 2、日期預設今天 → 底部黏性列收成一列「還差」pills（電話/姓名/時段），無確認鈕
  const stillMissing = page.getByText('還差', { exact: true })
  await expect(stillMissing).toBeVisible()
  await expect(page.getByRole('button', { name: '電話', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '姓名', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '時段', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /確認新增/ })).toHaveCount(0)

  // 補電話、姓名 → 缺漏縮減為「時段」
  await page.getByPlaceholder('0912345678').fill('0933111222')
  await page.getByPlaceholder('王小姐').fill('測試客')
  await expect(page.getByRole('button', { name: '電話', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '時段', exact: true })).toBeVisible()

  // 日期點「明天」chip（避免今天的過時時段干擾）→ 選 18:00
  await page.getByRole('button', { name: /^明天/ }).click()
  await page.getByRole('button', { name: /18:00/ }).click()

  // 按鈕轉為可提交（含日期+時段+人數摘要）
  const confirmBtn = page.getByRole('button', { name: /✅ 確認新增 · .*18:00 · 2 位/ })
  await expect(confirmBtn).toBeEnabled()
  await confirmBtn.click()

  // 建立成功（未來日 → 一般建立 toast，附「預配桌位」捷徑）
  await expect(page.getByText(/測試客 2 位 · .*18:00 已建立/)).toBeVisible()
})

// 回歸：9+ 自由輸入逐鍵打兩位數（如 12）。舊版每鍵入一位就即時回寫 value，
// 打到「1」（≤8）的瞬間輸入框被收合卸載、焦點消失，第二位數打不進去（畫面一直跳掉）。
test('人數 9+ 自由輸入：逐鍵輸入兩位數不跳掉', async ({ page }) => {
  await page.goto('/login')
  await page.getByPlaceholder('your@email.com').fill('berrylin0911@gmail.com')
  await page.getByRole('button', { name: /模擬登入/ }).click()
  await expect(page).toHaveURL(/\/admin/)
  await page.getByRole('button', { name: /新增/ }).click()

  // 展開 9+ 輸入框（預設帶 9 並全選）
  await page.getByRole('button', { name: /9\+/ }).click()
  const input = page.getByLabel('自訂人數')
  await expect(input).toBeVisible()

  // 逐鍵打「12」：聚焦時全選預設的 9，第一鍵「1」蓋掉它 → 中間值 1 ≤ 8，輸入框必須留著
  await input.focus()
  await input.pressSequentially('12', { delay: 50 })
  await expect(input).toHaveValue('12')
  await expect(page.getByText(/已選：12 位/)).toBeVisible()

  // 失焦後維持展開且值不變
  await input.blur()
  await expect(input).toHaveValue('12')
})
