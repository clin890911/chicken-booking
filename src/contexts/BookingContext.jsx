import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react'
import * as bookingService from '../services/bookingService'
import * as tableService from '../services/tableService'
import * as settingsService from '../services/settingsService'
import * as waitlistService from '../services/waitlistService'
import * as customerService from '../services/customerService'
import * as seatingService from '../services/seatingService'
import * as agencyService from '../services/agencyService'
import * as guideService from '../services/guideService'
import * as groupReservationService from '../services/groupReservationService'
import * as tg from '../services/telegramService'
import * as cloudData from '../services/cloudDataService'
import * as opsLogService from '../services/opsLogService'
import { computeOvertimeActions, computeDayRolloverActions } from '../utils/opsSweep'
import { todayStr } from '../utils/timeSlots'
import { useAuth } from './AuthContext'
import { useToast } from '../components/ui/Toast'

const BookingContext = createContext(null)

// 通知不阻塞 UI（fire-and-forget），失敗只 console.warn
const safeNotify = (fn) => {
  try { fn()?.catch?.(e => console.warn('TG notify error:', e)) }
  catch (e) { console.warn('TG notify error:', e) }
}

// 計算桌位用餐時長（給 checkout/finalize 訊息用）
const minutesSeated = (table) => {
  if (!table?.seatedAt) return 0
  return Math.floor((Date.now() - new Date(table.seatedAt).getTime()) / 60000)
}

