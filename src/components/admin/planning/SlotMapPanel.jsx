import { useMemo, useState, useEffect } from 'react'
import FloorMap from '../floormap/FloorMap'
import StatsCard from '../StatsCard'
import { useBooking } from '../../../contexts/BookingContext'
import { useAuth } from '../../../contexts/AuthContext'
import { useToast } from '../../ui/Toast'
import { dayLabel, seatingForSlot } from '../../../utils/timeSlots'
import { resolveSlotOccupancy, isSeatingClosed, CAPACITY_EXCLUDED_STATUSES } from '../../../utils/capacity'
import { isTableUsableOnDate } from '../../../utils/tableAvailability'

// 這筆散客訂位目前佔到的桌（主桌 + 併桌的額外桌），去重去空。
function bookingTablesOf(b) {
  return [...new Set([b?.assignedTableId, ...(b?.extraTableIds || [])].filter(Boolean).map(String))]
}

// 排位地圖（自 SlotOverviewView 拆出、嵌入規劃主控台）：
// 依「日期（受控 prop）+ 場次（內部 state）」呈現散客（暖色）×團客（冷色）佔位，
// 支援「散客預先配桌」（只記 booking.assignedTableId，不動今日即時桌況）。
// assignRequest（{ bookingId, seatingId }）：容器要求自動切場次並進入該散客的預配模式
// （來源：當日總覽散客列「→ 配桌 / 換桌」、訂位頁未來日「指派桌位（預配）」跨頁導向）。
//   ★ 已配桌的訂位也吃這個請求 → 進「改桌」模式（排錯位子要能當場改，不必先解除再重配）。
// focusRequest（{ tableNumbers, seatingId, agencyName, batchLabel, groupId, batchId }）：時間軸點團
// → 自動切場次/樓層並在那些桌畫白圈脈動，幫外場一眼定位「這團坐哪」；帶 groupId 時可就地改圈桌。
// onEditGroupTables（{ groupId, batchId }）：地圖上發現團體圈錯桌 → 交給容器開團單編輯器的圈桌頁。
export default function SlotMapPanel({
  date, assignRequest = null, onAssignHandled, focusRequest = null, onFocusHandled,
  onEditGroupTables = null,
}) {
  const { settings, bookings, groupReservations, tables, fixtures, zones, preassignBookingTables, clearBookingPreassign } = useBooking()
  const toast = useToast()
  const { can } = useAuth()
  // 唯讀角色（廚房）按下去只會寫進本機、推雲時被後端整包剔除 → 本機與雲端默默不一致。
  // 與 UpcomingPanel 同慣例：沒權限就不給入口。
  const canAssign = can('booking.assign')
  const canEditGroup = can('group.update') && !!onEditGroupTables

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

  // 消費 assignRequest：切場次 + 自動進預配 / 改桌模式（宣告在換日 reset 之後——mount 同輪執行時本 effect 勝出）
  useEffect(() => {
    if (!assignRequest) return
    if (assignRequest.seatingId) setSeatingId(assignRequest.seatingId)
    const b = (bookings || []).find(x => x.id === assignRequest.bookingId)
    if (b) {
      const current = bookingTablesOf(b)
      setAssignBooking(b)
      // 已有桌 → 改桌模式：現況先帶進選取（併桌時可直接加減桌），並把樓層切到原本坐的那層
      setAssignSelected(current)
      const cur = current.length ? (tables || []).find(t => String(t.number) === current[0]) : null
      if (cur?.floor) setFloor(cur.floor)
      setSelectedTable(null)
      setFocus(null)
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
    setFocus(nums.length ? {
      tables: nums,
      agencyName: focusRequest.agencyName || '',
      batchLabel: focusRequest.batchLabel || '',
      groupId: focusRequest.groupId || null,
      batchId: focusRequest.batchId || null,
    } : null)
    onFocusHandled?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRequest])

  const seating = seatings.find(s => s.id === seatingId) || seatings[0] || null
  const closed = seating ? isSeatingClosed(settings, date, seating) : false

  const { byTable, summary } = useMemo(
    () => resolveSlotOccupancy(tables, bookings, groupReservations, date, seating, settings),
    [tables, bookings, groupReservations, date, seating, settings],
  )

  // 此日此場次的所有散客（右側清單）：未配桌排前面（要處理的先看到），其餘依時間。
  // 已配桌的也留在清單上——排錯位子時要能一眼找到那筆、直接改桌。
  const seatingWalkins = useMemo(() => {
    if (!seating) return []
    return (bookings || [])
      .filter(b =>
        b.date === date && b.timeSlot &&
        !CAPACITY_EXCLUDED_STATUSES.includes(b.status) &&
        seatingForSlot(settings, b.timeSlot)?.id === seating.id,
      )
      .sort((a, b) =>
        (a.assignedTableId ? 1 : 0) - (b.assignedTableId ? 1 : 0) ||
        String(a.timeSlot).localeCompare(String(b.timeSlot)),
      )
  }, [bookings, date, seating, settings])
  const unassignedWalkins = useMemo(() => seatingWalkins.filter(b => !b.assignedTableId), [seatingWalkins])

  const guestsNeeded = assignBooking ? (Number(assignBooking.guests) || 1) : 0
  // 改桌模式：這筆訂位目前已佔的桌（進來時即帶入選取；地圖上算「自己的桌」可再選）
  const assignCurrentTables = useMemo(() => bookingTablesOf(assignBooking), [assignBooking])
  const isChangeMode = !!assignBooking && assignCurrentTables.length > 0

  // 預先配桌模式可選的空桌（此場次未被佔、該日可用）。
  // ★ 自己目前佔的桌視同可選——不然改桌時原桌會被自己擋住，變成「得先解除再重配」。
  const freeTables = useMemo(() => {
    if (!assignBooking) return []
    return (tables || []).filter(t =>
      isTableUsableOnDate(t, date) &&
      (!byTable[t.number] || byTable[t.number].booking?.id === assignBooking.id),
    )
  }, [assignBooking, tables, byTable, date])

  // 有無單桌能容納整團 → 容量足夠的空桌（單桌即點即配）。
  const singleFitTables = useMemo(
    () => freeTables.filter(t => (Number(t.capacity) || 0) >= guestsNeeded).map(t => t.number),
    [freeTables, guestsNeeded],
  )
  // 無單桌容納（大組）→ 進入併桌預配：累加選多張同層小桌湊滿席數。
  // 原本就併了多桌的訂位改桌時也走併桌流程（要能加減桌、確認後才落地）。
  const assignMulti = !!assignBooking && (singleFitTables.length === 0 || assignCurrentTables.length > 1)

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

  // 開始配桌 / 改桌：已有桌的先把現況帶進選取，並把樓層切到原本坐的那層
  const startAssign = (booking) => {
    if (!canAssign) return toast.error('你的角色沒有配桌的權限，請聯絡店長')
    const current = bookingTablesOf(booking)
    setAssignBooking(booking)
    setAssignSelected(current)
    const cur = current.length ? (tables || []).find(t => String(t.number) === current[0]) : null
    if (cur?.floor) setFloor(cur.floor)
    setSelectedTable(null)
    setFocus(null)
  }
  const cancelAssign = () => { setAssignBooking(null); setAssignSelected([]) }

  // 解除配桌（配桌 / 改桌模式中，或側欄選中桌時）：主桌與併桌額外桌一起清
  const clearAssign = (booking) => {
    if (!canAssign) return toast.error('你的角色沒有配桌的權限，請聯絡店長')
    clearBookingPreassign(booking.id)
    setAssignBooking(null)
    setAssignSelected([])
    setSelectedTable(null)
    toast.info(`已解除 ${booking.name || '此訂位'} 的配桌`)
  }

  const handleTableClick = (number) => {
    if (assignBooking) {
      const occupant = byTable[number]
      const isOwn = occupant?.booking?.id === assignBooking.id
      if (occupant && !isOwn) return toast.error(`${number} 在此場次已被佔用`)
      const t = tables.find(x => x.number === number)
      if (!t || !isTableUsableOnDate(t, date)) return toast.error(`${number} 停用/維修中`)
      if (!assignMulti && isOwn) return toast.info(`${assignBooking.name} 本來就在 ${number}，請點要換去的桌`)
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
      // 單桌：容量足夠即點即配（改桌時同一步完成搬移，不必先解除）
      if (t.capacity < guestsNeeded) return toast.error(`${number} 容量不足（${t.capacity} < ${assignBooking.guests}）`)
      // 走多桌 API（單元素陣列）：舊資料若殘留 extraTableIds，改成單桌時一併清乾淨
      preassignBookingTables(assignBooking.id, [number])
      toast.success(isChangeMode
        ? `✅ ${assignBooking.name} 已從 ${assignCurrentTables.join('、')} 改到 ${number}`
        : `✅ ${assignBooking.name} 已預先配到 ${number}`)
      setAssignBooking(null)
      setAssignSelected([])
      setSelectedTable(number)
      return
    }
    setSelectedTable(prev => prev === number ? null : number)
  }

  // 併桌預配確認：席數夠 → 一筆 booking 記多桌（主桌 + 額外桌），不動今日桌況
  const confirmAssignMulti = () => {
    if (!assignBooking) return
    if (!assignSelected.length) return toast.error('請先點地圖選桌')
    if (assignSelectedSeats < guestsNeeded) return toast.error(`還差 ${guestsNeeded - assignSelectedSeats} 席，請再加桌`)
    const picked = assignSelected
    preassignBookingTables(assignBooking.id, picked)
    toast.success(isChangeMode
      ? `✅ ${assignBooking.name}（${guestsNeeded} 位）已改配到 ${picked.join(' + ')}`
      : `✅ ${assignBooking.name}（${guestsNeeded} 位）已併桌預配到 ${picked.join(' + ')}`)
    setAssignBooking(null)
    setAssignSelected([])
    setSelectedTable(picked[0])
  }

  // 地圖上的團體圈錯桌 → 交給容器開團單編輯器的「圈選座位」頁（帶梯次）
  const editGroupTables = (groupId, batchId) => {
    if (!groupId || !canEditGroup) return
    onEditGroupTables?.({ groupId, batchId: batchId || null })
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

      {/* 時間軸點團標示橫幅（團客冷色系，呼應地圖團客＝靛色）
          — 標示的當下就是最容易發現「圈錯桌」的時機，故就地給改圈桌入口。 */}
      {focus && (
        <div className="bg-indigo-600 text-white px-4 py-2.5 rounded-xl shadow-md flex items-center justify-between gap-3 flex-wrap">
          <div className="text-sm font-bold">🎯 標示 🚌 {focus.agencyName || '團體'}{focus.batchLabel ? ` · ${focus.batchLabel}` : ''} 的座位（桌 {focus.tables.join('、')}）</div>
          <div className="flex gap-1.5 flex-wrap">
            {focus.groupId && canEditGroup && (
              <button onClick={() => editGroupTables(focus.groupId, focus.batchId)}
                className="text-xs px-3 py-2 bg-white text-indigo-700 rounded-lg font-bold">✏️ 改這團圈桌</button>
            )}
            <button onClick={() => setFocus(null)} className="text-xs px-3 py-2 bg-white/20 text-white rounded-lg font-bold">關閉標示</button>
          </div>
        </div>
      )}

      {/* 配桌 / 改桌模式橫幅
          — 四態：預先配桌（單桌即點即配）、併桌預配（湊席數後確認）、改桌、併桌改桌。
          改桌態多顯示「目前 桌X」與「解除配桌」，讓排錯位子在同一條橫幅內就能修好。 */}
      {assignBooking && (
        <div className="bg-orange-600 text-white px-4 py-2.5 rounded-xl shadow-md space-y-2">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="text-sm font-bold flex items-center gap-2 flex-wrap">
              <span className="text-base leading-none">{isChangeMode ? '↔' : '🪑'}</span>
              <span>{`${isChangeMode ? (assignMulti ? '併桌改桌' : '改桌') : (assignMulti ? '併桌預配' : '預先配桌')}：${assignBooking.name}（${assignBooking.guests} 位 · ${assignBooking.timeSlot}）`}</span>
              {isChangeMode && (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/20 font-black text-xs tabular-nums">
                  目前 桌 {assignCurrentTables.join('、')}
                </span>
              )}
              {assignMulti ? (
                <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg font-black text-sm shadow-sm ${assignSelectedSeats >= guestsNeeded ? 'bg-white text-emerald-700' : 'bg-white/95 text-chicken-brown'}`}>
                  已選 {assignSelectedSeats}/{guestsNeeded} 席 · {assignSelected.length} 桌
                </span>
              ) : (
                <span className="text-xs opacity-90">— {isChangeMode ? '請點要換去的空桌，一點就換好' : '請點地圖上高亮的空桌'}</span>
              )}
            </div>
            <div className="flex gap-1.5 flex-wrap">
              {isChangeMode && (
                <button onClick={() => clearAssign(assignBooking)}
                  className="text-xs px-3 py-2 bg-white/20 text-white rounded-lg font-bold whitespace-nowrap">解除配桌</button>
              )}
              <button onClick={cancelAssign} className="text-xs px-3 py-2 bg-white text-orange-700 rounded-lg font-bold whitespace-nowrap">取消</button>
            </div>
          </div>
          {assignMulti && (
            <div className="bg-white/15 rounded-lg px-3 py-2 flex items-center justify-between gap-2 flex-wrap">
              <div className="text-sm font-bold">
                {assignSelected.length ? `已選：${assignSelected.join(' + ')}` : '尚未選桌（點同層空桌加入，可併多張小桌）'}
                {assignSelectedSeats < guestsNeeded && <span className="ml-2 opacity-90">— 還差 {guestsNeeded - assignSelectedSeats} 席</span>}
                {isChangeMode && <span className="ml-2 opacity-90">— 點已選的桌可移除</span>}
              </div>
              <button
                onClick={confirmAssignMulti}
                disabled={assignSelectedSeats < guestsNeeded}
                className={`text-xs px-4 py-2 rounded-lg font-black whitespace-nowrap shadow-sm ${
                  assignSelectedSeats >= guestsNeeded ? 'bg-white text-emerald-700' : 'bg-white/40 text-white/70 cursor-not-allowed'}`}
              >{isChangeMode ? '✓ 確認改桌' : '✓ 確認併桌預配'}</button>
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
              scopedFocusTables={assignBooking
                ? (assignMulti ? assignSelected : assignCurrentTables)
                : (focus?.tables || [])}
              mapDate={date}
              fixtures={fixtures}
              zones={zones}
            />
          </div>
          <div className="text-center text-[11px] text-chicken-brown/45 mt-2">
            點桌看佔用者、可就地改桌 / 改圈桌 · 點右側散客可配桌或換桌 · 暖色＝散客 / 冷色＝團客
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
                  {bookingTablesOf(occ.booking).length > 1 && (
                    <div className="text-xs font-bold text-orange-700">併桌：{bookingTablesOf(occ.booking).join(' + ')}</div>
                  )}
                  {canAssign && (
                    <div className="flex gap-1.5 pt-0.5">
                      <button onClick={() => startAssign(occ.booking)}
                        className="flex-1 text-xs font-black bg-orange-600 text-white rounded-lg py-2">↔ 改桌</button>
                      <button onClick={() => clearAssign(occ.booking)}
                        className="flex-1 text-xs font-bold text-chicken-red border-2 border-chicken-red/30 rounded-lg py-2">解除配桌</button>
                    </div>
                  )}
                </div>
              )}
              {occ?.kind === 'group' && (
                <div className="space-y-2">
                  <div className="text-sm"><span className="text-chicken-brown/60">團客：</span><span className="font-bold text-chicken-brown">🚌 {occ.group?.agencyName || '團體'}</span></div>
                  <div className="text-xs text-chicken-brown/60">{occ.batch?.label} · {occ.batch?.timeSlot} · {occ.group?.guideName || ''}</div>
                  {canEditGroup && (
                    <button onClick={() => editGroupTables(occ.group?.id, occ.batch?.id)}
                      className="w-full text-xs font-black bg-indigo-600 text-white rounded-lg py-2">✏️ 改這團圈桌</button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* 本場次散客清單：未配桌在前（待辦），已配桌在後（可直接改桌）。
              排錯位子的人第一時間會來這裡找那筆訂位，所以已配桌的不能從清單消失。 */}
          <div className="bg-white rounded-2xl border border-chicken-brown/10 p-4">
            <div className="flex items-baseline justify-between gap-2 mb-2">
              <h3 className="font-bold text-chicken-brown text-sm">本場次散客（{seating.name}）</h3>
              {unassignedWalkins.length > 0 && (
                <span className="text-[11px] font-black text-amber-600">未配桌 {unassignedWalkins.length}</span>
              )}
            </div>
            {seatingWalkins.length === 0 ? (
              <p className="text-xs text-chicken-brown/50">此場次沒有散客訂位。</p>
            ) : (
              <div className="space-y-1.5">
                {seatingWalkins.map(b => {
                  const nums = bookingTablesOf(b)
                  const active = assignBooking?.id === b.id
                  const disabled = closed || !canAssign
                  return (
                    <button key={b.id} onClick={() => startAssign(b)} disabled={disabled}
                      title={disabled ? undefined : (nums.length ? '改桌' : '在地圖上配桌')}
                      className={`w-full text-left rounded-lg border-2 px-3 py-2 transition-all ${
                        active ? 'border-orange-500 bg-orange-50' : 'border-chicken-brown/10 hover:border-orange-400'} ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-bold text-chicken-brown truncate">{b.name} · {b.guests} 位</span>
                        {nums.length ? (
                          <span className="shrink-0 text-[11px] font-black px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 tabular-nums">🪑 {nums.join('+')}</span>
                        ) : (
                          <span className="shrink-0 text-[11px] font-black px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">未配桌</span>
                        )}
                      </div>
                      <div className="text-xs text-chicken-brown/55">
                        {b.timeSlot} · {disabled ? '唯讀' : (nums.length ? '點我改桌（可換到別桌）' : '點選後於地圖配桌')}
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
