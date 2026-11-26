import { createContext, useContext, useEffect } from 'react'

// 現場頁「復原欄」的 context（2026-11-27 驗收 P1 第三輪）。Provider 在 ToastProvider 裡（同一份狀態：
// placement:'seat' 的提示帶「復原」時，有復原欄就改進復原欄）。獨立成檔：測試常把 Toast 模組整個 mock 掉，
// 這裡的 hook 沒有 Provider 時一律 no-op／回 null，元件照樣能渲染。
export const SeatUndoContext = createContext(null)

// 現場頁掛上復原欄：掛著的期間，placement:'seat' 的入座提示改成不可互動，「復原」進復原欄。
export function useRegisterSeatUndoSlot() {
  const register = useContext(SeatUndoContext)?.register
  useEffect(() => (register ? register() : undefined), [register])
}

// 讀復原欄目前內容：{ entry: { text, ariaLabel, live } | null, run }；沒有 Provider 時回 null
export const useSeatUndo = () => useContext(SeatUndoContext)
