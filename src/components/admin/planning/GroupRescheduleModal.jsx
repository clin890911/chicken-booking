import { useState, useMemo } from 'react'
import { Modal } from '../../ui'
import MonthCalendar from '../../booking/MonthCalendar'
import { useBooking } from '../../../contexts/BookingContext'
import { dayLabel, todayStr } from '../../../utils/timeSlots'
import { remainingTablesForSeating } from '../../../utils/capacity'

// 團體「📅 改期」第一步：選新日期。
// 只選日期＋預覽新日各場次可用度；確認後把整團（清空圈桌）交給編輯器在新日重新圈桌（第二步）。
// 不在此落地任何資料——草稿優先：未在編輯器儲存前，團單仍留在原日期。
// 團體不受散客 maxDaysAhead 限制（旅行社常提前數月），故月曆不設 maxDate。
export default function GroupRescheduleModal({ open, group, onClose, onConfirm }) {
  const { settings, tables, bookings, groupReservations } = useBooking()
  const today = todayStr()
  const [newDate, setNewDate] = useState(null)

  const seatings = Array.isArray(settings?.seatings) ? settings.seatings : []
  // 排除正在改期的本團，避免改到同日時把自己算進佔用
  const otherGroups = useMemo(
    () => (groupReservations || []).filter(g => g.id !== group?.id),
    [groupReservations, group?.id],
  )
  const closedDate = !!newDate && (settings?.closures?.closedDates || []).includes(newDate)

  // 新日各場次剩餘桌/席（與容量引擎同口徑；公休/關閉場次回 closed）
  const preview = useMemo(() => {
    if (!newDate || !seatings.length) return []
    return seatings.map(s => ({
      seating: s,
      r: remainingTablesForSeating(tables, bookings, otherGroups, newDate, s, settings),
    }))
  }, [newDate, seatings, tables, bookings, otherGroups, settings])

  const total = Number(group?.counts?.total) || 0
  const sameDay = !!newDate && newDate === group?.date
  const canConfirm = !!newDate && !closedDate

  const handleClose = () => { setNewDate(null); onClose?.() }
  const handleConfirm = () => {
    if (!canConfirm) return
    onConfirm?.(newDate)
    setNewDate(null)
  }

  if (!group) return null

  return (
    <Modal open={open} onClose={handleClose} title={`📅 團體改期 · ${group.agencyName || '（未填旅行社）'}`} footer={
      <>
        <button onClick={handleClose} className="btn-secondary px-4 py-2">取消</button>
        <button onClick={handleConfirm} disabled={!canConfirm}
          className="btn-primary px-4 py-2 disabled:opacity-50">
          {!newDate ? '請先選新日期' : closedDate ? '該日公休' : '下一步：重新圈桌 →'}
        </button>
      </>
    }>
      <div className="space-y-3">
        <div className="rounded-lg bg-chicken-cream/60 px-3 py-2 text-sm font-bold text-chicken-brown">
          目前日期：📅 {dayLabel(group.date)}　·　共 {total} 人
        </div>

        <div>
          <label className="label">選擇新日期</label>
          <MonthCalendar value={newDate || ''} onChange={setNewDate} minDate={today} />
        </div>

        {newDate && (
          <div className="rounded-xl border-2 border-indigo-200 bg-indigo-50/50 p-3 space-y-2">
            <div className="text-sm font-black text-indigo-700">
              新日期：{dayLabel(newDate)}{sameDay ? '（同一天，等同重新圈桌）' : ''}
            </div>

            {closedDate ? (
              <div className="rounded-lg bg-chicken-red/10 px-3 py-2 text-xs font-bold text-chicken-red">
                🚫 該日為公休日，無法改期，請改選其他日期。
              </div>
            ) : seatings.length ? (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {preview.map(({ seating, r }) => {
                  const closed = r.closed
                  const full = !closed && (r.remainingSeats ?? 0) <= 0
                  const tight = !closed && !full && total > 0 && r.remainingSeats < total
                  const cls = closed ? 'border-chicken-brown/15 bg-white text-chicken-brown/40'
                    : full ? 'border-rose-200 bg-rose-50 text-rose-500'
                      : tight ? 'border-amber-300 bg-amber-50 text-amber-800'
                        : 'border-emerald-300 bg-emerald-50 text-emerald-800'
                  return (
                    <div key={seating.id} className={`rounded-lg border-2 p-2 ${cls}`}>
                      <div className="text-xs font-black">{seating.name}</div>
                      <div className="text-[11px] opacity-70">{seating.start}–{seating.end}</div>
                      <div className="mt-1 text-xs font-bold">
                        {closed ? '🚫 已關閉'
                          : full ? '已客滿'
                            : `剩 ${r.remainingTables ?? '—'} 桌 / ${r.remainingSeats ?? '—'} 席`}
                        {tight && <span className="ml-1">· 需分梯</span>}
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs font-bold text-amber-800">
                尚未設定場次，下一步在編輯器直接圈桌即可。
              </div>
            )}

            <div className="rounded-lg bg-white/70 px-3 py-2 text-[11px] font-bold text-indigo-600/80">
              ⚠️ 改期後原圈桌位將清空，下一步請為新日期重新圈桌。未儲存前團單仍留在原日期（{dayLabel(group.date)}）。
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
