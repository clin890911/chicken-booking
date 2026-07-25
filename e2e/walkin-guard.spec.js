import { test, expect } from '@playwright/test'

// 現場帶位 v3 的兩道防呆（拿掉二次確認後，警示改綁在「已選的桌」上）：
// 1) 該桌是今日團體圈桌未入座 → 警示 + 滑桿鎖住，勾「仍要帶」才滑得動
// 2) 該桌被別筆訂位預先配走 → 同上；★ 併桌（多桌）時任一張有問題就要擋並指出是哪一桌
//    （舊版 walkin-multi 完全沒有這兩道防呆，是這次一併補上的漏洞）
// 後台本機模式以 localStorage 為後端；攔截 admin* 雲端端點。

const today = (() => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
})()

async function stubCloud(page) {
  await page.route('**/adminPullData', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'e2e-offline' }) }))
  await page.route('**/adminPushData', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }))
  await page.route('**/admin*', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false }) }))
}

async function loginToOps(page) {
  await page.goto('/login')
  await page.getByPlaceholder('your@email.com').fill('berrylin0911@gmail.com')
  await page.getByRole('button', { name: /模擬登入/ }).click()
  await expect(page).toHaveURL(/\/admin/)
  await page.locator('aside').getByRole('button', { name: '現場' }).click()
}

const slider = (page) => page.getByRole('button', { name: '滑動帶位 →' })

async function slide(page) {
  const knob = page.locator('[data-slide-knob]')
  const kb = await knob.boundingBox()
  const tb = await slider(page).boundingBox()
  await page.mouse.move(kb.x + kb.width / 2, kb.y + kb.height / 2)
  await page.mouse.down()
  await page.mouse.move(tb.x + tb.width, kb.y + kb.height / 2, { steps: 12 })
  await page.mouse.up()
}

test('帶位：點到今日團體圈桌 → 警示且滑桿鎖住，勾「仍要帶」後才可入座', async ({ page }) => {
  await stubCloud(page)
  await page.addInitScript((d) => {
    localStorage.removeItem('chicken_waitlist_v1')
    localStorage.removeItem('chicken_bookings_v1')
    localStorage.removeItem('chicken_tables_v3')
    localStorage.setItem('chicken_group_reservations_v1', JSON.stringify([{
      id: 'GHOLD1', schemaVersion: 2, date: d, agencyName: '防呆旅行社', guideName: '林導', guidePhone: '0911000111',
      counts: { total: 12, vegetarian: 0, child: 0, mobility: 0, wheelchair: 0 },
      allergyText: '', status: 'confirmed',
      batches: [{ id: 'BH1', label: '第一梯', timeSlot: '11:30', tableNumbers: ['101'], guests: 12, note: '' }],
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    }]))
  }, today)
  await loginToOps(page)

  // 點團保桌 101 → 選進面板 + 紅底警示指名該桌與該團
  await page.locator('svg g:has(:text-is("101"))').first().click()
  await expect(page.getByRole('button', { name: '移除桌 101' })).toBeVisible()
  await expect(page.getByText(/101 為今日團體 防呆旅行社 預留/)).toBeVisible()

  // 席數雖然夠，但警示未確認 → 滑桿仍鎖住
  await expect(slider(page)).toHaveAttribute('aria-disabled', 'true')

  // 勾「我知道，仍要帶這桌」→ 解鎖 → 滑動入座
  await page.getByRole('checkbox', { name: /仍要帶這桌/ }).check()
  await expect(slider(page)).not.toHaveAttribute('aria-disabled', 'true')

  await slide(page)
  await expect(page.getByText(/入座 101\s*·\s*可帶下一組/)).toBeVisible()
})

test('併桌：多桌中任一張被預先配走也要擋，且警示指出是哪一桌', async ({ page }) => {
  await stubCloud(page)
  await page.addInitScript((d) => {
    localStorage.removeItem('chicken_waitlist_v1')
    localStorage.removeItem('chicken_group_reservations_v1')
    localStorage.removeItem('chicken_tables_v3')
    // 102 已在排位規劃預先配給「預配客」（桌況仍是空桌，不點開抽屜看不出來）
    localStorage.setItem('chicken_bookings_v1', JSON.stringify([
      { id: 'PRE1', name: '預配客', phone: '0900222333', guests: 6, date: d, timeSlot: '18:00',
        status: 'confirmed', assignedTableId: '102', notes: {}, source: 'phone' },
    ]))
  }, today)
  await loginToOps(page)

  // 先點乾淨的 101 → 無警示
  await page.locator('svg g:has(:text-is("101"))').first().click()
  await expect(page.getByRole('button', { name: '移除桌 101' })).toBeVisible()
  await expect(slider(page)).not.toHaveAttribute('aria-disabled', 'true')

  // 再併上被預配的 102 → 警示出現且指名 102（不是 101）
  await page.locator('svg g:has(:text-is("102"))').first().click()
  await expect(page.getByRole('button', { name: '移除桌 102' })).toBeVisible()
  await expect(page.getByText(/102 已於排位規劃預留給 預配客/)).toBeVisible()
  await expect(slider(page)).toHaveAttribute('aria-disabled', 'true')

  // 拿掉那張桌 → 警示消失、滑桿恢復
  await page.getByRole('button', { name: '移除桌 102' }).click()
  await expect(page.getByText(/已於排位規劃預留給/)).toHaveCount(0)
  await expect(slider(page)).not.toHaveAttribute('aria-disabled', 'true')
})

test('短復原：入座後 toast 按「復原」→ 訂位取消、桌回到空桌可重帶', async ({ page }) => {
  await stubCloud(page)
  await page.addInitScript(() => {
    localStorage.removeItem('chicken_waitlist_v1')
    localStorage.removeItem('chicken_bookings_v1')
    localStorage.removeItem('chicken_group_reservations_v1')
    localStorage.removeItem('chicken_tables_v3')
  })
  await loginToOps(page)

  await page.locator('svg g:has(:text-is("113"))').first().click()
  await slide(page)
  await expect(page.getByText(/入座 113\s*·\s*可帶下一組/)).toBeVisible()

  // 拿掉二次確認換來的安全網：8 秒內可反悔
  await page.getByRole('button', { name: '復原' }).click()
  await expect(page.getByText(/已復原：113 回到空桌/)).toBeVisible()

  // 先等第一個入座 toast 收掉，否則下一段會同時看到新舊兩個同文字的 toast
  // （成功 toast 帶 8 秒 duration，這裡不等會誤判成「重複入座」）
  await expect(page.getByText(/入座 113\s*·\s*可帶下一組/)).toHaveCount(0)

  // 桌真的釋回空桌（重新選回面板，且能再帶一次 —— walkInSeat 只接受 vacant 桌）
  await expect(page.getByRole('button', { name: '移除桌 113' })).toBeVisible()
  await slide(page)
  // 剛好一個：證明第二次滑動確實入座，且沒有重複觸發
  await expect(page.getByText(/入座 113\s*·\s*可帶下一組/)).toHaveCount(1)
})
