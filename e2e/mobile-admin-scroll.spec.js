import { test, expect } from '@playwright/test'

// 手機版面（方向 A：手機上整頁捲，2026-11）＋ iPad 不變回歸。
// 手機條件：(max-width: 767px), (max-height: 500px)。iPad 橫向 1180×820 是尖峰主力，版面與互動一 px 都不能動。
// 捲動一律用真的觸控手勢（CDP Input.synthesizeScrollGesture，走 Chromium 手勢管線，受 touch-action／overscroll／巢狀捲動影響）；
// scrollTop 與 mouse wheel 測不出「手指放在桌況圖上滑不動」這種 bug。本機沒有 WebKit，iOS 行為只能推論。
// 資料用 ?demo=ops（dev server 才有），時間固定當地 12:00。

const CONTENT = '[data-testid=admin-content]'
const MAP_SVG = 'svg[aria-label$="桌況圖"]'
const SEAT = '[data-testid=walkin-seat]'
const JUMP = '[data-testid=ops-phone-jump]'
const BANNER = '[data-testid=mode-banner]'
const tableOf = (n) => `${MAP_SVG} g[data-table-number="${n}"]`

test.use({ timezoneId: 'Asia/Taipei' })

test.beforeEach(async ({ page }) => {
  await page.route('https://**/*', route => route.abort())
  await page.route('**/adminPullData', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'e2e-offline' }) }))
  await page.route('**/adminPushData', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }))
  await page.route('**/admin*', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false }) }))
  const d = new Date()
  const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  await page.clock.setFixedTime(new Date(`${ymd}T12:00:00+08:00`))
})

async function login(page) {
  await page.goto('/login?demo=ops')
  await page.getByPlaceholder('your@email.com').fill('berrylin0911@gmail.com')
  await page.getByRole('button', { name: /模擬登入/ }).click()
  await expect(page).toHaveURL(/\/admin/)
  // 沙盒專屬的「雲端同步未啟用」橫幅正式站不會出現，藏起來才是正式站的版面
  await page.addStyleTag({ content: 'main > div.border-chicken-red.bg-red-50{display:none !important}' })
}

const navTo = async (page, label) => {
  const nav = page.locator('nav.lg-bottomnav')
  if (await nav.isVisible()) await nav.locator('button', { hasText: label }).tap()
  else await page.locator('aside').getByRole('button', { name: label }).click()
}

const swipe = async (page, x, y, dy) => {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Input.synthesizeScrollGesture', { x, y, yDistance: dy, speed: 1600, gestureSourceType: 'touch', preventFling: true })
  await cdp.detach()
  await page.waitForTimeout(60)
}

// 元素中心在視窗內，且那一點打到的是元素自己（沒被蓋、沒被裁）
const hittable = (page, selectorOrHandle) => (typeof selectorOrHandle === 'string'
  ? page.locator(selectorOrHandle).first().elementHandle()
  : Promise.resolve(selectorOrHandle)).then(h => h && h.evaluate(el => {
  const r = el.getBoundingClientRect()
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2
  if (!r.width || !r.height || cx < 0 || cy < 0 || cx >= innerWidth || cy >= innerHeight) return false
  const hit = document.elementFromPoint(cx, cy)
  return !!hit && (hit === el || el.contains(hit))
}))

// 跳轉鈕是平滑捲動：等內容區停下來再量
const settled = async (page) => {
  let prev = -1
  for (let i = 0; i < 40; i++) {
    const { top } = await contentScroll(page)
    if (top === prev) return
    prev = top
    await page.waitForTimeout(80)
  }
}

const contentScroll = (page) => page.locator(CONTENT).evaluate(el => ({ top: el.scrollTop, max: el.scrollHeight - el.clientHeight, ch: el.clientHeight }))

// 手指放在內容區中間一路往上滑，直到條件成立；回傳滑了幾次（滑不動就丟）
async function swipeUntil(page, cond, { step = 140, max = 40 } = {}) {
  const { width, height } = page.viewportSize()
  for (let i = 0; i <= max; i++) {
    if (await cond()) return i
    const before = await contentScroll(page)
    await swipe(page, Math.round(width / 2), Math.round(height / 2), -step)
    const after = await contentScroll(page)
    if (after.top === before.top && !(await cond())) throw new Error(`滑到底了條件仍不成立（top=${after.top}/${after.max}）`)
  }
  throw new Error('滑太多次')
}

