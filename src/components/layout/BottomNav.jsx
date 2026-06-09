// 手機版底部導航（lg 以下顯示）
export default function BottomNav({ tabs, active, onChange, badges = {} }) {
  return (
    <nav className="lg:hidden safe-bottom fixed bottom-0 inset-x-0 z-30 border-t border-chicken-brown/10 bg-white/95 shadow-[0_-6px_18px_rgba(58,46,38,0.08)] backdrop-blur">
      <div className="grid grid-cols-5 gap-1 px-2 py-1.5">
        {tabs.map(t => {
          const isActive = active === t.key
          const badge = t.badgeKey ? badges[t.badgeKey] : 0
          return (
            <button
              key={t.key}
              onClick={() => onChange(t.key)}
              className={`relative flex min-h-[60px] flex-col items-center justify-center rounded-xl py-2 transition-colors ${
                isActive ? 'bg-chicken-red/10 text-chicken-red ring-1 ring-chicken-red/20' : 'text-chicken-brown/50 hover:text-chicken-brown'
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
