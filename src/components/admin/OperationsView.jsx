import { useState, useMemo, useEffect } from 'react'
import FloorMap from './floormap/FloorMap'
import StatusBar from './floormap/StatusBar'
import TableDrawer from './floormap/TableDrawer'
import UpcomingPanel from './floormap/UpcomingPanel'
import WaitlistMiniPanel from './floormap/WaitlistMiniPanel'
import LayoutEditor from './LayoutEditor'
import { useBooking } from '../../contexts/BookingContext'
import { useToast } from '../ui/Toast'
import { useAuth } from '../../contexts/AuthContext'

// 「現場營運」主畫面
// 模式：normal | merge | assign-booking | seat-waitlist | move-table
// 每個模式有對應的 banner、桌位 highlight、確認 toast
export default function OperationsView({ pendingAssign, onAssignDone, pendingSeatWait, onSeatWaitDone }) {
  const {
    tables, bookings, waitlist,
    mergeTables, assignBookingToTable, seatWaitlist, moveTable,
    findSuitableTables, suggestTable,
  } = useBooking()
  const toast = useToast()
  const { can } = useAuth()

  const [floor, setFloor] = useState('1F')
  const [selectedTable, setSelectedTable] = useState(null)
  const [mode, setMode] = useState(null)
  const [justAssigned, setJustAssigned] = useState(null) // 剛指派的桌號（綠光 2 秒）
  const [showLayoutEditor, setShowLayoutEditor] = useState(false)

  // 進入指派桌模式（含自動建議）
  const startAssign = (booking) => {
    const suitable = findSuitableTables(booking.guests).map(t => t.number)
    if (suitable.length === 0) return toast.error('目前無符合容量的空桌')
    const suggestion = suggestTable(booking.guests)
    setMode({ type: 'assign', booking, suitable, suggestion: suggestion?.number })
    setSelectedTable(null)
    if (suggestion) setFloor(suggestion.floor)
  }

  const startSeatWaitlist = (wait) => {
    const suitable = findSuitableTables(wait.partySize).map(t => t.number)
    if (suitable.length === 0) return toast.error('目前無符合容量的空桌')
    const suggestion = suggestTable(wait.partySize)
    setMode({ type: 'seat-waitlist', wait, suitable, suggestion: suggestion?.number })
    setSelectedTable(null)
    if (suggestion) setFloor(suggestion.floor)
  }

  const startMerge = () => {
    setMode({ type: 'merge', first: selectedTable })
  }

  // 換桌模式：當前用餐桌 → 選一張新空桌
  const startMove = (booking) => {
    if (!booking) return
    const suitable = findSuitableTables(booking.guests).map(t => t.number)
    if (suitable.length === 0) return toast.error('沒有可換的空桌')
    setMode({ type: 'move', booking, suitable, suggestion: suggestTable(booking.guests)?.number })
    setSelectedTable(null)
  }

  const cancelMode = () => setMode(null)

  // 桌位點選 — 依模式分流
  const handleTableClick = (number) => {
    if (!mode) {
      setSelectedTable(prev => prev === number ? null : number)
      return
    }
    if (mode.type === 'merge') {
      if (!mode.first) {
        setMode({ ...mode, first: number })
        return
      }
      if (mode.first === number) { cancelMode(); return }
      const r = mergeTables(mode.first, number)
      if (!r.ok) toast.error('併桌失敗：' + r.error)
      else toast.success(`✅ ${mode.first} + ${number} 已併桌（合計 ${r.totalCapacity} 位）`)
      cancelMode()
      return
    }
    if (mode.type === 'assign') {
      if (!mode.suitable.includes(number)) return toast.error('此桌不符合容量或非空桌')
      const r = assignBookingToTable(mode.booking.id, number)
      if (!r.ok) return toast.error('指派失敗：' + r.error)
      toast.success(`✅ ${mode.booking.name}（${mode.booking.guests} 位）指派至 ${number}`)
      flashAssigned(number)
      cancelMode()
      setSelectedTable(number)
      onAssignDone?.()
      return
    }
    if (mode.type === 'seat-waitlist') {
      if (!mode.suitable.includes(number)) return toast.error('此桌不符合容量或非空桌')
      const r = seatWaitlist(mode.wait.id, number)
      if (!r.ok) return toast.error('入座失敗：' + r.error)
      toast.success(`✅ ${mode.wait.name}（候位 #${mode.wait.queueNumber}）入座 ${number}`)
      flashAssigned(number)
      cancelMode()
      setSelectedTable(number)
      onSeatWaitDone?.()
      return
    }
    if (mode.type === 'move') {
      if (!mode.suitable.includes(number)) return toast.error('此桌不符合容量或非空桌')
      const r = moveTable(mode.booking.id, number)
      if (!r.ok) return toast.error('換桌失敗：' + r.error)
      toast.success(`✅ ${mode.booking.name} 已換到 ${number}`)
      flashAssigned(number)
      cancelMode()
      setSelectedTable(number)
      return
    }
  }

  const flashAssigned = (number) => {
    setJustAssigned(number)
    setTimeout(() => setJustAssigned(null), 2200)
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

  // 從外部觸發候位入座
  useEffect(() => {
    if (pendingSeatWait && (!mode || mode.wait?.id !== pendingSeatWait.id)) {
      startSeatWaitlist(pendingSeatWait)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingSeatWait?.id])

  const cancelModeAndNotify = () => {
    if (mode?.type === 'assign') onAssignDone?.()
    if (mode?.type === 'seat-waitlist') onSeatWaitDone?.()
    cancelMode()
  }

  // === Mode banner 文案 ===
  const banner = (() => {
    if (!mode) return null
    if (mode.type === 'merge') return mode.first
      ? `併桌模式：已選 ${mode.first}，請點選另一張相鄰桌`
      : '併桌模式：請點選第一張桌'
    if (mode.type === 'assign') return `指派桌位：${mode.booking.name} ${mode.booking.guests} 位 — 建議 ${mode.suggestion || '無'}（綠閃）`
    if (mode.type === 'seat-waitlist') return `候位入座：${mode.wait.name} #${mode.wait.queueNumber}（${mode.wait.partySize} 位）— 建議 ${mode.suggestion || '無'}`
    if (mode.type === 'move') return `換桌：${mode.booking.name} 從 ${mode.booking.assignedTableId} → 選新桌`
    return null
  })()

  return (
    <div className="space-y-3">
      <StatusBar tables={tables} waitlist={waitlist} />

      {/* 樓層切換 + 模式 banner */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex gap-1.5">
          {['1F', '2F'].map(f => (
            <button
              key={f}
              onClick={() => setFloor(f)}
              className={`px-4 py-2 rounded-xl text-sm font-bold transition-all border-2 ${
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
        {!mode && (
          <>
            {can('table.config') && (
              <button
                onClick={() => setShowLayoutEditor(true)}
                className="px-3 py-2 rounded-xl text-xs font-bold bg-white border-2 border-chicken-brown/15 text-chicken-brown hover:border-chicken-red"
              >🛠 編輯佈局</button>
            )}
            <button
              onClick={() => setMode({ type: 'merge', first: null })}
              className="px-3 py-2 rounded-xl text-xs font-bold bg-white border-2 border-chicken-brown/15 text-chicken-brown hover:border-chicken-yellow"
            >⇆ 併桌模式</button>
          </>
        )}
      </div>

      {/* Mode banner */}
      {banner && (
        <div className="bg-chicken-yellow text-white px-4 py-2.5 rounded-xl flex items-center justify-between gap-3 shadow-md">
          <div className="text-sm font-bold flex-1">{banner}</div>
          <button onClick={cancelModeAndNotify} className="text-xs px-3 py-1 bg-white text-chicken-yellow rounded-lg font-bold whitespace-nowrap">取消</button>
        </div>
      )}

      {/* 主區：地圖 + 側邊 */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-3">
        {/* 地圖區 */}
        <div className="bg-white rounded-2xl border border-chicken-brown/10 p-2 sm:p-3 min-h-[480px] lg:min-h-[640px]">
          <FloorMap
            floor={floor}
            tables={tables}
            bookings={bookings}
            selectedTableNumber={selectedTable}
            onSelectTable={handleTableClick}
            mergeMode={mode?.type === 'merge'}
            mergeFirst={mode?.type === 'merge' ? mode.first : null}
            assignMode={mode?.type === 'assign' || mode?.type === 'seat-waitlist' || mode?.type === 'move'}
            highlightTables={
              mode?.type === 'assign' ? mode.suitable
              : mode?.type === 'seat-waitlist' ? mode.suitable
              : mode?.type === 'move' ? mode.suitable
              : []
            }
            suggestionTable={mode?.suggestion || null}
            justAssignedTable={justAssigned}
          />
        </div>

        {/* 右側：模式相關 / 詳情 / 候位 */}
        <div className="space-y-3">
          {selectedTableObj ? (
            <TableDrawer
              table={selectedTableObj}
              booking={selectedBooking}
              onClose={() => setSelectedTable(null)}
              onStartMerge={() => setMode({ type: 'merge', first: selectedTable })}
              onStartMove={() => startMove(selectedBooking)}
              mode={{ assigning: mode?.type === 'assign' }}
            />
          ) : (
            <>
              <div className="bg-white rounded-2xl border border-chicken-brown/10 p-4">
                <h3 className="font-bold text-chicken-brown mb-3 text-sm">⏰ 即將到達</h3>
                <UpcomingPanel
                  onClickBooking={(b) => {
                    if (b.assignedTableId) setSelectedTable(b.assignedTableId)
                  }}
                  onAssignTable={startAssign}
                />
              </div>
              <div className="bg-white rounded-2xl border border-chicken-brown/10 p-4">
                <WaitlistMiniPanel onSeatWaitlist={startSeatWaitlist} />
              </div>
            </>
          )}
        </div>
      </div>

      <div className="text-center text-[11px] text-chicken-brown/40 mt-2">
        💡 點桌位看詳情 · 訂位「指派桌位」進指派模式 · 紅色超時桌可禮貌詢問結帳 · ESC 隨時取消
      </div>

      {/* 桌位佈局編輯器 */}
      <LayoutEditor open={showLayoutEditor} onClose={() => setShowLayoutEditor(false)} />
    </div>
  )
}
