// 後台非現場頁的頁名（頁面捲動第 2 批，2026-10-31）。
// 桌機／iPad 橫向（lg↑）原本頂端有一條 48px 的獨立標題列（頁名＋說明＋登入者），頁名與側欄選中項重複、
// 又吃掉垂直空間 → 拿掉那條，頁名改坐進各頁「子分頁籤那一列」最前面，不多佔高度；登入者移到側欄底部。
// 手機版殼（< lg）有 Header 顯示分頁名，這裡隱藏，避免重複。
export default function PageTitle({ children, className = '' }) {
  return (
    <h1 className={`hidden lg:block shrink-0 text-lg font-semibold tracking-tight leading-7 text-chicken-brown ${className}`}>
      {children}
    </h1>
  )
}
