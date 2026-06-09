import { defineConfig } from 'vitest/config'

// 回歸測試設定。測試聚焦「領域邏輯層」（src/services、src/utils）——
// 這是用戶端訂位與管理端營運共用的引擎，bug 最常藏在這裡。
// jsdom 提供 localStorage / window.crypto，貼近瀏覽器執行環境。
export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,                       // 全域 describe/it/expect，測試檔免 import
    setupFiles: ['./tests/setup.js'],
    include: ['tests/**/*.test.js'],
    clearMocks: true,
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      include: ['src/services/**', 'src/utils/**'],
      exclude: ['src/services/firebase.js', 'src/services/cloudDataService.js'],
      reporter: ['text', 'html'],
    },
  },
})