// 跳轉鈕用平滑捲動：等位置穩定才點（否則點到移動中的舊座標）
const tapCenter = async (page, selector) => {
  const loc = page.locator(selector).first()
  let box = await loc.boundingBox()
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(60)
    const next = await loc.boundingBox()
    if (next.y === box.y && next.x === box.x) break
    box = next
  }
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)
}

// 桌況圖在視窗內實際看得到的高度（被 overflow 祖先裁切後）
const mapVisibleHeight = (page) => page.locator(MAP_SVG).first().evaluate(svg => {
  const r = svg.getBoundingClientRect()
  let top = r.top, bottom = Math.min(r.bottom, innerHeight)
  for (let n = svg.parentElement; n && n !== document.body; n = n.parentElement) {
    if (getComputedStyle(n).overflowY !== 'visible') { const a = n.getBoundingClientRect(); top = Math.max(top, a.top); bottom = Math.min(bottom, a.bottom) }
  }
  return Math.max(0, Math.round(bottom - top))
})

// 選桌模式捲動容器是桌況圖那一區（不是內容區）：手指放地圖上往上滑，直到目標桌點得到
async function swipeMapUntilHit(page, selector) {
  for (let i = 0; i < 12; i++) {
    if (await hittable(page, selector)) return
    const b = await page.locator('[data-testid=ops-map-card]').boundingBox()
    await swipe(page, Math.round(b.x + b.width / 2), Math.round(Math.min(b.y + 150, page.viewportSize().height - 90)), -90)
  }
  throw new Error(`${selector} 滑不到`)
}

const noHorizontalOverflow = async (page, label) => {
  const o = await page.evaluate((sel) => {
    const c = document.querySelector(sel)
    return { c: c.scrollWidth - c.clientWidth, doc: document.scrollingElement.scrollWidth - innerWidth }
  }, CONTENT)
  expect(o, `水平溢出：${label}`).toEqual({ c: 0, doc: 0 })
}

