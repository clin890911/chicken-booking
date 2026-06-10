import { defineConfig, devices } from '@playwright/test'

// E2E：用真實瀏覽器跑兩條主線（用戶端訂位 / 管理端指派）。
// 重要：所有測試都會攔截後端 function 端點（admin* / guest*），
// 絕不打到正式 Cloud Functions，確保測試獨立且不碰 production 資料。
//
// E2E_PORT：多 session 共用這台機器時，5173 常被「別的 checkout」的 dev server 佔走，
// reuseExistingServer 會重用到舊程式碼、整套測試得到假結果（已實際踩過兩次）。
// 在 worktree 跑測試請指定空埠，例：E2E_PORT=5199 npx playwright test
const PORT = Number(process.env.E2E_PORT || 5173)

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.js',
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
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
      grepInvert: /@mobile/,
    },
    // 手機：只跑標記 @mobile 的測試。顧客在手機上實際使用的是 MobileActionBar 固定底欄
    // （桌面摘要卡 lg 以下隱藏），2026-06 手機白屏 bug（PR #19）在桌面 viewport 永遠測不到，
    // 故補真機尺寸並跑雙引擎（chromium + webkit≒iOS Safari）。
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] }, grep: /@mobile/ },
    { name: 'mobile-webkit', use: { ...devices['iPhone 14'] }, grep: /@mobile/ },
  ],
  webServer: {
    command: `npm run dev -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: true,
    timeout: 60_000,
  },
})
