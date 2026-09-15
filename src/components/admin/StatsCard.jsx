import Icon from '../ui/Icon'

// 統計小格：與規劃頁「團體 / 散客 / 保留」同款——白底髮絲框、小灰標籤、大數字。
// color 只染數字（品牌紅 / 黃 / 綠 / 棕），不再整格塗色。icon 可傳 Icon 名稱。
const COLOR = {
  red: 'text-chicken-red',
  yellow: 'text-[#b06600]',
  green: 'text-[#5b8c1f]',
  brown: 'text-chicken-brown',
}

export default function StatsCard({ icon, label, value, color = 'brown' }) {
  return (
    <div className="rounded-xl border border-chicken-brown/10 bg-white px-3.5 py-3 flex flex-col gap-1 min-w-0">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-chicken-brown/55">
        {icon && (typeof icon === 'string' ? <Icon name={icon} size={14} /> : icon)}
        <span className="truncate">{label}</span>
      </div>
      <div className={`text-2xl font-semibold tracking-tight tabular-nums leading-none ${COLOR[color] || COLOR.brown}`}>{value}</div>
    </div>
  )
}
