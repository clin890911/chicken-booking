// Liquid Glass 的降級開關（每台裝置自己記）。
//
// 後台的控制層（導覽、頂列、浮動鍵盤、toast、抽屜、modal、模式橫幅）預設是玻璃材質（src/styles/glass.css）。
// 三種情況改成不透明實心底，三層各自獨立、任一成立就生效：
//   1. 系統「降低透明度」：CSS @media (prefers-reduced-transparency: reduce)（iPad Safari 可能不支援這個 query）
//   2. 這台裝置在「設定 → 現場與桌位 → 這台裝置的顯示」打開「不透明模式」→ <html data-material="opaque">
//   3. 瀏覽器不支援 backdrop-filter：半透明沒有模糊就只是「看得到後面的字」，不夠讀 → 一律退回不透明。
//      CSS 端有 @supports not (...) 兜底；JS 端再補 <html data-no-backdrop>（兩者等價，JS 版可在測試中模擬）。
//
// localStorage 讀寫都包 try/catch：私密瀏覽、封鎖網站資料時讀取失敗＝當作沒開（維持玻璃）。
// 檔名刻意不以 admin 開頭：E2E 會用 page.route('**/admin*') 攔後端端點，同名的前端模組會被誤攔。
import { useSyncExternalStore } from 'react'

export const OPAQUE_PREF_KEY = 'chicken_opaque_ui_v1'

const listeners = new Set()
const root = () => (typeof document === 'undefined' ? null : document.documentElement)

export function readOpaquePref() {
  try {
    return globalThis.localStorage?.getItem(OPAQUE_PREF_KEY) === '1'
  } catch {
    return false
  }
}

function applyOpaque(on) {
  const el = root()
  if (!el) return
  if (on) el.dataset.material = 'opaque'
  else delete el.dataset.material
}

export function supportsBackdropFilter() {
  try {
    const s = globalThis.CSS?.supports
    if (typeof s !== 'function') return true // 無從判斷就交給 CSS @supports 兜底
    return s.call(globalThis.CSS, 'backdrop-filter', 'blur(1px)') || s.call(globalThis.CSS, '-webkit-backdrop-filter', 'blur(1px)')
  } catch {
    return true
  }
}

// main.jsx 在 React 掛載「之前」呼叫：首幀就是正確材質，不會先閃一下玻璃再變實心。
export function initOpaqueMode() {
  applyOpaque(readOpaquePref())
  const el = root()
  if (el && !supportsBackdropFilter()) el.dataset.noBackdrop = ''
}

// 回傳是否成功記住（寫入失敗時這次仍會套用，只是重新整理後回到預設）。
export function setOpaquePref(on) {
  let saved = true
  try {
    if (on) globalThis.localStorage.setItem(OPAQUE_PREF_KEY, '1')
    else globalThis.localStorage.removeItem(OPAQUE_PREF_KEY)
  } catch {
    saved = false
  }
  applyOpaque(on)
  listeners.forEach(fn => fn())
  return saved
}

const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn) }
const snapshot = () => root()?.dataset.material === 'opaque'

// 設定頁的開關用：[目前是否不透明, 設定函式]
export function useOpaqueMode() {
  const on = useSyncExternalStore(subscribe, snapshot, () => false)
  return [on, setOpaquePref]
}
