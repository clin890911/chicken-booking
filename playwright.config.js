import { defineConfig, devices } from '@playwright/test'

// E2E：用真實瀏覽器跑兩條主線（用戶端訂位 / 管理端指派）。
// 重要：所有測試都會攔截後端 function 端點（admin* / guest*），
// 絕不打到正式 Cloud Functions，確保測試獨立且不碰 production 資料。
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
    baseURL: 'http://localhost:5173',
    viewport: { width: 1280, height: 800 },
    actionTimeout: 10_000,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
})
