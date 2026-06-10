// SeatGauge：團體圈桌「席次量表」——已圈席 vs 需求席，即時不足/剛好/超量視覺。
// 純展示元件：只把兩個數字映射成顏色＋進度條，座位加總邏輯留在呼叫端。
//   needed<=0 → 中性灰｜circled<needed → 不足(琥珀)｜=needed → 剛好(綠)｜>needed → 超量(藍，嚴重超量轉紅)
export default function SeatGauge({ circled = 0, needed = 0, size = 'sm', showLabel = true, className = '' }) {
  const c = Math.max(0, Number(circled) || 0)
  const n = Math.max(0, Number(needed) || 0)

  let state = 'idle'
  if (n > 0) {
    if (c < n) state = 'under'
    else if (c === n) state = 'exact'
    else state = c >= n * 2 ? 'gross' : 'over'
  }

  const palette = {
    idle:  { bar: 'bg-chicken-brown/25', text: 'text-chicken-brown/50', track: 'bg-chicken-brown/10' },
    under: { bar: 'bg-amber-500',  text: 'text-amber-700',  track: 'bg-amber-100' },
    exact: { bar: 'bg-emerald-500', text: 'text-emerald-700', track: 'bg-emerald-100' },
    over:  { bar: 'bg-indigo-500', text: 'text-indigo-700', track: 'bg-indigo-100' },
    gross: { bar: 'bg-rose-500',   text: 'text-rose-700',   track: 'bg-rose-100' },
  }[state]

  const pct = n > 0 ? Math.min(100, Math.round((c / n) * 100)) : (c > 0 ? 100 : 0)
  const note = state === 'under' ? `尚缺 ${n - c} 席`
    : state === 'exact' ? '剛好'
    : (state === 'over' || state === 'gross') ? `多出 ${c - n} 席`
    : ''
  const barH = size === 'xs' ? 'h-1.5' : 'h-2'
  const textSize = size === 'xs' ? 'text-[10px]' : 'text-xs'

  return (
    <div className={className} aria-label={`已圈 ${c} 席，需 ${n} 席`}>
      {showLabel && (
        <div className={`flex items-center justify-between font-bold ${textSize} ${palette.text}`}>
          <span>已圈 {c} / 需 {n} 席</span>
          {note && <span>{note}</span>}
        </div>
      )}
      <div className={`mt-1 w-full overflow-hidden rounded-full ${barH} ${palette.track}`}>
        <div className={`${barH} rounded-full transition-all ${palette.bar}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}
