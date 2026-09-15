import { useMemo, useState, useEffect, useCallback } from 'react'
import FloorMap from '../floormap/FloorMap'
import StatGroup from '../../ui/StatGroup'
import BookingDetailSheet from '../../booking/BookingDetailSheet'
import { useBooking } from '../../../contexts/BookingContext'
import { useToast } from '../../ui/Toast'
import { dayLabel, seatingForSlot } from '../../../utils/timeSlots'
import { resolveSlotOccupancy, isSeatingClosed, CAPACITY_EXCLUDED_STATUSES } from '../../../utils/capacity'
import { isTableUsableOnDate } from '../../../utils/tableAvailability'
import SegmentedControl from '../../ui/SegmentedControl'
import Icon from '../../ui/Icon'

// 排位地圖（自 SlotOverviewView 拆出、嵌入規劃主控台）：
// 依「日期（受控 prop）+ 場次」呈現散客（暖色）×團客（冷色）佔位，
// 支援「散客預先配桌」（只記 booking.assignedTableId，不動今日即時桌況）。
// 場次 / 樓層可由容器受控（seatingId/onSeatingChange、floor/onFloorChange）：PlanningView 持有它們，
// 讓 pane 切換 remount 後仍停在同一場次同一樓層；未傳則退回內部 state（相容既有用法）。
// assignRequest（{ bookingId, seatingId }）：容器要求自動切場次並進入該散客的預配模式
// （來源：當日總覽散客列「→ 配桌」、訂位頁未來日「指派桌位（預配）」跨頁導向）。
// focusRequest（{ tableNumbers, seatingId, agencyName, batchLabel }）：時間軸點團 → 自動切場次/樓層
// 並在那些桌畫白圈脈動，幫外場一眼定位「這團坐哪」。
export default function SlotMapPanel({
  date, assignRequest = null, onAssignHandled, focusRequest = null, onFocusHandled,
  seatingId: seatingIdProp, onSeatingChange, floor: floorProp, onFloorChange,
}) {
  const { settings, bookings, groupReservations, tables, fixtures, zones, preassignBookingTable, preassignBookingTables, clearBookingPreassign } = useBooking()
  const toast = useToast()

  const seatings = Array.isArray(settings?.seatings) ? settings.seatings : []
  const [seatingIdState, setSeatingIdState] = useState(seatings[0]?.id || '')
  const [floorState, setFloorState] = useState('1F')
  const seatingControlled = typeof onSeatingChange === 'function'
  const floorControlled = typeof onFloorChange === 'function'
  const seatingId = (seatingControlled ? seatingIdProp : seatingIdState) || seatings[0]?.id || ''
  const floor = (floorControlled ? floorProp : floorState) || '1F'
  const setSeatingId = useCallback((id) => { if (seatingControlled) onSeatingChange(id); else setSeatingIdState(id) }, [seatingControlled, onSeatingChange])
  const setFloor = useCallback((f) => { if (floorControlled) onFloorChange(f); else setFloorState(f) }, [floorControlled, onFloorChange])
  const [selectedTable, setSelectedTable] = useState(null)
  const [assignBooking, setAssignBooking] = useState(null) // 預先配桌中的散客訂位
  const [assignSelected, setAssignSelected] = useState([]) // 併桌預配：累加式已選桌（大組超過單桌容量時）
  const [focus, setFocus] = useState(null) // 時間軸點團標示：{ tables:[], agencyName, batchLabel }
  const [detailBookingId, setDetailBookingId] = useState(null) // 側欄散客列 / 選中桌散客 → 訂位詳情

  // date 由容器（PlanningView 月曆）控制：換日重置選桌與預配模式（場次保留，換日通常仍看同場次）
  useEffect(() => {
    setSelectedTable(null)
    setAssignBooking(null)
    setAssignSelected([])
    setFocus(null)
    setDetailBookingId(null)
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
      setFocus(null)
      setDetailBookingId(null)
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
    setDetailBookingId(null)
    setFocus(nums.length ? { tables: nums, kind: focusRequest.kind || 'group', agencyName: focusRequest.agencyName || '', batchLabel: focusRequest.batchLabel || '' } : null)
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

  const startAssign = (booking) => { setDetailBookingId(null); setAssignBooking(booking); setAssignSelected([]); setSelectedTable(null); setFocus(null) }
  const cancelAssign = () => { setAssignBooking(null); setAssignSelected([]) }

  // 詳情表「在地圖標示」：切到該桌樓層並畫白圈（散客用暖色系文案，與團客標示共用同一個 focus 機制）
  const focusBookingTables = (booking) => {
    const nums = [booking.assignedTableId, ...(Array.isArray(booking.extraTableIds) ? booking.extraTableIds : [])].filter(Boolean).map(String)
    if (!nums.length) return
    const first = (tables || []).find(t => nums.includes(t.number))
    if (first?.floor) setFloor(first.floor)
    setSelectedTable(null)
    setFocus({ tables: nums, agencyName: `${booking.name || '散客'}`, batchLabel: `${booking.guests || 0} 位 · ${booking.timeSlot || ''}` })
  }

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
      toast.success(`${assignBooking.name} 已預先配到 ${number}`)
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
    toast.success(`${assignBooking.name}（${guestsNeeded} 位）已併桌預配到 ${picked.join(' + ')}`)
    setAssignBooking(null)
    setAssignSelected([])
    setSelectedTable(picked[0])
  }

  const occ = selectedTable ? byTable[selectedTable] : null

  if (!seating) {
    return (
      <div className="rounded-xl border border-dashed border-chicken-brown/20 bg-white p-8 text-center">
        <div className="mb-2 flex justify-center text-chicken-brown/30"><Icon name="map" size={32} strokeWidth={1.5} /></div>
        <p className="font-semibold text-chicken-brown">尚未設定場次</p>
        <p className="text-sm text-chicken-brown/60 mt-1">請先到「設定 → 場次設定」新增午餐/晚餐等場次，地圖才能依場次呈現。</p>
      </div>
    )
  }

  const switchSeating = (id) => { setSeatingId(id); setSelectedTable(null); setAssignBooking(null); setAssignSelected([]); setFocus(null) }
  const bannerBtn = 'tap text-xs px-3 h-8 bg-white rounded-lg font-semibold whitespace-nowrap'

  return (
    <div className="space-y-3">
      {/* 場次選擇（分段控制；已關閉場次淡化劃線仍可點進去看） */}
      <div className="flex items-center gap-3 flex-wrap px-1">
        <span className="text-xs font-semibold text-chicken-brown/55 tracking-wide">場次（批次）</span>
        <SegmentedControl ariaLabel="場次" value={seatingId} onChange={switchSeating}
          options={seatings.map(s => ({ key: s.id, label: s.name, sub: `${s.start}–${s.end}`, muted: isSeatingClosed(settings, date, s) }))} />
      </div>

      {/* 關閉提示 */}
      {closed && (
        <div className="flex items-start gap-2 rounded-xl bg-rose-50 px-3 py-2.5 text-xs font-semibold text-rose-700">
          <Icon name="ban" size={16} className="shrink-0 mt-px" />
          <span>此場次已關閉訂位：{dayLabel(date)} · {seating.name}（{seating.start}–{seating.end}），停止接收新散客 / 團體訂位，既有訂位不受影響。</span>
        </div>
      )}

      {/* 容量摘要 */}
      <StatGroup items={[
        { label: '全店座位', big: summary.totalSeats, small: '席' },
        { label: '散客已訂', big: summary.walkinGuests, small: '位', bigCls: 'text-[#b06600]',
          note: summary.unassignedWalkinGuests > 0 ? `未配桌 ${summary.unassignedWalkinGuests} 位` : null, noteCls: 'text-[#b06600]' },
        { label: '團客保留', big: summary.groupHeldSeats, small: '席', bigCls: 'text-chicken-red' },
        { label: '剩餘可訂', big: summary.remaining, small: '席', bigCls: 'text-[#5b8c1f]' },
      ]} />

      {/* 時間軸點團標示橫幅（團客＝靛色、散客＝暖色，與地圖同色） */}
      {focus && (
        <div className={`${focus.kind === 'walkin' ? 'bg-orange-600' : 'bg-indigo-600'} text-white px-4 py-2.5 rounded-xl shadow-sm flex items-center justify-between gap-3 flex-wrap`}>
          <div className="text-sm font-semibold flex items-center gap-2"><Icon name={focus.kind === 'walkin' ? 'person' : 'bus'} size={16} /><span>標示 {focus.agencyName || '團體'}{focus.batchLabel ? ` · ${focus.batchLabel}` : ''} 的座位（桌 {focus.tables.join('、')}）</span></div>
          <button type="button" onClick={() => setFocus(null)} className={`${bannerBtn} ${focus.kind === 'walkin' ? 'text-orange-700' : 'text-indigo-700'}`}>關閉標示</button>
        </div>
      )}

      {/* 預先配桌模式橫幅（大組無單桌容納 → 併桌：累加選同層小桌，席數夠才確認） */}
      {assignBooking && (
        <div className="bg-orange-600 text-white px-4 py-2.5 rounded-xl shadow-sm space-y-2">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="text-sm font-semibold flex items-center gap-2 flex-wrap">
              <Icon name="chair" size={18} />
              <span>{assignMulti ? '併桌預配' : '預先配桌'}：{assignBooking.name}（{assignBooking.guests} 位 · {assignBooking.timeSlot}）</span>
              {assignMulti ? (
                <span className={`inline-flex items-center gap-1 px-2.5 h-7 rounded-lg font-semibold text-sm ${assignSelectedSeats >= guestsNeeded ? 'bg-white text-emerald-700' : 'bg-white/95 text-chicken-brown'}`}>
                  已選 {assignSelectedSeats}/{guestsNeeded} 席 · {assignSelected.length} 桌
                </span>
              ) : (
                <span className="text-xs opacity-90">請點地圖上高亮的空桌</span>
              )}
            </div>
            <button type="button" onClick={cancelAssign} className={`${bannerBtn} text-orange-700`}>取消</button>
          </div>
          {assignMulti && (
            <div className="bg-white/15 rounded-lg px-3 py-2 flex items-center justify-between gap-2 flex-wrap">
              <div className="text-sm font-semibold">
                {assignSelected.length ? `已選：${assignSelected.join(' + ')}` : '尚未選桌（點同層空桌加入，可併多張小桌）'}
                {assignSelectedSeats < guestsNeeded && <span className="ml-2 opacity-90">還差 {guestsNeeded - assignSelectedSeats} 席</span>}
              </div>
              <button
                type="button"
                onClick={confirmAssignMulti}
                disabled={assignSelectedSeats < guestsNeeded}
                className={`tap text-xs px-4 h-8 rounded-lg font-semibold whitespace-nowrap ${
                  assignSelectedSeats >= guestsNeeded ? 'bg-white text-emerald-700' : 'bg-white/40 text-white/70 cursor-not-allowed'}`}
              >✓ 確認併桌預配</button>
            </div>
          )}
        </div>
      )}

      {/* 主區：地圖 + 側欄 */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-3 items-start">
        <div className="bg-white rounded-xl border border-chicken-brown/10 p-2.5 sm:p-3">
          <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
            <SegmentedControl options={[{ key: '1F', label: '1F 主用餐區' }, { key: '2F', label: '2F 用餐區' }]} value={floor} onChange={setFloor} ariaLabel="樓層" />
            <div className="flex items-center gap-3 text-[11px] font-semibold text-chicken-brown/55 flex-wrap">
              <span className="inline-flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-sm" style={{ background: '#ea580c' }} />散客</span>
              <span className="inline-flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-sm" style={{ background: '#4f46e5' }} />團客</span>
              <span className="inline-flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-sm border border-slate-300" style={{ background: '#e2e8f0' }} />空桌</span>
            </div>
          </div>
          <div className="rounded-lg overflow-hidden border border-chicken-brown/5 min-h-[420px]" style={{ background: '#faf8f5' }}>
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
            點桌看佔用者 · 點右側未配桌散客可在圖上預先配桌
          </div>
        </div>

        {/* 側欄 */}
        <div className="space-y-3">
          {/* 選中桌詳情 */}
          {selectedTable && (
            <div className="space-y-1.5">
              <div className="flex items-center px-1">
                <h3 className="text-xs font-semibold text-chicken-brown/55 tracking-wide">桌 {selectedTable}</h3>
                <span className="flex-1" />
                <button type="button" onClick={() => setSelectedTable(null)} className="tap text-xs font-semibold text-chicken-brown/50 hover:text-chicken-brown">關閉</button>
              </div>
              <div className="bg-white rounded-xl border border-chicken-brown/10 overflow-hidden">
                {!occ && <p className="px-3.5 py-3 text-sm text-chicken-brown/60">此場次空桌，可預先配給未配桌散客。</p>}
                {occ?.kind === 'walkin' && (
                  <>
                    <button type="button" onClick={() => setDetailBookingId(occ.booking?.id || null)} title="點擊看訂位詳情"
                      className="tap w-full text-left flex items-center gap-2.5 min-h-[48px] px-3.5 py-2">
                      <Icon name="person" size={18} className="text-chicken-yellow" />
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm font-semibold text-chicken-brown truncate">{occ.booking?.name}</span>
                        <span className="block text-xs text-chicken-brown/60 tabular-nums">{occ.booking?.guests} 位 · {occ.booking?.timeSlot} · {occ.booking?.phone || '—'}</span>
                        {occ.booking?.notes?.text && <span className="block text-[11px] text-chicken-brown/55 mt-0.5 line-clamp-2">「{occ.booking.notes.text}」</span>}
                      </span>
                      <Icon name="chevronRight" size={14} strokeWidth={2.2} className="text-chicken-brown/30" />
                    </button>
                    <button type="button" onClick={() => { clearBookingPreassign(occ.booking.id); setSelectedTable(null); toast.info('已解除預先配桌') }}
                      className="tap w-full min-h-[44px] px-3.5 border-t border-chicken-brown/[0.08] text-left text-sm font-semibold text-chicken-red">解除預先配桌</button>
                  </>
                )}
                {occ?.kind === 'group' && (
                  <div className="flex items-center gap-2.5 min-h-[48px] px-3.5 py-2">
                    <Icon name="bus" size={18} className="text-indigo-600" />
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-semibold text-chicken-brown truncate">{occ.group?.agencyName || '團體'}</span>
                      <span className="block text-xs text-chicken-brown/60">{occ.batch?.label} · {occ.batch?.timeSlot}{occ.group?.guideName ? ` · ${occ.group.guideName}` : ''}</span>
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 未配桌散客清單 */}
          <div className="space-y-1.5">
            <h3 className="px-1 text-xs font-semibold text-chicken-brown/55 tracking-wide">未配桌散客 <span className="font-medium text-chicken-brown/40">· {seating.name}</span></h3>
            <div className="bg-white rounded-xl border border-chicken-brown/10 overflow-hidden divide-y divide-chicken-brown/[0.08]">
              {unassignedWalkins.length === 0 ? (
                <p className="px-3.5 py-3 text-xs text-chicken-brown/50">此場次散客都已配桌或無散客訂位。</p>
              ) : unassignedWalkins.map(b => {
                const active = assignBooking?.id === b.id
                return (
                  <div key={b.id} className={`flex items-center gap-2 min-h-[48px] pl-3.5 pr-2 ${active ? 'bg-orange-50' : ''} ${closed ? 'opacity-40' : ''}`}>
                    <button type="button" onClick={() => setDetailBookingId(b.id)} title="看訂位詳情"
                      className="tap flex-1 min-w-0 flex items-center gap-2 text-left py-1">
                      <Icon name="person" size={18} className="text-chicken-yellow" />
                      <span className="text-sm font-semibold text-chicken-brown truncate">{b.name}</span>
                      <span className="text-xs text-chicken-brown/60 tabular-nums shrink-0">{b.timeSlot} · {b.guests} 位</span>
                    </button>
                    <button type="button" onClick={() => startAssign(b)} disabled={closed}
                      className={`tap text-xs font-semibold h-8 px-3 rounded-lg shrink-0 ${active ? 'bg-orange-600 text-white' : 'bg-chicken-red text-white'} disabled:cursor-not-allowed`}>
                      {active ? '配桌中' : '配桌'}
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>

      {/* 散客訂位詳情：配桌 → 進本圖預配模式；在地圖標示 → 白圈 */}
      <BookingDetailSheet
        bookingId={detailBookingId}
        onClose={() => setDetailBookingId(null)}
        onAssign={(b) => { if (closed) return toast.error('此場次已關閉訂位'); startAssign(b) }}
        onFocusTable={focusBookingTables}
      />
    </div>
  )
}
