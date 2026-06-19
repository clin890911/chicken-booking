import { useMemo, useState, useEffect } from 'react'
import FloorMap from '../floormap/FloorMap'
import StatsCard from '../StatsCard'
import { useBooking } from '../../../contexts/BookingContext'
import { useToast } from '../../ui/Toast'
import { dayLabel, seatingForSlot } from '../../../utils/timeSlots'
import { resolveSlotOccupancy, isSeatingClosed, CAPACITY_EXCLUDED_STATUSES } from '../../../utils/capacity'
import { isTableUsableOnDate } from '../../../utils/tableAvailability'

// 排位地圖（自 SlotOverviewView 拆出、嵌入規劃主控台）：
// 依「日期（受控 prop）+ 場次（內部 state）」呈現散客（暖色）×團客（冷色）佔位，
// 支援「散客預先配桌」（只記 booking.assignedTableId，不動今日即時桌況）。
// assignRequest（{ bookingId, seatingId }）：容器要求自動切場次並進入該散客的預配模式
// （來源：當日總覽散客列「→ 配桌」、訂位頁未來日「指派桌位（預配）」跨頁導向）。
// focusRequest（{ tableNumbers, seatingId, agencyName, batchLabel }）：時間軸點團 → 自動切場次/樓層
// 並在那些桌畫白圈脈動，幫外場一眼定位「這團坐哪」。
export default function SlotMapPanel({ date, assignRequest = null, onAssignHandled, focusRequest = null, onFocusHandled }) {
  const { settings, bookings, groupReservations, tables, fixtures, zones, preassignBookingTable, preassignBookingTables, clearBookingPreassign } = useBooking()
  const toast = useToast()

  const seatings = Array.isArray(settings?.seatings) ? settings.seatings : []
  const [seatingId, setSeatingId] = useState(seatings[0]?.id || '')
  const [floor, setFloor] = useState('1F')
  const [selectedTable, setSelectedTable] = useState(null)
  const [assignBooking, setAssignBooking] = useState(null) // 預先配桌中的散客訂位
  const [assignSelected, setAssignSelected] = useState([]) // 併桌預配：累加式已選桌（大組超過單桌容量時）
  const [focus, setFocus] = useState(null) // 時間軸點團標示：{ tables:[], agencyName, batchLabel }

  // date 由容器（PlanningView 月曆）控制：換日重置選桌與預配模式（場次保留，換日通常仍看同場次）
  useEffect(() => {
    setSelectedTable(null)
    setAssignBooking(null)
    setAssignSelected([])
    setFocus(null)
  }, [date])

  // 消費 assignRequest：切場次 + 自動進預配模式（宣告在換日 reset 之後——mount 同輪執行時本 effect 勝出）
  useEffect(() => {
    if (!assignRequest) return
    if (assignRequest.seatingId) setSeatingId(assignRequest.seatingId)
    const b = (bookings || []).find(x => x.id === assignRequest.bookingId)
    if (b && !b.assignedTableId) {
      setAssignBooking(b)
      setAssignSelected([])
      setSelectedTable(null)
    }
    onAssignHandled?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignRequest])

  // 消費 focusRequest：切到該團場次、切到含焦點桌的樓層，點亮白圈標示（宣告在換日 reset 之後勝出）
  useEffect(() => {
    if (!focusRequest) return
    const nums = focusRequest.tableNumbers || []
    if (focusRequest.seatingId) setSeatingId(focusRequest.seatingId)
    const first = (tables || []).find(t => nums.includes(t.number))
    if (first?.floor) setFloor(first.floor)
    setAssignBooking(null)
    setAssignSelected([])
    setSelectedTable(null)
    setFocus(nums.length ? { tables: nums, agencyName: focusRequest.agencyName || '', batchLabel: focusRequest.batchLabel || '' } : null)
    onFocusHandled?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRequest])

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

  const guestsNeeded = assignBooking ? (Number(assignBooking.guests) || 1) : 0

  // 預先配桌模式可選的空桌（此場次未被佔、該日可用）。
  const freeTables = useMemo(() => {
    if (!assignBooking) return []
    return (tables || []).filter(t => isTableUsableOnDate(t, date) && !byTable[t.number])
  }, [assignBooking, tables, byTable, date])

  // 有無單桌能容納整團 → 容量足夠的空桌（單桌即點即配）。
  const singleFitTables = useMemo(
    () => freeTables.filter(t => (Number(t.capacity) || 0) >= guestsNeeded).map(t => t.number),
    [freeTables, guestsNeeded],
  )
  // 無單桌容納（大組）→ 進入併桌預配：累加選多張同層小桌湊滿席數。
  const assignMulti = !!assignBooking && singleFitTables.length === 0

  // 地圖高亮：單桌模式只亮容量足夠的桌；多桌模式亮所有可選空桌（含小桌，供併桌）。
  const highlightTables = useMemo(() => {
    if (!assignBooking) return []
    return assignMulti ? freeTables.map(t => t.number) : singleFitTables
  }, [assignBooking, assignMulti, freeTables, singleFitTables])

  // 併桌已選席數（合計選中桌的容量）
  const assignSelectedSeats = useMemo(
    () => assignSelected.reduce((s, n) => s + (Number(tables.find(t => t.number === n)?.capacity) || 0), 0),
    [assignSelected, tables],
  )

  const startAssign = (booking) => { setAssignBooking(booking); setAssignSelected([]); setSelectedTable(null) }
  const cancelAssign = () => { setAssignBooking(null); setAssignSelected([]) }

  const handleTableClick = (number) => {
    if (assignBooking) {
      if (byTable[number]) return toast.error(`${number} 在此場次已被佔用`)
      const t = tables.find(x => x.number === number)
      if (!t || !isTableUsableOnDate(t, date)) return toast.error(`${number} 停用/維修中`)
      if (assignMulti) {
        // 併桌預配：點桌加入/移除（同層守門）；席數夠才在 banner 確認
        const isRemove = assignSelected.includes(number)
        if (!isRemove && assignSelected.length) {
          const selFloor = tables.find(x => x.number === assignSelected[0])?.floor
          if (selFloor && t.floor && selFloor !== t.floor) {
            return toast.error('併桌需在同一樓層，請改選同層的桌')
          }
        }
        setAssignSelected(prev => isRemove ? prev.filter(n => n !== number) : [...prev, number])
        return
      }
      // 單桌：容量足夠即點即配
      if (t.capacity < guestsNeeded) return toast.error(`${number} 容量不足（${t.capacity} < ${assignBooking.guests}）`)
      preassignBookingTable(assignBooking.id, number)
      toast.success(`✅ ${assignBooking.name} 已預先配到 ${number}`)
      setAssignBooking(null)
      setSelectedTable(number)
      return
    }
    setSelectedTable(prev => prev === number ? null : number)
  }

  // 併桌預配確認：席數夠 → 一筆 booking 記多桌（主桌 + 額外桌），不動今日桌況
  const confirmAssignMulti = () => {
    if (!assignBooking) return
    if (assignSelectedSeats < guestsNeeded) return toast.error(`還差 ${guestsNeeded - assignSelectedSeats} 席，請再加桌`)
    const picked = assignSelected
    preassignBookingTables(assignBooking.id, picked)
    toast.success(`✅ ${assignBooking.name}（${guestsNeeded} 位）已併桌預配到 ${picked.join(' + ')}`)
    setAssignBooking(null)
    setAssignSelected([])
    setSelectedTable(picked[0])
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
      {/* 場次選擇 */}
      <div className="bg-white rounded-2xl border border-chicken-brown/10 p-3 sm:p-4">
        <div className="text-xs font-bold text-chicken-brown/55 mb-1.5">場次（批次）</div>
        <div className="flex gap-1.5 flex-wrap">
          {seatings.map(s => {
            const c = isSeatingClosed(settings, date, s)
            return (
              <button key={s.id}
                onClick={() => { setSeatingId(s.id); setSelectedTable(null); setAssignBooking(null); setAssignSelected([]); setFocus(null) }}
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

      {/* 時間軸點團標示橫幅（團客冷色系，呼應地圖團客＝靛色） */}
      {focus && (
        <div className="bg-indigo-600 text-white px-4 py-2.5 rounded-xl shadow-md flex items-center justify-between gap-3 flex-wrap">
          <div className="text-sm font-bold">🎯 標示 🚌 {focus.agencyName || '團體'}{focus.batchLabel ? ` · ${focus.batchLabel}` : ''} 的座位（桌 {focus.tables.join('、')}）</div>
          <button onClick={() => setFocus(null)} className="text-xs px-3 py-2 bg-white text-indigo-700 rounded-lg font-bold">關閉標示</button>
        </div>
      )}

      {/* 預先配桌模式橫幅（大組無單桌容納 → 併桌：累加選同層小桌，席數夠才確認） */}
      {assignBooking && (
        <div className="bg-orange-600 text-white px-4 py-2.5 rounded-xl shadow-md space-y-2">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="text-sm font-bold flex items-center gap-2 flex-wrap">
              <span className="text-base leading-none">🪑</span>
              <span>{assignMulti ? '併桌預配' : '預先配桌'}：{assignBooking.name}（{assignBooking.guests} 位 · {assignBooking.timeSlot}）</span>
              {assignMulti ? (
                <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg font-black text-sm shadow-sm ${assignSelectedSeats >= guestsNeeded ? 'bg-white text-emerald-700' : 'bg-white/95 text-chicken-brown'}`}>
                  已選 {assignSelectedSeats}/{guestsNeeded} 席 · {assignSelected.length} 桌
                </span>
              ) : (
                <span className="text-xs opacity-90">— 請點地圖上高亮的空桌</span>
              )}
            </div>
            <button onClick={cancelAssign} className="text-xs px-3 py-2 bg-white text-orange-700 rounded-lg font-bold whitespace-nowrap">取消</button>
          </div>
          {assignMulti && (
            <div className="bg-white/15 rounded-lg px-3 py-2 flex items-center justify-between gap-2 flex-wrap">
              <div className="text-sm font-bold">
                {assignSelected.length ? `已選：${assignSelected.join(' + ')}` : '尚未選桌（點同層空桌加入，可併多張小桌）'}
                {assignSelectedSeats < guestsNeeded && <span className="ml-2 opacity-90">— 還差 {guestsNeeded - assignSelectedSeats} 席</span>}
              </div>
              <button
                onClick={confirmAssignMulti}
                disabled={assignSelectedSeats < guestsNeeded}
                className={`text-xs px-4 py-2 rounded-lg font-black whitespace-nowrap shadow-sm ${
                  assignSelectedSeats >= guestsNeeded ? 'bg-white text-emerald-700' : 'bg-white/40 text-white/70 cursor-not-allowed'}`}
              >✓ 確認併桌預配</button>
            </div>
          )}
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
              scopedFocusTables={assignMulti ? assignSelected : (focus?.tables || [])}
              mapDate={date}
              fixtures={fixtures}
              zones={zones}
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
