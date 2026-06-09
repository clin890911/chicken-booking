import { useMemo, useState } from 'react'
import { useBooking } from '../../../contexts/BookingContext'
import { useToast } from '../../ui/Toast'
import { EmptyState, Badge } from '../../ui'
import { todayStr } from '../../../utils/timeSlots'
import GroupSheet from './GroupSheet'

const STATUS_LABEL = {
  planned: { label: '已預排', color: 'gray' },
  confirmed: { label: '已確認', color: 'yellow' },
  arrived: { label: '已到店', color: 'green' },
  completed: { label: '已完成', color: 'brown' },
  cancelled: { label: '已取消', color: 'red' },
}

// 今日團體：現場帶位用。每個梯次可「入座 / 離席」，整團可「完成」。
export default function GroupTodayView() {
  const {
    groupReservations, tables, store, settings,
    seatGroupBatch, checkoutGroupBatch, finalizeGroup, setGroupStatus,
  } = useBooking()
  const toast = useToast()
  const today = todayStr()
  const [sheetGroup, setSheetGroup] = useState(null)

  const tableByNumber = useMemo(() => {
    const m = {}
    tables.forEach(t => { m[t.number] = t })
    return m
  }, [tables])

  const todayGroups = useMemo(() => {
    return groupReservations
      .filter(g => g.date === today && g.status !== 'cancelled')
      .sort((a, b) => {
        const sa = Math.min(...(a.batches || []).map(x => x.timeSlot || '99:99'))
        const sb = Math.min(...(b.batches || []).map(x => x.timeSlot || '99:99'))
        return String(sa).localeCompare(String(sb))
      })
  }, [groupReservations, today])

  // 某梯次是否已入座（其桌至少一張為 dining 且 currentRef 指向此梯次）
  const batchSeated = (group, batch) =>
    (batch.tableNumbers || []).some(n => {
      const t = tableByNumber[n]
      return t && t.status === 'dining' && t.currentRef?.groupId === group.id && t.currentRef?.batchId === batch.id
    })

  const onSeat = (g, b) => {
    const r = seatGroupBatch(g.id, b.id)
    if (!r.ok) return toast.error('入座失敗：' + r.error)
    toast.success(`✅ ${g.agencyName} ${b.label} 已入座（${(b.tableNumbers || []).join('、')}）`)
  }
  const onCheckout = (g, b) => {
    const r = checkoutGroupBatch(g.id, b.id)
    if (!r.ok) return toast.error('離席失敗：' + r.error)
    toast.success(`${g.agencyName} ${b.label} 已離席，桌位待清`)
  }
  const onFinalize = (g) => {
    const r = finalizeGroup(g.id)
    if (!r.ok) return toast.error('完成失敗：' + r.error)
    toast.success(`${g.agencyName} 整團已完成、桌位釋出`)
  }

  if (todayGroups.length === 0) {
    return <EmptyState icon="🚌" title="今日沒有團體" hint="可到「預排規劃」建立團體預排單" />
  }

  return (
    <div className="space-y-3">
      {todayGroups.map(g => {
        const st = STATUS_LABEL[g.status] || STATUS_LABEL.planned
        const c = g.counts || {}
        return (
          <div key={g.id} className="bg-white rounded-xl border border-chicken-brown/10 p-4">
            <div className="flex items-start justify-between gap-2 flex-wrap">
              <div>
                <div className="font-black text-chicken-brown text-base">
                  🚌 {g.agencyName || '（未填旅行社）'}
                  <Badge color={st.color} className="ml-2">{st.label}</Badge>
                </div>
                <div className="text-xs text-chicken-brown/60 mt-0.5">
                  導遊 {g.guideName || '—'}{g.guidePhone ? `（${g.guidePhone}）` : ''}
                </div>
              </div>
              <div className="flex gap-1.5">
                <button onClick={() => setSheetGroup(g)} className="px-3 py-1.5 rounded-lg text-xs font-bold bg-white border-2 border-chicken-brown/15 text-chicken-brown">🖨 回傳單</button>
                {g.status !== 'completed' && (
                  <button onClick={() => onFinalize(g)} className="px-3 py-1.5 rounded-lg text-xs font-bold bg-chicken-brown text-white">整團完成</button>
                )}
              </div>
            </div>

            <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] font-bold">
              <span className="px-2 py-0.5 rounded-full bg-chicken-red/10 text-chicken-red">總 {c.total || 0}</span>
              {c.vegetarian > 0 && <span className="px-2 py-0.5 rounded-full bg-chicken-green/15 text-chicken-green">素 {c.vegetarian}</span>}
              {c.child > 0 && <span className="px-2 py-0.5 rounded-full bg-sky-100 text-sky-700">兒童 {c.child}</span>}
              {c.mobility > 0 && <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">♿ {c.mobility}</span>}
              {c.wheelchair > 0 && <span className="px-2 py-0.5 rounded-full bg-violet-100 text-violet-700">輪椅 {c.wheelchair}</span>}
              {g.allergyText && <span className="px-2 py-0.5 rounded-full bg-chicken-red text-white">過敏：{g.allergyText}</span>}
            </div>

            <div className="mt-3 space-y-2">
              {(g.batches || []).map(b => {
                const seated = batchSeated(g, b)
                return (
                  <div key={b.id} className="flex items-center gap-2 flex-wrap rounded-lg bg-chicken-cream/60 px-3 py-2">
                    <span className="text-sm font-black text-chicken-brown tabular-nums">{b.timeSlot}</span>
                    <span className="text-sm font-bold text-chicken-brown">{b.label}</span>
                    <span className="text-xs text-chicken-brown/60">{b.guests} 人</span>
                    <span className="text-xs text-chicken-brown/60">桌：{(b.tableNumbers || []).join('、') || '未圈桌'}</span>
                    <div className="flex-1" />
                    {seated ? (
                      <button onClick={() => onCheckout(g, b)} className="px-3 py-1.5 rounded-lg text-xs font-bold bg-amber-500 text-white">梯次離席</button>
                    ) : (
                      <button onClick={() => onSeat(g, b)} disabled={!(b.tableNumbers || []).length}
                        className="px-3 py-1.5 rounded-lg text-xs font-bold bg-chicken-green text-white disabled:opacity-40">✅ 梯次入座</button>
                    )}
                  </div>
                )
              })}
            </div>

            {g.status === 'planned' && (
              <button onClick={() => setGroupStatus(g.id, 'confirmed')} className="mt-2 text-xs text-chicken-brown/60 underline">標記為已確認</button>
            )}
          </div>
        )
      })}

      {sheetGroup && (
        <GroupSheet group={sheetGroup} tables={tables} store={store || settings} onClose={() => setSheetGroup(null)} />
      )}
    </div>
  )
}
