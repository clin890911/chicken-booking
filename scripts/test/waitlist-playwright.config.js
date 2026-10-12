import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: '../../e2e', testMatch: ['waitlist-stability*.spec.js','waitlist-seat.spec.js','waitlist-multi-seat.spec.js'], workers: 1, fullyParallel: false,
  timeout: 120000, expect: {timeout:15000}, reporter: [['list']],
  use: {baseURL:'http://127.0.0.1:5199',viewport:{width:1024,height:1366},trace:'retain-on-failure',actionTimeout:15000,
    launchOptions:{executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1']}},
  webServer:{command:'npm run dev -- --host 127.0.0.1 --port 5199 --strictPort',url:'http://127.0.0.1:5199',reuseExistingServer:false,
    env:{VITE_FUNCTION_BASE_URL:'http://127.0.0.1:5201',VITE_FIREBASE_API_KEY:'placeholder',VITE_FIREBASE_PROJECT_ID:'demo-waitlist-stability'},timeout:60000},
})
