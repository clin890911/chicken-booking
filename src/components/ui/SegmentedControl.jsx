// 分段控制（segmented control）：灰底槽 + 白色浮起的選中段，與 iPadOS 一致。
// 後台各分頁的子籤（訂位：今日/日曆/查詢/新增；名冊：顧客/旅行社；規劃：當日總覽/排位地圖；
// 現場：桌況圖/排程/總覽、1F/2F）統一用這一顆，不再各自畫實心紅底的 pill。
// options: [{ key, label, icon?, badge? }]；size='md'（32px）| 'sm'（28px）；fill=true 時撐滿寬度均分。
import Icon from './Icon'

export default function SegmentedControl({ options, value, onChange, size = 'md', fill = false, className = '', ariaLabel }) {
  const h = size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-8 px-3.5 text-[13px]'
  return (
    <div className={`inline-flex rounded-[10px] bg-chicken-brown/[0.07] p-0.5 ${fill ? 'w-full' : ''} ${className}`} aria-label={ariaLabel}>
      {options.map(o => {
        const active = value === o.key
        return (
          <button
            key={o.key}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.key)}
            title={o.title}
            className={`tap inline-flex items-center justify-center gap-1.5 rounded-lg font-semibold whitespace-nowrap transition-colors ${h} ${fill ? 'flex-1 min-w-0' : ''} ${
              active ? 'bg-white text-chicken-brown shadow-[0_1px_2px_rgba(0,0,0,0.08),0_0_0_0.5px_rgba(0,0,0,0.04)]' : 'text-chicken-brown/60 hover:text-chicken-brown'
            }`}
          >
            {o.icon && <Icon name={o.icon} size={size === 'sm' ? 14 : 16} />}
            <span className={o.hideLabelOnNarrow ? 'hidden sm:inline' : ''}>{o.label}</span>
            {o.badge > 0 && (
              <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-chicken-red text-white text-[11px] font-bold inline-flex items-center justify-center">{o.badge > 99 ? '99+' : o.badge}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}