for (const size of [{ width: 390, height: 844 }, { width: 360, height: 640 }, { width: 844, height: 390 }]) {
  test.describe(`手機 ${size.width}×${size.height}`, () => {
    test.use({ viewport: size, hasTouch: true, isMobile: true })

    test.beforeEach(async ({ page }) => {
      await login(page)
      await navTo(page, '現場')
      await expect(page.locator(JUMP)).toBeVisible()
    })

    test('預設今日籤；三籤都點得到；現場頁能整頁捲到桌況圖', async ({ page }) => {
      await expect(page.locator('.lg-tabs [data-active=true]')).toContainText('今日')
      for (const name of ['帶位', '候位', '今日']) {
        const tab = page.locator('.lg-tabs button', { hasText: name })
        expect(await hittable(page, await tab.elementHandle()), `籤 ${name}`).toBe(true)
        await tab.tap()
        await expect(tab).toHaveAttribute('data-active', 'true')
      }
      const { max } = await contentScroll(page)
      expect(max).toBeGreaterThan(200)
      await swipeUntil(page, async () => (await mapVisibleHeight(page)) > 100, { step: 300 })
      await noHorizontalOverflow(page, '現場')
    })

    test('跳轉鈕：清單 ⇄ 桌況圖；觸控 ≥ 44px', async ({ page }) => {
      const jump = page.locator(JUMP)
      expect(Math.round((await jump.boundingBox()).height)).toBeGreaterThanOrEqual(44)
      await expect(jump).toContainText('桌況圖')
      await jump.tap()
      await expect.poll(() => mapVisibleHeight(page)).toBeGreaterThan(100)
      await expect(jump).toContainText('回今日')
      await jump.tap()
      await expect(page.locator('.lg-tabs button', { hasText: '今日' })).toBeInViewport()
      await expect(jump).toContainText('桌況圖')
    })

    test('帶位：桌況圖選桌 → 跳回 → 確認入座可點且真的入座', async ({ page }) => {
      await page.locator('.lg-tabs button', { hasText: '帶位' }).tap()
      await swipeUntil(page, () => hittable(page, SEAT), { step: 100 })
      await page.locator(JUMP).tap()
      await expect.poll(() => mapVisibleHeight(page)).toBeGreaterThan(100)
      await tapCenter(page, tableOf('113'))
      await expect(page.locator(JUMP)).toContainText('回帶位')
      await page.locator(JUMP).tap()
      await expect(page.locator(SEAT)).toContainText('113')
      await expect.poll(() => hittable(page, SEAT)).toBe(true)
      await page.locator(SEAT).tap()
      await expect(page.getByText(/入座/).first()).toBeVisible()
      await expect(page.locator(SEAT)).not.toContainText('113')
    })

    test('新增今日訂位：主鈕滑得到、點得到', async ({ page }) => {
      await page.getByRole('button', { name: /新增今日訂位/ }).tap()
      const panel = page.getByTestId('quick-reserve-panel')
      await expect(panel).toBeVisible()
      const mainBtn = panel.locator('[data-rail-footer] > button').last()
      await swipeUntil(page, async () => hittable(page, await mainBtn.elementHandle()), { step: 100 })
    })

    test('點桌 → 抽屜出現在可視範圍、每顆鈕都點得到；關掉回到地圖', async ({ page }) => {
      await page.locator(JUMP).tap()
      await expect.poll(() => mapVisibleHeight(page)).toBeGreaterThan(100)
      await settled(page)
      await tapCenter(page, tableOf('113'))
      const drawer = page.locator('.lg-drawer')
      await expect(drawer).toBeVisible()
      const inView = await drawer.evaluate(d => { const r = d.getBoundingClientRect(); return r.top >= 0 && r.top < innerHeight / 2 })
      expect(inView, '抽屜上緣要在可視範圍').toBe(true)
      expect(await hittable(page, await drawer.getByRole('button', { name: '關閉' }).elementHandle())).toBe(true)
      const buttons = await drawer.locator('button').elementHandles()
      expect(buttons.length).toBeGreaterThan(1)
      for (const b of buttons) await swipeUntil(page, () => hittable(page, b), { step: 90 }).catch(async e => { throw new Error(`${await b.innerText()}：${e.message}`) })
      await swipeUntil(page, async () => hittable(page, await drawer.getByRole('button', { name: '關閉' }).elementHandle()).then(Boolean), { step: -160 }).catch(() => {})
      await drawer.getByRole('button', { name: '關閉' }).tap()
      await expect(drawer).toHaveCount(0)
      await expect.poll(() => mapVisibleHeight(page)).toBeGreaterThan(100)
    })

    test('選桌模式（多桌）：橫幅精簡、桌況圖可見、確認入座點得到', async ({ page }) => {
      await page.locator(JUMP).tap()
      const arrive = page.getByRole('button', { name: /到了.*選桌/ }).first()
      await arrive.scrollIntoViewIfNeeded()
      await arrive.tap()
      const banner = page.locator(BANNER)
      await expect(banner).toBeInViewport()
      expect((await banner.boundingBox()).height, '舊版 304–324px').toBeLessThan(size.height > 500 ? 180 : 330)
      await expect.poll(() => mapVisibleHeight(page)).toBeGreaterThan(150)
      await noHorizontalOverflow(page, '選桌模式')
      await expect(page.locator(JUMP)).toHaveCount(0)
      // 手指放桌況圖上也滑得動：把目標桌滑進來、點下去，橫幅還在
      await swipeMapUntilHit(page, tableOf('113'))
      await tapCenter(page, tableOf('113'))
      const confirm = banner.getByRole('button', { name: /確認/ }).first()
      await expect(confirm).toBeEnabled()
      expect(await hittable(page, await confirm.elementHandle())).toBe(true)
      await banner.getByRole('button', { name: '取消' }).first().tap()
      await expect(banner).toHaveCount(0)
      await expect(page.locator(JUMP)).toBeVisible()
    })

    test('選桌模式（單桌改桌）：確認／取消都點得到', async ({ page }) => {
      const move = page.locator('[data-booking-id]').getByRole('button', { name: '改桌' }).first()
      await move.scrollIntoViewIfNeeded()
      await move.tap()
      const banner = page.locator(BANNER)
      await expect(banner).toBeInViewport()
      await expect.poll(() => mapVisibleHeight(page)).toBeGreaterThan(150)
      await swipeMapUntilHit(page, tableOf('113'))
      await tapCenter(page, tableOf('113'))
      const confirm = banner.getByRole('button', { name: /確認/ }).first()
      await expect(confirm).toBeVisible()
      expect((await banner.boundingBox()).height).toBeLessThan(size.height > 500 ? 240 : 330)
      expect(await hittable(page, await confirm.elementHandle())).toBe(true)
      expect(await hittable(page, await banner.getByRole('button', { name: '取消' }).first().elementHandle())).toBe(true)
    })

    test('手指落在桌況圖上也能繼續捲（現場頁、規劃頁）', async ({ page }) => {
      await page.locator(JUMP).tap()
      await expect.poll(() => mapVisibleHeight(page)).toBeGreaterThan(100)
      await settled(page)
      const center = async () => { const b = await page.locator(MAP_SVG).first().boundingBox(); return [Math.round(b.x + b.width / 2), Math.round(Math.min(b.y + b.height / 2, size.height - 90))] }
      let before = await contentScroll(page)
      const [x, y] = await center()
      await swipe(page, x, y, 150)
      expect((await contentScroll(page)).top, '現場頁：手指在地圖上往下滑').toBeLessThan(before.top)

      await navTo(page, '規劃')
      await page.getByRole('button', { name: /^排位地圖$/ }).first().tap()
      await expect(page.locator(MAP_SVG).first()).toBeAttached()
      await swipeUntil(page, async () => (await mapVisibleHeight(page)) > 100, { step: 200 })
      const b2 = await page.locator(MAP_SVG).first().boundingBox()
      before = await contentScroll(page)
      const px = Math.round(b2.x + b2.width / 2), py = Math.round(Math.max(b2.y + 40, 60))
      await swipe(page, px, py, before.top > 0 ? 120 : -120)
      expect((await contentScroll(page)).top, '規劃頁：手指在地圖上').not.toBe(before.top)
      await noHorizontalOverflow(page, '排位地圖')
    })

    test('放大視圖：可切樓層、點桌可操作', async ({ page }) => {
      await page.locator(JUMP).tap()
      await page.getByRole('button', { name: '放大視圖' }).tap()
      const dialog = page.getByRole('dialog', { name: /放大桌況圖/ })
      await expect(dialog).toBeVisible()
      await dialog.getByRole('button', { name: '2F' }).tap()
      await expect(dialog).toHaveAttribute('aria-label', /2F/)
      await dialog.getByRole('button', { name: '1F' }).tap()
      await tapCenter(page, `[role=dialog] g[data-table-number="113"]`)
      await expect(dialog).toHaveCount(0)
      // 抽屜標題（桌號）要在畫面內：還焦點曾把頁面捲回放大鈕，第一眼只看到動作鈕、不知道是哪一桌
      await expect.poll(async () => (await page.locator('.lg-drawer').boundingBox())?.y).toBeGreaterThanOrEqual(0)
      expect((await page.locator('.lg-drawer').boundingBox()).y).toBeLessThan(size.height / 2)
    })

    test('圖例預設收合、可展開；鍵盤提示藏起來', async ({ page }) => {
      await expect(page.getByText('待清桌', { exact: true })).toBeHidden()
      await expect(page.getByText(/Tab 選桌/)).toBeHidden()
      const toggle = page.getByRole('button', { name: '圖例' })
      await toggle.scrollIntoViewIfNeeded()
      await toggle.tap()
      await expect(page.getByText('待清桌', { exact: true })).toBeVisible()
    })

    test('電話數字鍵盤不超出視窗', async ({ page }) => {
      await page.locator('.lg-tabs button', { hasText: '帶位' }).tap()
      const phone = page.getByLabel('電話').first()
      await phone.scrollIntoViewIfNeeded()
      await phone.tap()
      const box = await page.getByRole('dialog', { name: '電話數字鍵盤' }).boundingBox()
      expect(box.y).toBeGreaterThanOrEqual(0)
      expect(box.y + box.height).toBeLessThanOrEqual(size.height)
      expect(await hittable(page, await page.getByRole('button', { name: 'OK' }).elementHandle())).toBe(true)
    })

    test('切分頁回到頂端：訂位捲下去再切現場，不殘留捲動位置', async ({ page }) => {
      await navTo(page, '訂位')
      await page.locator(CONTENT).evaluate(el => { el.scrollTop = 600 })
      await navTo(page, '現場')
      await expect(page.locator(JUMP)).toBeVisible()
      expect(await page.locator(CONTENT).evaluate(el => el.scrollTop)).toBe(0)
    })

    test('其他頁：今日清單可捲、新增訂位備註框不被蓋、整頁沒有水平溢出', async ({ page }) => {
      await navTo(page, '訂位')
      await page.getByRole('button', { name: /^今日$/ }).tap()
      const list = page.getByTestId('today-list')
      await expect(list).toBeVisible()
      // 手機橫向舊版清單只剩 8px；現在清單不再自己捲、跟著頁面走
      expect((await list.boundingBox()).height).toBeGreaterThan(100)
      await noHorizontalOverflow(page, '訂位今日')

      await page.getByRole('button', { name: /^新增$/ }).tap()
      const note = page.getByPlaceholder(/靠窗|慶生|特殊|備註/).first()
      await expect(note).toBeAttached()
      await swipeUntil(page, async () => hittable(page, await note.elementHandle()), { step: 150 })
      await noHorizontalOverflow(page, '新增訂位')

      await navTo(page, '規劃')
      await page.getByRole('button', { name: /^排位地圖$/ }).first().tap()
      await noHorizontalOverflow(page, '排位地圖')
      for (const b of await page.locator('[aria-label="場次"] > button').elementHandles()) {
        const r = await b.boundingBox()
        expect(r.x + r.width, '場次按鈕都在畫面內').toBeLessThanOrEqual(size.width)
      }
      await page.getByRole('button', { name: /^當日總覽$/ }).tap()
      await page.getByRole('button', { name: /^新增團單$/ }).first().tap()
      await expect(page.getByText('旅行社與導遊')).toBeVisible()
      await noHorizontalOverflow(page, '新增團單')
      await navTo(page, '名冊')
      await noHorizontalOverflow(page, '名冊')
      await navTo(page, '設定')
      await noHorizontalOverflow(page, '設定')
    })

    test('版面編輯器：窄螢幕給提示，夠寬照常', async ({ page }) => {
      await navTo(page, '設定')
      await page.evaluate(() => document.querySelectorAll('[data-testid=admin-content] details').forEach(d => { d.open = true }))
      for (const label of ['現場與桌位']) await page.getByRole('button', { name: label }).locator('visible=true').first().tap()
      await page.getByText('桌位佈局', { exact: true }).first().tap().catch(() => {})
      const open = page.getByRole('button', { name: '開啟桌位佈局編輯器' })
      await open.scrollIntoViewIfNeeded()
      await open.tap()
      const notice = page.getByTestId('layout-editor-narrow')
      if (size.width < 768) {
        await expect(notice).toBeVisible()
        await expect(notice).toContainText('請到 iPad 或電腦編輯版面')
        await notice.getByRole('button', { name: '返回' }).tap()
        await expect(notice).toHaveCount(0)
      } else {
        await expect(notice).toBeHidden()
        await expect(page.getByRole('heading', { name: '桌位佈局編輯器' })).toBeVisible()
      }
    })
  })
}

