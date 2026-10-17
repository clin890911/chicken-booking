import { defineConfig, devices } from '@playwright/test'

// E2E：用真實瀏覽器跑兩條主線（用戶端訂位 / 管理端指派）。
// 重要：所有測試都會攔截後端 function 端點（admin* / guest*），
// 絕不打到正式 Cloud Functions，確保測試獨立且不碰 production 資料。
//
// E2E_PORT：多 session 共用這台機器時，5173 常被「別的 checkout」的 dev server 佔走，
// reuseExistingServer 會重用到舊程式碼、整套測試得到假結果（已實際踩過兩次）。
// 在 worktree 跑測試請指定空埠，例：E2E_PORT=5199 npx playwright test
const PORT = Number(process.env.E2E_PORT || 5173)

// 安全網：Chromium 在瀏覽器層把 localhost 以外的主機一律解析失敗。
// 各 spec 靠 page.route 攔後端端點，一旦漏攔就會打到正式 Cloud Functions；
// 這條保證漏攔時只會「連不到」而不是寫進正式資料。（WebKit 不吃此參數，mobile-webkit 不套。）
const OFFLINE_CHROMIUM = { args: ['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1'] }

// 候位真交易 E2E（PR #176）：要 Firestore emulator＋本機 5201 handler＋VITE_FUNCTION_BASE_URL 指向它的
// dev server，只能用 scripts/test/waitlist-playwright.config.js 跑（`npm run test:e2e:waitlist`）。
// 在這份主設定裡它們必定在 beforeAll 拋「Isolated test requires…」——排除掉，不算主線失敗。
// 清單須與 waitlist-playwright.config.js 的 testMatch 成對維護。
const WAITLIST_EMULATOR_SPECS = ['**/waitlist-stability*.spec.js', '**/waitlist-seat.spec.js', '**/waitlist-multi-seat.spec.js']

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.js',
  testIgnore: WAITLIST_EMULATOR_SPECS,
  timeout: 40_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1280, height: 800 },
    actionTimeout: 10_000,
    trace: 'retain-on-failure',
  },
  projects: [
    // 桌面主力：跑全部非 @mobile 測試。
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 }, launchOptions: OFFLINE_CHROMIUM },
      grepInvert: /@mobile/,
    },
    // 手機：只跑標記 @mobile 的測試。顧客在手機上實際使用的是 MobileActionBar 固定底欄
    // （桌面摘要卡 lg 以下隱藏），2026-06 手機白屏 bug（PR #19）在桌面 viewport 永遠測不到，
    // 故補真機尺寸並跑雙引擎（chromium + webkit≒iOS Safari）。
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'], launchOptions: OFFLINE_CHROMIUM }, grep: /@mobile/ },
    { name: 'mobile-webkit', use: { ...devices['iPhone 14'] }, grep: /@mobile/ },
  ],
  webServer: {
    command: `npm run dev -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: true,
    timeout: 60_000,
  },
})
