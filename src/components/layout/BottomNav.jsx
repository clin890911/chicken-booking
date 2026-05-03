const TABS = [
  { key: 'today', label: '今日', icon: '📋' },
  { key: 'calendar', label: '日曆', icon: '📅' },
  { key: 'tables', label: '座位', icon: '🪑' },
  { key: 'add', label: '新增', icon: '➕' },
  { key: 'settings', label: '設定', icon: '⚙️' }
]

export default function BottomNav({ active, onChange }) {
  return (
    <nav className="safe-bottom fixed bottom-0 inset-x-0 z-30 bg-white border-t border-chicken-brown/10 shadow-[0_-4px_12px_rgba(0,0,0,0.04)]">
      <div className="grid grid-cols-5">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => onChange(t.key)}
            className={`flex flex-col items-center justify-center py-2.5 transition-colors ${
              active === t.key ? 'text-chicken-red' : 'text-chicken-brown/60 hover:text-chicken-brown'
            }`}
          >
            <span className="text-xl leading-none">{t.icon}</span>
            <span className={`text-[11px] mt-1 font-bold ${active === t.key ? 'text-chicken-red' : ''}`}>{t.label}</span>
          </button>
        ))}
      </div>
    </nav>
  )
}
