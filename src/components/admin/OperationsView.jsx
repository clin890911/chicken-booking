import { useState, useMemo, useEffect } from 'react'
import FloorMap from './floormap/FloorMap'
import StatusBar from './floormap/StatusBar'
import TableDrawer from './floormap/TableDrawer'
import ModeBanner from './ops/ModeBanner'
import OpsRail from './ops/OpsRail'
import OpsHintBar from './ops/OpsHintBar'
import OpsLogModal from './ops/OpsLogModal'
import LayoutEditor from './LayoutEditor'
import { useBooking } from '../../contexts/BookingContext'
import { useToast } from '../ui/Toast'
import { useAuth } from '../../contexts/AuthContext'
import { findPreassignedBooking } from '../../utils/capacity'
import { buildGroupHolds, todayActiveGroups, reseatCandidateTables } from '../../utils/groupLive'
import { todayStr } from '../../utils/timeSlots'

// 「現場營運」主畫面
// 模式：normal | assign-booking | seat-waitlist | move-table | group-reseat
// 每個模式有對應的 banner、桌位 highlight、確認 toast
// 候位入座由右側欄（OpsRail > WaitlistPanel）頁內觸發；指派桌仍可由「訂位」分頁跨頁觸發（pendingAssign）
export default function OperationsView({ pendingAssign, onAssignDone }) {
  const {
    tables, bookings, waitlist, settings, groupReservations,
    assignBookingToTable, seatWaitlist, moveTable, reseatGroupBatchTable,
    findSuitableTables, suggestTable,
  } = useBooking()
  const toast = useToast()
  const { can } = useAuth()

  const [floor, setFloor] = useState('1F')
  const [selectedTable, setSelectedTable] = useState(null)
  const [railTab, setRailTab] = useState('upcoming') // 右側欄籤；ESC/關閉抽屜不重設
  const [mode, setMode] = useState(null)
  const [justAssigned, setJustAssigned] = useState(null) // 剛指派的桌號（綠光）
  const [pendingConfirm, setPendingConfirm] = useState(null) // 指派/候位/換桌：待確認的桌號（二步確認）
  const [showLayoutEditor, setShowLayoutEditor] = useState(false)
  const [showOpsLog, setShowOpsLog] = useState(false) // 系統自動處理紀錄（自動清檯留痕）

  // 今日團體 hold：今日（未取消/未完成）團體的桌位，若尚未實際入座（非 dining）則於圖上標示 🚌。
  // value = { agencyName, holds: [{ group, batch }] }（未入座梯次，依時段排序）：
  // FloorMap 只讀 truthiness 畫標記；TableDrawer 用 holds 顯示團資訊與「梯次入座」
  const groupHoldTables = useMemo(
    () => buildGroupHolds(todayActiveGroups(groupReservations, todayStr()), tables),
    [groupReservations, tables],
  )

  // 進入指派桌模式（含自動建議）
  const startAssign = (booking) => {
    const suitable = findSuitableTables(booking.guests).map(t => t.number)
    if (suitable.length === 0) return toast.error('目前無符合容量的空桌')
    const suggestion = suggestTable(booking.guests)
    setMode({ type: 'assign', booking, suitable, suggestion: suggestion?.number })
    setSelectedTable(null)
    setPendingConfirm(null)
    if (suggestion) setFloor(suggestion.floor)
  }

  const startSeatWaitlist = (wait) => {
    const suitable = findSuitableTables(wait.partySize).map(t => t.number)
    if (suitable.length === 0) return toast.error('目前無符合容量的空桌')
    const suggestion = suggestTable(wait.partySize)
    setMode({ type: 'seat-waitlist', wait, suitable, suggestion: suggestion?.number })
    setSelectedTable(null)
    setPendingConfirm(null)
    if (suggestion) setFloor(suggestion.floor)
  }

  // 改派桌位模式：團體梯次入座被佔桌卡住 → 逐桌挑替代空桌（queue 依序處理）
  const startGroupReseat = (group, batch, blocked) => {
    const queue = (blocked || []).map(b => b.tableNumber)
    if (!queue.length) return
    const current = queue[0]
    const fromTable = tables.find(t => t.number === current)
    const suitable = reseatCandidateTables({
      tables, holds: groupHoldTables, group, batch, fromTable,
    }).map(t => t.number)
    if (!suitable.length) {
      return toast.error(`目前沒有可改派的空桌（${current} 被佔）`)
    }
    setMode({ type: 'group-reseat', group, batch, queue, current, suitable, suggestion: suitable[0] })
    setSelectedTable(null)
    setPendingConfirm(null)
    const sug = tables.find(t => t.number === suitable[0])
    if (sug) setFloor(sug.floor)
  }

  // 換桌模式：當前用餐桌 → 選一張新空桌
  const startMove = (booking) => {
    if (!booking) return
    const suitable = findSuitableTables(booking.guests).map(t => t.number)
    if (suitable.length === 0) return toast.error('沒有可換的空桌')
    setMode({ type: 'move', booking, suitable, suggestion: suggestTable(booking.guests)?.number })
    setSelectedTable(null)
    setPendingConfirm(null)
  }

  const cancelMode = () => { setMode(null); setPendingConfirm(null) }

  // 桌位點選 — 依模式分流
  const handleTableClick = (number) => {
    if (!mode) {
      setSelectedTable(prev => prev === number ? null : number)
      return
    }
    // 指派 / 候位入座 / 換桌 / 團體改派：二步確認
    // 第一次點合適桌 → 進入「待確認」預覽；第二次點同一桌（或按確認鈕）才真正執行
    if (['assign', 'seat-waitlist', 'move', 'group-reseat'].includes(mode.type)) {
      if (!mode.suitable.includes(number)) {
        return toast.error(mode.type === 'group-reseat' ? '此桌非空桌或已被其他團體保留' : '此桌不符合容量或非空桌')
      }
      if (pendingConfirm === number) { executeAssign(number); return }
      setPendingConfirm(number)
      return
    }
  }

  // 真正執行指派/候位入座/換桌（由二步確認的第二步或確認鈕觸發）
  const executeAssign = (number) => {
    if (!mode || !number) return
    if (mode.type === 'assign') {
      const r = assignBookingToTable(mode.booking.id, number)
      if (!r.ok) return toast.error('指派失敗：' + r.error)
      toast.success(`✅ ${mode.booking.name}（${mode.booking.guests} 位）指派至 ${number} · 可指派下一組`)
      flashAssigned(number)
      cancelMode()
      setSelectedTable(number)
      onAssignDone?.()
      return
    }
    if (mode.type === 'seat-waitlist') {
      const r = seatWaitlist(mode.wait.id, number)
      if (!r.ok) return toast.error('入座失敗：' + r.error)
      toast.success(`✅ ${mode.wait.name}（候位 #${mode.wait.queueNumber}）入座 ${number} · 可指派下一組`)
      flashAssigned(number)
      cancelMode()
      setSelectedTable(number)
      return
    }
    if (mode.type === 'move') {
      const r = moveTable(mode.booking.id, number)
      if (!r.ok) return toast.error('換桌失敗：' + r.error)
      toast.success(`✅ ${mode.booking.name} 已換到 ${number} · 可指派下一組`)
      flashAssigned(number)
      cancelMode()
      setSelectedTable(number)
      return
    }
    if (mode.type === 'group-reseat') {
      const { group, batch, current } = mode
      const r = reseatGroupBatchTable(group.id, batch.id, current, number)
      if (!r.ok) { setPendingConfirm(null); return toast.error('改派失敗：' + r.error) }
      if (r.seated) {
        toast.success(`✅ 已改派 ${current} → ${number}，${group.agencyName || '團體'} ${batch.label || ''} 整梯入座`)
        flashAssigned(number)
        cancelMode()
        setSelectedTable(number)
        return
      }
      // 改派已落地但其他桌仍被佔 → 換下一張被佔桌繼續處理
      const nextQueue = (r.blocked || []).map(b => b.tableNumber)
      toast.info(`已改派 ${current} → ${number}，尚有 ${nextQueue.length} 桌被佔`)
      const nextCurrent = nextQueue[0]
      const fromTable = tables.find(t => t.number === nextCurrent)
      const suitable = reseatCandidateTables({
        tables, holds: groupHoldTables, group, batch, fromTable,
      }).map(t => t.number)
      if (!suitable.length) {
        cancelMode()
        return toast.error(`目前沒有可改派的空桌（${nextCurrent} 被佔）`)
      }
      setMode({ type: 'group-reseat', group, batch, queue: nextQueue, current: nextCurrent, suitable, suggestion: suitable[0] })
      setPendingConfirm(null)
      return
    }
  }

  const flashAssigned = (number) => {
    setJustAssigned(number)
    setTimeout(() => setJustAssigned(null), 3500)
  }

  // 當前選中桌的物件 + 對應 booking
  const selectedTableObj = useMemo(
    () => selectedTable ? tables.find(t => t.number === selectedTable) : null,
    [selectedTable, tables]
  )
  const selectedBooking = useMemo(() => {
    if (!selectedTableObj?.currentBookingId) return null
    return bookings.find(b => b.id === selectedTableObj.currentBookingId) || null
  }, [selectedTableObj, bookings])

  // 防呆：待確認桌是否已被「別筆 booking」於排位規劃預先配走（assignedTableId 指向此桌）。
  // 預配不動桌況（桌仍 vacant），會默默被現場指派覆蓋；指派前先示警讓店員知情。
  // 只示警「不同 booking 的預配」：現場指派的就是被預配的那位客人（id 相同）時不觸發。
  const pendingConflict = useMemo(() => {
    if (!pendingConfirm || !mode) return null
    if (!['assign', 'seat-waitlist', 'move'].includes(mode.type)) return null
    const excludeBookingId = mode.booking?.id // seat-waitlist 無 booking（新建 walk-in），任何預配都算他人
    const date = mode.type === 'seat-waitlist' ? todayStr() : (mode.booking?.date || todayStr())
    return findPreassignedBooking(bookings, pendingConfirm, { date, excludeBookingId })
  }, [pendingConfirm, mode, bookings])

  // 防呆：待確認桌是否被「今日團體」hold（圈桌未入座）。
  // findSuitableTables 只看桌況（vacant），不知道團體圈桌 → 指派/換桌/候位入座前先示警，避免散客坐掉團體桌。
  const pendingGroupHold = useMemo(() => {
    if (!pendingConfirm || !mode) return null
    if (!['assign', 'seat-waitlist', 'move'].includes(mode.type)) return null
    const hold = groupHoldTables[pendingConfirm]
    return hold?.holds?.length ? hold : null
  }, [pendingConfirm, mode, groupHoldTables])

  // 桌位詳情用：選中的「空桌」是否已被別筆 booking 預先配走（被動提示，未進指派模式也看得到）。
  const selectedTablePreassign = useMemo(() => {
    if (!selectedTableObj || selectedTableObj.status !== 'vacant') return null
    return findPreassignedBooking(bookings, selectedTable, {
      date: todayStr(),
      excludeBookingId: selectedTableObj.currentBookingId,
    })
  }, [selectedTableObj, selectedTable, bookings])

  // ESC 取消模式
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { cancelMode(); setSelectedTable(null) } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // 從外部觸發指派模式
  useEffect(() => {
    if (pendingAssign && (!mode || mode.booking?.id !== pendingAssign.id)) {
      startAssign(pendingAssign)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingAssign?.id])

  const cancelModeAndNotify = () => {
    if (mode?.type === 'assign') onAssignDone?.()
    cancelMode()
  }

  return (
    <div className="space-y-3">
      <StatusBar tables={tables} waitlist={waitlist} bookings={bookings} />

      {/* 「現在該做什麼」提示列：過時未到 / 超時 / 待清 / 自動處理紀錄 / 節奏單句 */}
      <OpsHintBar
        onOpenUpcoming={() => { setSelectedTable(null); setRailTab('upcoming') }}
        onOpenLog={() => setShowOpsLog(true)}
      />

      {/* 樓層切換 + 模式 banner */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
          {['1F', '2F'].map(f => (
            <button
              key={f}
              onClick={() => setFloor(f)}
              className={`whitespace-nowrap px-4 py-2 rounded-xl text-sm font-bold transition-all border-2 ${
                floor === f
                  ? 'bg-chicken-red border-chicken-red text-white shadow'
                  : 'bg-white border-chicken-brown/15 text-chicken-brown'
              }`}
            >
              {f === '1F' ? '1F 主用餐區' : '2F 用餐區'}
              <span className="ml-1.5 text-[10px] opacity-75">({tables.filter(t => t.floor === f).length})</span>
            </button>
          ))}
        </div>
        <div className="flex-1" />
        {!mode && can('table.config') && (
          <button
            onClick={() => setShowLayoutEditor(true)}
            className="px-3 py-2 rounded-xl text-xs font-bold bg-white border-2 border-chicken-brown/15 text-chicken-brown hover:border-chicken-red"
          >編輯佈局</button>
        )}
      </div>

      {/* Mode banner — 依模式不同底色 + emoji，避免誤判 */}
      <ModeBanner
        mode={mode}
        pendingConfirm={pendingConfirm}
        pendingConflict={pendingConflict}
        pendingGroupHold={pendingGroupHold}
        onCancel={cancelModeAndNotify}
        onConfirm={() => executeAssign(pendingConfirm)}
        onClearPending={() => setPendingConfirm(null)}
      />

      {/* 主區：地圖 + 側邊 */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-3">
        {/* 地圖區 */}
        <div className="bg-white rounded-xl border border-chicken-brown/10 p-2 sm:p-3 min-h-[430px] sm:min-h-[560px] lg:min-h-[680px] overflow-hidden">
          <div className="mb-2 flex flex-wrap items-center gap-2 px-1 text-[11px] font-bold text-chicken-brown/55">
            <span className="inline-flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-full bg-emerald-600" />可入座</span>
            <span className="inline-flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-full bg-sky-600" />已預訂</span>
            <span className="inline-flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-full bg-orange-500" />用餐中</span>
            <span className="inline-flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-full bg-amber-600" />待清桌</span>
            <span className="inline-flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-full bg-chicken-red" />超時</span>
            <span className="inline-flex items-center gap-1"><i className="h-2.5 w-2.5 rounded border-2 border-dashed border-indigo-500 bg-transparent" />🚌 團體保留</span>
            <span className="inline-flex items-center gap-1"><i className="h-2.5 w-2.5 rounded border-2 border-chicken-red bg-transparent" />選中</span>
          </div>
          <FloorMap
            floor={floor}
            tables={tables}
            bookings={bookings}
            settings={settings}
            selectedTableNumber={selectedTable}
            onSelectTable={handleTableClick}
            assignMode={['assign', 'seat-waitlist', 'move', 'group-reseat'].includes(mode?.type)}
            highlightTables={
              ['assign', 'seat-waitlist', 'move', 'group-reseat'].includes(mode?.type) ? mode.suitable : []
            }
            suggestionTable={mode?.suggestion || null}
            pendingConfirmTable={pendingConfirm}
            justAssignedTable={justAssigned}
            groupHoldTables={groupHoldTables}
          />
        </div>

        {/* 右側：模式相關 / 詳情 / 候位 */}
        <div className="space-y-3">
          {selectedTableObj ? (
            <TableDrawer
              table={selectedTableObj}
              booking={selectedBooking}
              preassign={selectedTablePreassign}
              groupHold={groupHoldTables[selectedTable] || null}
              onClose={() => setSelectedTable(null)}
              onStartMove={() => startMove(selectedBooking)}
              onReseatBatch={startGroupReseat}
              mode={{ assigning: mode?.type === 'assign' }}
            />
          ) : (
            <OpsRail
              activeTab={railTab}
              onTabChange={setRailTab}
              onClickBooking={(b) => {
                if (b.assignedTableId) setSelectedTable(b.assignedTableId)
              }}
              onAssignTable={startAssign}
              onSeatWaitlist={startSeatWaitlist}
              onReseatBatch={startGroupReseat}
              onFocusTable={(n) => {
                const t = tables.find(x => x.number === n)
                if (t) setFloor(t.floor)
                setSelectedTable(n)
              }}
            />
          )}
        </div>
      </div>

      <div className="text-center text-[11px] text-chicken-brown/45 mt-2">
        點桌位看詳情 · 訂位「指派桌位」進指派模式 · 紅色超時桌可禮貌詢問結帳 · ESC 取消
      </div>

      {/* 桌位佈局編輯器 */}
      <LayoutEditor open={showLayoutEditor} onClose={() => setShowLayoutEditor(false)} />

      {/* 系統自動處理紀錄（自動清檯留痕） */}
      <OpsLogModal open={showOpsLog} onClose={() => setShowOpsLog(false)} />
    </div>
  )
}
