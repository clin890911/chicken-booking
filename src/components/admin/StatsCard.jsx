import { ChevronRight, Filter } from 'lucide-react'
import Icon from '../ui/Icon'

// 統計小格：與規劃頁「團體 / 散客 / 保留」同款——白底髮絲框、小灰標籤、大數字。
// color 只染數字（品牌紅 / 黃 / 綠 / 棕），不再整格塗色。icon 可傳 Icon 名稱。
//
// 可點（傳 onClick）：整格變成 button（訂位「今日」統計列，Barry 2026-10-31「上面這排按了都會直接連動到該去的地方」）。
//   kind='filter' → 在本頁篩選，右上漏斗；kind='nav' → 跳到別頁，右上箭頭。兩種一眼分得出來。
//   hint：去處提示（「去排位」「看已到」…），跟圖示一起放右上——不另開一行，統計列高度不變（頁首精簡）。
//   active：本頁篩選正套用中（aria-pressed＋外框）。
//   disabled：沒有可去的地方（例：未指派 0）→ 不渲染成 button，提示改成 disabledHint，字色不調淡（維持 AA）。
const COLOR = {
  red: 'text-chicken-red',
  yellow: 'text-[#b06600]',
  green: 'text-[#5b8c1f]',
  brown: 'text-chicken-brown',
}

export default function StatsCard({ icon, label, value, color = 'brown', onClick, kind = 'nav', hint, ariaLabel, active = false, disabled = false, disabledHint, testId }) {
  const interactive = !!onClick && !disabled
  const KindIcon = kind === 'filter' ? Filter : ChevronRight
  const head = (
    <div className="flex items-center gap-1.5 text-xs font-semibold text-chicken-brown/55 min-w-0">
      {icon && (typeof icon === 'string' ? <Icon name={icon} size={14} /> : icon)}
      <span className="truncate">{label}</span>
      {onClick && (
        <span className={`ml-auto flex items-center gap-0.5 flex-shrink-0 whitespace-nowrap font-bold ${interactive ? 'text-chicken-brown/70' : 'text-chicken-brown/55'}`}>
          <span>{interactive ? hint : disabledHint}</span>
          {interactive && <KindIcon size={kind === 'filter' ? 12 : 14} strokeWidth={2.4} aria-hidden="true" data-kind-icon={kind} />}
        </span>
      )}
    </div>
  )
  const number = <div className={`text-2xl font-semibold tracking-tight tabular-nums leading-none ${COLOR[color] || COLOR.brown}`}>{value}</div>
  if (!interactive) {
    return (
      <div data-testid={testId} className="rounded-xl border border-chicken-brown/10 bg-white px-3.5 py-3 flex flex-col gap-1 min-w-0">
        {head}{number}
      </div>
    )
  }
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      aria-label={ariaLabel}
      aria-pressed={kind === 'filter' ? active : undefined}
      className={`tap text-left rounded-xl border bg-white px-3.5 py-3 flex flex-col gap-1 min-w-0 min-h-[44px] cursor-pointer
        hover:border-chicken-brown/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-chicken-red/50 focus-visible:ring-offset-1
        ${active ? 'border-chicken-brown/60 ring-1 ring-chicken-brown/40' : 'border-chicken-brown/15'}`}
    >
      {head}{number}
    </button>
  )
}
