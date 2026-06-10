// 今日備餐重點：自動加總當日所有團的特殊需求，給廚房與外場備料/設備。
// 吃 daySummary.prep（summarizeDayPrep 結果）。過敏/桌邊/遊覽車依團具名，行動需求附桌號。
const TILES = [
  { key: 'vegetarian', label: '素食', cls: 'bg-chicken-green/15 text-chicken-green' },
  { key: 'child', label: '兒童', cls: 'bg-sky-100 text-sky-700' },
  { key: 'mobility', label: '行動不便', cls: 'bg-amber-100 text-amber-700' },
  { key: 'wheelchair', label: '輪椅', cls: 'bg-violet-100 text-violet-700' },
]

function NeedList({ icon, title, items, render }) {
  if (!items.length) return null
  return (
    <div>
      <div className="text-[11px] font-black text-chicken-brown/55 mb-1">{icon} {title}</div>
      <div className="space-y-1">
        {items.map((it, i) => (
          <div key={i} className="text-xs text-chicken-brown bg-chicken-cream/60 rounded-lg px-2.5 py-1.5">{render(it)}</div>
        ))}
      </div>
    </div>
  )
}

export default function GroupPrepDigest({ prep }) {
  if (!prep || prep.groupCount === 0) return null
  const { counts, allergies, tableSideNeeds, buses, mobilityGroups } = prep
  const anyNeeds = allergies.length || tableSideNeeds.length || buses.length || mobilityGroups.length

  return (
    <div className="bg-white rounded-2xl border border-chicken-brown/10 p-3 sm:p-4">
      <h3 className="font-black text-chicken-brown text-sm mb-3">🍽 今日備餐重點 <span className="text-chicken-brown/40 font-bold">（{prep.groupCount} 團彙總）</span></h3>

      <div className="grid grid-cols-4 gap-2 mb-3">
        {TILES.map(t => (
          <div key={t.key} className={`rounded-xl p-2.5 text-center ${t.cls}`}>
            <div className="text-[11px] font-bold opacity-80">{t.label}</div>
            <div className="text-2xl font-black tabular-nums leading-tight mt-0.5">{counts[t.key] || 0}</div>
          </div>
        ))}
      </div>

      {anyNeeds ? (
        <div className="space-y-2.5">
          <NeedList icon="⚠️" title="過敏 / 飲食禁忌" items={allergies}
            render={it => <><span className="font-bold">{it.agencyName}</span>：{it.text}</>} />
          <NeedList icon="🍴" title="桌邊需求" items={tableSideNeeds}
            render={it => <><span className="font-bold">{it.agencyName}</span>：{it.text}</>} />
          <NeedList icon="♿" title="行動 / 輪椅安排（建議安排 1F 地面層）" items={mobilityGroups}
            render={it => <><span className="font-bold">{it.agencyName}</span>　桌 {it.tableNumbers.join('、') || '未圈'}</>} />
          <NeedList icon="🚍" title="遊覽車 / 司機" items={buses}
            render={it => <><span className="font-bold">{it.agencyName}</span>：{it.busInfo}</>} />
        </div>
      ) : (
        <div className="text-xs text-chicken-brown/50">本日無特殊需求備註。</div>
      )}
    </div>
  )
}
