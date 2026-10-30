import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

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

// Google 登入輔助頁自架（Firebase「Self-host the sign-in helper code」）：
// 預設 authDomain 是 *.firebaseapp.com，與網站不同網域。iOS Safari 的跨站隔離與「加入主畫面」App
// （彈窗會跳到 Safari、回不來）都會讓彈窗登入卡在「登入中…」。把 /__/auth/* 放在自己網域，
// 登入流程就是同網域，彈窗與整頁導向都可用。檔案在 build 時從 firebaseapp.com 下載
// （firebase hosting 預設就有這幾個檔），輸出到 dist/__/auth/。
// handler、iframe 沒副檔名：存成 .html，Cloudflare Pages 會以 /__/auth/handler 提供 handler.html。
const AUTH_HELPER_FILES = [
  ['handler', 'handler.html'],
  ['handler.js', 'handler.js'],
  ['experiments.js', 'experiments.js'],
  ['iframe', 'iframe.html'],
  ['iframe.js', 'iframe.js'],
]

function firebaseAuthHelperPlugin(env) {
  const hosts = (env.VITE_FIREBASE_SELF_HOSTED_AUTH_HOSTS || '').trim()
  const source = (env.VITE_FIREBASE_AUTH_DOMAIN || '').trim()
  return {
    name: 'firebase-auth-helper',
    apply: 'build',
    async generateBundle() {
      if (!hosts || !source) return
      try {
        for (const [remote, local] of AUTH_HELPER_FILES) {
          const res = await fetch(`https://${source}/__/auth/${remote}`)
          if (!res.ok) throw new Error(`${remote}: HTTP ${res.status}`)
          this.emitFile({ type: 'asset', fileName: `__/auth/${local}`, source: new Uint8Array(await res.arrayBuffer()) })
        }
      } catch (err) {
        const msg = `[firebase-auth-helper] 無法下載 Google 登入輔助頁（${err.message}）`
        // 正式部署（Cloudflare Pages）缺檔＝登入全壞 → 讓這次部署失敗，線上維持上一版。
        // 本機與 CI 不部署，網路擋住時只警告。
        if (process.env.CF_PAGES) throw new Error(msg)
        this.warn(`${msg}；本次輸出不含 /__/auth/*`)
      }
    },
  }
}

// 後台「加入主畫面」要拿到後台 manifest（雞王後台、開啟 /admin）。原本只靠 React 掛載後換 <link rel=manifest>，
// 但 Safari 可能在 JS 換之前就讀了 HTML 裡的客人 manifest → 裝出來的是「雞王訂位」或根本不是後台 App（2026-10 店主回報）。
// 改成 build 時另外輸出 admin.html、login.html：內容同 index.html，只把 manifest／App 名稱／標題換成後台版。
// Cloudflare Pages 會以 /admin、/login 直接提供這兩個檔（優先於 SPA fallback），瀏覽器第一個位元組就看到後台 manifest。
export const ADMIN_HTML_PAGES = ['admin', 'login']
export function toAdminHtml(html) {
  const out = html
    .replace(/(<link rel="manifest" href=")\/manifest\.webmanifest(")/, '$1/manifest-admin.webmanifest$2')
    .replace(/(<meta name="apple-mobile-web-app-title" content=")[^"]*(")/, '$1雞王後台$2')
    .replace(/<title>[^<]*<\/title>/, '<title>雞王管理後台</title>')
  if (!out.includes('/manifest-admin.webmanifest')) throw new Error('[admin-html] index.html 找不到 manifest 連結，無法產生後台頁')
  return out
}

function adminHtmlPlugin() {
  let outDir = 'dist'
  return {
    name: 'emit-admin-html',
    apply: 'build',
    configResolved(config) { outDir = resolve(config.root, config.build.outDir) },
    closeBundle() {
      const html = toAdminHtml(readFileSync(resolve(outDir, 'index.html'), 'utf8'))
      for (const name of ADMIN_HTML_PAGES) writeFileSync(resolve(outDir, `${name}.html`), html)
    },
  }
}

export default defineConfig(({ command, mode }) => ({
  plugins: [react(), versionJsonPlugin(), firebaseAuthHelperPlugin(loadEnv(mode, process.cwd(), 'VITE_')), adminHtmlPlugin()],
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
