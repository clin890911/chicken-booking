import { useMemo, useState } from 'react'
import { useBooking } from '../../../contexts/BookingContext'
import { EmptyState } from '../../ui'
import { todayStr } from '../../../utils/timeSlots'
import { todayGroupsByState } from '../../../utils/groupLive'
import GroupTodayCard from './GroupTodayCard'
import GroupSheet from '../group/GroupSheet'

// 現場右側欄「今日團體」籤：依抵達時間列今日各團，梯次入座/離席/整團完成。
// 已完成的團移入底部「已完成」摺疊區（灰階、不可再操作、保留回傳單列印）。
export default function GroupTodayPanel({ onFocusTable, onReseatBatch }) {
  const { groupReservations, tables, store, settings } = useBooking()
  const today = todayStr()
  const [sheetGroup, setSheetGroup] = useState(null)
  const [showCompleted, setShowCompleted] = useState(false)

  const { active, completed } = useMemo(
    () => todayGroupsByState(groupReservations, today),
    [groupReservations, today],
  )

  if (active.length + completed.length === 0) {
    return <EmptyState icon="🚌" title="今日沒有團體" hint="可到「團體 → 預排規劃」建立預排單" />
  }

  return (
    <div className="space-y-2.5">
      {active.map(g => (
        <GroupTodayCard key={g.id} group={g} onOpenSheet={setSheetGroup} onFocusTable={onFocusTable} onReseatBatch={onReseatBatch} />
      ))}
      {active.length === 0 && (
        <div className="text-center text-xs text-chicken-brown/55 font-bold py-3">
          🎉 今日團體皆已完成
        </div>
      )}
      {completed.length > 0 && (
        <div className="pt-1">
          <button
            onClick={() => setShowCompleted(v => !v)}
            className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-chicken-brown/5 text-xs font-bold text-chicken-brown/65 hover:bg-chicken-brown/10"
          >
            <span>✓ 已完成（{completed.length}）</span>
            <span className="text-[10px]">{showCompleted ? '收合 ▲' : '展開 ▼'}</span>
          </button>
          {showCompleted && (
            <div className="mt-2 space-y-2.5">
              {completed.map(g => (
                <GroupTodayCard key={g.id} group={g} onOpenSheet={setSheetGroup} onFocusTable={onFocusTable} />
              ))}
            </div>
          )}
        </div>
      )}
      {sheetGroup && (
        <GroupSheet group={sheetGroup} tables={tables} store={store || settings} onClose={() => setSheetGroup(null)} />
      )}
    </div>
  )
}
