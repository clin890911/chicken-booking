import { useState } from 'react'
import DatePicker from '../../../booking/DatePicker'
import { todayStr } from '../../../../utils/timeSlots'

// 階段一：選日期。預設只顯示 2 週、每日標「N 團」，可「顯示更多」或直接跳指定日期。
export default function GroupDateStage({ date, badges = {}, maxDaysCap = 60, onPick }) {
  const [weeks, setWeeks] = useState(2)
  const visibleDays = Math.min(weeks * 7, maxDaysCap)
  const canShowMore = visibleDays < maxDaysCap

  const renderBadge = (d) => {
    const n = badges[d]
    if (!n) return null
    const active = date === d
    return (
      <span className={`inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-black ${
        active ? 'bg-white/25 text-white' : 'bg-chicken-red text-white'
      }`}>{n}</span>
    )
  }

  return (
    <div className="bg-white rounded-xl border border-chicken-brown/10 p-3 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="text-sm font-bold text-chicken-brown">📅 選擇預排日期</div>
        <label className="flex items-center gap-1.5 text-xs font-bold text-chicken-brown/70">
          跳到指定日期
          <input
            type="date"
            min={todayStr()}
            value={date}
            onChange={e => e.target.value && onPick(e.target.value)}
            className="input !py-1 !px-2 text-xs w-[150px]"
          />
        </label>
      </div>

      <DatePicker value={date} onChange={onPick} maxDaysAhead={visibleDays} renderBadge={renderBadge} compact />

      {canShowMore && (
        <button
          onClick={() => setWeeks(w => w + 4)}
          className="w-full py-2 rounded-xl text-sm font-bold border-2 border-chicken-brown/15 text-chicken-brown/70 hover:border-chicken-red/40"
        >
          顯示更多日期 ▾
        </button>
      )}
    </div>
  )
}
