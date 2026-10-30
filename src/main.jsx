import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import './index.css'
import './styles/glass.css'
import { initOpaqueMode } from './utils/opaqueMode'
import { installPopoverDismiss } from './utils/popoverDismiss'
import { resolveLiffStatePath } from './utils/liffState'

// LIFF Endpoint=站根：LINE 以 ?liff.state=/path 帶入目標路徑。
// 在 React/Router 掛載「之前」改寫網址（天然 StrictMode-safe、不依賴 LIFF SDK），
// SPA 直接以目標路徑啟動，免一次重新導向往返。
const liffTarget = resolveLiffStatePath(window.location.search, window.location.pathname)
if (liffTarget) window.history.replaceState(null, '', liffTarget)

// Liquid Glass 降級：掛載前就把 <html data-material> / data-no-backdrop 設好，首幀即是正確材質
initOpaqueMode()
installPopoverDismiss()

const boot = () => ReactDOM.createRoot(document.getElementById('root')).render(
  <BrowserRouter>
    <App />
  </BrowserRouter>
)

// 開發專用 demo 假資料：?demo=dayplan → 掛載前把「當日排位」示範訂位灌進本機 localStorage。
// import.meta.env.DEV 在正式 build 會被換成 false，整段（含動態 import 的檔案）不會進 dist。
// ?demo=ops（今天有事：將到／待清／超時／候位）、?demo=ops-calm（今天沒事）→ 現場頁「需要處理」提示 demo。
const DEMO = import.meta.env.DEV ? new URLSearchParams(window.location.search).get('demo') : null
const dropDemoParam = () => {
  const url = new URL(window.location.href)
  url.searchParams.delete('demo') // 重新整理不會再灌一次（要重置就再帶一次 ?demo=…）
  window.history.replaceState(null, '', url.pathname + url.search + url.hash)
}
if (import.meta.env.DEV && (DEMO === 'ops' || DEMO === 'ops-calm')) {
  import('./dev/opsDemoSeed.js')
    .then(m => {
      const r = m.seedOpsDemo({ calm: DEMO === 'ops-calm' })
      console.info(`[demo] 已灌入現場頁假資料（${DEMO}）：${r.bookings} 筆訂位、${r.waitlist} 組候位`)
      dropDemoParam()
    })
    .catch(e => console.error('[demo] 假資料灌入失敗', e))
    .finally(boot)
} else if (import.meta.env.DEV && DEMO === 'dayplan') {
  import('./dev/dayplanDemoSeed.js')
    .then(m => {
      const r = m.seedDayplanDemo()
      console.info(`[demo] 已灌入當日排位假資料：${r.bookings} 筆訂位、${r.groups} 個團`)
      dropDemoParam()
    })
    .catch(e => console.error('[demo] 假資料灌入失敗', e))
    .finally(boot)
} else {
  boot()
}
