import { test, expect } from '@playwright/test'

// 「同步基準線落不了地」的主動警示（PR #109 後半段）。
//
// 為什麼要 e2e 而不是再補一支單測：判斷邏輯 shouldAlertPersistDegraded 已經有純函式單測，
// 但**真正會壞掉的是接線**——toastRef.current 在該時機是不是 null、useEffect 的依賴陣列
// 被改壞導致 check() 永遠不跑、輪詢被搬走…這些純函式測試一條都抓不到。而這條警示正好是
// 「平常永遠不會觸發、觸發時最需要它管用」的東西：它失效＝店主再一次無聲地弄丟排好的佈局
// （正是 #109 要修的那場事故）。所以在真瀏覽器裡從「localStorage 拒寫」一路驗到「畫面跳出
// 那句話」，中間任何一環斷掉都會紅。
//
// 手法：覆寫 Storage.prototype.setItem，**只讓同步狀態那把 key 拋錯**（模擬配額滿／iPad
// 無痕模式），其餘 key 照常寫入——不然整個 app 連桌位資料都存不了，測到的就不是這個 bug。
// 觸發點：adminPullData 回 ok:true → BookingContext.pullCloud → applyCloudSnapshot →
// persistSyncState() → setItem 拋錯 → 模組旗標 syncPersistDegraded 翻成 true。

const TOAST_TEXT = /你排的桌位可能在重新整理後消失/
const SETTINGS_BANNER = /佈局變更可能在重新整理後遺失/
const SYNC_STATE_KEY = 'chicken_sync_state_v1'
const POLL_MS = 4000 // BookingContext 旗標輪詢間隔

test.beforeEach(async ({ page }) => {
  // 單一 handler 依 URL 分流：Playwright 多個 page.route 的優先序（先註冊 vs 後註冊）
  // 在不同版本間曾有變動，而這支測試**依賴 adminPullData 真的回 ok:true**（否則
  // applyCloudSnapshot 不會被呼叫、也就不會走到 persistSyncState），不能賭匹配順序。
  await page.route('**/admin*', route => {
    const url = route.request().url()
    const ok = url.includes('adminPullData') || url.includes('adminPushData')
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(ok ? { ok: true } : { ok: false }),
    })
  })

  await page.addInitScript(({ key }) => {
    localStorage.removeItem('chicken_waitlist_v1')
    localStorage.removeItem('chicken_bookings_v1')
    localStorage.removeItem('chicken_group_reservations_v1')

    // 只毒這一把 key。用 QuotaExceededError 這個真實瀏覽器會丟的名字，
    // 讓 cloudDataService 的 catch 走在跟正式環境一樣的路徑上。
    const originalSetItem = Storage.prototype.setItem
    Storage.prototype.setItem = function (k, v) {
      if (k === key) {
        const err = new Error('e2e: simulated quota exceeded')
        err.name = 'QuotaExceededError'
        throw err
      }
      return originalSetItem.call(this, k, v)
    }
  }, { key: SYNC_STATE_KEY })

  // 「到底跳了幾次」的精準計數器。單靠 DOM 輪詢查不準：error toast 只存活 6 秒，
  // 兩次輪詢之間跳出又消失就漏抓了。改用 MutationObserver 記錄每一個「被插進 DOM 且
  // 含有那句話」的節點，重複轟炸一定會被記到。
  await page.addInitScript(() => {
    window.__persistToastSeen = 0
    const NEEDLE = '你排的桌位可能在重新整理後消失'
    const counted = new WeakSet()
    const scan = (node) => {
      if (!node || node.nodeType !== 1) return
      if (!(node.textContent || '').includes(NEEDLE)) return
      // 已計數節點的子孫不重複計（React 若分兩次插入外框與內文才不會算成兩則）
      for (let p = node.parentElement; p; p = p.parentElement) if (counted.has(p)) return
      counted.add(node)
      window.__persistToastSeen += 1
    }
    new MutationObserver(records => {
      records.forEach(r => r.addedNodes.forEach(scan))
    }).observe(document, { childList: true, subtree: true })
  })
})

// 登入後**停在現場頁**：這條警示的整個存在理由就是「店主日常都在現場帶位，
// 不會主動點進設定頁看靜態警示列」。在設定頁測等於沒測到重點。
async function loginToOnsite(page) {
  await page.goto('/login')
  await page.getByPlaceholder('your@email.com').fill('berrylin0911@gmail.com')
  await page.getByRole('button', { name: /模擬登入/ }).click()
  await expect(page).toHaveURL(/\/admin/)
  await page.locator('aside').getByRole('button', { name: '現場' }).click()
  await expect(page.getByText(/點右邊桌況圖選一張桌/)).toBeVisible()
}

test('同步基準線寫不進 localStorage 時，現場頁會主動跳 toast 警示', async ({ page }) => {
  await loginToOnsite(page)

  // 旗標翻起來要等一次輪詢（≤4 秒），放寬到 15 秒吸收登入與首拉的抖動。
  await expect(page.getByText(TOAST_TEXT)).toBeVisible({ timeout: 15_000 })

  // 人在現場頁時就看得到——不必先切到設定頁才會知道出事。
  await expect(page.getByText(/點右邊桌況圖選一張桌/)).toBeVisible()

  // 確認真的是那把 key 被擋、其餘 localStorage 照常運作（否則測到的是「整個 app 存不了東西」）
  const state = await page.evaluate(k => localStorage.getItem(k), SYNC_STATE_KEY)
  expect(state).toBeNull()
  expect(await page.evaluate(() => localStorage.getItem('chicken_tables_v3'))).not.toBeNull()
})

test('持續故障不會重複轟炸：整段期間只跳一次', async ({ page }) => {
  // 等 toast 自動消失（error toast 6 秒）再觀察數個輪詢週期，總時長超過預設 40 秒。
  test.setTimeout(90_000)

  await loginToOnsite(page)
  await expect(page.getByText(TOAST_TEXT)).toBeVisible({ timeout: 15_000 })
  expect(await page.evaluate(() => window.__persistToastSeen)).toBe(1)

  // 故障沒有排除（每 5 秒的拉取都會再踩一次 persistSyncState），旗標持續是 true。
  // 若哪天有人把 shouldAlertPersistDegraded 的守門拿掉、或改成「只要 degraded 就跳」，
  // 這裡就會累積成好幾則——那正是每 4 秒洗版一次的疲勞轟炸。
  await expect(page.getByText(TOAST_TEXT)).toHaveCount(0, { timeout: 15_000 }) // 6 秒後自動關閉
  await page.waitForTimeout(POLL_MS * 3)

  expect(await page.evaluate(() => window.__persistToastSeen)).toBe(1)
  await expect(page.getByText(TOAST_TEXT)).toHaveCount(0)
})

// 刻意不等 toast：靜態警示列與 toast 是兩條獨立的線（同一個 state，不同的呈現），
// toast 那條壞掉時這支要維持綠色，紅的才會精準指向真正壞掉的那一條。
test('設定頁的靜態警示列同時也在（事後想確認還在不在的查詢入口）', async ({ page }) => {
  await loginToOnsite(page)

  await page.locator('aside').getByRole('button', { name: '設定' }).click()
  await expect(page.getByText(SETTINGS_BANNER)).toBeVisible({ timeout: 15_000 })
})
