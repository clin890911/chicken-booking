import { useState } from 'react'
import Icon from '../../ui/Icon'

// 今日備餐重點：自動加總當日所有團的特殊需求，給廚房與外場備料/設備。
// 吃 daySummary.prep（summarizeDayPrep 結果）。
// 2026-09 改版：群組清單（iOS 設定頁式）——每列一種需求 + 合計；點列原地展開，
// 看到「哪一團 · 第一梯幾點 · 幾份 · 哪幾桌」（店主：點素食要能看到哪一團要素食餐）。
// 過敏 / 桌邊 / 遊覽車依團具名，同樣可展開。
const NEEDS = [
  { key: 'vegetarian', label: '素食', icon: 'leaf', color: 'text-[#5b8c1f]', unit: '份' },
  { key: 'child', label: '兒童', icon: 'child', color: 'text-sky-600', unit: '位' },
  { key: 'mobility', label: '行動不便', icon: 'walk', color: 'text-amber-600', unit: '位', hint: '建議 1F' },
  { key: 'wheelchair', label: '輪椅', icon: 'wheelchair', color: 'text-violet-600', unit: '位', hint: '建議 1F' },
]

function Row({ open, onToggle, icon, color, label, value, unit, hint, count, children, disabled }) {
  return (
    <div className="border-t border-chicken-brown/[0.08] first:border-t-0">
      <button type="button" onClick={onToggle} disabled={disabled} aria-expanded={open}
        className={`tap w-full flex items-center gap-2.5 min-h-[46px] px-3.5 text-left ${open ? 'bg-[#fbfaf8]' : ''} ${disabled ? 'cursor-default' : ''}`}>
        <Icon name={icon} size={18} className={color} />
        <span className="text-sm font-semibold text-chicken-brown">{label}</span>
        {value != null && <span className={`text-[15px] font-semibold tabular-nums ${value > 0 ? color : 'text-chicken-brown/30'}`}>{value}{unit && value > 0 ? <span className="text-xs font-medium ml-0.5">{unit}</span> : null}</span>}
        <span className="flex-1" />
        {hint && value > 0 && <span className="text-xs text-chicken-brown/50">{hint}</span>}
        {count > 0 && <span className="text-xs text-chicken-brown/50 tabular-nums">{count} 團</span>}
        {!disabled && <Icon name={open ? 'chevronDown' : 'chevronRight'} size={14} strokeWidth={2.2} className="text-chicken-brown/40" />}
      </button>
      {open && children}
    </div>
  )
}

function SubRow({ children }) {
  return (
    <div className="flex items-center gap-2.5 min-h-[40px] pl-[42px] pr-3.5 border-t border-chicken-brown/[0.06] bg-[#fbfaf8] text-[13px]">
      {children}
    </div>
  )
}

export default function GroupPrepDigest({ prep }) {
  const [open, setOpen] = useState('vegetarian') // 預設展開素食：出餐最常查的一項
  if (!prep || prep.groupCount === 0) return null
  const { counts, allergies, tableSideNeeds, buses, byGroup = [] } = prep
  const toggle = (k) => setOpen(o => (o === k ? null : k))
  const fmtTables = (nums) => (nums && nums.length ? nums.join('、') : '未圈桌')

  return (
    <div className="space-y-1.5">
      <div className="flex items-center px-1">
        <h3 className="text-xs font-semibold text-chicken-brown/55 tracking-wide">備餐重點 <span className="font-medium text-chicken-brown/40">· {prep.groupCount} 團彙總</span></h3>
      </div>
      <div className="bg-white rounded-xl border border-chicken-brown/10 overflow-hidden">
        {NEEDS.map(n => {
          const groups = byGroup.filter(g => (g.counts?.[n.key] || 0) > 0)
          const value = counts[n.key] || 0
          return (
            <Row key={n.key} open={open === n.key} onToggle={() => toggle(n.key)} disabled={groups.length === 0}
              icon={n.icon} color={n.color} label={n.label} value={value} unit={n.unit} hint={n.hint} count={groups.length}>
              {groups.map(g => (
                <SubRow key={g.id}>
                  <span className="font-semibold text-chicken-brown truncate">{g.agencyName}</span>
                  {g.firstTimeSlot && <span className="text-chicken-brown/55 tabular-nums shrink-0">{g.firstTimeSlot}</span>}
                  <span className="flex-1" />
                  <span className={`font-semibold tabular-nums shrink-0 ${n.color}`}>{g.counts[n.key]} {n.unit}</span>
                  <span className="text-chicken-brown/50 tabular-nums shrink-0">{fmtTables(g.tableNumbers)}</span>
                </SubRow>
              ))}
            </Row>
          )
        })}

        <Row open={open === 'allergy'} onToggle={() => toggle('allergy')} disabled={allergies.length === 0}
          icon="warning" color="text-chicken-red" label="過敏 / 禁忌" value={allergies.length} unit="團" count={0}>
          {allergies.map((it, i) => (
            <SubRow key={i}><span className="font-semibold text-chicken-brown shrink-0">{it.agencyName}</span><span className="text-chicken-brown/70">{it.text}</span></SubRow>
          ))}
        </Row>
        <Row open={open === 'tableside'} onToggle={() => toggle('tableside')} disabled={tableSideNeeds.length === 0}
          icon="utensils" color="text-chicken-brown/70" label="桌邊需求" value={tableSideNeeds.length} unit="團" count={0}>
          {tableSideNeeds.map((it, i) => (
            <SubRow key={i}><span className="font-semibold text-chicken-brown shrink-0">{it.agencyName}</span><span className="text-chicken-brown/70">{it.text}</span></SubRow>
          ))}
        </Row>
        <Row open={open === 'bus'} onToggle={() => toggle('bus')} disabled={buses.length === 0}
          icon="bus" color="text-chicken-brown/70" label="遊覽車 / 司機" value={buses.length} unit="團" count={0}>
          {buses.map((it, i) => (
            <SubRow key={i}><span className="font-semibold text-chicken-brown shrink-0">{it.agencyName}</span><span className="text-chicken-brown/70">{it.busInfo}</span></SubRow>
          ))}
        </Row>
      </div>
    </div>
  )
}
