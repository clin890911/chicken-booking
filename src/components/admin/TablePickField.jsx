import { useMemo, useState } from 'react'
import { statusZh } from '../../utils/tableStatus'

// 新增訂位表單的「桌位」區塊（僅日期＝今天時由 AddBookingView 渲染）。
// 店主回報：余先生早上來現場訂位，輸入完資料後「沒辦法選桌」——舊表單只有底部一顆預設打勾、
// 欄位填齊才出現的「建立後立刻自動指派最佳桌」，看不到會挑哪張、也不能換。
// 這裡改成時段下方看得見的晶片：候選＝今日可用、容量夠、且依所選時段不撞別筆預配/團保的單桌
// （鎖桌型還要此刻是空桌；排序沿用 findSuitableTables：浪費小 → 1F 優先 → 桌號）。第一張預選並標「建議」（多數店員不用改），
// 另有「到桌況圖選（可併桌）」與「先不指派」。純呈現：選擇狀態與存檔語意都在 AddBookingView。
//
// 存檔語意依鎖桌時機（capacity.lockKindFor，2026-09 店主拍板「接近時段才鎖」）：
//   lockKind 'hold'      離用餐 ≤ 30 分 → 存檔立刻鎖桌（reserved）；候選只有此刻的空桌
//   lockKind 'preassign' 更早 → 只預配、桌況維持空桌；候選可含此刻有客但屆時會空出的桌（晶片標出現況）
//
// props
//   hasSlot     是否已選時段（沒選時段無從判斷撞不撞桌 → 只顯示提示）
//   lockKind    'hold' | 'preassign'（AddBookingView 由 findReserveCandidates 算好）
//   leadMin     鎖桌門檻分鐘（文案用，與 capacity.HOLD_LEAD_MIN 同一份）
//   candidates  候選桌（已排序）
//   choice      AddBookingView 算好的「實際會用的選擇」：{ kind:'table', table } | { kind:'map' } | { kind:'none' }
//   onPick(v)   v＝桌號 | 'map' | 'none'
//   notice      已選桌因人數/時段變動而改回建議時的提示（讓店員看得出桌號換了）
//   emptyReason 沒有候選桌時的說明

const COLLAPSE_AT = 8

function floorOrder(a, b) {
  return String(a).localeCompare(String(b))
}

