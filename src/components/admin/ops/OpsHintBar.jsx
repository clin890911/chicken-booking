import { useMemo, useState, useEffect } from 'react'
import { TriangleAlert, Timer, Clock, Brush, Users } from 'lucide-react'
import { useBooking } from '../../../contexts/BookingContext'
import { todayStr } from '../../../utils/timeSlots'
import { classifyTodayPulse } from '../../../utils/bookingPulse'
import { pickOpsAlerts, computeStoreStats } from '../../../utils/opsAlerts'

// 現場頁頂端「一條」（Barry 2026-10-30，取代「全店」六格統計列＋原本另一列的提示列）：
//   常駐兩格：可入座 N 桌 · 可坐 M 人｜用餐中 N 桌 · M 人（大字主數字、小字單位與人數，比照訂位頁「12 組 · 48 人」）
//   有事才接在後面：過時未到／超時／將到／待清／候位，數字 0 的不出現；點了直接帶到那件事。
// 只渲染在頂列裡（與 地圖／摘要／排程 同一列），不另外多一列 → iPad 頂部高度不增加。
// 用餐中以外的管理數字（待清總數、系統自動處理紀錄、一天節奏）在摘要分頁。

const ALERT_ICON = { overdue: TriangleAlert, overtime: Timer, soon: Clock, cleaning: Brush, waitlist: Users }

// 底色一律不透明：頂列是玻璃（半透明白），半透明底會吃到桌布顏色，字色掉到 AA 以下；實心淡底 ≥5:1。
const LEVEL_CLS = {
  danger: 'bg-red-50 border-chicken-red/30 text-chicken-red',
  warn: 'bg-amber-50 border-amber-300 text-amber-800',
  info: 'bg-sky-50 border-sky-200 text-sky-800',
  queue: 'bg-violet-50 border-violet-200 text-violet-800',
}

// 「將到 3 組 · 10 人」：label 小字、主數字大字、單位與人數小字
function Figure({ label, value, unit, people, small = 'text-chicken-brown/60' }) {
  return (
    <span className="inline-flex items-baseline gap-0.5 whitespace-nowrap">
      <span className={`text-sm font-semibold ${small}`}>{label}</span>
      <span className="text-xl font-bold tabular-nums leading-none">{value}</span>
      <span className={`text-sm font-semibold ${small}`}>{unit}{people != null ? ` · ${people} 人` : ''}</span>
    </span>
  )
}

export default function OpsHintBar({ tablePresentation = null, onOpenUpcoming, onOpenTable, onOpenWaitlist }) {
  const { tables, bookings, settings, waitlist } = useBooking()
  const today = todayStr()
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000)
    return () => clearInterval(id)
  }, [])

  const { stats, alerts } = useMemo(() => {
    const pulse = classifyTodayPulse(bookings, today, now)
    return {
      stats: computeStoreStats({ tables: tables || [], bookings: bookings || [], waitlist: waitlist || [], tablePresentation, pulse, today }),
      alerts: pickOpsAlerts({ pulse, tables, settings, waitlist, now }),
    }
  }, [bookings, tables, settings, waitlist, tablePresentation, today, now])

  const run = (a) => {
    if (a.action === 'open-upcoming') onOpenUpcoming?.()
    if (a.action === 'open-table') onOpenTable?.(a.tableNumber)
    if (a.action === 'open-waitlist') onOpenWaitlist?.()
  }

  return (
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 min-w-0 text-chicken-brown">
      {/* 常駐：看一眼就知道「還能坐多少、場內多少人」（口徑同樓層鈕「可坐」＝現在就能坐的桌） */}
      <div role="group" aria-label="全店概況" className="flex items-center gap-2.5 min-h-[44px] flex-none">
        <span data-stat="vacant" className="text-emerald-800"><Figure label="可入座" value={stats.vacant} unit="桌" people={stats.vacantSeats} /></span>
        <span aria-hidden className="h-5 w-px bg-chicken-brown/15" />
        <span data-stat="dining"><Figure label="用餐中" value={stats.dining} unit="桌" people={stats.occSeats} /></span>
      </div>
      {/* 有事才出現：數字 0 的不列；全部是 0 → 這一段不渲染（不留空白） */}
      {alerts.length > 0 && (
        <div role="group" aria-label="需要處理" className="flex flex-wrap items-center gap-1 min-w-0">
          {alerts.map(a => {
            const Icon = ALERT_ICON[a.key]
            return (
              <button
                key={a.key}
                type="button"
                data-alert={a.key}
                onClick={() => run(a)}
                title={a.title}
                aria-label={`${a.text}：${a.title}`}
                className={`tap flex-none inline-flex items-center gap-1 min-h-[44px] px-2.5 rounded-xl border cursor-pointer hover:brightness-95 ${LEVEL_CLS[a.level]}`}
              >
                {Icon && <Icon size={15} strokeWidth={2.25} aria-hidden className="flex-none" />}
                <Figure label={a.label} value={a.count} unit={a.unit} people={a.people} small="" />
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
