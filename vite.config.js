import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'node:child_process'

// 版本戳記：每次 build 產生唯一 id，同時寫進前端程式（__BUILD_ID__）與 dist/version.json。
// 店裡 iPad 常駐在現場頁、好幾天不重新整理 → 一直跑舊版（2026-10 實例：新功能已上線一週，
// 平板仍是舊版、以為系統不能擠一擠）。後台定期抓 /version.json 比對，不同就提示更新（utils/appVersion）。
function gitShortSha() {
  const fromEnv = process.env.CF_PAGES_COMMIT_SHA || process.env.ZEABUR_GIT_COMMIT_SHA || process.env.GITHUB_SHA || ''
  if (fromEnv) return fromEnv.slice(0, 7)
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch {
    return ''
  }
}

const BUILD_TIME = new Date().toISOString()
const BUILD_SHA = gitShortSha()
const BUILD_ID = `${BUILD_SHA || 'nogit'}-${Date.parse(BUILD_TIME).toString(36)}`

function versionJsonPlugin() {
  return {
    name: 'emit-version-json',
    apply: 'build',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: JSON.stringify({ id: BUILD_ID, sha: BUILD_SHA, time: BUILD_TIME }),
      })
    },
  }
}

export default defineConfig(({ command }) => ({
  plugins: [react(), versionJsonPlugin()],
  define: {
    // dev server 不檢查新版本（沒有 version.json）
    __BUILD_ID__: JSON.stringify(command === 'build' ? BUILD_ID : 'dev'),
    __BUILD_SHA__: JSON.stringify(BUILD_SHA),
    __BUILD_TIME__: JSON.stringify(BUILD_TIME),
  },
  server: {
    host: true,
    port: 5173
  }
}))
