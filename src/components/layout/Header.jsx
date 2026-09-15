// 手機 / iPad 直向的後台頂欄（lg 以下）。只有 AdminPage 使用。
// 2026-09 改版：由實心紅底改為淺底 + 髮絲線，品牌紅只留在「王」標記上，與側欄同一套語彙。
export default function Header({ title = '雞王涮涮鍋', subtitle, right }) {
  return (
    <header className="safe-top sticky top-0 z-30 bg-[#fbfaf8] text-chicken-brown border-b border-chicken-brown/10">
      <div className="px-4 py-2.5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="w-8 h-8 rounded-lg bg-chicken-red text-white font-black text-[15px] flex items-center justify-center flex-shrink-0">王</span>
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
