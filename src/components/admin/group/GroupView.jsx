import { useState } from 'react'
import GroupPlanningView from './GroupPlanningView'
import GroupDirectoryView from './GroupDirectoryView'

const SUB = [
  { key: 'planning', label: '預排規劃' },
  { key: 'directory', label: '名冊 / 歷史' },
]

// 旅行社團體：預排規劃 / 名冊歷史
// （「今日團體」現場帶位已併入「現場」分頁右側欄，onGoLive 用來跳過去）
export default function GroupView({ onGoLive }) {
  const [sub, setSub] = useState('planning')
  return (
    <div className="space-y-3">
      <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
        {SUB.map(s => (
          <button
            key={s.key}
            onClick={() => setSub(s.key)}
            className={`whitespace-nowrap px-4 py-2 rounded-xl text-sm font-bold border-2 transition-all ${
              sub === s.key
                ? 'bg-chicken-red border-chicken-red text-white shadow'
                : 'bg-white border-chicken-brown/15 text-chicken-brown'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>
      {sub === 'planning' && <GroupPlanningView onGoToday={onGoLive} />}
      {sub === 'directory' && <GroupDirectoryView />}
    </div>
  )
}