export default function TablePickField({ hasSlot, lockKind = 'hold', leadMin = 30, candidates = [], choice, onPick, notice, emptyReason }) {
  const [expanded, setExpanded] = useState(false)
  const suggestedNumber = candidates[0]?.number
  const selectedNumber = choice?.kind === 'table' ? choice.table.number : null

  // 太多時收合：先顯示前 N 張（已依浪費/樓層排序，最合適的在前）；已選桌若在後段也一定露出
  const visible = useMemo(() => {
    if (expanded || candidates.length <= COLLAPSE_AT) return candidates
    const head = candidates.slice(0, COLLAPSE_AT)
    const sel = candidates.find(t => t.number === selectedNumber)
    return sel && !head.includes(sel) ? [...head, sel] : head
  }, [candidates, expanded, selectedNumber])
  const hiddenCount = candidates.length - visible.length

  // 依樓層分組（組內維持候選排序）
  const byFloor = useMemo(() => {
    const m = new Map()
    visible.forEach(t => {
      const f = t.floor || '其他'
      if (!m.has(f)) m.set(f, [])
      m.get(f).push(t)
    })
    return [...m.entries()].sort(([a], [b]) => floorOrder(a, b))
  }, [visible])

  if (!hasSlot) {
    return (
      <div>
        <label className="label">桌位（今天）</label>
        <p className="rounded-xl border-2 border-dashed border-chicken-brown/15 px-3 py-3 text-xs font-bold text-chicken-brown/50">
          選好時段後，這裡會列出這個時段不撞桌的空桌，可直接點選
        </p>
      </div>
    )
  }

  const preassign = lockKind === 'preassign'
  // 文案據實：預配不會在用餐前自動轉成鎖桌（系統沒有這個排程），只講「現在會發生什麼」
  const hint = choice?.kind === 'table'
    ? (preassign
      ? `先預配 ${choice.table.number}：桌子先不鎖、現在仍可帶位（離用餐 ${leadMin} 分內新增才會直接鎖桌）；現場帶位用到這張桌會提醒。`
      : `存檔後立刻鎖桌 ${choice.table.number}（桌況「已預訂」）；之後要換可按訂位卡的「改桌」。`)
    : choice?.kind === 'map'
      ? '存檔後直接跳到現場桌況圖選桌（大組可點多張同層空桌併桌）。'
      : '存檔後先不指派，之後可在訂位卡按「指派桌位」。'

  const optionCls = (active) => `min-h-[44px] px-3.5 rounded-xl border-2 text-sm font-bold transition-all ${
    active
      ? 'border-chicken-red bg-chicken-red/10 text-chicken-red'
      : 'border-chicken-brown/15 bg-white text-chicken-brown/70 hover:border-chicken-red/40'}`

  return (
    <div data-testid="table-pick">
      <label className="label">桌位（今天）</label>
      <div className="space-y-2">
        {notice && (
          <div role="status" className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">
            {notice}
          </div>
        )}

        {candidates.length === 0 ? (
          <div className="rounded-lg bg-chicken-brown/5 px-3 py-2 text-xs font-bold text-chicken-brown/70">
            {emptyReason}
          </div>
        ) : (
          byFloor.map(([floor, list]) => (
            <div key={floor}>
              <div className="mb-1 text-[11px] font-bold text-chicken-brown/50">{floor}</div>
              <div className="flex flex-wrap gap-1.5">
                {list.map(t => {
                  const selected = t.number === selectedNumber
                  const isSuggested = t.number === suggestedNumber
                  return (
                    <button key={t.number} type="button" aria-pressed={selected}
                      onClick={() => onPick(t.number)}
                      className={`min-h-[44px] min-w-[80px] px-3 rounded-xl border-2 text-sm font-bold tabular-nums transition-all ${
                        selected
                          ? 'border-chicken-red bg-chicken-red text-white'
                          : 'border-chicken-brown/15 bg-white text-chicken-brown hover:border-chicken-red/50'}`}>
                      {t.number} · {t.capacity}人
                      {/* 預配候選可能此刻有客（屆時會空出）→ 標出現況，店員才不會以為是空桌 */}
                      {t.status && t.status !== 'vacant' && (
                        <span className={`ml-1 text-[10px] ${selected ? 'text-white/80' : 'text-chicken-brown/50'}`}>· 現{statusZh(t.status)}</span>
                      )}
                      {isSuggested && (
                        <span className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] ${
                          selected ? 'bg-white/25 text-white' : 'bg-chicken-green/15 text-chicken-green'}`}>建議</span>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          ))
        )}

        {candidates.length > COLLAPSE_AT && (
          <button type="button" onClick={() => setExpanded(e => !e)}
            className="min-h-[44px] px-2 text-xs font-bold text-chicken-brown/60 underline underline-offset-2">
            {expanded ? '收合 ▴' : `＋ 其他 ${hiddenCount} 張${preassign ? '桌' : '空桌'} ▾`}
          </button>
        )}

        <div className="flex flex-wrap gap-1.5 pt-1">
          <button type="button" aria-pressed={choice?.kind === 'map'} onClick={() => onPick('map')}
            className={optionCls(choice?.kind === 'map')}>到桌況圖選（可併桌）</button>
          <button type="button" aria-pressed={choice?.kind === 'none'} onClick={() => onPick('none')}
            className={optionCls(choice?.kind === 'none')}>先不指派</button>
        </div>
        <p className="text-[11px] font-bold text-chicken-brown/50">{hint}</p>
      </div>
    </div>
  )
}
