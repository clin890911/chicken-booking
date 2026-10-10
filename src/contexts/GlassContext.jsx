import { createContext, useContext, useEffect, useState } from 'react'
import { MotionConfig } from 'framer-motion'

// Liquid Glass 打樣（spike/liquid-glass）：<html data-glass="chrome|full">；沒有屬性＝與 main 完全相同。
//   chrome（A 版）＝只有浮在內容上的控制層用玻璃（導覽、頂列、鍵盤、toast、抽屜、modal、ModeBanner）
//   full  （B 版）＝卡片與面板也套玻璃（對照用）
// 切換：網址 ?glass=chrome|full|off，或 localStorage chicken_glass_v1；也可在 devtools 直接改 html 屬性（即時生效）。
const KEY = 'chicken_glass_v1'
const MODES = ['chrome', 'full']

export function initGlassMode() {
  if (typeof document === 'undefined') return
  let mode = null
  try {
    const q = new URLSearchParams(window.location.search).get('glass')
    if (q === 'off') localStorage.removeItem(KEY)
    else if (MODES.includes(q)) localStorage.setItem(KEY, q)
    mode = localStorage.getItem(KEY)
  } catch { /* 私密視窗／封鎖網站資料：當作沒開 */ }
  if (MODES.includes(mode)) document.documentElement.dataset.glass = mode
}

const read = () => {
  if (typeof document === 'undefined') return null
  const m = document.documentElement.dataset.glass
  return MODES.includes(m) ? m : null
}

const GlassContext = createContext(null)

export function GlassProvider({ children }) {
  const [mode, setMode] = useState(read)
  useEffect(() => {
    const obs = new MutationObserver(() => setMode(read()))
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-glass'] })
    return () => obs.disconnect()
  }, [])
  // reducedMotion="user"：系統開「減少動態效果」時 framer 自動略過 transform 動畫。
  // 未開玻璃時用 "never"（framer 的預設值）＝main 行為不變；永遠包同一層，切換時才不會整棵樹重掛載丟狀態。
  return (
    <MotionConfig reducedMotion={mode ? 'user' : 'never'}>
      <GlassContext.Provider value={mode}>{children}</GlassContext.Provider>
    </MotionConfig>
  )
}

// null＝未開玻璃（main 原樣）；'chrome'｜'full'
export const useGlass = () => useContext(GlassContext)

// Apple 預設 UI spring：critically damped（damping 1.0、response ≈0.35s），不 overshoot；
// 抽屜／sheet 用 damping 0.85 帶一點點回彈。只用在 transform/opacity。
export const SPRING_UI = { type: 'spring', bounce: 0, duration: 0.35 }
export const SPRING_SHEET = { type: 'spring', bounce: 0.15, duration: 0.4 }
