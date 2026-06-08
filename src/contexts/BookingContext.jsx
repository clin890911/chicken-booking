import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react'
import * as bookingService from '../services/bookingService'
import * as tableService from '../services/tableService'
import * as settingsService from '../services/settingsService'
import * as waitlistService from '../services/waitlistService'
import * as customerService from '../services/customerService'
import * as seatingService from '../services/seatingService'
import * as tg from '../services/telegramService'
import * as cloudData from '../services/cloudDataService'
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
  const { user, getToken } = useAuth() || {}
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
  const toggleTable = (number) => { tableService.toggle(number); refresh(); syncCloudSoon() }
  const setTableStatus = (number, status, extra = {}) => { tableService.setStatus(number, status, extra); refresh(); syncCloudSoon() }
  const blockTable = (number, reason) => { tableService.blockTable(number, reason); refresh(); syncCloudSoon() }
  const unblockTable = (number) => { tableService.unblockTable(number); refresh(); syncCloudSoon() }
  const mergeTables = (a, b) => { const r = tableService.mergeTables(a, b); refresh(); syncCloudSoon(); return r }
  const unmergeTable = (number) => { tableService.unmergeTable(number); refresh(); syncCloudSoon() }
  const updateTablePosition = (number, pos) => { tableService.updatePosition(number, pos); refresh(); syncCloudSoon() }
  const bulkSaveTables = (list) => { tableService.bulkWrite(list); refresh(); syncCloudSoon() }
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

  const migrateLocalToCloud = async () => {
    setCloudStatus(s => ({ ...s, state: 'syncing' }))
    const result = await cloudData.pushCloudData()
    cloudData.markLocalAsSynced()
    setCloudStatus({ state: 'synced', lastSyncAt: new Date().toISOString(), error: '' })
    return result
  }

  const value = {
    bookings, tables, waitlist, customers, settings, cloudStatus,
    refresh, pullCloud, migrateLocalToCloud,
    addBooking, updateBooking, cycleStatus, setStatus,
    toggleTable, setTableStatus, blockTable, unblockTable, mergeTables, unmergeTable, updateTablePosition,
    bulkSaveTables, addTable, removeTable, resetTables,
    assignBookingToTable, seatBooking, checkoutBooking, finalizeBooking, clearTable, cancelBooking, walkInSeat, moveTable, findSuitableTables, suggestTable,
    addWaitlist, callWaitlist, seatWaitlist, leaveWaitlist,
    updateCustomer, setCustomerBlacklist, setCustomerVip,
    updateSettings,
  }

  return <BookingContext.Provider value={value}>{children}</BookingContext.Provider>
}

export const useBooking = () => useContext(BookingContext)