// 窄又矮（小手機、Android 鍵盤縮視窗、分割畫面）：不可走手機橫向的左右分欄，否則選桌模式桌況圖寬度變 0、只剩取消能按
for (const size of [{ width: 390, height: 480 }, { width: 320, height: 460 }]) {
  test.describe(`窄又矮 ${size.width}×${size.height}`, () => {
    test.use({ viewport: size, hasTouch: true, isMobile: true })

    test('選桌模式：桌況圖有寬度、點得到桌、確認點得到', async ({ page }) => {
      await login(page)
      await navTo(page, '現場')
      await expect(page.locator(JUMP)).toBeVisible()
      const arrive = page.getByRole('button', { name: /到了.*選桌/ }).first()
      await arrive.scrollIntoViewIfNeeded()
      await arrive.tap()
      const banner = page.locator(BANNER)
      await expect(banner).toBeInViewport()
      expect((await page.locator(MAP_SVG).first().boundingBox()).width).toBeGreaterThan(200)
      await swipeMapUntilHit(page, tableOf('113'))
      await tapCenter(page, tableOf('113'))
      const confirm = banner.getByRole('button', { name: /確認/ }).first()
      await expect(confirm).toBeEnabled()
      expect(await hittable(page, await confirm.elementHandle())).toBe(true)
    })
  })
}

