import { Button } from '../../../ui'
import { dayLabel } from '../../../../utils/timeSlots'
import { groupTableNumbers } from '../../../../utils/capacity'

// 階段二：當日團單總覽。日期 header chip + 換日期、容量摘要、團卡、新增團單。
export default function GroupDayStage({ date, dayGroups, capacity, onChangeDate, onSelectGroup, onNewGroup }) {
  return (
    <div className="space-y-3">
      {/* header chip + 換日期 + 新增 */}
      <div className="bg-white rounded-xl border border-chicken-brown/10 p-3 flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-chicken-cream px-3 py-1.5 text-sm font-black text-chicken-brown">
            📅 {dayLabel(date)}
          </span>
          <button onClick={onChangeDate} className="text-xs font-bold text-chicken-red">換日期</button>
        </div>
        <Button onClick={onNewGroup}>➕ 新增團單</Button>
      </div>

      {/* 容量摘要 */}
      {capacity && (
        <div className="bg-white rounded-xl border border-chicken-brown/10 px-3 py-2 text-xs font-bold text-chicken-brown/70">
          本日團體已保留 <span className="text-chicken-red">{capacity.tables}</span> 桌 ·
          <span className="text-chicken-red"> {capacity.seats}</span> 席（共 {dayGroups.length} 團）
        </div>
      )}

      {/* 團卡 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
        {dayGroups.length === 0 && (
          <div className="col-span-full text-center text-sm text-chicken-brown/50 p-8 bg-white rounded-xl border border-dashed border-chicken-brown/15">
            這天還沒有團單，點右上「新增團單」開始預排
          </div>
        )}
        {dayGroups.map(g => (
          <button key={g.id} onClick={() => onSelectGroup(g.id)}
            className="text-left rounded-xl border-2 border-chicken-brown/10 bg-white p-3 hover:border-indigo-400 transition-all">
            <div className="font-bold text-chicken-brown text-sm truncate">🚌 {g.agencyName || '（未填旅行社）'}</div>
            {g.guideName && <div className="text-xs text-chicken-brown/50 truncate">導遊 {g.guideName}</div>}
            <div className="text-xs text-chicken-brown/60 mt-1">
              {(g.batches || []).map(b => b.timeSlot).join(' / ') || '未排梯次'} · {g.counts?.total || 0} 人 · {groupTableNumbers(g).length} 桌
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
