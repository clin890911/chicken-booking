// 統計條：一個白底髮絲框容器內並排幾格「小灰標籤 + 大數字 + 小字」（規劃頁三格統計的抽象）。
// items: [{ label, big, small?, note?, noteCls?, bigCls? }]；cols 未傳時依 items 數量均分。
export default function StatGroup({ items = [], cols, className = '' }) {
  const n = cols || items.length || 1
  const grid = { 2: 'grid-cols-2', 3: 'grid-cols-3', 4: 'grid-cols-2 sm:grid-cols-4', 5: 'grid-cols-2 sm:grid-cols-5', 6: 'grid-cols-3 sm:grid-cols-6' }[n] || 'grid-cols-3'
  return (
    <div className={`grid ${grid} bg-white rounded-xl border border-chicken-brown/10 overflow-hidden ${className}`}>
      {items.map((it, i) => (
        <div key={it.key || it.label || i} className={`flex flex-col gap-0.5 px-3.5 py-3 min-w-0 ${i > 0 ? 'border-l border-chicken-brown/[0.08]' : ''}`}>
          <div className="text-xs font-semibold text-chicken-brown/55 truncate">{it.label}</div>
          <div className="flex items-baseline gap-1 flex-wrap">
            <span className={`text-2xl font-semibold tracking-tight tabular-nums leading-none ${it.bigCls || 'text-chicken-brown'}`}>{it.big}</span>
            {it.small && <span className="text-xs text-chicken-brown/60 tabular-nums">{it.small}</span>}
          </div>
          {it.note && <div className={`text-[11px] font-semibold ${it.noteCls || 'text-chicken-brown/50'}`}>{it.note}</div>}
        </div>
      ))}
    </div>
  )
}