test.describe('iPad 橫向 1180×820 回歸（尖峰主力，版面與互動不可變動）', () => {
  test.use({ viewport: { width: 1180, height: 820 }, hasTouch: true, isMobile: true })

  test.beforeEach(async ({ page }) => {
    await login(page)
    await navTo(page, '現場')
    await expect(page.locator(MAP_SVG).first()).toBeVisible()
  })

  const metrics = (page) => page.evaluate((sel) => {
    const svg = document.querySelector(sel)
    const vb = svg.viewBox.baseVal, r = svg.getBoundingClientRect()
    const s = Math.min(r.width / vb.width, r.height / vb.height)
    const shorts = [...svg.querySelectorAll('g[role=button]')].map(g => { const q = g.getBoundingClientRect(); return Math.min(q.width, q.height) }).sort((a, b) => a - b)
    const card = document.querySelector('.lg-tabs').parentElement
    const inner = [...card.querySelectorAll('div')].find(d => /(auto|scroll)/.test(getComputedStyle(d).overflowY))
    const c = document.querySelector('[data-testid=admin-content]')
    return {
      rail: Math.round(card.getBoundingClientRect().height), inner: Math.round(inner.getBoundingClientRect().height),
      drawnW: Math.round(vb.width * s), drawnH: Math.round(vb.height * s), short: Math.round(shorts[0] * 10) / 10,
      overflow: c.scrollHeight - c.clientHeight, docOverflow: document.scrollingElement.scrollHeight - innerHeight,
      contentOverflowY: getComputedStyle(c).overflowY, tab: document.querySelector('.lg-tabs [data-active=true]').innerText.trim(),
    }
  }, MAP_SVG)

  test('整頁不捲、左欄與桌況圖尺寸與基準相同、預設籤帶位', async ({ page }) => {
    const m = await metrics(page)
    expect(m).toEqual({ rail: 704, inner: 479, drawnW: 521, drawnH: 472, short: 49.3, overflow: 0, docOverflow: 0, contentOverflowY: 'hidden', tab: '帶位' })
    await page.locator('[role=tablist][aria-label=樓層] button', { hasText: '2F' }).click()
    expect((await metrics(page)).short).toBe(42)
    expect(await hittable(page, SEAT)).toBe(true)
  })

  test('手機專屬的東西都不出現；放大視圖沒有樓層切換；提示與圖例照舊', async ({ page }) => {
    await expect(page.locator(JUMP)).toBeHidden()
    await expect(page.getByRole('button', { name: '圖例' })).toBeHidden()
    await expect(page.getByText('待清桌', { exact: true })).toBeVisible()
    await expect(page.getByText(/Tab 選桌/)).toBeVisible()
    await page.getByRole('button', { name: '放大視圖' }).click()
    const dialog = page.getByRole('dialog', { name: /放大桌況圖/ })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('button', { name: '2F' })).toBeHidden()
    await dialog.getByRole('button', { name: '關閉放大視圖' }).click()
  })

  test('放大拖曳：zoom>1 地圖內可捲且 contain；全貌時不 contain', async ({ page }) => {
    const vp = page.locator(MAP_SVG).first().locator('xpath=..')
    expect(await vp.evaluate(el => getComputedStyle(el).overscrollBehaviorY)).toBe('auto')
    await page.getByRole('button', { name: '放大地圖' }).click()
    await page.getByRole('button', { name: '放大地圖' }).click()
    expect(await vp.evaluate(el => getComputedStyle(el).overscrollBehaviorY)).toBe('contain')
    const box = await vp.boundingBox()
    await swipe(page, Math.round(box.x + box.width / 2), Math.round(box.y + box.height / 2), -150)
    expect(await vp.evaluate(el => el.scrollTop), '手指拖地圖＝地圖自己捲').toBeGreaterThan(50)
    expect((await page.locator(CONTENT).evaluate(el => el.scrollTop)), '整頁不動').toBe(0)
  })

  test('規劃頁：手指落在桌況圖上仍能捲頁面', async ({ page }) => {
    await navTo(page, '規劃')
    await page.getByRole('button', { name: /^排位地圖$/ }).first().click()
    await expect(page.locator(MAP_SVG).first()).toBeVisible()
    const before = await contentScroll(page)
    test.skip(before.max < 40, '這個尺寸排位地圖整頁放得下，沒有捲動可驗')
    const b = await page.locator(MAP_SVG).first().boundingBox()
    await swipe(page, Math.round(b.x + b.width / 2), Math.round(Math.min(b.y + b.height / 2, 700)), -120)
    expect((await contentScroll(page)).top).toBeGreaterThan(before.top)
  })
})
