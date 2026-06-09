import { useMemo, useState } from 'react'
import FloorMap from './floormap/FloorMap'
import StatsCard from './StatsCard'
import DatePicker from '../booking/DatePicker'
import { useBooking } from '../../contexts/BookingContext'
import { useToast } from '../ui/Toast'
import { todayStr, dayLabel, seatingForSlot } from '../../utils/timeSlots'
import { resolveSlotOccupancy, isSeatingClosed, CAPACITY_EXCLUDED_STATUSES } from '../../utils/capacity'

// 統一座位地圖（規劃 / 總覽）：依「日期 + 場次」呈現散客（暖色）與團客（冷色）佔位。
// 唯讀總覽為主，另支援「散客預先配桌」（只記 booking.assignedTableId，不動今日即時桌況）。
export default function SlotOverviewView() {
  const { settings, bookings, groupReservations, tables, preassignBookingTable, clearBookingPreassign } = useBooking()
  const toast = useToast()

  const seatings = Array.isArray(settings?.seatings) ? settings.seatings : []
  const [date, setDate] = useState(todayStr())
  const [seatingId, setSeatingId] = useState(seatings[0]?.id || '')
  const [floor, setFloor] = useState('1F')
  const [selectedTable, setSelectedTable] = useState(null)
  const [assignBooking, setAssignBooking] = useState(null) // 預先配桌中的散客訂位

  const seating = seatings.find(s => s.id === seatingId) || seatings[0] || null
  const closed = seating ? isSeatingClosed(settings, date, seating) : false

  const { byTable, summary } = useMemo(
    () => resolveSlotOccupancy(tables, bookings, groupReservations, date, seating, settings),
    [tables, bookings, groupReservations, date, seating, settings],
  )

  // 此日此場次「未配桌」的散客（供右側清單 + 預先配桌）
  const unassignedWalkins = useMemo(() => {
    if (!seating) return []
    return (bookings || []).filter(b =>
      b.date === date && b.timeSlot && !b.assignedTableId &&
      !CAPACITY_EXCLUDED_STATUSES.includes(b.status) &&
      seatingForSlot(settings, b.timeSlot)?.id === seating.id,
    )
  }, [bookings, date, seating, settings])

  // 預先配桌模式：可選的空桌（此場次未被佔、啟用中、容量足夠）
  const highlightTables = useMemo(() => {
    if (!assignBooking) return []
    return (tables || [])
      .filter(t => t.isActive !== false && !byTable[t.number] && t.capacity >= (assignBooking.guests || 1))
      .map(t => t.number)
  }, [assignBooking, tables, byTable])

  const startAssign = (booking) => { setAssignBooking(booking); setSelectedTable(null) }
  const cancelAssign = () => setAssignBooking(null)

  const handleTableClick = (number) => {
    if (assignBooking) {
      if (byTable[number]) return toast.error(`${number} 在此場次已被佔用`)
      const t = tables.find(x => x.number === number)
      if (!t || t.isActive === false) return toast.error(`${number} 停用中`)
      if (t.capacity < (assignBooking.guests || 1)) return toast.error(`${number} 容量不足（${t.capacity} < ${assignBooking.guests}）`)
      preassignBookingTable(assignBooking.id, number)
      toast.success(`✅ ${assignBooking.name} 已預先配到 ${number}`)
      setAssignBooking(null)
      setSelectedTable(number)
      return
    }
    setSelectedTable(prev => prev === number ? null : number)
  }

  const occ = selectedTable ? byTable[selectedTable] : null

  if (!seating) {
    return (
      <div className="rounded-2xl border border-dashed border-chicken-brown/20 bg-white p-8 text-center">
        <div className="text-3xl mb-2">🗺️</div>
        <p className="font-bold text-chicken-brown">尚未設定場次</p>
        <p className="text-sm text-chicken-brown/60 mt-1">請先到「設定 → 場次設定」新增午餐/晚餐等場次，地圖才能依場次呈現。</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* 日期 + 場次選擇 */}
      <div className="bg-white rounded-2xl border border-chicken-brown/10 p-3 sm:p-4 space-y-3">
        <details className="group">
          <summary className="flex cursor-pointer list-none items-center justify-between">
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-chicken-cream px-3 py-1.5 text-sm font-black text-chicken-brown">
              📅 {dayLabel(date)}{settings?.closures?.closedDates?.includes(date) ? ' · 公休' : ''}
            </span>
            <span className="text-xs font-bold text-chicken-red">換日期 ⌄</span>
          </summary>
          <div className="mt-3">
            <DatePicker
              value={date}
              onChange={(d) => { setDate(d); setSelectedTable(null); setAssignBooking(null) }}
              maxDaysAhead={Number(settings?.maxDaysAhead) || 30}
              compact
              renderBadge={(d) => settings?.closures?.closedDates?.includes(d)
                ? <span className="text-[10px]">🚫</span> : null}
            />
          </div>
        </details>

        <div>
          <div className="text-xs font-bold text-chicken-brown/55 mb-1.5">場次（批次）</div>
          <div className="flex gap-1.5 flex-wrap">
            {seatings.map(s => {
              const c = isSeatingClosed(settings, date, s)
              return (
                <button key={s.id}
                  onClick={() => { setSeatingId(s.id); setSelectedTable(null); setAssignBooking(null) }}
                  className={`px-3 py-2 rounded-xl text-sm font-bold border-2 transition-all ${
                    seatingId === s.id
                      ? 'bg-indigo-600 border-indigo-600 text-white shadow'
                      : c ? 'bg-slate-100 border-slate-200 text-slate-400 line-through' : 'bg-white border-chicken-brown/15 text-chicken-brown'}`}>
                  {s.name}
                  <span className="ml-1 text-[10px] opacity-70">{s.start}–{s.end}</span>
                  {c && <span className="ml-1 text-[10px]">🚫</span>}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {/* 關閉徽章 */}
      {closed && (
        <div className="bg-rose-50 border-2 border-rose-200 rounded-2xl px-4 py-3 flex items-center gap-2">
          <span className="text-xl">🚫</span>
          <div>
            <div className="font-black text-rose-700 text-sm">此場次已關閉訂位</div>
            <div className="text-xs text-rose-600/80">{dayLabel(date)} · {seating.name}（{seating.start}–{seating.end}）— 停止接收新散客 / 團體訂位，既有訂位不受影響。</div>
          </div>
        </div>
      )}

      {/* 容量摘要 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <StatsCard icon="🪑" label="全店座位" value={summary.totalSeats} color="brown" />
        <StatsCard icon="🧍" label="散客已訂(人)" value={summary.walkinGuests} color="yellow" />
        <StatsCard icon="🚌" label="團客保留(席)" value={summary.groupHeldSeats} color="red" />
        <StatsCard icon="✅" label="剩餘可訂(席)" value={summary.remaining} color="green" />
      </div>
      {summary.unassignedWalkinGuests > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-xs font-bold text-amber-700">
          ⚠️ 尚有 <span className="text-base">{summary.unassignedWalkinGuests}</span> 位散客已訂位但未配桌（可在右側清單點選 → 於地圖預先配桌）
        </div>
      )}

      {/* 預先配桌模式橫幅 */}
      {assignBooking && (
        <div className="bg-orange-600 text-white px-4 py-2.5 rounded-xl shadow-md flex items-center justify-between gap-3 flex-wrap">
          <div className="text-sm font-bold">🪑 預先配桌：{assignBooking.name}（{assignBooking.guests} 位 · {assignBooking.timeSlot}）— 請點地圖上高亮的空桌</div>
          <button onClick={cancelAssign} className="text-xs px-3 py-2 bg-white text-orange-700 rounded-lg font-bold">取消</button>
        </div>
      )}

      {/* 主區：地圖 + 側欄 */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-3">
        <div className="bg-white rounded-2xl border border-chicken-brown/10 p-2 sm:p-3">
          <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
            <div className="flex gap-1.5">
              {['1F', '2F'].map(f => (
                <button key={f} onClick={() => setFloor(f)}
                  className={`px-4 py-2 rounded-xl text-sm font-bold border-2 ${floor === f ? 'bg-chicken-red border-chicken-red text-white' : 'bg-white border-chicken-brown/15 text-chicken-brown'}`}>
                  {f === '1F' ? '1F 主用餐區' : '2F 用餐區'}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-3 text-[11px] font-bold text-chicken-brown/60 flex-wrap">
              <span className="inline-flex items-center gap-1"><i className="h-3 w-3 rounded" style={{ background: '#ea580c' }} />散客</span>
              <span className="inline-flex items-center gap-1"><i className="h-3 w-3 rounded" style={{ background: '#4f46e5' }} />團客</span>
              <span className="inline-flex items-center gap-1"><i className="h-3 w-3 rounded border" style={{ background: '#e2e8f0' }} />空桌</span>
            </div>
          </div>
          <div className="rounded-xl overflow-hidden border border-chicken-brown/5 min-h-[420px]" style={{ background: '#faf8f5' }}>
            <FloorMap
              floor={floor}
              tables={tables}
              settings={settings}
              selectedTableNumber={selectedTable}
              onSelectTable={handleTableClick}
              scopedMode
              scopedByTable={byTable}
              scopedClosed={closed}
              scopedHighlightTables={highlightTables}
            />
          </div>
          <div className="text-center text-[11px] text-chicken-brown/45 mt-2">
            點桌看佔用者 · 點右側未配桌散客可在圖上預先配桌 · 暖色＝散客 / 冷色＝團客
          </div>
        </div>

        {/* 側欄 */}
        <div className="space-y-3">
          {/* 選中桌詳情 */}
          {selectedTable && (
            <div className="bg-white rounded-2xl border border-chicken-brown/10 p-4">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-black text-chicken-brown">桌 {selectedTable}</h3>
                <button onClick={() => setSelectedTable(null)} className="text-xs text-chicken-brown/50">關閉</button>
              </div>
              {!occ && <p className="text-sm text-chicken-brown/60">此場次空桌（可預先配給未配桌散客）</p>}
              {occ?.kind === 'walkin' && (
                <div className="space-y-2">
                  <div className="text-sm"><span className="text-chicken-brown/60">散客：</span><span className="font-bold text-chicken-brown">{occ.booking?.name}</span></div>
                  <div className="text-xs text-chicken-brown/60">{occ.booking?.guests} 位 · {occ.booking?.timeSlot} · {occ.booking?.phone || '—'}</div>
                  <button onClick={() => { clearBookingPreassign(occ.booking.id); setSelectedTable(null); toast.info('已解除預先配桌') }}
                    className="mt-1 w-full text-xs font-bold text-chicken-red border-2 border-chicken-red/30 rounded-lg py-2">解除預先配桌</button>
                </div>
              )}
              {occ?.kind === 'group' && (
                <div className="space-y-1">
                  <div className="text-sm"><span className="text-chicken-brown/60">團客：</span><span className="font-bold text-chicken-brown">🚌 {occ.group?.agencyName || '團體'}</span></div>
                  <div className="text-xs text-chicken-brown/60">{occ.batch?.label} · {occ.batch?.timeSlot} · {occ.group?.guideName || ''}</div>
                </div>
              )}
            </div>
          )}

          {/* 未配桌散客清單 */}
          <div className="bg-white rounded-2xl border border-chicken-brown/10 p-4">
            <h3 className="font-bold text-chicken-brown mb-2 text-sm">未配桌散客（{seating.name}）</h3>
            {unassignedWalkins.length === 0 ? (
              <p className="text-xs text-chicken-brown/50">此場次散客都已配桌或無散客訂位。</p>
            ) : (
              <div className="space-y-1.5">
                {unassignedWalkins.map(b => (
                  <button key={b.id} onClick={() => startAssign(b)} disabled={closed}
                    className={`w-full text-left rounded-lg border-2 px-3 py-2 transition-all ${
                      assignBooking?.id === b.id ? 'border-orange-500 bg-orange-50' : 'border-chicken-brown/10 hover:border-orange-400'} ${closed ? 'opacity-40 cursor-not-allowed' : ''}`}>
                    <div className="text-sm font-bold text-chicken-brown">{b.name} · {b.guests} 位</div>
                    <div className="text-xs text-chicken-brown/55">{b.timeSlot} · 點選後於地圖配桌</div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
