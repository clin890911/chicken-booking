// 手機版底部導航（lg 以下顯示）
export default function BottomNav({ tabs, active, onChange, badges = {} }) {
  return (
    <nav className="lg:hidden safe-bottom fixed bottom-0 inset-x-0 z-30 bg-white border-t border-chicken-brown/10 shadow-[0_-4px_12px_rgba(0,0,0,0.04)]">
      <div className="grid grid-cols-5">
        {tabs.map(t => {
          const isActive = active === t.key
          const badge = t.badgeKey ? badges[t.badgeKey] : 0
          return (
            <button
              key={t.key}
              onClick={() => onChange(t.key)}
              className={`flex flex-col items-center justify-center py-2.5 transition-colors relative ${
                isActive ? 'text-chicken-red' : 'text-chicken-brown/60 hover:text-chicken-brown'
              }`}
            >
              <span className="relative">
                <span className="text-xl leading-none">{t.icon}</span>
                {badge > 0 && (
                  <span className={`absolute -top-0.5 -right-2 min-w-[16px] h-4 px-1 rounded-full
                    bg-chicken-red text-white text-[10px] font-black flex items-center justify-center
                    ${t.badgeKey === 'ops' ? 'animate-pulse' : ''}`}>
                    {badge > 99 ? '99+' : badge}
                  </span>
                )}
              </span>
              <span className={`text-[10px] mt-1 font-bold ${isActive ? 'text-chicken-red' : ''}`}>{t.label}</span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}
