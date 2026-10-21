// 頂部統計列：6 個關鍵數字一眼看到（外場 iPad 不用換頁）
// 「90分內將到」看訂位組數（之前看桌況 reserved 數：開店有訂位卻顯示 0，誤導）；
// 過時未到另計紅字。「在席人數」優先用 booking 實際人數，團體桌以桌容量估。
//
// variant：
//   'grid'（預設）＝原本的六格大數字卡（高度約 76px）
//   'compact'      ＝現場 iPad 用的單行 pill 列（高度約 30px，與樓層/視圖切換同一列），只列三個數字。
//                    iPad 10 橫向可視高只有 506pt，頂部三排就吃掉 180px；壓成一條把高度還給桌況圖。
import { useMemo } from 'react'
import { todayStr } from '../../../utils/timeSlots'
import { classifyTodayPulse } from '../../../utils/bookingPulse'
import { diningTablePresentation } from '../../../utils/tableStatus'
import { isTableUsableOnDate } from '../../../utils/tableAvailability'

export default function StatusBar({ tables, waitlist, bookings = [], variant = 'grid', tablePresentation = null }) {
  const counts = { vacant: 0, reserved: 0, dining: 0, cleaning: 0, blocked: 0 }
  const bookingById = {}
  bookings.forEach(b => { if (b.id) bookingById[b.id] = b })
  let occSeats = 0
  const today = todayStr()
  tables.forEach(storedTable => {
    const t = diningTablePresentation(storedTable, bookingById[storedTable.currentBookingId], tables)
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
    { label: '可入座',   value: tablePresentation ? tables.filter(t => tablePresentation[t.number]?.canSeatNow).length : counts.vacant,   color: 'text-emerald-700', className: 'status-vacant' },
    { label: '90分內將到', value: pulse.soon.length, color: 'text-sky-700', className: 'status-reserved',
      sub: pulse.overdue.length > 0 ? `+${pulse.overdue.length} 過時未到` : null },
    { label: '用餐中',   value: counts.dining,   color: 'text-orange-700', className: 'status-dining' },
    { label: '待清桌',   value: counts.cleaning, color: 'text-amber-700', className: 'status-cleaning' },
    { label: '候位需處理', value: waiting + called,color: 'text-red-700', className: 'status-danger', accent: true },
    { label: '在席人數', value: occSeats,        color: 'text-chicken-brown', className: 'bg-white text-chicken-brown border-chicken-brown/10' },
  ]
  if (variant === 'compact') {
    // 現場 iPad 頂列只留三個「看一眼就要的」數字（Barry 2026-10-17：頂列資訊太多、很多沒在看）。
    // 其餘各有更直接的落點，不重複：90 分內將到／過時未到 → 今日訂位籤 badge＋提示列；
    // 待清桌、超時 → 提示列；候位 → 候位籤 badge；時間 → iPad 狀態列。
    const KEEP = ['可入座', '用餐中', '在席人數']
    const pills = items.filter(it => KEEP.includes(it.label))
      .map(it => ({ label: it.label, value: it.value, className: it.className, color: it.color }))
    return (
      <div className="flex items-center gap-2 min-w-0">
        <div className="flex items-center gap-1.5 min-w-0 overflow-x-auto no-scrollbar">
          {pills.map(p => (
            <div
              key={p.label}
              className={`flex-none flex items-baseline gap-1 px-2 py-1 rounded-lg border ${p.className}`}
            >
              <span className={`text-base font-bold tabular-nums leading-none ${p.color}`}>{p.value}</span>
              <span className="text-[11px] font-bold leading-none whitespace-nowrap">{p.label}</span>
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
          <div className={`text-2xl font-bold tabular-nums leading-none ${it.color}`}>{it.value}</div>
          <div className="text-[11px] font-bold mt-1">{it.label}</div>
          {it.sub && <div className="text-[10px] font-bold text-chicken-red mt-0.5">{it.sub}</div>}
        </div>
      ))}
    </div>
  )
}
