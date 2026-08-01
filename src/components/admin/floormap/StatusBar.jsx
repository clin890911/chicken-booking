// 頂部統計列：6 個關鍵數字一眼看到（外場 iPad 不用換頁）
// 「90分內將到」看訂位組數（之前看桌況 reserved 數：開店有訂位卻顯示 0，誤導）；
// 過時未到另計紅字。「在席人數」優先用 booking 實際人數，團體桌以桌容量估。
//
// variant：
//   'grid'（預設）＝原本的六格大數字卡（高度約 76px）
//   'compact'      ＝現場 iPad 用的單行 pill 列（高度約 30px，與樓層/視圖切換同一列）。
//                    iPad 10 橫向可視高只有 506pt，頂部三排就吃掉 180px；壓成一條把高度還給桌況圖。
import { useMemo, useState, useEffect } from 'react'
import { todayStr } from '../../../utils/timeSlots'
import { classifyTodayPulse } from '../../../utils/bookingPulse'
import { isTableUsableOnDate } from '../../../utils/tableAvailability'

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']

// 「現場 · 7/27 (日) 18:32」：分鐘級即可，30 秒 tick（與 OpsHintBar 同步調）。
// 刻意做成子元件，計時器只在 compact 版掛載，grid 版完全不受影響。
function NowLabel() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30000)
    return () => clearInterval(id)
  }, [])
  const hh = String(now.getHours()).padStart(2, '0')
  const mm = String(now.getMinutes()).padStart(2, '0')
  return (
    <div className="flex-none text-sm font-black text-chicken-brown whitespace-nowrap">
      現場
      <span className="ml-1.5 text-[11px] font-bold text-chicken-brown/55 tabular-nums">
        {now.getMonth() + 1}/{now.getDate()} ({WEEKDAYS[now.getDay()]}) {hh}:{mm}
      </span>
    </div>
  )
}

export default function StatusBar({ tables, waitlist, bookings = [], variant = 'grid' }) {
  const counts = { vacant: 0, reserved: 0, dining: 0, cleaning: 0, blocked: 0 }
  const bookingById = {}
  bookings.forEach(b => { if (b.id) bookingById[b.id] = b })
  let occSeats = 0
  const today = todayStr()
  tables.forEach(t => {
    // 維修/停用只剔除「空著的」桌；有客人的桌（跨午夜進維修窗等不一致狀態）必須照常計入，
    // 否則在席人數與用餐桌數會憑空消失。
    const occupied = ['dining', 'reserved', 'cleaning'].includes(t.status) || t.currentBookingId || t.currentRef
    if (!isTableUsableOnDate(t, today) && !occupied) return
    counts[t.status] = (counts[t.status] || 0) + 1
    if (t.status === 'dining') {
      const b = t.currentBookingId ? bookingById[t.currentBookingId] : null
      // 大組併桌：主桌 + 副桌 currentBookingId 都指向同一 booking。guests 只在主桌算一次，
      // 副桌（在 extraTableIds）不重複加，否則 8 人會被算成 16。團體桌（無 booking）按桌容量估。
      if (b) {
        const isExtra = (b.extraTableIds || []).map(String).includes(String(t.number)) && String(b.assignedTableId) !== String(t.number)
        if (!isExtra) occSeats += Number(b.guests) || t.capacity
      } else {
        occSeats += t.capacity
      }
    }
  })
  const waiting = waitlist.filter(w => w.status === 'waiting').length
  const called = waitlist.filter(w => w.status === 'called').length

  const pulse = useMemo(
    () => classifyTodayPulse(bookings, todayStr()),
    [bookings],
  )

  const items = [
    { label: '可入座',   value: counts.vacant,   color: 'text-emerald-700', className: 'status-vacant' },
    { label: '90分內將到', value: pulse.soon.length, color: 'text-sky-700', className: 'status-reserved',
      sub: pulse.overdue.length > 0 ? `+${pulse.overdue.length} 過時未到` : null },
    { label: '用餐中',   value: counts.dining,   color: 'text-orange-700', className: 'status-dining' },
    { label: '待清桌',   value: counts.cleaning, color: 'text-amber-700', className: 'status-cleaning' },
    { label: '候位需處理', value: waiting + called,color: 'text-red-700', className: 'status-danger', accent: true },
    { label: '在席人數', value: occSeats,        color: 'text-chicken-brown', className: 'bg-white text-chicken-brown border-chicken-brown/10' },
  ]
  if (variant === 'compact') {
    // 單行 pill：數字 text-base、標籤 text-[11px]。原本掛在「90分內將到」下面的
    // 「+N 過時未到」在一條線上沒有位置放副標 → 獨立成一顆紅底 pill（資訊不減）。
    const pills = [
      ...items.map(it => ({ label: it.label, value: it.value, className: it.className, color: it.color })),
      ...(pulse.overdue.length > 0
        ? [{ label: '未報到', value: pulse.overdue.length, className: 'bg-chicken-red/10 border-chicken-red/25', color: 'text-chicken-red' }]
        : []),
    ]
    return (
      <div className="flex items-center gap-2 min-w-0">
        <NowLabel />
        <div className="flex items-center gap-1.5 min-w-0 overflow-x-auto no-scrollbar">
          {pills.map(p => (
            <div
              key={p.label}
              className={`flex-none flex items-baseline gap-1 px-2 py-1 rounded-lg border ${p.className}`}
            >
              <span className={`text-base font-black tabular-nums leading-none ${p.color}`}>{p.value}</span>
              <span className="text-[11px] font-bold opacity-60 leading-none whitespace-nowrap">{p.label}</span>
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2">
      {items.map(it => (
        <div key={it.label}
             className={`border rounded-xl px-3 py-2 flex flex-col items-center ${it.className}
                         ${it.accent && it.value > 0 ? 'ring-2 ring-red-100' : ''}`}>
          <div className={`text-2xl font-black tabular-nums leading-none ${it.color}`}>{it.value}</div>
          <div className="text-[11px] font-bold opacity-70 mt-1">{it.label}</div>
          {it.sub && <div className="text-[10px] font-black text-chicken-red mt-0.5">{it.sub}</div>}
        </div>
      ))}
    </div>
  )
}
