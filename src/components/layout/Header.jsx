export default function Header({ title = '雞王涮涮鍋', subtitle, right }) {
  return (
    <header className="safe-top sticky top-0 z-30 bg-chicken-red text-white shadow-md">
      <div className="px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-2xl">🐔</span>
          <div>
            <h1 className="font-black leading-tight text-lg">{title}</h1>
            {subtitle && <p className="text-xs opacity-90 leading-tight">{subtitle}</p>}
          </div>
        </div>
        {right}
      </div>
    </header>
  )
}
