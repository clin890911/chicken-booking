import Icon from '../ui/Icon'

// 手機 / iPad 直向底部導航（lg 以下顯示）。
// Tailwind 無法動態拼 class 字串，欄數需顯式對照；依分頁數選欄數讓所有籤保持單行
const COLS = { 4: 'grid-cols-4', 5: 'grid-cols-5', 6: 'grid-cols-6', 7: 'grid-cols-7' }

export default function BottomNav({ tabs, active, onChange, badges = {} }) {
  return (
    <nav className="lg:hidden flex-shrink-0 safe-bottom z-30 border-t border-chicken-brown/10 bg-[#fbfaf8]/95 backdrop-blur">
      <div className={`grid ${COLS[tabs.length] || 'grid-cols-5'} gap-1 px-2 pt-1 pb-1`}>
        {tabs.map(t => {
          const isActive = active === t.key
          const badge = t.badgeKey ? badges[t.badgeKey] : 0
          return (
            <button
              key={t.key}
              onClick={() => onChange(t.key)}
              aria-current={isActive ? 'page' : undefined}
              className={`tap relative flex min-h-[56px] flex-col items-center justify-center gap-0.5 rounded-xl transition-colors ${
                isActive ? 'text-chicken-red' : 'text-chicken-brown/50 hover:text-chicken-brown'
              }`}
            >
              <span className="relative inline-flex">
                <Icon name={t.icon} size={24} />
                {badge > 0 && (
                  <span className={`absolute -top-1 -right-2.5 min-w-[16px] h-4 px-1 rounded-full
                    bg-chicken-red text-white text-[10px] font-bold flex items-center justify-center
                    ${t.badgeKey === 'ops' ? 'animate-pulse' : ''}`}>
                    {badge > 99 ? '99+' : badge}
                  </span>
                )}
              </span>
              <span className="text-[10px] font-semibold">{t.label}</span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}
