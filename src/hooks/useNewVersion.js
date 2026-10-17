import { useEffect, useRef, useState } from 'react'
import { BUILD_ID, fetchLatestBuildId, isNewBuild, canAutoReload } from '../utils/appVersion'

const CHECK_EVERY_MS = 5 * 60 * 1000
// 螢幕關掉／切走至少這麼久，回來時若有新版本且沒有未存資料 → 直接重新整理。
// 剛喚醒平板的當下不會有人正在輸入，是最安全的更新時機。
const WAKE_RELOAD_AFTER_HIDDEN_MS = 10 * 60 * 1000

// 後台用：回傳 { updateAvailable, reload }。dev 模式（BUILD_ID==='dev'）不檢查。
export function useNewVersion() {
  const [updateAvailable, setUpdateAvailable] = useState(false)
  const hiddenAtRef = useRef(null)

  useEffect(() => {
    if (BUILD_ID === 'dev') return
    let cancelled = false
    const check = async () => {
      const latest = await fetchLatestBuildId()
      const fresh = isNewBuild(latest)
      if (!cancelled && fresh) setUpdateAvailable(true)
      return fresh
    }
    check()
    const id = window.setInterval(check, CHECK_EVERY_MS)
    const onVisibility = async () => {
      if (document.visibilityState === 'hidden') {
        hiddenAtRef.current = Date.now()
        return
      }
      const hiddenFor = hiddenAtRef.current ? Date.now() - hiddenAtRef.current : 0
      hiddenAtRef.current = null
      const fresh = await check()
      if (fresh && hiddenFor >= WAKE_RELOAD_AFTER_HIDDEN_MS && canAutoReload()) window.location.reload()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      cancelled = true
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  return { updateAvailable, reload: () => window.location.reload() }
}
