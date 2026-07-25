import { useState, useMemo, useEffect, useRef } from 'react'
import FloorMap from './floormap/FloorMap'
import StatusBar from './floormap/StatusBar'
import TableDrawer from './floormap/TableDrawer'
import ModeBanner from './ops/ModeBanner'
import OpsRail from './ops/OpsRail'
import OpsHintBar from './ops/OpsHintBar'
import OpsLogModal from './ops/OpsLogModal'
import TableScheduleView from './ops/TableScheduleView'
import TableSummaryView from './ops/TableSummaryView'
import LayoutEditor from './LayoutEditor'
import { useBooking } from '../../contexts/BookingContext'
import { useToast } from '../ui/Toast'
import { useAuth } from '../../contexts/AuthContext'
import { findPreassignedBooking } from '../../utils/capacity'
import { buildGroupHolds, todayActiveGroups, reseatCandidateTables } from '../../utils/groupLive'
import { buildTableTurns } from '../../utils/tableTurns'
import { todayStr } from '../../utils/timeSlots'

// 「現場營運」主畫面
// 模式：normal | assign-booking | seat-waitlist | move-table | group-reseat
// ★ 現場帶位（walk-in）v3 不再是「模式」：帶位籤常駐左欄，點桌／選人數順序不拘，
//   兩者到齊由面板滑動入座（walkin / walkin-multi 兩個舊 mode 已移除）。
// 每個模式有對應的 banner、桌位 highlight、確認 toast
// 候位入座由右側欄（OpsRail > WaitlistPanel）頁內觸發；指派桌仍可由「訂位」分頁跨頁觸發（pendingAssign）
export default function OperationsView({ pendingAssign, onAssignDone }) {
  const {
    tables, bookings, waitlist, settings, groupReservations, fixtures, zones,
    assignBookingToTable, assignBookingTablesMulti, seatWaitlist, walkInSeat, walkInSeatMulti, moveTable, reseatGroupBatchTable,
    cancelBooking,
    findSuitableTables, suggestTable, suggestTableCombo,
  } = useBooking()
  const toast = useToast()
  const { can } = useAuth()

  const [floor, setFloor] = useState('1F')
  const [view, setView] = useState('map') // map=SVG 桌況圖 ｜ schedule=當日排程（每桌 turns）
  const [selectedTable, setSelectedTable] = useState(null)
  const [railTab, setRailTab] = useState('walkin') // 左側操作欄籤（預設帶位）；ESC/關閉抽屜不重設
  const [mode, setMode] = useState(null)
  const [justAssigned, setJustAssigned] = useState(null) // 剛指派的桌號（綠光）
  const [pendingConfirm, setPendingConfirm] = useState(null) // 指派/候位/換桌：待確認的桌號（二步確認）
  const [showLayoutEditor, setShowLayoutEditor] = useState(false)
  const [showOpsLog, setShowOpsLog] = useState(false) // 系統自動處理紀錄（自動清檯留痕）

  // === 現場帶位 v3（順序不拘）===
  // 系統只需要「桌」和「人數」：先點桌或先選人數都行，兩者到齊由面板的滑動手勢入座。
  // 桌的真相放這裡（不放面板內），桌況圖與帶位面板共用同一份，避免兩邊各記一套。
  const [walkinGuests, setWalkinGuests] = useState(2)
  const [walkinTableNumbers, setWalkinTableNumbers] = useState([])
  const [lastSeated, setLastSeated] = useState(null) // M2b 短復原：{ bookingId, tableNumbers, name, guests, at }
  // M6 沿用上一組：{ guests, notes }。放在這裡（不放面板內）是因為切籤會把 FastWalkInPanel
  // 卸載，state 會消失；連續同型客人（一直來 2 位）才是這功能要救的情境。
  // 刻意不記姓名／電話——那是每組不同的資料，沿用會把上一組的客人資料掛到新客人身上。
  const [lastParty, setLastParty] = useState(null)
  // 復原時要讀「當下」的訂位狀態（toast 的 onClick 閉包會抓到入座當時的舊值）
  const bookingsRef = useRef(bookings)
  bookingsRef.current = bookings

  // 今日團體 hold：今日（未取消/未完成）團體的桌位，若尚未實際入座（非 dining）則於圖上標示 🚌。
  // value = { agencyName, holds: [{ group, batch }] }（未入座梯次，依時段排序）：
  // FloorMap 只讀 truthiness 畫標記；TableDrawer 用 holds 顯示團資訊與「梯次入座」
  const groupHoldTables = useMemo(
    () => buildGroupHolds(todayActiveGroups(groupReservations, todayStr()), tables),
    [groupReservations, tables],
  )

  // 今日預配標記：被今日訂位「預先配走」的桌號 → { timeSlot }。
  // 預配只記在 booking 上、不動桌況（桌仍 vacant）——地圖上需給視覺線索（📌 時段 預配），
  // 否則店員要到帶位確認那一步才會被 pendingConflict 警告撞桌。
  // 只標「還會來」的：pending/confirmed；arrived 桌已 dining、completed/cancelled/noshow 不標。
  // 同桌多筆預配（午、晚兩輪）取最早時段。
  const preassignTables = useMemo(() => {
    const map = {}
    const today = todayStr()
    bookings.forEach(b => {
      if (b.date !== today || !b.assignedTableId) return
      if (!['pending', 'confirmed'].includes(b.status)) return
      const key = String(b.assignedTableId)
      if (!map[key] || String(b.timeSlot || '99:99') < String(map[key].timeSlot || '99:99')) {
        map[key] = { timeSlot: b.timeSlot || '' }
      }
    })
    return map
  }, [bookings])

  // 排程視圖資料：每張桌今天的各批用餐（turns）。散客（含預先配桌）+ 團體梯次合併、依時段排序。
  const turnsByTable = useMemo(
    () => buildTableTurns(tables, bookings, groupReservations, todayStr()),
    [tables, bookings, groupReservations],
  )

  // 帶位/指派等模式一律在 SVG 桌況圖操作；排程視圖為總覽用途，模式進行中強制切回地圖。
  const showSchedule = !mode && view === 'schedule'
  const showSummary = !mode && view === 'summary'

  // 進入指派桌模式（含自動建議）。無單桌容納（大組）→ 改走多桌指派（併桌）。
  const startAssign = (booking) => {
    const guests = Number(booking.guests) || 0
    const suitable = findSuitableTables(guests).map(t => t.number)
    if (suitable.length > 0) {
      // 有單桌容納 → 既有單桌指派流程
      const suggestion = suggestTable(guests)
      setMode({ type: 'assign', booking, suitable, suggestion: suggestion?.number })
      setSelectedTable(null)
      setPendingConfirm(null)
      if (suggestion) setFloor(suggestion.floor)
      return
    }
    // 無單桌容納（大組）→ 多桌指派（併桌）：系統建議組合，店員可在地圖加減桌後確認
    const combo = suggestTableCombo(guests)
    if (!combo.enough) {
      return toast.error(`目前沒有單一樓層能容納 ${guests} 位（同層最多 ${combo.seats} 席），可改用候位取號或分成兩組`)
    }
    const vacantNums = findSuitableTables(1).map(t => t.number) // 所有今日可用空桌（容量≥1）= 可加減的池
    setMode({
      type: 'assign-multi',
      booking,
      need: guests,
      selected: combo.tableNumbers, // 預選建議組合
      suitable: vacantNums,
    })
    setSelectedTable(null)
    setPendingConfirm(null)
    const firstTable = tables.find(t => t.number === combo.tableNumbers[0])
    if (firstTable) setFloor(firstTable.floor)
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
      // 帶位 v3：帶位籤上點「今日可入座的空桌」＝加入/移出帶位面板（不開抽屜、不進 mode）。
      // 一桌＝單桌帶位、多桌＝併桌，同一條路徑，人數與桌到齊後由面板滑動入座。
      if (railTab === 'walkin' && walkinSelectable.includes(number)) {
        const isRemove = walkinTableNumbers.includes(number)
        // 同樓層守門：切樓層後想加別層的桌 → 擋（併桌不可跨層；移除一律允許）
        if (!isRemove && walkinTableNumbers.length) {
          const selFloor = tables.find(x => x.number === walkinTableNumbers[0])?.floor
          const thisFloor = tables.find(x => x.number === number)?.floor
          if (selFloor && thisFloor && selFloor !== thisFloor) {
            return toast.error('併桌需在同一樓層，請改選同層的桌')
          }
        }
        // 加/移一律在 updater 內依 prev 判斷：iPad 觸控可能同一個 tick 內送出兩次 click
        // （touch → 合成 click），若沿用 render 當下的 isRemove，兩次都會判定「加入」→
        // 同一張桌被塞進陣列兩次 → 席數加倍、入座時帶錯桌數。
        setWalkinTableNumbers(prev => prev.includes(number) ? prev.filter(n => n !== number) : [...prev, number])
        setSelectedTable(null) // 抽屜開著時也要退回帶位面板，選了什麼桌才看得見
        return
      }
      setSelectedTable(prev => prev === number ? null : number)
      return
    }
    // 多桌指派（大組併桌）：點桌加入/移除已選集合，不走二步確認（確認在 banner 按鈕）
    if (mode.type === 'assign-multi') {
      if (!mode.suitable.includes(number)) return toast.error('此桌目前不可加入（非空桌或維修中）')
      const isRemove = mode.selected.includes(number)
      // 同樓層守門：切樓層後若想加別層的桌 → 擋（併桌不可跨層；移除一律允許）
      if (!isRemove && mode.selected.length) {
        const selFloor = tables.find(x => x.number === mode.selected[0])?.floor
        const thisFloor = tables.find(x => x.number === number)?.floor
        if (selFloor && thisFloor && selFloor !== thisFloor) {
          return toast.error('併桌需在同一樓層，請改選同層的桌')
        }
      }
      const selected = isRemove ? mode.selected.filter(n => n !== number) : [...mode.selected, number]
      setMode({ ...mode, selected })
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

  // 多桌指派：已選桌的合計席數（給 banner 顯示 + 確認門檻）
  const walkinMultiSeats = useMemo(() => {
    if (mode?.type !== 'assign-multi') return 0
    return (mode.selected || []).reduce((s, n) => s + (tables.find(t => t.number === n)?.capacity || 0), 0)
  }, [mode, tables])

  // 多桌指派確認：席數夠 → 一筆 booking 佔多桌（預訂該訂位；現場帶位併桌走 handleWalkinSeat）
  const confirmWalkinMulti = () => {
    if (mode?.type !== 'assign-multi') return
    if (walkinMultiSeats < mode.need) return toast.error(`還差 ${mode.need - walkinMultiSeats} 席，請再加桌`)
    const r = assignBookingTablesMulti(mode.booking.id, mode.selected)
    if (!r.ok) return toast.error('指派失敗：' + r.error)
    toast.success(`✅ ${mode.booking.name}（${mode.need} 位）併桌指派至 ${mode.selected.join(' + ')} · 可指派下一組`)
    flashAssigned(mode.selected[0])
    cancelMode()
    setSelectedTable(mode.selected[0])
    onAssignDone?.()
  }

  // === 帶位 v3：可選桌池 / 已選桌 / 兩道防呆 / 入座 + 短復原 ===

  // 可加入帶位的桌＝今日可用（非維修）且空桌（沿用指派流程同一個判定來源）
  const walkinSelectable = useMemo(
    () => findSuitableTables(1).map(t => t.number),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tables],
  )

  // 已選桌物件（面板顯示用）。桌被別台裝置帶走/進維修 → 自動從已選清單消失，不會帶著失效桌去入座。
  const walkinTables = useMemo(
    () => walkinTableNumbers
      .filter(n => walkinSelectable.includes(n))
      .map(n => tables.find(t => t.number === n))
      .filter(Boolean),
    [walkinTableNumbers, walkinSelectable, tables],
  )

  // 已選桌被別人佔走/進維修 → 直接從 walkinTableNumbers 剪掉，並告知店員是哪一張。
  // 不能只靠 walkinTables 過濾顯示：留在 walkinTableNumbers 的「幽靈桌」會①在桌況圖上
  // 仍畫成已選 ②被同層守門當成基準桌，害之後選別層的桌跳莫名錯誤 ③只剩一張時面板
  // 連「移除」鈕都不會渲染，店員在 UI 上完全清不掉。
  useEffect(() => {
    if (!walkinTableNumbers.length) return
    const gone = walkinTableNumbers.filter(n => !walkinSelectable.includes(n))
    if (!gone.length) return
    setWalkinTableNumbers(prev => prev.filter(n => walkinSelectable.includes(n)))
    toast.info(`${gone.join('、')} 已被佔用或停用，已從帶位清單移除`)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walkinSelectable, walkinTableNumbers])

  // 防呆（v3 綁在「已選的桌」而非二次確認上）：任一張桌有問題就示警，面板要勾「仍要帶」才滑得動。
  // 1) 被別筆 booking 預先配走（預配不動桌況，桌仍 vacant，會默默被現場帶位覆蓋）
  // 2) 今日團體圈桌未入座（findSuitableTables 只看桌況，不知道團體圈桌）
  // ★ 舊版 walkin-multi 沒有這兩道防呆（白名單不含 multi），v3 併桌一併補上。
  // 併桌時**每一張**有問題的桌都要列出來：只報第一張的話，店員勾了「仍要帶」就會把
  // 後面那張沒被告知的團體桌/預配桌一起放行——擋是擋住了，但他不知道自己在覆蓋什麼。
  const walkinWarning = useMemo(() => {
    if (!walkinTables.length) return null
    const date = todayStr()
    const lines = []
    for (const t of walkinTables) {
      const pre = findPreassignedBooking(bookings, t.number, { date })
      if (pre) {
        lines.push(`${t.number} 已於排位規劃預留給 ${pre.name}（${pre.guests} 位${pre.timeSlot ? ` · ${pre.timeSlot}` : ''}）。帶位後將覆蓋其預配，${pre.name} 會變回未配桌。`)
        continue // 同一張桌只報最嚴重的那一項，避免同桌兩行洗版
      }
      const hold = groupHoldTables[t.number]
      if (hold?.holds?.length) {
        const batch = hold.holds[0]?.batch
        const when = batch ? `（${batch.label || ''} ${batch.timeSlot || ''}）`.replace(/\s+/g, ' ') : ''
        lines.push(`${t.number} 為今日團體 ${hold.agencyName || '旅行社'} 預留${when}。帶位後散客將佔用團體桌。`)
      }
    }
    return lines.length ? { text: lines.join('\n'), lines } : null
  }, [walkinTables, bookings, groupHoldTables])

  // M2b 短復原：把剛剛那筆 walk-in 取消並釋回空桌（沿用既有 cancelBooking：
  // clearTable 主桌+額外桌 → vacant、status→cancelled、解除桌號指派）。
  const undoLastSeat = (snap) => {
    if (!snap?.bookingId) return
    const current = bookingsRef.current.find(b => b.id === snap.bookingId)
    if (!current || current.status !== 'arrived') {
      return toast.error('已無法復原（這筆訂位的狀態已被更動）')
    }
    const r = cancelBooking(snap.bookingId)
    if (!r?.ok) return toast.error('復原失敗：' + (r?.error || '未知錯誤'))
    setLastSeated(null)
    setWalkinTableNumbers(snap.tableNumbers || []) // 桌回到已選狀態，方便馬上改帶別組
    toast.info(`↩️ 已復原：${snap.tableNumbers.join(' + ')} 回到空桌`)
  }

  // 帶位入座：一桌走 walkInSeat、多桌走 walkInSeatMulti（同一個手勢靠陣列長度分派）。
  // 回傳 false = 失敗（面板保留欄位，方便改人數或改走候位）。
  const handleWalkinSeat = (payload) => {
    const nums = payload?.tableNumbers || []
    if (!nums.length) { toast.error('請先點桌況圖選一張桌'); return false }
    const guestData = {
      name: payload.name, phone: payload.phone, guests: payload.guests, notes: payload.notes,
    }
    const r = nums.length === 1 ? walkInSeat(nums[0], guestData) : walkInSeatMulti(nums, guestData)
    if (!r.ok) { toast.error('入座失敗：' + r.error); return false }
    const label = nums.join(' + ')
    const name = r.booking?.name || '散客'
    const guests = r.booking?.guests || payload.guests
    const snap = { bookingId: r.booking?.id, tableNumbers: nums, name, guests, at: Date.now() }
    setLastSeated(snap)
    setLastParty({ guests, notes: payload.notes || '' })   // M6：供下一組一鍵沿用
    flashAssigned(nums[0])
    setWalkinTableNumbers([])
    // 不 setSelectedTable：留在帶位面板才能直接帶下一組（舊版會被 TableDrawer 蓋掉）
    // M2b：成功 toast 直接帶「復原」，8 秒內可反悔（拿掉二次確認換來的安全網）
    toast.action(
      `✅ ${name}（${guests} 位）入座 ${label} · 可帶下一組`,
      { label: '復原', onClick: () => undoLastSeat(snap) },
      { duration: 8000 },
    )
    return true
  }

  // 復原提示 8 秒後失效（toast 也同步消失）
  useEffect(() => {
    if (!lastSeated) return
    const id = setTimeout(() => setLastSeated(null), 8000)
    return () => clearTimeout(id)
  }, [lastSeated])

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
    if (mode?.type === 'assign' || mode?.type === 'assign-multi') onAssignDone?.()
    cancelMode()
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* 上部チップ群：高さ固定（捲動しない）。地図＋右側欄に最大高さを譲る */}
      <div className="flex-shrink-0 space-y-3">
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

        {/* 視圖切換：桌況（SVG 即時圖）｜排程（每桌當日 turns）。帶位模式中隱藏，避免在排程視圖操作。 */}
        {!mode && (
          <div className="flex gap-1 rounded-xl bg-chicken-cream p-1 border-2 border-chicken-brown/10">
            {[['map', '地圖'], ['summary', '摘要'], ['schedule', '排程']].map(([k, label]) => (
              <button
                key={k}
                onClick={() => setView(k)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  view === k ? 'bg-chicken-red text-white shadow' : 'text-chicken-brown/70 hover:text-chicken-brown'
                }`}
              >{label}</button>
            ))}
          </div>
        )}

        <div className="flex-1" />
        {!mode && (
          <button
            onClick={() => { setSelectedTable(null); setRailTab('walkin') }}
            className="px-4 py-2 rounded-xl text-sm font-black bg-amber-500 text-white shadow hover:bg-amber-600 transition-all"
          >🪑 立即帶位</button>
        )}
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
        multiSeats={walkinMultiSeats}
        onCancel={cancelModeAndNotify}
        onConfirm={() => executeAssign(pendingConfirm)}
        onConfirmMulti={confirmWalkinMulti}
        onClearPending={() => setPendingConfirm(null)}
      />
      </div>

      {/* 主區：左＝操作/帶位欄（常駐、內部捲動）｜右＝桌況（地圖/摘要/排程，填滿）。
          一面式機制不變：外層 flex-1 min-h-0；左欄自身 overflow-y-auto；右欄 flex-1 min-h-0、SVG 自動縮放 */}
      <div className="flex-1 min-h-0 mt-3 grid grid-cols-1 md:grid-cols-[340px_1fr] lg:grid-cols-[380px_1fr] gap-3">
        {/* 左欄：選中桌→TableDrawer；否則→OpsRail（帶位/今日訂位/候位/團體）
            TableDrawer 是長內容 → 外層捲動；OpsRail 自己管內部捲動與釘底動作列 → 外層只給 flex 容器 */}
        <div className={`h-full min-h-0 ${selectedTableObj ? 'overflow-y-auto space-y-3' : 'flex flex-col'}`}>
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
              walkinGuests={walkinGuests}
              onWalkinGuestsChange={setWalkinGuests}
              walkinTables={walkinTables}
              onRemoveWalkinTable={(n) => setWalkinTableNumbers(prev => prev.filter(x => x !== n))}
              onClearWalkinTables={() => setWalkinTableNumbers([])}
              walkinWarning={walkinWarning}
              onWalkinSeat={handleWalkinSeat}
              lastParty={lastParty}
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

        {/* 右欄：桌況（地圖 SVG／摘要／排程）。高度填滿剩餘空間，SVG 自動縮放 */}
        <div className="bg-white rounded-xl border border-chicken-brown/10 p-2 sm:p-3 h-full min-h-[260px] overflow-hidden flex flex-col">
          {showSchedule ? (
            // 排程視圖＝縱向堆疊卡片，會長 → 內部捲動避免裁切
            <div className="flex-1 min-h-0 overflow-y-auto">
              <TableScheduleView
                tables={tables.filter(t => t.floor === floor)}
                turnsByTable={turnsByTable}
                selectedTableNumber={selectedTable}
                onSelectTable={(n) => setSelectedTable(prev => prev === n ? null : n)}
              />
            </div>
          ) : showSummary ? (
            // 摘要視圖＝可坐存量 + 依狀態分組（不估時間）
            <div className="flex-1 min-h-0">
              <TableSummaryView
                tables={tables.filter(t => t.floor === floor)}
                groupHoldTables={groupHoldTables}
                settings={settings}
                onSelectTable={(n) => setSelectedTable(prev => prev === n ? null : n)}
              />
            </div>
          ) : (
            <>
              <div className="mb-2 flex-shrink-0 flex flex-wrap items-center gap-2 px-1 text-[11px] font-bold text-chicken-brown/55">
                <span className="inline-flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-sm bg-green-300 border-2 border-green-700" />可入座</span>
                <span className="inline-flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-sm bg-slate-100 border border-slate-400" />已預訂</span>
                <span className="inline-flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-sm bg-gray-200 border border-gray-400" />用餐中</span>
                <span className="inline-flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-sm bg-amber-200 border border-amber-600" />待清桌</span>
                <span className="inline-flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-sm bg-red-600" />超時</span>
                <span className="inline-flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-sm bg-indigo-100 border border-indigo-400" />團體保留</span>
                <span className="inline-flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-sm bg-white ring-2 ring-chicken-red ring-inset" />選中</span>
              </div>
              <div className="flex-1 min-h-0">
              <FloorMap
                floor={floor}
                tables={tables}
                bookings={bookings}
                settings={settings}
                selectedTableNumber={selectedTable}
                selectedTableNumbers={walkinTableNumbers}
                onSelectTable={handleTableClick}
                assignMode={['assign', 'seat-waitlist', 'move', 'group-reseat', 'assign-multi'].includes(mode?.type)}
                highlightTables={
                  mode?.type === 'assign-multi' ? mode.selected   // 多桌：已選桌高亮（其餘空桌 dimmed 但可點加入）
                    : ['assign', 'seat-waitlist', 'move', 'group-reseat'].includes(mode?.type) ? mode.suitable
                    : []
                }
                suggestionTable={mode?.suggestion || null}
                pendingConfirmTable={pendingConfirm}
                justAssignedTable={justAssigned}
                groupHoldTables={groupHoldTables}
                preassignTables={preassignTables}
                fixtures={fixtures}
                zones={zones}
              />
              </div>
            </>
          )}
        </div>
      </div>

      <div className="flex-shrink-0 hidden sm:block text-center text-[11px] text-chicken-brown/45 mt-2">
        帶位籤點空桌＝選位（可多桌併桌）· 其他情況點桌位看詳情 · 紅色超時桌可禮貌詢問結帳 · ESC 取消
      </div>

      {/* 桌位佈局編輯器 */}
      <LayoutEditor open={showLayoutEditor} onClose={() => setShowLayoutEditor(false)} />

      {/* 系統自動處理紀錄（自動清檯留痕） */}
      <OpsLogModal open={showOpsLog} onClose={() => setShowOpsLog(false)} />
    </div>
  )
}
