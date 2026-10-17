// 這台裝置自己的版面偏好（存 localStorage、不寫雲端、不必部署後端），設定頁「這台裝置的顯示」切換。
// 讀寫包 try/catch：私密瀏覽／封鎖網站資料時讀取失敗＝用預設值，寫入失敗回 false（這次仍生效，重整後回預設）。
// 檔名刻意不以 admin 開頭（同 opaqueMode：E2E 用 page.route('**/admin*') 攔後端端點）。
import { useSyncExternalStore } from 'react'

// 地圖下方「等報到」列：預設顯示；關掉後到店改從「今日訂位」卡片按「客人到了」（Barry 2026-10-17：讓地圖更大）
export const HIDE_ARRIVAL_STRIP_KEY = 'chicken_hide_arrival_strip_v1'

// 桌況圖整層轉 180°（每層各自記，key＝前綴＋樓層，例：chicken_map_rot180_v1_1F）
export const MAP_ROT180_KEY_PREFIX = 'chicken_map_rot180_v1_'

const listeners = new Set()
const read = (key) => { try { return globalThis.localStorage?.getItem(key) === '1' } catch { return false } }

export function setDeviceFlag(key, on) {
  let saved = true
  try {
    if (on) globalThis.localStorage.setItem(key, '1')
    else globalThis.localStorage.removeItem(key)
  } catch { saved = false }
  cache.set(key, !!on)
  listeners.forEach(fn => fn())
  return saved
}

// 寫入失敗時仍要讓這次的切換生效 → 以記憶體 cache 為準，首次讀才看 localStorage
const cache = new Map()
const get = (key) => { if (!cache.has(key)) cache.set(key, read(key)); return cache.get(key) }
const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn) }

export function useDeviceFlag(key) {
  const on = useSyncExternalStore(subscribe, () => get(key), () => false)
  return [on, (v) => setDeviceFlag(key, v)]
}
