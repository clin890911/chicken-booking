import { Badge } from '../ui'
import { getNoshowCount } from '../../services/bookingService'

const STATUS_MAP = {
  pending: { label: '待確認', color: 'gray' },
  confirmed: { label: '待到', color: 'yellow' },
  arrived: { label: '已到', color: 'green' },
  completed: { label: '已離', color: 'gray' },
  noshow: { label: 'No-show', color: 'red' },
  cancelled: { label: '已取消', color: 'gray' }
}

const SOURCE_MAP = {
  online: { label: '🌐 線上' },
  phone: { label: '📞 電話' },
  walkin: { label: '🚶 現場' },
  group: { label: '👥 團體' },
  line: { label: '💚 LINE' }
}

export default function BookingCard({ booking, onCycleStatus, onCancel, onNoshow, onClick }) {
  const status = STATUS_MAP[booking.status] || STATUS_MAP.pending
  const noshowCount = getNoshowCount(booking.phone)

  return (
    <div className="card hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="text-lg font-black text-chicken-brown">{booking.timeSlot}</span>
            <span className="text-sm font-bold text-chicken-brown">{booking.name}</span>
            <span className="text-sm text-chicken-brown/60">{booking.guests} 位</span>
          </div>
          <div className="text-xs text-chicken-brown/70 mt-0.5 flex items-center gap-1.5 flex-wrap">
            <span>📱 {booking.phone}</span>
            {noshowCount > 0 && (
              <span className="text-chicken-red font-bold" title={`No-show ${noshowCount} 次`}>⚠️ ×{noshowCount}</span>
            )}
            {SOURCE_MAP[booking.source] && (
              <span className="text-chicken-brown/50">· {SOURCE_MAP[booking.source].label}</span>
            )}
          </div>
          <div className="mt-1.5 flex items-center gap-1 flex-wrap">
            {booking.notes?.pet && <Badge color="yellow">🐾 寵物</Badge>}
            {booking.notes?.child && <Badge color="green">👶 兒童</Badge>}
            {booking.notes?.mobility && <Badge color="brown">♿ 行動不便</Badge>}
            {booking.notes?.text && <span className="text-[11px] text-chicken-brown/60 italic">「{booking.notes.text}」</span>}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <button
            onClick={() => onCycleStatus?.(booking)}
            className={`badge whitespace-nowrap cursor-pointer hover:opacity-80 ${
              status.color === 'red' ? 'bg-chicken-red/10 text-chicken-red'
                : status.color === 'yellow' ? 'bg-chicken-yellow/15 text-chicken-yellow'
                : status.color === 'green' ? 'bg-chicken-green/15 text-chicken-green'
                : 'bg-chicken-brown/10 text-chicken-brown'
            }`}
          >
            {status.label}
          </button>
          <div className="flex gap-1">
            {onNoshow && booking.status !== 'noshow' && booking.status !== 'completed' && (
              <button onClick={() => onNoshow(booking)} className="text-[10px] text-chicken-red/70 underline">標 no-show</button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
