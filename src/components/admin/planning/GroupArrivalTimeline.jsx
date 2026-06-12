// 遊覽車抵達時間軸：依場次分區、時間排序，外場一眼看出帶位節奏。
// 吃 daySummary.timeline（buildArrivalTimeline 結果）。對不到場次的梯次以琥珀色提醒確認帶位。
// onFocusBatch(row)：點某團某梯次 → 容器跳排位地圖，在這團的桌位畫白圈標示「坐這邊」（已圈桌才可點）。
export default function GroupArrivalTimeline({ timeline = [], onFocusBatch }) {
  if (!timeline.length) return null

  return (
    <div className="bg-white rounded-2xl border border-chicken-brown/10 p-3 sm:p-4">
      <h3 className="font-black text-chicken-brown text-sm mb-3">🚌 遊覽車抵達時間軸</h3>
      <div className="space-y-3">
        {timeline.map((bucket, bi) => {
          const isNull = bucket.seating === null
          const collisionSlots = new Set((bucket.collisions || []).map(c => c.timeSlot))
          return (
            <div key={bucket.seating?.id || `none-${bi}`}
              className={`rounded-xl border-2 p-2.5 ${isNull ? 'border-amber-300 bg-amber-50' : 'border-chicken-brown/10 bg-chicken-cream/40'}`}>
              <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
                <div className={`text-xs font-black ${isNull ? 'text-amber-700' : 'text-chicken-brown'}`}>
                  {isNull ? '⚠ 未對應場次（請確認帶位時間）' : `${bucket.seating.name} · ${bucket.seating.start}–${bucket.seating.end}`}
                </div>
                {(bucket.collisions || []).length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {bucket.collisions.map(c => (
                      <span key={c.timeSlot} className="text-[10px] font-black rounded-full bg-chicken-red text-white px-2 py-0.5">
                        {c.timeSlot} 同時段 {c.count} 團 / {c.guests} 位
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div className="space-y-1.5">
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
                      className={`w-full text-left flex items-center gap-2 flex-wrap rounded-lg bg-white px-2.5 py-1.5 border transition-all ${clickable ? 'border-chicken-brown/5 hover:border-indigo-400 hover:bg-indigo-50/40 cursor-pointer' : 'border-chicken-brown/5'}`}>
                      <span className={`text-sm font-black tabular-nums px-1.5 py-0.5 rounded ${collide ? 'bg-chicken-red text-white' : 'text-chicken-brown'}`}>
                        {r.timeSlot || '—'}
                      </span>
                      <span className="text-sm font-bold text-chicken-brown truncate">🚌 {r.group.agencyName || '（未填旅行社）'}</span>
                      {r.batch.label && <span className="text-[11px] text-chicken-brown/50">{r.batch.label}</span>}
                      <div className="flex-1" />
                      <span className="text-xs font-bold text-chicken-brown/70 tabular-nums">{r.guests} 位</span>
                      <span className="text-[11px] text-chicken-brown/55">桌 {r.tableNumbers.join('、') || '未圈'}</span>
                      {clickable && <span className="text-[11px] font-bold text-indigo-500 shrink-0">看地圖 ›</span>}
                    </RowTag>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
