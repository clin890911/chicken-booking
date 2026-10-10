import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import './index.css'
import './styles/glass.css'
import { initGlassMode } from './contexts/GlassContext'
import { resolveLiffStatePath } from './utils/liffState'

// LIFF Endpoint=站根：LINE 以 ?liff.state=/path 帶入目標路徑。
// 在 React/Router 掛載「之前」改寫網址（天然 StrictMode-safe、不依賴 LIFF SDK），
// SPA 直接以目標路徑啟動，免一次重新導向往返。
const liffTarget = resolveLiffStatePath(window.location.search, window.location.pathname)
if (liffTarget) window.history.replaceState(null, '', liffTarget)

// Liquid Glass 打樣：掛載前就把 <html data-glass> 設好，首幀即是正確材質（沒設＝main 原樣）
initGlassMode()

ReactDOM.createRoot(document.getElementById('root')).render(
  <BrowserRouter>
    <App />
  </BrowserRouter>
)
