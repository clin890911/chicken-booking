import Icon from '../../ui/Icon'

// 遊覽車抵達時間軸：依場次分區、時間排序，外場一眼看出帶位節奏。
// 吃 daySummary.timeline（buildArrivalTimeline 結果）。對不到場次的梯次以琥珀色提醒確認帶位。
// onFocusBatch(row)：點某團某梯次 → 容器跳排位地圖，在這團的桌位畫白圈標示「坐這邊」（已圈桌才可點）。
export default function GroupArrivalTimeline({ timeline = [], onFocusBatch }) {
  if (!timeline.length) return null

  return (
    <div className="space-y-1.5">
      <h3 className="px-1 text-xs font-semibold text-chicken-brown/55 tracking-wide">遊覽車抵達時間軸</h3>
      <div className="bg-white rounded-xl border border-chicken-brown/10 overflow-hidden">
        {timeline.map((bucket, bi) => {
          const isNull = bucket.seating === null
          const collisionSlots = new Set((bucket.collisions || []).map(c => c.timeSlot))
          return (
            <div key={bucket.seating?.id || `none-${bi}`} className="border-t border-chicken-brown/[0.08] first:border-t-0">
              <div className={`flex items-center gap-2 flex-wrap px-3.5 py-2 ${isNull ? 'bg-amber-50' : 'bg-[#fbfaf8]'}`}>
                <div className={`text-xs font-semibold ${isNull ? 'text-amber-700' : 'text-chicken-brown'}`}>
                  {isNull ? '未對應場次（請確認帶位時間）' : bucket.seating.name}
                </div>
                {!isNull && <div className="text-xs text-chicken-brown/50 tabular-nums">{bucket.seating.start}–{bucket.seating.end}</div>}
                {(bucket.collisions || []).length > 0 && (
                  <div className="flex flex-wrap gap-1 ml-auto">
                    {bucket.collisions.map(c => (
                      <span key={c.timeSlot} className="text-[11px] font-semibold rounded-full bg-chicken-red/10 text-chicken-red px-2 py-0.5 tabular-nums">
                        {c.timeSlot} 同時 {c.count} 團 · {c.guests} 位
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {bucket.rows.map((r, ri) => {
                const collide = collisionSlots.has(r.timeSlot)
                const hasTables = (r.tableNumbers || []).length > 0
                const clickable = !!onFocusBatch && hasTables
                const RowTag = clickable ? 'button' : 'div'
                return (
                  <RowTag key={`${r.group.id}-${r.batch.id}-${ri}`}
                    type={clickable ? 'button' : undefined}
                    onClick={clickable ? () => onFocusBatch(r) : undefined}
                    title={clickable ? '在排位地圖上標示這團座位' : undefined}
                    className={`w-full text-left flex items-center gap-2.5 min-h-[44px] px-3.5 border-t border-chicken-brown/[0.06] ${clickable ? 'tap hover:bg-chicken-brown/[0.03]' : ''}`}>
                    <span className={`text-sm font-semibold tabular-nums px-1.5 py-0.5 rounded-md ${collide ? 'bg-chicken-red text-white' : 'text-chicken-brown'}`}>
                      {r.timeSlot || '—'}
                    </span>
                    {/* 名稱一行、梯次＋桌號一行：iPad 橫向右欄只有 ~380px，單行會把旅行社名擠成「東…」 */}
                    <span className="flex-1 min-w-0 flex flex-col py-1.5">
                      <span className="text-sm font-semibold text-chicken-brown truncate">{r.group.agencyName || '（未填旅行社）'}</span>
                      <span className="text-[11px] text-chicken-brown/50 tabular-nums truncate">
                        {r.batch.label ? `${r.batch.label} · ` : ''}{r.tableNumbers.length ? `桌 ${r.tableNumbers.join('、')}` : '未圈桌'}
                      </span>
                    </span>
                    <span className="text-xs font-semibold text-chicken-brown/70 tabular-nums shrink-0">{r.guests} 位</span>
                    {clickable && <span className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-chicken-red shrink-0">看地圖<Icon name="chevronRight" size={12} strokeWidth={2.2} /></span>}
                  </RowTag>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}
