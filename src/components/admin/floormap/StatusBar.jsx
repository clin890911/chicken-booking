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
    { label: '可入座',   value: counts.vacant,   color: 'text-emerald-700', className: 'status-vacant' },
    { label: '即將到',   value: counts.reserved, color: 'text-sky-700', className: 'status-reserved' },
    { label: '用餐中',   value: counts.dining,   color: 'text-orange-700', className: 'status-dining' },
    { label: '待清桌',   value: counts.cleaning, color: 'text-amber-700', className: 'status-cleaning' },
    { label: '候位需處理', value: waiting + called,color: 'text-red-700', className: 'status-danger', accent: true },
    { label: '在席人數', value: occSeats,        color: 'text-chicken-brown', className: 'bg-white text-chicken-brown border-chicken-brown/10' },
  ]
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2">
      {items.map(it => (
        <div key={it.label}
             className={`border rounded-xl px-3 py-2 flex flex-col items-center ${it.className}
                         ${it.accent && it.value > 0 ? 'ring-2 ring-red-100' : ''}`}>
          <div className={`text-2xl font-black tabular-nums leading-none ${it.color}`}>{it.value}</div>
          <div className="text-[11px] font-bold opacity-70 mt-1">{it.label}</div>
        </div>
      ))}
    </div>
  )
}
