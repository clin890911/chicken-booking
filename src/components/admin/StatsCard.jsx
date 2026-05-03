export default function StatsCard({ icon, label, value, color = 'red' }) {
  const colorMap = {
    red: 'bg-chicken-red/10 text-chicken-red',
    yellow: 'bg-chicken-yellow/15 text-chicken-yellow',
    green: 'bg-chicken-green/15 text-chicken-green',
    brown: 'bg-chicken-brown/10 text-chicken-brown'
  }
  return (
    <div className={`rounded-2xl p-3 ${colorMap[color] || colorMap.red}`}>
      <div className="flex items-center gap-2">
        <span className="text-xl">{icon}</span>
        <span className="text-xs font-bold opacity-80">{label}</span>
      </div>
      <div className="text-2xl font-black mt-1">{value}</div>
    </div>
  )
}
