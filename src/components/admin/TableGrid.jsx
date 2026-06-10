import { useMemo } from 'react'
import { Card } from '../ui'
import { useToast } from '../ui/Toast'
import { useBooking } from '../../contexts/BookingContext'
import { totalActiveSeats } from '../../utils/capacity'
import { isTableOutOnDate, normalizeOutage, outageLabel } from '../../utils/tableAvailability'
import { todayStr } from '../../utils/timeSlots'

export default function TableGrid() {
  const { tables, toggleTable } = useBooking()
  const toast = useToast()
  const today = todayStr()

  // 點擊切換啟用/停用 + 反饋；佔用守門失敗時顯示原因（桌上有客人不准停用）
  const handleToggle = (t) => {
    const r = toggleTable(t.number)
    if (!r?.ok) return toast.error(r?.error || '無法切換')
    if (t.isActive) toast.warning(`已停用 ${t.number}`)
    else toast.success(`已啟用 ${t.number}`)
  }

  const stats = useMemo(() => {
    const four = tables.filter(t => t.capacity === 4)
    const six = tables.filter(t => t.capacity === 6)
    const fourActive = four.filter(t => t.isActive).length
    const sixActive = six.filter(t => t.isActive).length
    const seats = totalActiveSeats(tables)
    const outTables = tables.filter(t => t.isActive && isTableOutOnDate(t, today))
    const outSeats = outTables.reduce((s, t) => s + (Number(t.capacity) || 0), 0)
    return { fourActive, fourTotal: four.length, sixActive, sixTotal: six.length, seats, outToday: outTables.length, outSeats }
  }, [tables, today])

  const fourSeaters = tables.filter(t => t.capacity === 4)
  const sixSeaters = tables.filter(t => t.capacity === 6)
  // 桌號範圍標籤由實際資料推導（避免重新編號後又留下過時文案）
  const rangeLabel = (list) => {
    const nums = list.map(t => String(t.number)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    return nums.length ? `${nums[0]}–${nums[nums.length - 1]}` : '—'
  }

  const renderTable = (t, activeClass) => {
    const out = isTableOutOnDate(t, today)
    // 只有「未來」的維修窗標為排定；過期紀錄不再顯示（normalizeOutage 過濾壞資料）
    const o = normalizeOutage(t.outage)
    const upcoming = !out && o && o.from > today ? outageLabel(t, today) : ''
    return (
      <button
        key={t.number}
        onClick={() => handleToggle(t)}
        className={`aspect-square min-h-[44px] rounded-lg border-2 flex flex-col items-center justify-center text-xs font-bold transition-all active:scale-95 ${
          !t.isActive
            ? 'border-chicken-brown/20 bg-chicken-brown/5 text-chicken-brown/30 line-through'
            : out
              ? 'border-orange-300 bg-orange-50 text-orange-700'
              : activeClass
        }`}
        title={out || upcoming ? outageLabel(t, today) : undefined}
      >
        <span>{out ? '🛠' : ''}{t.number}</span>
        <span className="text-[9px] opacity-70">{out ? '維修' : upcoming ? '🛠排定' : `${t.capacity}人`}</span>
      </button>
    )
  }

  return (
    <div className="space-y-4">
      <Card>
        <div className="grid grid-cols-3 gap-2 text-center">
          <div>
            <div className="text-xs text-chicken-brown/60">四人桌</div>
            <div className="text-xl font-black text-chicken-brown">{stats.fourActive}<span className="text-sm text-chicken-brown/40">/{stats.fourTotal}</span></div>
          </div>
          <div>
            <div className="text-xs text-chicken-brown/60">六人桌</div>
            <div className="text-xl font-black text-chicken-brown">{stats.sixActive}<span className="text-sm text-chicken-brown/40">/{stats.sixTotal}</span></div>
          </div>
          <div>
            <div className="text-xs text-chicken-brown/60">可用座位</div>
            <div className="text-xl font-black text-chicken-red">{stats.seats}</div>
          </div>
        </div>
        {stats.outToday > 0 && (
          <p className="mt-2 text-center text-xs font-bold text-orange-600">🛠 今日有 {stats.outToday} 桌維修中（今日實際可訂 {stats.seats - stats.outSeats} 位 = 上方 {stats.seats} − 維修 {stats.outSeats}；到現場頁點該桌可結束維修）</p>
        )}
      </Card>

      <Card>
        <h3 className="font-bold text-chicken-brown mb-3">🪑 四人桌（{rangeLabel(fourSeaters)}）</h3>
        <div className="grid grid-cols-6 sm:grid-cols-8 gap-2">
          {fourSeaters.map(t => renderTable(t, 'border-chicken-green bg-chicken-green/15 text-chicken-brown'))}
        </div>
      </Card>

      <Card>
        <h3 className="font-bold text-chicken-brown mb-3">🪑 六人桌（{rangeLabel(sixSeaters)}）</h3>
        <div className="grid grid-cols-6 sm:grid-cols-8 gap-2">
          {sixSeaters.map(t => renderTable(t, 'border-chicken-yellow bg-chicken-yellow/15 text-chicken-brown'))}
        </div>
      </Card>

      <p className="text-center text-xs text-chicken-brown/50">點擊桌子可切換啟用 / 停用（長期）；短期維修請在現場頁點桌設定「維修停用」</p>
    </div>
  )
}
