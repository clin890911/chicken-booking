import Icon from '../../ui/Icon'
import { seatCompareText } from './groupEditorFields'

// 圈桌區的「區域側欄」：只講**目前這一梯**（整單的席位/檢查清單在右側 GroupEditorSummary，兩者並存）。
// 店員腦中的順序是「這一場能給他哪幾桌」，圈桌當下要一眼看到「已圈 30 席、夠坐 20 人、多 10 席」
// 或「還差 8 席，再圈一桌」——不必心算、也不必捲回摘要卡。
//
// 🔴 圖例色值直接對應 FloorMap → TableShape 規劃模式的實際填色，不另外發明色盤：
//    selected #4f46e5 / blocked #94a3b8（虛線）/ available #e2e8f0 / 維修停用 #e5e0d8（虛線、置灰）。
//    FloorMap 規劃模式只有 selected|blocked|available 三態，「別梯」與「別團／已訂」在圖上
//    同為灰色 blocked，靠側欄的桌號清單與提示文字區分（為此改 FloorMap 不划算）。
const LEGEND = [
  { label: '可圈', fill: '#e2e8f0', stroke: '#94a3b8' },
  { label: '這一梯', fill: '#4f46e5', stroke: '#3730a3' },
  { label: '別梯', fill: '#94a3b8', stroke: '#64748b', dashed: true },
  { label: '別團／已訂', fill: '#94a3b8', stroke: '#64748b', dashed: true },
  { label: '維修', fill: '#e5e0d8', stroke: '#3a2e26', dashed: true },
]

const TONE = {
  idle: 'text-chicken-brown/50',
  ok: 'text-emerald-700',
  short: 'text-chicken-red',
}

const sortTables = (nums) => [...nums]
  .map(String)
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))

export default function BatchSeatPanel({
  batchLabel = '', seatingLabel = '',
  circled = 0, tableCount = 0, needed = 0,
  tableNumbers = [], onRemoveTable,
  chips = [], activeBatchId = null, onSelectBatch, onAddBatch,
  addPicker = null,
  hasEscort = false, onToggleEscort,
  badTables = [], dupTables = [],
  heldSeats = 0,
}) {
  const cmp = seatCompareText({ circled, needed, tableCount })
  const sorted = sortTables(tableNumbers)
  const badSet = new Set([...badTables, ...dupTables].map(String))

  return (
    <div className="space-y-3 rounded-xl border border-chicken-brown/10 bg-[#fbfaf8] p-3">
      {/* 大數字：這一梯圈到幾席、幾桌，夠不夠坐 */}
      <div aria-label={`本梯已圈 ${circled} 席、${tableCount} 桌`}>
        <div className="text-[11px] font-bold tracking-wide text-chicken-brown/50">
          {batchLabel || '尚未選梯次'} · 已圈席位
        </div>
        <div className="mt-0.5 flex items-baseline gap-1.5">
          <span className="text-3xl font-black leading-none tabular-nums text-chicken-brown">{circled}</span>
          <span className="text-xs font-bold tabular-nums text-chicken-brown/55">席 · {tableCount} 桌</span>
        </div>
        <div className={`mt-1 text-xs font-bold ${TONE[cmp.tone]}`}>{cmp.text}</div>
        {seatingLabel && <div className="mt-0.5 text-[11px] font-semibold text-chicken-brown/45">{seatingLabel}</div>}
      </div>

      {/* 這一梯的桌號：點一下＝在圖上取消圈選 */}
      <div className="border-t border-chicken-brown/10 pt-2.5">
        <div className="mb-1 text-[11px] font-bold text-chicken-brown/55">這一梯的桌</div>
        {sorted.length === 0 ? (
          <div className="rounded-lg border border-dashed border-chicken-brown/20 px-2.5 py-2 text-[11px] text-chicken-brown/50">
            在圖上點桌子加入這一梯
          </div>
        ) : (
          <div className="flex flex-wrap gap-1">
            {sorted.map(n => (
              <button key={n} type="button" onClick={() => onRemoveTable?.(n)} aria-label={`移除桌 ${n}`}
                className={`tap inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11px] font-bold tabular-nums ${
                  badSet.has(n)
                    ? 'bg-chicken-red/10 text-chicken-red'
                    : 'bg-chicken-brown/[0.07] text-chicken-brown hover:bg-chicken-brown/15'}`}>
                {n}<span className="opacity-45">✕</span>
              </button>
            ))}
          </div>
        )}
        {badTables.length > 0 && (
          <p className="mt-1.5 text-[11px] font-bold text-chicken-red">{sortTables(badTables).join('、')} 當日停用／維修中，儲存會被擋</p>
        )}
        {dupTables.length > 0 && (
          <p className="mt-1.5 text-[11px] font-bold text-chicken-red">{sortTables(dupTables).join('、')} 已被本團其他梯圈走，同一張桌不能排兩梯</p>
        )}
      </div>

      {/* 梯次切換：取代原本「圈桌中：第一梯」那行純文字標頭 */}
      <div className="border-t border-chicken-brown/10 pt-2.5">
        <div className="mb-1 text-[11px] font-bold text-chicken-brown/55">圈哪一梯</div>
        <div className="flex flex-wrap gap-1">
          {chips.map(c => {
            const active = c.id === activeBatchId
            return (
              <button key={c.id} type="button" aria-pressed={active} onClick={() => onSelectBatch?.(c.id)}
                className={`tap h-7 rounded-lg px-2 text-[11px] font-semibold tabular-nums ${
                  active
                    ? 'bg-chicken-red text-white'
                    : 'border border-chicken-brown/15 bg-white text-chicken-brown'}`}>
                {c.isEscort ? '司領桌' : `${c.label} ${c.timeSlot || ''}`.trim()}
              </button>
            )
          })}
          <button type="button" onClick={onAddBatch}
            className="tap inline-flex h-7 items-center gap-0.5 rounded-lg border border-dashed border-chicken-brown/25 bg-white px-2 text-[11px] font-semibold text-chicken-red">
            <Icon name="plus" size={11} strokeWidth={2.6} />拆梯
          </button>
        </div>
        {addPicker && <div className="mt-1.5">{addPicker}</div>}
        <button type="button" aria-pressed={hasEscort} onClick={onToggleEscort}
          className={`tap mt-1.5 inline-flex h-7 items-center gap-1 rounded-lg px-2 text-[11px] font-semibold ${
            hasEscort
              ? 'bg-chicken-brown/15 text-chicken-brown'
              : 'border border-chicken-brown/15 bg-white text-chicken-brown/70'}`}>
          <Icon name="bus" size={12} />司領桌{hasEscort ? '（再按移除）' : ''}
        </button>
      </div>

      {/* 圖例 */}
      <div className="border-t border-chicken-brown/10 pt-2.5">
        <div className="mb-1 text-[11px] font-bold text-chicken-brown/55">圖例</div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] font-semibold text-chicken-brown/60">
          {LEGEND.map(l => (
            <span key={l.label} className="inline-flex items-center gap-1">
              <i className="inline-block h-2.5 w-2.5 rounded-sm"
                style={{ background: l.fill, border: `1px ${l.dashed ? 'dashed' : 'solid'} ${l.stroke}` }} />
              {l.label}
            </span>
          ))}
        </div>
        <p className="mt-1 text-[10px] leading-snug text-chicken-brown/40">
          別梯與別團在圖上同為灰色、都不可點；桌號以上方清單為準。旅客保留 {heldSeats} 席（不含司領桌）。
        </p>
      </div>
    </div>
  )
}
