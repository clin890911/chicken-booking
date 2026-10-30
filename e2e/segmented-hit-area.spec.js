import { test, expect } from '@playwright/test'

// SegmentedControl 觸控區：視覺高度維持 32px（md）／28px（sm），但可點區（::after）上下外擴到 ≥44px，
// 且左右不外擴（相鄰按鈕貼在一起，外擴會互相重疊誤觸）。
// 用 getBoundingClientRect 量視覺高度、用 elementFromPoint 驗「32px 外、44px 內」的點真的打到該按鈕，
// 以及左右相鄰按鈕交界兩側各打到自己。後台在本機開發模式（無 Firebase），攔截 admin* 雲端端點。

test.beforeEach(async ({ page }) => {
  await page.route('**/adminPullData', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'e2e-offline' }) }))
  await page.route('**/adminPushData', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }))
  await page.route('**/admin*', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false }) }))
})

async function login(page) {
  await page.goto('/login')
  await page.getByPlaceholder('your@email.com').fill('berrylin0911@gmail.com')
  await page.getByRole('button', { name: /模擬登入/ }).click()
  await expect(page).toHaveURL(/\/admin/)
}

// 回傳每顆按鈕的視覺矩形、上下外擴 EXT 的邊緣點打到誰、以及與下一顆按鈕交界處兩側的點打到誰
async function probe(page, ariaLabel, ext) {
  return page.evaluate(({ ariaLabel, ext }) => {
    const bar = document.querySelector(`[aria-label="${ariaLabel}"]`)
    const btns = [...bar.querySelectorAll(':scope > button')]
    return btns.map((b, i) => {
      const r = b.getBoundingClientRect()
      const cx = r.left + r.width / 2
      const hit = (x, y) => document.elementFromPoint(x, y)?.closest('button') === b
      const next = btns[i + 1]
      const nr = next?.getBoundingClientRect()
      const seam = nr ? (r.right + nr.left) / 2 : null
      return {
        label: b.textContent.trim(),
        height: r.height,
        // 視覺外 1px 起、外擴量內 1px 止（44px 內）都要打得到自己
        hitAboveInside: hit(cx, r.top - ext + 1),
        hitBelowInside: hit(cx, r.bottom + ext - 1),
        // 超出 44px 一點點不該再打到這顆（沒有過度外擴）
        hitAboveOutside: hit(cx, r.top - ext - 3),
        hitBelowOutside: hit(cx, r.bottom + ext + 3),
        // 與右鄰交界：左側 2px 內是自己、右側 2px 內是鄰居（沒有水平重疊誤觸）
        seamOwn: nr ? hit(seam - 2, r.top - ext + 1) : null,
        seamNeighbour: nr ? document.elementFromPoint(seam + 2, r.top - ext + 1)?.closest('button') === next : null,
      }
    })
  }, { ariaLabel, ext })
}

test('SegmentedControl md：視覺 32px、可點區外擴到 44px、左右不重疊', async ({ page }) => {
  await login(page)
  await expect(page.getByLabel('訂位子分頁')).toBeVisible()
  const rows = await probe(page, '訂位子分頁', 6)
  expect(rows.length).toBeGreaterThanOrEqual(3)
  for (const r of rows) {
    expect(r.height, r.label).toBeCloseTo(32, 0)
    expect(r.hitAboveInside, `${r.label} 上方 44px 內`).toBe(true)
    expect(r.hitBelowInside, `${r.label} 下方 44px 內`).toBe(true)
    expect(r.hitAboveOutside, `${r.label} 上方 44px 外`).toBe(false)
    expect(r.hitBelowOutside, `${r.label} 下方 44px 外`).toBe(false)
    if (r.seamOwn !== null) {
      expect(r.seamOwn, `${r.label} 交界左側`).toBe(true)
      expect(r.seamNeighbour, `${r.label} 交界右側屬於鄰居`).toBe(true)
    }
  }
  // 真的點擊：點在視覺高度外、44px 內，要切到該分頁
  const search = page.getByLabel('訂位子分頁').getByRole('button', { name: /查詢/ })
  const box = await search.boundingBox()
  await page.mouse.click(box.x + box.width / 2, box.y - 4)
  await expect(search).toHaveAttribute('aria-pressed', 'true')
})

test('SegmentedControl sm：視覺 28px、可點區外擴到 44px、左右不重疊', async ({ page }) => {
  // 原本量訂位「今日」的來源篩選；2026-10-31 它併進「篩選」選單（多選勾選），改量名冊「顧客篩選」（同為 sm）
  await login(page)
  await page.locator('aside').getByRole('button', { name: '名冊' }).click()
  await expect(page.getByLabel('顧客篩選')).toBeVisible()
  const rows = await probe(page, '顧客篩選', 8)
  expect(rows.length).toBeGreaterThanOrEqual(2)
  for (const r of rows) {
    expect(r.height, r.label).toBeCloseTo(28, 0)
    expect(r.hitAboveInside, `${r.label} 上方 44px 內`).toBe(true)
    expect(r.hitBelowInside, `${r.label} 下方 44px 內`).toBe(true)
    expect(r.hitAboveOutside, `${r.label} 上方 44px 外`).toBe(false)
    expect(r.hitBelowOutside, `${r.label} 下方 44px 外`).toBe(false)
    if (r.seamOwn !== null) {
      expect(r.seamOwn, `${r.label} 交界左側`).toBe(true)
      expect(r.seamNeighbour, `${r.label} 交界右側屬於鄰居`).toBe(true)
    }
  }
})
