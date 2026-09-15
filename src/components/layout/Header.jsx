// 手機 / iPad 直向的後台頂欄（lg 以下）。只有 AdminPage 使用。
// 2026-09 改版：由實心紅底改為淺底 + 髮絲線，品牌紅只留在雞王 logo 上，與側欄同一套語彙。
export default function Header({ title = '雞王涮涮鍋', subtitle, right }) {
  return (
    <header className="safe-top sticky top-0 z-30 bg-[#fbfaf8] text-chicken-brown border-b border-chicken-brown/10">
      <div className="px-4 py-2.5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <img src="/brand/master-of-chicken-logo-transparent.png" alt="" className="w-8 h-8 object-contain flex-shrink-0" />
          <div className="min-w-0">
            <h1 className="font-semibold leading-tight text-base truncate">{title}</h1>
            {subtitle && <p className="text-xs text-chicken-brown/55 leading-tight">{subtitle}</p>}
          </div>
        </div>
        {right}
      </div>
    </header>
  )
}
