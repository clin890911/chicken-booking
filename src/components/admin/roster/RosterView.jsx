import { useState, useEffect } from 'react'
import CustomersView from './CustomersView'
import AgencyDirectoryView from './AgencyDirectoryView'

const SUB = [
  { key: 'customers', label: '👤 顧客', },
  { key: 'agencies', label: '🚌 旅行社 / 導遊' },
]

// 名冊：顧客檔（VIP/黑名單）＋ 旅行社/導遊（含歷史團體與業績排名）。
// 兩個子視圖都自取 context，容器只負責子籤切換。
// pendingPhone：他頁（設定→No-show）帶入電話 → 切到顧客子籤並 seed 搜尋，消費後回呼清除。
export default function RosterView({ pendingPhone, onPendingConsumed, onAddBooking, onGoPlanning }) {
  const [sub, setSub] = useState('customers')
  const [seedQuery, setSeedQuery] = useState('')

  useEffect(() => {
    if (pendingPhone) {
      setSub('customers')
      setSeedQuery(pendingPhone)
      onPendingConsumed?.()
    }
  }, [pendingPhone, onPendingConsumed])

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
      {sub === 'customers' && <CustomersView initialQuery={seedQuery} onAddBooking={onAddBooking} />}
      {sub === 'agencies' && <AgencyDirectoryView onGoPlanning={onGoPlanning} />}
    </div>
  )
}
