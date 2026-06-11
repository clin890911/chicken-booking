import { useEffect, useRef, useState } from 'react'
import { lineLiffId, loadLiffSdk } from '../services/lineService'

// 靜默 LIFF 身分偵測（LINE-first 訂位用）：
// 客人從 LINE rich menu 開訂位頁（LIFF 內）時，已登入 LINE——取 idToken 附在訂位請求上，
// 後端驗明身分後「建立訂位即綁定＋立即推播確認卡」，零額外動作。
//
// 鐵則：
// - 絕不呼叫 liff.login()——訂位途中強制跳登入是漏斗殺手；未登入（外部瀏覽器）就保持 null，
//   走既有的訂位後綁定 CTA fallback。
// - 任何失敗（SDK 載不到、init 失敗、舊版 LINE）完全靜默，絕不阻塞、絕不影響訂位流程。
// - StrictMode 守門用 run ref；「不可」用 cancelled 旗標擋 setState——
//   run#1 被 cleanup、run#2 被 ref 擋會永久卡住（LineBindPage/MyBookings 已踩過兩次的坑）。
export function useLiffIdentity(settings) {
  const [identity, setIdentity] = useState(null)
  const runRef = useRef(false)

  useEffect(() => {
    if (runRef.current) return
    const liffId = lineLiffId(settings)
    if (!liffId) return
    runRef.current = true

    async function detect() {
      try {
        const liff = await loadLiffSdk()
        await liff.init({ liffId })
        if (!liff.isLoggedIn()) return // 外部瀏覽器/未登入 → 靜默放棄

        const idToken = typeof liff.getIDToken === 'function' ? liff.getIDToken() : null
        if (!idToken) return // 未開 openid scope 等 → 靜默放棄

        // 過期預檢（30 秒緩衝）：避免把必 401 的過期 token 送到後端白跑一趟
        try {
          const decoded = typeof liff.getDecodedIDToken === 'function' ? liff.getDecodedIDToken() : null
          if (decoded?.exp && decoded.exp * 1000 <= Date.now() + 30_000) return
        } catch { /* 解碼失敗不致命，後端仍會驗 */ }

        let profile = null
        try { profile = await liff.getProfile() } catch { profile = null }
        let friendFlag = null
        try {
          const friendship = await liff.getFriendship?.()
          if (typeof friendship?.friendFlag === 'boolean') friendFlag = friendship.friendFlag
        } catch { friendFlag = null }

        setIdentity({
          idToken,
          displayName: profile?.displayName || '',
          pictureUrl: profile?.pictureUrl || '',
          friendFlag,
        })
      } catch (err) {
        console.warn('LIFF identity detect skipped:', err?.message)
      }
    }
    detect()
  }, [settings])

  return identity
}
