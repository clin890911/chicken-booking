import { useMemo, useState, useEffect } from 'react'
import { useBooking } from '../../../contexts/BookingContext'
import { todayStr } from '../../../utils/timeSlots'
import { classifyTodayPulse } from '../../../utils/bookingPulse'
import { diffMin, stageOf } from '../../../utils/diningStage'
import { dayPhase } from '../../../utils/dayPhase'
import { todayActiveGroups } from '../../../utils/groupLive'
import { listToday as opsLogToday } from '../../../services/opsLogService'

// 時間欄最舊的一筆（缺時間的排最後；同時間依桌號，結果穩定可預期）
function oldestBy(list, timeOf) {
  const ts = (t) => { const v = new Date(timeOf(t) || '').getTime(); return Number.isFinite(v) ? v : Infinity }
  return [...list].sort((a, b) => ts(a) - ts(b) || String(a.number).localeCompare(String(b.number)))[0]
}

// 現場「現在該做什麼」單行提示列（StatusBar 下方，最多兩則，不做 dashboard）。
// 優先序：過時未到 > 超時用餐 > 待清桌 > 系統自動處理紀錄 > 一天節奏單句。
export function pickHints({ pulse, tables, settings, groups, autoCount, now }) {
  const hints = []
  if (pulse.overdue.length) {
    hints.push({ level: 'danger', text: `${pulse.overdue.length} 組過時未到待處理`, action: 'open-upcoming' })
  }
  // 刻意不過濾 isActive/outage：停用或維修中但仍佔用的桌（不一致狀態）更需要被提示處理。
  const overtime = (tables || []).filter(t => t.status === 'dining' && t.seatedAt
    && ['overtime', 'buffer-overtime'].includes(stageOf(diffMin(t.seatedAt, now), settings)))
  // 「N 桌超時／待清」點了直接處理：帶出最該先處理的那一桌（打開它的桌況抽屜）。
  // 超時＝坐最久的；待清＝最早變成待清的（updatedAt 最舊）。處理完 N−1，再點一次就是下一桌。
  if (overtime.length) {
    const first = oldestBy(overtime, t => t.seatedAt)
    hints.push({ level: 'danger', text: `${overtime.length} 桌已超時用餐，可禮貌詢問結帳`, action: 'open-table', tableNumber: String(first.number) })
  }
  const cleaningTables = (tables || []).filter(t => t.status === 'cleaning')
  if (cleaningTables.length) {
    const first = oldestBy(cleaningTables, t => t.updatedAt)
    hints.push({ level: 'warn', text: `${cleaningTables.length} 桌待清`, action: 'open-table', tableNumber: String(first.number) })
  }
  if (autoCount > 0) {
    hints.push({ level: 'info', text: `系統今日自動處理 ${autoCount} 筆`, action: 'open-log' })
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
    if (p.phase === 'before-open') hints.push({ level: 'calm', text: `開店前 · ${upcomingTxt()}` })
    else if (p.phase === 'service') hints.push({ level: 'calm', text: `${p.seating?.name || '營業中'} · ${upcomingTxt()}` })
    else if (p.phase === 'between') hints.push({ level: 'calm', text: `場次空檔${p.next ? ` · ${p.next.start} ${p.next.name}` : ''} · ${upcomingTxt()}` })
    else hints.push({ level: 'calm', text: '已過打烊時間 · 桌況乾淨即可收工' })
  }
  return hints.slice(0, 2)
}

const LEVEL_CLS = {
  danger: 'bg-chicken-red/10 border-chicken-red/30 text-chicken-red',
  warn: 'bg-amber-50 border-amber-300 text-amber-800',
  info: 'bg-sky-50 border-sky-200 text-sky-800',
  calm: 'bg-white border-chicken-brown/10 text-chicken-brown/65',
}

export default function OpsHintBar({ onOpenUpcoming, onOpenLog, onOpenTable }) {
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
    // 細長條：兩則提示串在同一行（iPad 頂部每一像素都要還給桌況圖）。
    // 內容過長時各自 truncate，不換行、不長高。
    <div className="flex items-center gap-2">
      {hints.map((h, i) => (
        <button
          key={i}
          onClick={() => {
            if (h.action === 'open-upcoming') onOpenUpcoming?.()
            if (h.action === 'open-log') onOpenLog?.()
            if (h.action === 'open-table') onOpenTable?.(h.tableNumber)
          }}
          title={h.action === 'open-table' ? `打開 ${h.tableNumber} 處理` : undefined}
          className={`flex-1 min-w-0 truncate text-left px-3 py-1 rounded-lg border text-xs font-bold ${LEVEL_CLS[h.level]} ${h.action ? 'cursor-pointer hover:opacity-80' : 'cursor-default'}`}
        >
          {h.text}
        </button>
      ))}
    </div>
  )
}
