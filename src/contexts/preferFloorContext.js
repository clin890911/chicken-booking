import { createContext } from 'react'

// 「建議桌」的樓層偏好（2026-11-27 C 包，walkthrough #18）：現場頁把店員目前看的樓層放進這個 context，
// 子樹裡 useBooking().suggestTable／suggestTableCombo 自動帶 preferFloor（容量合適的前提下目前樓層優先，
// 見 utils/floorPreference）——散客表單等元件照舊呼叫，不必知道樓層。獨立成檔：測試常把 BookingContext 整個 mock 掉，
// 這裡的 Provider 不受影響。
export const PreferFloorContext = createContext(null)
