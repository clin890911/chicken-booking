import { useEffect, useRef, useState } from 'react'
import { prepareLineLoginUrl } from '../services/lineService'

// 預取 LINE Login 直達授權網址（access.line.me/...&state=...），供綁定 CTA render 成
// <a href> 直達——使用者手勢的 top-level 導航才會觸發 iOS Universal Link 直跳 LINE app
// 一鍵授權；href 指自家後端再 302 會讓 Universal Link 不觸發、掉到帳密網頁表單。
//
// state 一次性憑證 TTL 10 分鐘：每 8 分鐘刷新一次＋回前景且逾 8 分鐘就補刷（客人鎖屏
// 放置是最常見情境）。預取失敗/未返回一律回空字串，呼叫端退回 302 舊路，保底不壞；
// 即使拿到的 state 意外過期，callback 也會導回 /line/bind?err=expired 的重試頁兜底。
const REFRESH_MS = 8 * 60 * 1000

export function useLineAuthorizeUrl(settings, booking, enabled = true) {
  const [authorizeUrl, setAuthorizeUrl] = useState('')
  const fetchedAtRef = useRef(0)
  const bookingId = booking?.id || ''
  const manageToken = booking?.manageToken || ''
  const endpoint = settings?.lineLoginStartEndpoint || ''
  const active = !!(enabled && bookingId && manageToken)

  useEffect(() => {
    if (!active) { setAuthorizeUrl(''); return undefined }
    let disposed = false
    const refresh = async () => {
      const r = await prepareLineLoginUrl(
        endpoint ? { lineLoginStartEndpoint: endpoint } : {},
        { id: bookingId, manageToken },
      )
      if (disposed) return
      fetchedAtRef.current = Date.now()
      setAuthorizeUrl(r?.authorizeUrl || '')
    }
    refresh()
    const timer = window.setInterval(refresh, REFRESH_MS)
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - fetchedAtRef.current > REFRESH_MS) refresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      disposed = true
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [active, bookingId, manageToken, endpoint])

  return authorizeUrl
}
