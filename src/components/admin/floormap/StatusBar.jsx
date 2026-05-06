// 頂部統計列：6 個關鍵數字一眼看到（外場 iPad 不用換頁）
export default function StatusBar({ tables, waitlist }) {
  const counts = { vacant: 0, reserved: 0, dining: 0, cleaning: 0, blocked: 0 }
  let occSeats = 0
  tables.forEach(t => {
    if (!t.isActive) return
    counts[t.status] = (counts[t.status] || 0) + 1
    if (t.status === 'dining') occSeats += t.capacity
  })
  const waiting = waitlist.filter(w => w.status === 'waiting').length
  const called = waitlist.filter(w => w.status === 'called').length

  const items = [
    { label: '空桌',     value: counts.vacant,   color: 'text-emerald-600' },
    { label: '已預訂',   value: counts.reserved, color: 'text-yellow-600' },
    { label: '用餐中',   value: counts.dining,   color: 'text-red-600' },
    { label: '等待清桌', value: counts.cleaning, color: 'text-orange-600' },
    { label: '候位中',   value: waiting + called,color: 'text-chicken-red', accent: true },
    { label: '在席人數', value: occSeats,        color: 'text-chicken-brown' },
  ]
  return (
    <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
      {items.map(it => (
        <div key={it.label}
             className={`bg-white border ${it.accent ? 'border-chicken-red bg-chicken-red/5' : 'border-chicken-brown/10'}
                         rounded-xl px-3 py-2 flex flex-col items-center`}>
          <div className={`text-2xl font-black tabular-nums leading-none ${it.color}`}>{it.value}</div>
          <div className="text-[11px] text-chicken-brown/60 mt-1">{it.label}</div>
        </div>
      ))}
    </div>
  )
}
