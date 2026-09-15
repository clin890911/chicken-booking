import { useAuth } from '../../contexts/AuthContext'
import { useConfirm } from '../ui/Toast'
import Icon from '../ui/Icon'

// iPad / 桌面版側邊導航。手機版用 BottomNav。視窗 < 1024px 隱藏（自動退回 BottomNav）。
// 2026-09 改版：iPad 橫向（1024–1279px）是主要使用情境，側欄縮成「圖示 + 小字」的 76px 圖示欄，
// ≥1280px 才展開成含文字的 224px 側欄。選中態改用淡紅底 + 紅字（不再整塊實心紅），
// 圖示改單色線條（Icon），讓側欄退到背景、內容區才是主角。
export default function SidebarNav({ tabs, active, onChange, badges = {} }) {
  const { user, signOut } = useAuth()
  const confirm = useConfirm()

  return (
    <aside className="hidden lg:flex flex-col w-[76px] xl:w-56 bg-[#fbfaf8] border-r border-chicken-brown/10 sticky top-0 h-[100dvh]">
      {/* Logo */}
      <div className="px-3 py-4 flex items-center justify-center xl:justify-start gap-2.5">
        <img src="/brand/master-of-chicken-logo-transparent.png" alt="雞王涮涮鍋" className="w-10 h-10 object-contain flex-shrink-0" />
        <div className="hidden xl:block min-w-0">
          <div className="text-sm font-bold text-chicken-brown leading-tight">雞王涮涮鍋</div>
          <div className="text-[11px] text-chicken-brown/50 leading-tight">Master of Chicken</div>
        </div>
      </div>

      {/* Tabs */}
      <nav className="flex-1 py-2 px-2 space-y-1">
        {tabs.map(t => {
          const isActive = active === t.key
          const badge = t.badgeKey ? badges[t.badgeKey] : 0
          return (
            <button
              key={t.key}
              onClick={() => onChange(t.key)}
              aria-current={isActive ? 'page' : undefined}
              className={`tap w-full relative flex flex-col xl:flex-row items-center gap-1 xl:gap-3 px-2 xl:px-3 py-2 xl:py-2.5 min-h-[56px] xl:min-h-[44px] rounded-xl transition-colors text-[11px] xl:text-[15px] font-semibold
                ${isActive ? 'bg-chicken-red/[0.08] text-chicken-red' : 'text-chicken-brown/65 hover:bg-chicken-brown/[0.05] hover:text-chicken-brown'}`}
            >
              <Icon name={t.icon} size={22} />
              <span>{t.label}</span>
              {badge > 0 && (
                <span className={`absolute top-1 right-1.5 xl:static xl:ml-auto min-w-[18px] h-[18px] px-1.5 rounded-full text-[11px] font-bold flex items-center justify-center bg-chicken-red text-white
                  ${t.badgeKey === 'ops' ? 'animate-pulse' : ''}`}>
                  {badge > 99 ? '99+' : badge}
                </span>
              )}
            </button>
          )
        })}
      </nav>

      {/* User card；底部加 home indicator 安全區（iPad 直/橫向手勢列不蓋住登出） */}
      <div className="border-t border-chicken-brown/10 p-2 pb-[calc(0.5rem_+_env(safe-area-inset-bottom))]">
        <div className="flex items-center justify-center xl:justify-start gap-2.5 px-1 xl:px-2 py-2">
          <div className="w-8 h-8 rounded-full bg-[#e9e5df] text-chicken-brown/80 text-[13px] font-bold flex items-center justify-center flex-shrink-0" title={user?.displayName}>
            {(user?.displayName || '?').trim().charAt(0).toUpperCase()}
          </div>
          <div className="hidden xl:block min-w-0 flex-1">
            <div className="text-[13px] font-bold text-chicken-brown truncate">{user?.displayName}</div>
            <div className="text-[11px] text-chicken-brown/55">{user?.roleLabel || '—'}</div>
          </div>
        </div>
        <button
          onClick={async () => { if (await confirm('確定登出？', { title: '登出', confirmLabel: '登出' })) signOut() }}
          className="tap w-full flex items-center justify-center xl:justify-start gap-2 min-h-[44px] px-2 xl:px-3 rounded-lg text-xs text-chicken-brown/60 hover:bg-chicken-brown/[0.05]"
          title="登出"
        >
          <Icon name="logout" size={18} />
          <span className="hidden xl:inline">登出</span>
        </button>
      </div>
    </aside>
  )
}
