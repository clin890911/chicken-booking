import { useState, useEffect } from 'react'
import CustomersView from './CustomersView'
import AgencyDirectoryView from './AgencyDirectoryView'
import SegmentedControl from '../../ui/SegmentedControl'
import PageTitle from '../../layout/PageTitle'

const SUB = [
  { key: 'customers', label: '顧客', icon: 'users' },
  { key: 'agencies', label: '旅行社 / 導遊', icon: 'bus' },
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
      {/* 頁名與子分頁籤同一列（桌機不再有獨立標題列，見 layout/PageTitle） */}
      <div className="sticky top-0 z-20 py-1 bg-chicken-cream flex items-center gap-3">
        <PageTitle className="pl-1">名冊</PageTitle>
        <SegmentedControl options={SUB} value={sub} onChange={setSub} ariaLabel="名冊子分頁" />
      </div>
      {sub === 'customers' && <CustomersView initialQuery={seedQuery} onAddBooking={onAddBooking} />}
      {sub === 'agencies' && <AgencyDirectoryView onGoPlanning={onGoPlanning} />}
    </div>
  )
}
