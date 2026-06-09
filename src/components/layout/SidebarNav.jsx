import { motion } from 'framer-motion'
import { useAuth } from '../../contexts/AuthContext'
import { useConfirm } from '../ui/Toast'

// iPad / 桌面版側邊導航。手機版用 BottomNav。
// 視窗 < 1024px 隱藏（自動退回 BottomNav）
export default function SidebarNav({ tabs, active, onChange, badges = {} }) {
  const { user, signOut } = useAuth()
  const confirm = useConfirm()

  return (
    <aside className="hidden lg:flex flex-col w-20 xl:w-56 bg-white border-r border-chicken-brown/10 sticky top-0 h-screen">
      {/* Logo */}
      <div className="px-3 py-4 border-b border-chicken-brown/10 flex items-center gap-2">
        <div className="w-10 h-10 bg-chicken-red rounded-full flex items-center justify-center text-white font-black text-xl flex-shrink-0">
          王
        </div>
        <div className="hidden xl:block min-w-0">
          <div className="text-sm font-black text-chicken-brown leading-tight">雞王涮涮鍋</div>
          <div className="text-[10px] text-chicken-brown/50 leading-tight">Master of Chicken</div>
        </div>
      </div>

      {/* Tabs */}
      <nav className="flex-1 py-3 px-2 space-y-1">
        {tabs.map(t => {
          const isActive = active === t.key
          const badge = t.badgeKey ? badges[t.badgeKey] : 0
          return (
            <button
              key={t.key}
              onClick={() => onChange(t.key)}
              className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl transition-all text-sm font-bold relative
                ${isActive ? 'bg-chicken-red text-white shadow-md' : 'text-chicken-brown/70 hover:bg-chicken-cream'}`}
            >
              <span className="text-xl flex-shrink-0 relative">
                {t.icon}
                {badge > 0 && (
                  <span className={`absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full text-[10px] font-black flex items-center justify-center
                    ${isActive ? 'bg-white text-chicken-red' : 'bg-chicken-red text-white'}
                    ${t.badgeKey === 'ops' ? 'animate-pulse' : ''}`}>
                    {badge > 99 ? '99+' : badge}
                  </span>
                )}
              </span>
              <span className="hidden xl:inline">{t.label}</span>
              {badge > 0 && (
                <span className={`hidden xl:inline ml-auto text-[10px] font-black px-1.5 rounded-full
                  ${isActive ? 'bg-white/30 text-white' : 'bg-chicken-red text-white'}`}>
                  {badge}
                </span>
              )}
              {isActive && (
                <motion.div
                  layoutId="sidebar-active"
                  className="absolute inset-0 rounded-xl bg-chicken-red -z-10"
                  transition={{ type: 'spring', bounce: 0.2, duration: 0.4 }}
                />
              )}
            </button>
          )
        })}
      </nav>

      {/* User card */}
      <div className="border-t border-chicken-brown/10 p-2">
        <div className="hidden xl:block px-3 py-2 mb-1">
          <div className="text-xs text-chicken-brown/50">登入身份</div>
          <div className="text-sm font-bold text-chicken-brown truncate">{user?.displayName}</div>
          <div className="text-[10px] text-chicken-brown/60">
            {user?.roleLabel || '—'}
          </div>
        </div>
        <button
          onClick={async () => { if (await confirm('確定登出？', { title: '登出', confirmLabel: '登出' })) signOut() }}
          className="w-full flex items-center gap-2 min-h-[44px] px-3 py-2 rounded-lg text-xs text-chicken-brown/60 hover:bg-chicken-cream"
        >
          <span>🚪</span>
          <span className="hidden xl:inline">登出</span>
        </button>
      </div>
    </aside>
  )
}
