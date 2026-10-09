import GuestCountField from './GuestCountField'
import NumberStepper from './planning/NumberStepper'
import { normalizeSplit } from '../../utils/partySplit'

// 後台人數輸入（大人＋小孩）：沿用 GuestCountField 當「大人」快選，旁邊加一個小孩步進器（−/＋ 44px）。
// 父層仍只持有「總人數 total」（＝guests／partySize，所有容量邏輯讀它）＋小孩數 kids；
// 大人 = total − kids。小孩預設 0 → 常態（只有大人）點擊次數與過去完全相同。
// 注意：不可命名為 children（React 保留 prop），一律叫 kids。
export default function PartySizeField({ total, kids = 0, onChange, max = 200, accent = 'red', size = 'md', hint }) {
  const { adults, children } = normalizeSplit(total, kids)
  const lg = size === 'lg'
  const setAdults = (a) => onChange(a + children, children)
  const setKids = (c) => onChange(adults + c, c)

  const kidStepper = (
    <div className="flex items-center gap-2 flex-shrink-0">
      <span className={`label !mb-0 ${lg ? '!text-xs' : ''}`}>小孩</span>
      <NumberStepper value={children} onChange={setKids} min={0} max={Math.max(0, max - adults)} ariaLabel="小孩人數" />
    </div>
  )
  const totalLine = children > 0 && (
    <span data-testid="party-total" className="text-sm font-bold text-chicken-brown tabular-nums whitespace-nowrap">共 {adults + children} 位</span>
  )

  return (
    <div>
      <GuestCountField
        value={adults}
        onChange={setAdults}
        max={Math.max(1, max - children)}
        accent={accent}
        size={size}
        // lg（現場左欄 400px）標題列已擠：「共 N 位」併進標題文字，不另佔寬度
        label={lg && children > 0 ? `大人 · 共 ${adults + children} 位` : '大人'}
        headerExtra={lg ? kidStepper : undefined}
      />
      {!lg && (
        <div className="flex items-center gap-3 mt-2 flex-wrap">
          {kidStepper}
          {totalLine}
        </div>
      )}
      {hint != null && <p className="text-xs text-chicken-brown/55 mt-1">{hint}</p>}
    </div>
  )
}
