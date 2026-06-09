import { useMemo } from 'react'
import { Card } from '../ui'
import { useToast } from '../ui/Toast'
import { useBooking } from '../../contexts/BookingContext'
import { totalActiveSeats } from '../../utils/capacity'

export default function TableGrid() {
  const { tables, toggleTable } = useBooking()
  const toast = useToast()

  // 點擊切換啟用/停用 + 反饋（以點擊前狀態判斷切換後結果）
  const handleToggle = (t) => {
    toggleTable(t.number)
    if (t.isActive) toast.warning(`已停用 ${t.number}`)
    else toast.success(`已啟用 ${t.number}`)
  }

  const stats = useMemo(() => {
    const four = tables.filter(t => t.capacity === 4)
    const six = tables.filter(t => t.capacity === 6)
    const fourActive = four.filter(t => t.isActive).length
    const sixActive = six.filter(t => t.isActive).length
    const seats = totalActiveSeats(tables)
    return { fourActive, fourTotal: four.length, sixActive, sixTotal: six.length, seats }
  }, [tables])

  const fourSeaters = tables.filter(t => t.capacity === 4)
  const sixSeaters = tables.filter(t => t.capacity === 6)

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
      </Card>

      <Card>
        <h3 className="font-bold text-chicken-brown mb-3">🪑 四人桌（A1 - A33）</h3>
        <div className="grid grid-cols-6 sm:grid-cols-8 gap-2">
          {fourSeaters.map(t => (
            <button
              key={t.number}
              onClick={() => handleToggle(t)}
              className={`aspect-square min-h-[44px] rounded-lg border-2 flex flex-col items-center justify-center text-xs font-bold transition-all active:scale-95 ${
                t.isActive
                  ? 'border-chicken-green bg-chicken-green/15 text-chicken-brown'
                  : 'border-chicken-brown/20 bg-chicken-brown/5 text-chicken-brown/30 line-through'
              }`}
            >
              <span>{t.number}</span>
              <span className="text-[9px] opacity-70">4人</span>
            </button>
          ))}
        </div>
      </Card>

      <Card>
        <h3 className="font-bold text-chicken-brown mb-3">🪑 六人桌（B1 - B19）</h3>
        <div className="grid grid-cols-6 sm:grid-cols-8 gap-2">
          {sixSeaters.map(t => (
            <button
              key={t.number}
              onClick={() => handleToggle(t)}
              className={`aspect-square min-h-[44px] rounded-lg border-2 flex flex-col items-center justify-center text-xs font-bold transition-all active:scale-95 ${
                t.isActive
                  ? 'border-chicken-yellow bg-chicken-yellow/15 text-chicken-brown'
                  : 'border-chicken-brown/20 bg-chicken-brown/5 text-chicken-brown/30 line-through'
              }`}
            >
              <span>{t.number}</span>
              <span className="text-[9px] opacity-70">6人</span>
            </button>
          ))}
        </div>
      </Card>

      <p className="text-center text-xs text-chicken-brown/50">點擊桌子可切換啟用 / 停用</p>
    </div>
  )
}
