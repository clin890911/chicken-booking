import { useSyncExternalStore, useCallback, useRef } from 'react'

// 入座回饋的落點（placement:'seat'，見 utils/seatFeedback）：現場頁在桌況圖底部放一個 <SeatToastSlot />，
// 入座／換桌的 toast 就出現在那裡（手指附近），不蓋左欄確認鈕與報到列；沒有落點時 ToastProvider 照常放頂部。
// 用一個極小的模組層 store 串起來（不放進 Toast 的 context）：元件測試常把 ui/Toast 整個 mock 掉，
// 落點元件若依賴 Toast 模組的 export 就會讓那些測試整頁炸掉。
let slotEl = null
const listeners = new Set()
const setSlotEl = (el) => {
  if (slotEl === el) return
  slotEl = el
  listeners.forEach(fn => fn())
}
const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn) }
const getSnapshot = () => slotEl

// ToastProvider 讀目前的落點（null＝沒有落點，照常放頂部）
export function useSeatToastSlot() {
  return useSyncExternalStore(subscribe, getSnapshot, () => null)
}

// 本身不佔高度（空的 relative 容器），裡面的絕對定位堆疊往上長；外框 pointer-events-none，
// 只有 toast 本體可點 → 不影響一面式版面、不擋底下桌子以外的點擊。
export function SeatToastSlot({ className = '' }) {
  const own = useRef(null)
  const ref = useCallback((el) => {
    if (el) { own.current = el; setSlotEl(el); return }
    if (slotEl === own.current) setSlotEl(null)   // 只收回自己掛上去的落點（切視圖時新舊兩個交接）
    own.current = null
  }, [])
  return (
    <div className={`relative ${className}`}>
      <div ref={ref} data-testid="seat-toast-slot"
        className="absolute inset-x-2 bottom-2 z-30 flex flex-col gap-2 pointer-events-none items-center" />
    </div>
  )
}
