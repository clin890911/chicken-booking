import { useMemo, useState } from 'react'
import { useBooking } from '../../../contexts/BookingContext'
import { EmptyState } from '../../ui'
import { todayStr } from '../../../utils/timeSlots'
import { todayActiveGroups } from '../../../utils/groupLive'
import GroupTodayCard from './GroupTodayCard'
import GroupSheet from '../group/GroupSheet'

// 現場右側欄「今日團體」籤：依抵達時間列今日各團，梯次入座/離席/整團完成
export default function GroupTodayPanel({ onFocusTable }) {
  const { groupReservations, tables, store, settings } = useBooking()
  const today = todayStr()
  const [sheetGroup, setSheetGroup] = useState(null)

  const groups = useMemo(
    () => todayActiveGroups(groupReservations, today),
    [groupReservations, today],
  )

  if (groups.length === 0) {
    return <EmptyState icon="🚌" title="今日沒有團體" hint="可到「團體 → 預排規劃」建立預排單" />
  }

  return (
    <div className="space-y-2.5">
      {groups.map(g => (
        <GroupTodayCard key={g.id} group={g} onOpenSheet={setSheetGroup} onFocusTable={onFocusTable} />
      ))}
      {sheetGroup && (
        <GroupSheet group={sheetGroup} tables={tables} store={store || settings} onClose={() => setSheetGroup(null)} />
      )}
    </div>
  )
}