export function BookingProvider({ children }) {
  // 只有登入的員工才會啟動「全量雲端同步」。
  // 客人端（公開頁）一律不碰 admin 同步，避免把所有顧客個資灌進客人的瀏覽器，
  // 也避免未授權的全量讀寫（真正的把關在後端 requireStaff）。
  const { user, getToken, usingFirebase } = useAuth() || {}
  const isStaff = !!user
  const toast = useToast()
  const toastRef = useRef(toast)
  toastRef.current = toast
  // 節流：雲端推送失敗的 toast 最多每 8 秒一則，避免離線時連續操作洗版。
  const lastPushErrorToastRef = useRef(0)

  const [bookings, setBookings] = useState([])
  const [tables, setTables] = useState([])
  const [waitlist, setWaitlist] = useState([])
  const [customers, setCustomers] = useState([])
  const [agencies, setAgencies] = useState([])
  const [guides, setGuides] = useState([])
  const [groupReservations, setGroupReservations] = useState([])
  const [settings, setSettings] = useState(settingsService.getSettings())
  const [cloudStatus, setCloudStatus] = useState({ state: 'idle', lastSyncAt: null, error: '' })
  const syncTimerRef = useRef(null)
  const isStaffRef = useRef(isStaff)
  isStaffRef.current = isStaff

  // 把員工 ID Token 提供者注入 cloudDataService（admin 端點需要 Bearer token）。
  useEffect(() => {
    cloudData.setAuthTokenProvider(getToken || null)
    return () => cloudData.setAuthTokenProvider(null)
  }, [getToken])

  const refresh = useCallback(() => {
    setBookings(bookingService.listAll())
    setTables(tableService.listAll())
    setWaitlist(waitlistService.listAll())
    setCustomers(customerService.listAll())
    setAgencies(agencyService.listAll())
    setGuides(guideService.listAll())
    setGroupReservations(groupReservationService.listAll())
    setSettings(settingsService.getSettings())
  }, [])

  const pullCloud = useCallback(async () => {
    try {
      const data = await cloudData.pullCloudData()
      cloudData.applyCloudSnapshot(data)
      refresh()
      setCloudStatus({ state: 'synced', lastSyncAt: new Date().toISOString(), error: '' })
      return data
    } catch (err) {
      setCloudStatus(s => ({ ...s, state: 'offline', error: err.message || 'cloud-sync-failed' }))
      return null
    }
  }, [refresh])

  const syncCloudSoon = useCallback(() => {
    if (!isStaffRef.current) return // 非員工不推送
    window.clearTimeout(syncTimerRef.current)
    syncTimerRef.current = window.setTimeout(async () => {
      try {
        await cloudData.pushChangedData()
        setCloudStatus({ state: 'synced', lastSyncAt: new Date().toISOString(), error: '' })
      } catch (err) {
        setCloudStatus(s => ({ ...s, state: 'offline', error: err.message || 'cloud-push-failed' }))
        // F-D：把推送失敗主動回饋給觸發操作的店員，避免「以為存檔成功、實際沒上雲」。
        const now = Date.now()
        if (now - lastPushErrorToastRef.current > 8000) {
          lastPushErrorToastRef.current = now
          toastRef.current?.error?.('雲端同步失敗，剛才的變更可能未存到雲端，請檢查網路後重試')
        }
      }
    }, 250)
  }, [])

  useEffect(() => { refresh() }, [refresh])

  // ── 現場自動清檯（sweep）編排 ──
  // 規則計算在 utils/opsSweep（純函式）、執行在 seatingService.executeSweepActions（前置重驗、冪等）。
  // 防重複：跨分頁 45 秒節流戳記 + 換日掃除每裝置每日 marker + action 前置條件重驗。
  const sweepActionMsg = (a) => {
    if (a.type === 'finalize-booking') return `${a.tableNumber} 用餐 ${a.minutes} 分未清桌，已自動釋出`
    if (a.type === 'checkout-group-table') return `團體桌 ${a.tableNumber} 用餐 ${a.minutes} 分，已自動「此梯離席」待清`
    if (a.type === 'clear-table') return `${a.tableNumber} ${a.reason === 'stale-day' ? '昨日殘留桌況' : '孤兒用餐狀態'}，已自動清為空桌`
    if (a.type === 'complete-booking') return `昨日訂位 ${a.bookingId} 已自動標記完成`
    if (a.type === 'complete-group') return `昨日已到店團體已自動整團結案`
    if (a.type === 'mark-noshow-auto') return `昨日未到訂位 ${a.bookingId} 已自動標記 No-show（不計罰則）`
    return a.type
  }

  const runSweeps = useCallback((opts = {}) => {
    if (!isStaffRef.current) return
    const nowMs = Date.now()
    const last = Number(localStorage.getItem('chicken_ops_sweep_at') || 0)
    if (!opts.force && nowMs - last < 45000) return // 跨分頁節流
    localStorage.setItem('chicken_ops_sweep_at', String(nowMs))

    const settings = settingsService.getSettings()
    const today = todayStr()
    const state = {
      tables: tableService.listAll(),
      bookings: bookingService.listAll(),
      groupReservations: groupReservationService.listAll(),
    }
    let doneCount = 0

    // 換日掃除：每裝置每日一次（跨午夜開著的分頁也會在 interval 中觸發）
    if (settings.dayRolloverEnabled !== false && localStorage.getItem('chicken_ops_day_sweep_v1') !== today) {
      const done = seatingService.executeSweepActions(
        computeDayRolloverActions({ ...state, settings, today }))
      localStorage.setItem('chicken_ops_day_sweep_v1', today)
      if (done.length) {
        done.forEach(a => opsLogService.append({ kind: 'day-rollover', ...a, message: sweepActionMsg(a) }))
        doneCount += done.length
        toastRef.current?.info?.(`🌅 換日掃除：已自動清理 ${done.length} 筆昨日殘留（詳見現場提示列）`)
      }
    }

    // 超時釋桌（預設 5 小時：高概率忘記按清桌）
    const done = seatingService.executeSweepActions(
      computeOvertimeActions({ tables: state.tables, settings, now: nowMs }))
    if (done.length) {
      done.forEach(a => opsLogService.append({ kind: 'auto-release', ...a, message: sweepActionMsg(a) }))
      doneCount += done.length
      const hrs = Math.round((Number(settings.autoReleaseAfterMin) || 300) / 6) / 10
      toastRef.current?.warning?.(`⏱ ${done.length} 桌用餐逾 ${hrs} 小時，已自動處理（疑似忘記清桌，詳見現場提示列）`)
    }

    if (doneCount) { refresh(); syncCloudSoon() }
  }, [refresh, syncCloudSoon])

  const runSweepsRef = useRef(runSweeps)
  runSweepsRef.current = runSweeps

  // 觸發點：(a) 首拉雲端成功後（避免用過期本機快照誤殺另一台裝置今天的桌）；
  // 本機模式（未設 Firebase）無此風險、20 秒 fallback 給離線情境；(b) 每 60 秒（先換日再超時）。
  const bootSweepDoneRef = useRef(false)
  useEffect(() => {
    if (!isStaff) return
    if (!bootSweepDoneRef.current && (cloudStatus.state === 'synced' || !usingFirebase)) {
      bootSweepDoneRef.current = true
      runSweepsRef.current({ force: true })
    }
  }, [isStaff, cloudStatus.state, usingFirebase])
  useEffect(() => {
    if (!isStaff) return
    const fallback = window.setTimeout(() => {
      if (!bootSweepDoneRef.current) {
        bootSweepDoneRef.current = true
        runSweepsRef.current({ force: true })
      }
    }, 20000)
    const id = window.setInterval(() => { runSweepsRef.current() }, 60000)
    return () => { window.clearTimeout(fallback); window.clearInterval(id) }
  }, [isStaff])

  useEffect(() => {
    // 客人端（未登入）不啟動全量同步：只用本機資料，避免他人個資外洩。
    if (!isStaff) {
      setCloudStatus({ state: 'idle', lastSyncAt: null, error: '' })
      return
    }
    let cancelled = false
    async function bootCloud() {
      setCloudStatus(s => ({ ...s, state: 'syncing' }))
      try {
        await cloudData.migrateLocalToCloudOnce()
      } catch (err) {
        console.warn('Firestore migration skipped:', err)
      }
      // 一次性把雲端舊桌號（A1–B19）換成「雞王座號圖」新桌號（101–267）。
      // 必須在 pullCloud 之前，否則首拉會用雲端舊桌位覆寫。
      try {
        await cloudData.migrateTableLayoutOnce()
      } catch (err) {
        console.warn('Table layout migration skipped:', err)
      }
      // 一次性把六人桌改成橫式（90×75）並對齊同列；只更新桌位幾何、保留運營狀態。
      // 同樣須在 pullCloud 之前（已推到雲端，首拉才不會用舊尺寸蓋回）。
      try {
        await cloudData.migrateTableDimsOnce()
      } catch (err) {
        console.warn('Table dims migration skipped:', err)
      }
      if (!cancelled) await pullCloud()
    }
    bootCloud()
    const id = window.setInterval(() => { pullCloud() }, 5000)
    // 分頁回前景 / 網路恢復時立即補抓，避免鎖屏或斷線造成的同步空窗。
    const onVisible = () => { if (document.visibilityState === 'visible') pullCloud() }
    const onOnline = () => { pullCloud() }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', onOnline)
    return () => {
      cancelled = true
      window.clearInterval(id)
      window.clearTimeout(syncTimerRef.current)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', onOnline)
    }
  }, [pullCloud, isStaff])

  useEffect(() => {
    const onStorage = (e) => {
      if (!e.key) return
      if (e.key.startsWith('chicken_')) refresh()
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [refresh])

  // ============ 訂位動作 ============
  const addBooking = (data) => {
    const b = bookingService.create(data)
    refresh()
    syncCloudSoon()
    safeNotify(() => tg.notifyBookingCreated(b))
    return b
  }
  const updateBooking = (id, patch) => {
    const b = bookingService.update(id, patch)
    refresh()
    syncCloudSoon()
    safeNotify(() => tg.notifyBookingUpdated(b, patch))
    return b
  }
  const cycleStatus = (id) => {
    const b = bookingService.cycleStatus(id)
    refresh()
    syncCloudSoon()
    return b
  }
  const setStatus = (id, status) => {
    const b = bookingService.setStatus(id, status)
    refresh()
    syncCloudSoon()
    if (b && status === 'noshow') safeNotify(() => tg.notifyBookingNoShow(b))
    return b
  }

  // ============ 桌位動作 ============
  // toggle/setOutage 帶兩層守門（佔用 + 團體圈桌衝突）：失敗回 { ok:false, error }，
  // 由 UI 顯示原因，不寫入也不同步。
  const toggleTable = (number) => { const r = seatingService.toggleTableGuarded(number); if (r?.ok) { refresh(); syncCloudSoon() } return r }
  const setTableOutage = (number, outage) => { const r = seatingService.setTableOutageGuarded(number, outage); if (r?.ok) { refresh(); syncCloudSoon() } return r }
  const clearTableOutage = (number) => { const r = tableService.clearOutage(number); if (r?.ok) { refresh(); syncCloudSoon() } return r }
  const setTableStatus = (number, status, extra = {}) => { tableService.setStatus(number, status, extra); refresh(); syncCloudSoon() }
  const blockTable = (number, reason) => { tableService.blockTable(number, reason); refresh(); syncCloudSoon() }
  const unblockTable = (number) => { tableService.unblockTable(number); refresh(); syncCloudSoon() }
  const updateTablePosition = (number, pos) => { tableService.updatePosition(number, pos); refresh(); syncCloudSoon() }
  const bulkSaveTables = (list) => { const r = seatingService.bulkSaveTablesGuarded(list); if (r?.ok) { refresh(); syncCloudSoon() } return r }
  const addTable = (data) => { const t = tableService.addTable(data); refresh(); syncCloudSoon(); return t }
  const removeTable = (number) => { const r = tableService.removeTable(number); refresh(); syncCloudSoon(); return r }
  const resetTables = () => { tableService.reset(); refresh(); syncCloudSoon() }

  // ============ 整合動作（含通知）============
  const assignBookingToTable = (bookingId, tableNumber) => {
    const r = seatingService.assignBookingToTable(bookingId, tableNumber)
    refresh()
    syncCloudSoon()
    if (r.ok) {
      const b = bookingService.getById(bookingId)
      if (b) safeNotify(() => tg.notifyBookingAssigned(b, tableNumber))
    }
    return r
  }
  // 散客大組多桌指派（併桌）：一筆 booking 佔多張桌（主桌 + extraTableIds）。
  const assignBookingTablesMulti = (bookingId, tableNumbers) => {
    const r = seatingService.assignBookingTablesMulti(bookingId, tableNumbers)
    refresh()
    syncCloudSoon()
    if (r.ok) {
      const b = bookingService.getById(bookingId)
      if (b) safeNotify(() => tg.notifyBookingAssigned(b, (r.tableNumbers || []).join(' + ')))
    }
    return r
  }
  const seatBooking = (bookingId) => {
    const r = seatingService.seatBooking(bookingId)
    refresh()
    syncCloudSoon()
    if (r.ok) {
      const b = bookingService.getById(bookingId)
      if (b) safeNotify(() => tg.notifyBookingArrived(b))
    }
    return r
  }
  // 「一鍵釋出」復原：把整組桌（含併桌的額外桌）重新入座
  const reseatBookingTables = (bookingId) => {
    const r = seatingService.reseatBookingTables(bookingId)
    if (r?.ok) { refresh(); syncCloudSoon() }
    return r
  }
  const checkoutBooking = (bookingId) => {
    // 取用餐分鐘需在 checkout 前計算（之後 seatedAt 會被清掉）
    const before = bookingService.getById(bookingId)
    const tbl = before?.assignedTableId ? tableService.getByNumber(before.assignedTableId) : null
    const min = minutesSeated(tbl)
    const r = seatingService.checkoutBooking(bookingId)
    refresh()
    syncCloudSoon()
    if (r.ok && before) safeNotify(() => tg.notifyBookingCompleted(before, min))
    return r
  }
  const finalizeBooking = (bookingId) => {
    const before = bookingService.getById(bookingId)
    const tbl = before?.assignedTableId ? tableService.getByNumber(before.assignedTableId) : null
    const min = minutesSeated(tbl)
    const r = seatingService.finalizeBooking(bookingId)
    refresh()
    syncCloudSoon()
    if (r.ok && before) safeNotify(() => tg.notifyBookingCompleted(before, min))
    return r
  }
  const clearTable = (number) => { seatingService.clearTable(number); refresh(); syncCloudSoon() }
  const cancelBooking = (bookingId) => {
    const before = bookingService.getById(bookingId)
    const r = seatingService.cancelBooking(bookingId)
    refresh()
    syncCloudSoon()
    if (r.ok && before) safeNotify(() => tg.notifyBookingCancelled(before))
    return r
  }
  const walkInSeat = (tableNumber, guestData) => {
    const r = seatingService.walkInSeat(tableNumber, guestData)
    refresh()
    syncCloudSoon()
    if (r.ok) safeNotify(() => tg.notifyWalkInSeated(r.booking))
    return r
  }
  // 大組多桌入座（併桌）：一筆 booking 佔多張桌。
  const walkInSeatMulti = (tableNumbers, guestData) => {
    const r = seatingService.walkInSeatMulti(tableNumbers, guestData)
    refresh()
    syncCloudSoon()
    if (r.ok) safeNotify(() => tg.notifyWalkInSeated(r.booking))
    return r
  }
  const moveTable = (bookingId, newTableNumber) => {
    const before = bookingService.getById(bookingId)
    const fromTable = before?.assignedTableId
    const r = seatingService.moveTable(bookingId, newTableNumber)
    refresh()
    syncCloudSoon()
    if (r.ok && before) {
      const after = bookingService.getById(bookingId)
      safeNotify(() => tg.notifyTableMoved(after, fromTable, newTableNumber))
    }
    return r
  }
  const findSuitableTables = (partySize) => seatingService.findSuitableTables(partySize)
  const suggestTable = (partySize) => seatingService.suggestTable(partySize)
  const suggestTableCombo = (partySize) => seatingService.suggestTableCombo(partySize)

  // 統一座位地圖的「預先配桌」：僅在 booking 上記錄 assignedTableId（per-date），
  // ★ 不更動 live tables（currentBookingId/status），故未來日期預排不會誤佔今日現場桌況。
  // 到店當天仍走現場「指派桌」流程把實體桌設為 reserved/dining。
  const preassignBookingTable = (bookingId, tableNumber) => { const b = bookingService.assignTable(bookingId, tableNumber); refresh(); syncCloudSoon(); return b }
  // 大組併桌的預先配桌：主桌 + 額外桌一起記在 booking（同樣不動 live tables）。
  const preassignBookingTables = (bookingId, tableNumbers) => { const b = bookingService.assignTables(bookingId, tableNumbers); refresh(); syncCloudSoon(); return b }
  const clearBookingPreassign = (bookingId) => { const b = bookingService.unassignTable(bookingId); refresh(); syncCloudSoon(); return b }

  // ============ 候位動作 ============
  const addWaitlist = (data) => {
    const w = waitlistService.create(data)
    if (w.phone) customerService.upsert({ phone: w.phone, name: w.name, partySize: w.partySize, source: 'walk-in' })
    refresh()
    syncCloudSoon()
    safeNotify(() => tg.notifyWaitlistCreated(w))
    return w
  }
  const callWaitlist = (id) => { waitlistService.call(id); refresh(); syncCloudSoon() }
  const seatWaitlist = (id, tableNumber) => {
    const before = waitlistService.getById(id)
    const r = seatingService.seatWaitlist(id, tableNumber)
    refresh()
    syncCloudSoon()
    if (r.ok && before) safeNotify(() => tg.notifyWaitlistSeated(before, tableNumber))
    return r
  }
  const leaveWaitlist = (id) => { waitlistService.leave(id); refresh(); syncCloudSoon() }

  // ============ 顧客動作（不發 TG，太瑣碎）============
  const updateCustomer = (phone, patch) => { customerService.update(phone, patch); refresh(); syncCloudSoon() }
  const setCustomerBlacklist = (phone, value, reason) => { customerService.setBlacklist(phone, value, reason); refresh(); syncCloudSoon() }
  const setCustomerVip = (phone, tier) => { customerService.setVipTier(phone, tier); refresh(); syncCloudSoon() }

  // ============ 設定 ============
  const updateSettings = (patch) => {
    const s = settingsService.saveSettings(patch)
    setSettings(s)
    syncCloudSoon()
    return s
  }

  // ============ 旅行社 / 導遊 名冊 ============
  const addAgency = (data) => { const a = agencyService.create(data); refresh(); syncCloudSoon(); return a }
  const updateAgency = (id, patch) => { const a = agencyService.update(id, patch); refresh(); syncCloudSoon(); return a }
  const archiveAgency = (id) => { agencyService.archive(id); refresh(); syncCloudSoon() }
  const addGuide = (data) => { const g = guideService.create(data); refresh(); syncCloudSoon(); return g }
  const updateGuide = (id, patch) => { const g = guideService.update(id, patch); refresh(); syncCloudSoon(); return g }
  const archiveGuide = (id) => { guideService.archive(id); refresh(); syncCloudSoon() }

  // ============ 團體預排單 ============
  const addGroupReservation = (data) => { const g = groupReservationService.create(data); refresh(); syncCloudSoon(); return g }
  const updateGroupReservation = (id, patch) => { const g = groupReservationService.update(id, patch); refresh(); syncCloudSoon(); return g }
  const setGroupStatus = (id, status) => { const g = groupReservationService.setStatus(id, status); refresh(); syncCloudSoon(); return g }
  const removeGroupReservation = (id) => { groupReservationService.remove(id); refresh(); syncCloudSoon() }

  // 一次性清除既有殘留空白團單（草稿優先改版前的舊資料）。本機刪除→syncCloudSoon 走泛型刪除同步雲端。
  const purgeBlankGroups = () => {
    const n = groupReservationService.purgeBlankGroups()
    if (n) { refresh(); syncCloudSoon() }
    return n
  }

  // 草稿優先：新團單在「填好按儲存」當下才落地。先本機 create() 鑄 id，線上再走交易原子把關。
  // 409（桌位衝突）撤銷剛建立的本機記錄（無前快照可回滾）、不 syncCloudSoon，將錯誤丟給 UI。
  const createAndReserveGroup = async (data) => {
    const saved = groupReservationService.create(data)
    refresh()
    if (usingFirebase && isStaffRef.current && saved) {
      try {
        const r = await cloudData.groupReserveTables(saved)
        if (r?.group) { groupReservationService.update(saved.id, r.group); refresh() }
      } catch (err) {
        if (err?.status === 409) {
          groupReservationService.remove(saved.id)
          refresh()
          throw err
        }
        // 其他錯誤（離線/暫時性）：保留本機、照常排程同步
      }
    }
    syncCloudSoon()
    return saved
  }

  // 圈桌存檔：先寫本機讓 UI 立即反映；線上時呼叫 groupReserveTables 交易做多裝置原子把關。
  // 真衝突（409）丟給 UI 顯示；離線等其他錯誤已存本機、照常排程同步、不阻斷。
  const reserveGroupTables = async (id, patch) => {
    const before = groupReservationService.getById(id) // 衝突時回滾用的送出前快照
    const saved = groupReservationService.update(id, patch)
    refresh()
    if (usingFirebase && isStaffRef.current && saved) {
      try {
        const r = await cloudData.groupReserveTables(saved)
        if (r?.group) { groupReservationService.update(id, r.group); refresh() }
      } catch (err) {
        if (err?.status === 409) {
          // 桌位衝突：回滾本機到送出前狀態，且「不」syncCloudSoon，
          // 避免衝突中的圈桌資料被後續一般差異同步送上雲端。
          if (before) groupReservationService.update(id, before)
          refresh()
          throw err
        }
        // 其他錯誤（離線/暫時性）：保留本機變更，照常排程同步
      }
    }
    syncCloudSoon()
    return saved
  }

  // 團體梯次入座流程（含通知略過：團體現場操作頻繁，暫不發 TG）
  const seatGroupBatch = (groupId, batchId) => { const r = seatingService.seatGroupBatch(groupId, batchId); refresh(); syncCloudSoon(); return r }
  const checkoutGroupBatch = (groupId, batchId) => { const r = seatingService.checkoutGroupBatch(groupId, batchId); refresh(); syncCloudSoon(); return r }
  const releaseGroupBatch = (groupId, batchId) => { const r = seatingService.releaseGroupBatch(groupId, batchId); refresh(); syncCloudSoon(); return r }
  const seatNextBatchOnTable = (tableNumber, groupId, batchId) => { const r = seatingService.seatNextBatchOnTable(tableNumber, groupId, batchId); refresh(); syncCloudSoon(); return r }
  const finalizeGroup = (groupId) => { const r = seatingService.finalizeGroup(groupId); refresh(); syncCloudSoon(); return r }
  const reseatGroupBatchTable = (groupId, batchId, fromTable, toTable) => { const r = seatingService.reseatGroupBatchTable(groupId, batchId, fromTable, toTable); refresh(); syncCloudSoon(); return r }
  const cancelGroup = (groupId) => { const r = seatingService.cancelGroup(groupId); refresh(); syncCloudSoon(); return r }

  const migrateLocalToCloud = async () => {
    setCloudStatus(s => ({ ...s, state: 'syncing' }))
    const result = await cloudData.pushCloudData()
    cloudData.markLocalAsSynced()
    setCloudStatus({ state: 'synced', lastSyncAt: new Date().toISOString(), error: '' })
    return result
  }

  const value = {
    bookings, tables, waitlist, customers, settings, cloudStatus,
    agencies, guides, groupReservations,
    refresh, pullCloud, migrateLocalToCloud,
    addBooking, updateBooking, cycleStatus, setStatus,
    toggleTable, setTableOutage, clearTableOutage, setTableStatus, blockTable, unblockTable, updateTablePosition,
    bulkSaveTables, addTable, removeTable, resetTables,
    assignBookingToTable, assignBookingTablesMulti, seatBooking, reseatBookingTables, checkoutBooking, finalizeBooking, clearTable, cancelBooking, walkInSeat, walkInSeatMulti, moveTable, findSuitableTables, suggestTable, suggestTableCombo,
    preassignBookingTable, preassignBookingTables, clearBookingPreassign,
    addWaitlist, callWaitlist, seatWaitlist, leaveWaitlist,
    updateCustomer, setCustomerBlacklist, setCustomerVip,
    addAgency, updateAgency, archiveAgency, addGuide, updateGuide, archiveGuide,
    addGroupReservation, updateGroupReservation, setGroupStatus, removeGroupReservation, reserveGroupTables,
    createAndReserveGroup, purgeBlankGroups,
    seatGroupBatch, checkoutGroupBatch, releaseGroupBatch, seatNextBatchOnTable, finalizeGroup, cancelGroup, reseatGroupBatchTable,
    updateSettings,
  }

  return <BookingContext.Provider value={value}>{children}</BookingContext.Provider>
}

export const useBooking = () => useContext(BookingContext)
