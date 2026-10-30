import { useEffect } from 'react'

// 後台／登入頁：把 PWA manifest 換成後台版（主畫面圖示名稱「雞王後台」、開啟直接進 /admin），
// 離開時換回客人版。Safari／Chrome「加入主畫面」讀的是當下頁面上的 manifest 連結。
const ADMIN = { manifest: '/manifest-admin.webmanifest', title: '雞王後台' }

export function useAdminAppManifest() {
  useEffect(() => {
    const link = document.querySelector('link[rel="manifest"]')
    const meta = document.querySelector('meta[name="apple-mobile-web-app-title"]')
    const prev = { manifest: link?.getAttribute('href'), title: meta?.getAttribute('content') }
    link?.setAttribute('href', ADMIN.manifest)
    meta?.setAttribute('content', ADMIN.title)
    return () => {
      if (link && prev.manifest) link.setAttribute('href', prev.manifest)
      if (meta && prev.title) meta.setAttribute('content', prev.title)
    }
  }, [])
}

// 是否以「加入主畫面」的 App 模式開啟（沒有網址列與重新整理鈕）
export function isStandaloneApp() {
  try {
    return window.matchMedia?.('(display-mode: standalone)')?.matches === true || window.navigator?.standalone === true
  } catch {
    return false
  }
}
