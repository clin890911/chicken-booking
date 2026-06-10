import { useMemo, useState, useEffect } from 'react'
import { useBooking } from '../../../contexts/BookingContext'
import { todayStr } from '../../../utils/timeSlots'
import { classifyTodayPulse } from '../../../utils/bookingPulse'
import { diffMin, stageOf } from '../../../utils/diningStage'
import { dayPhase } from '../../../utils/dayPhase'
import { todayActiveGroups } from '../../../utils/groupLive'
import { listToday as opsLogToday } from '../../../services/opsLogService'

// 現場「現在該做什麼」單行提示列（StatusBar 下方，最多兩則，不做 dashboard）。
// 優先序：過時未到 > 超時用餐 > 待清桌 > 系統自動處理紀錄 > 一天節奏單句。
export function pickHints({ pulse, tables, settings, groups, autoCount, now }) {
  const hints = []
  if (pulse.overdue.length) {
    hints.push({ level: 'danger', text: `⚠ ${pulse.overdue.length} 組過時未到待處理`, action: 'open-upcoming' })
  }
  // 刻意不過濾 isActive/outage：停用或維修中但仍佔用的桌（不一致狀態）更需要被提示處理。
  const overtime = (tables || []).filter(t => t.status === 'dining' && t.seatedAt
    && ['overtime', 'buffer-overtime'].includes(stageOf(diffMin(t.seatedAt, now), settings)))
  if (overtime.length) {
    hints.push({ level: 'danger', text: `🔴 ${overtime.length} 桌已超時用餐，可禮貌詢問結帳` })
  }
  const cleaning = (tables || []).filter(t => t.status === 'cleaning').length
  if (cleaning) hints.push({ level: 'warn', text: `🧹 ${cleaning} 桌待清` })
  if (autoCount > 0) {
    hints.push({ level: 'info', text: `🤖 系統今日自動處理 ${autoCount} 筆`, action: 'open-log' })
  }
  if (!hints.length) {
    const p = dayPhase(settings, now)
    const upcomingTxt = () => {
      const parts = []
      if (pulse.soon.length + pulse.later.length > 0) parts.push(`${pulse.soon.length + pulse.later.length} 組訂位`)
      const g = (groups || []).length
      if (g) parts.push(`${g} 團`)
      return parts.length ? `今日還有 ${parts.join('、')}` : '今日無待到訂位'
    }
    if (p.phase === 'before-open') hints.push({ level: 'calm', text: `☀️ 開店前 · ${upcomingTxt()}` })
    else if (p.phase === 'service') hints.push({ level: 'calm', text: `🍲 ${p.seating?.name || '營業中'} · ${upcomingTxt()}` })
    else if (p.phase === 'between') hints.push({ level: 'calm', text: `☕ 場次空檔${p.next ? ` · ${p.next.start} ${p.next.name}` : ''} · ${upcomingTxt()}` })
    else hints.push({ level: 'calm', text: '🌙 已過打烊時間 · 桌況乾淨即可收工' })
  }
  return hints.slice(0, 2)
}

const LEVEL_CLS = {
  danger: 'bg-chicken-red/10 border-chicken-red/30 text-chicken-red',
  warn: 'bg-amber-50 border-amber-300 text-amber-800',
  info: 'bg-sky-50 border-sky-200 text-sky-800',
  calm: 'bg-white border-chicken-brown/10 text-chicken-brown/65',
}

export default function OpsHintBar({ onOpenUpcoming, onOpenLog }) {
  const { tables, bookings, settings, groupReservations } = useBooking()
  const today = todayStr()
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000)
    return () => clearInterval(id)
  }, [])

  const hints = useMemo(() => {
    const pulse = classifyTodayPulse(bookings, today, now)
    const groups = todayActiveGroups(groupReservations, today)
    const autoCount = opsLogToday(today).length
    return pickHints({ pulse, tables, settings, groups, autoCount, now })
  }, [bookings, tables, settings, groupReservations, today, now])

  if (!hints.length) return null
  return (
    <div className="flex flex-wrap gap-2">
      {hints.map((h, i) => (
        <button
          key={i}
          onClick={() => {
            if (h.action === 'open-upcoming') onOpenUpcoming?.()
            if (h.action === 'open-log') onOpenLog?.()
          }}
          className={`flex-1 min-w-[200px] text-left px-3 py-2 rounded-xl border text-xs font-bold ${LEVEL_CLS[h.level]} ${h.action ? 'cursor-pointer hover:opacity-80' : 'cursor-default'}`}
        >
          {h.text}
        </button>
      ))}
    </div>
  )
}
