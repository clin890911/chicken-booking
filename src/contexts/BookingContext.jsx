import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import * as bookingService from '../services/bookingService'
import * as tableService from '../services/tableService'
import * as settingsService from '../services/settingsService'
import * as waitlistService from '../services/waitlistService'
import * as customerService from '../services/customerService'
import * as seatingService from '../services/seatingService'
import * as tg from '../services/telegramService'

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
  const [bookings, setBookings] = useState([])
  const [tables, setTables] = useState([])
  const [waitlist, setWaitlist] = useState([])
  const [customers, setCustomers] = useState([])
  const [settings, setSettings] = useState(settingsService.getSettings())

  const refresh = useCallback(() => {
    setBookings(bookingService.listAll())
    setTables(tableService.listAll())
    setWaitlist(waitlistService.listAll())
    setCustomers(customerService.listAll())
    setSettings(settingsService.getSettings())
  }, [])

  useEffect(() => { refresh() }, [refresh])

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
    safeNotify(() => tg.notifyBookingCreated(b))
    return b
  }
  const updateBooking = (id, patch) => {
    const b = bookingService.update(id, patch)
    refresh()
    safeNotify(() => tg.notifyBookingUpdated(b, patch))
    return b
  }
  const cycleStatus = (id) => {
    const b = bookingService.cycleStatus(id)
    refresh()
    return b
  }
  const setStatus = (id, status) => {
    const b = bookingService.setStatus(id, status)
    refresh()
    if (b && status === 'noshow') safeNotify(() => tg.notifyBookingNoShow(b))
    return b
  }

  // ============ 桌位動作 ============
  const toggleTable = (number) => { tableService.toggle(number); refresh() }
  const setTableStatus = (number, status, extra = {}) => { tableService.setStatus(number, status, extra); refresh() }
  const blockTable = (number, reason) => { tableService.blockTable(number, reason); refresh() }
  const unblockTable = (number) => { tableService.unblockTable(number); refresh() }
  const mergeTables = (a, b) => { const r = tableService.mergeTables(a, b); refresh(); return r }
  const unmergeTable = (number) => { tableService.unmergeTable(number); refresh() }
  const updateTablePosition = (number, pos) => { tableService.updatePosition(number, pos); refresh() }
  const bulkSaveTables = (list) => { tableService.bulkWrite(list); refresh() }
  const addTable = (data) => { const t = tableService.addTable(data); refresh(); return t }
  const removeTable = (number) => { const r = tableService.removeTable(number); refresh(); return r }
  const resetTables = () => { tableService.reset(); refresh() }

  // ============ 整合動作（含通知）============
  const assignBookingToTable = (bookingId, tableNumber) => {
    const r = seatingService.assignBookingToTable(bookingId, tableNumber)
    refresh()
    if (r.ok) {
      const b = bookingService.getById(bookingId)
      if (b) safeNotify(() => tg.notifyBookingAssigned(b, tableNumber))
    }
    return r
  }
  const seatBooking = (bookingId) => {
    const r = seatingService.seatBooking(bookingId)
    refresh()
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
    if (r.ok && before) safeNotify(() => tg.notifyBookingCompleted(before, min))
    return r
  }
  const finalizeBooking = (bookingId) => {
    const before = bookingService.getById(bookingId)
    const tbl = before?.assignedTableId ? tableService.getByNumber(before.assignedTableId) : null
    const min = minutesSeated(tbl)
    const r = seatingService.finalizeBooking(bookingId)
    refresh()
    if (r.ok && before) safeNotify(() => tg.notifyBookingCompleted(before, min))
    return r
  }
  const clearTable = (number) => { seatingService.clearTable(number); refresh() }
  const cancelBooking = (bookingId) => {
    const before = bookingService.getById(bookingId)
    const r = seatingService.cancelBooking(bookingId)
    refresh()
    if (r.ok && before) safeNotify(() => tg.notifyBookingCancelled(before))
    return r
  }
  const walkInSeat = (tableNumber, guestData) => {
    const r = seatingService.walkInSeat(tableNumber, guestData)
    refresh()
    if (r.ok) safeNotify(() => tg.notifyWalkInSeated(r.booking))
    return r
  }
  const moveTable = (bookingId, newTableNumber) => {
    const before = bookingService.getById(bookingId)
    const fromTable = before?.assignedTableId
    const r = seatingService.moveTable(bookingId, newTableNumber)
    refresh()
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
    safeNotify(() => tg.notifyWaitlistCreated(w))
    return w
  }
  const callWaitlist = (id) => { waitlistService.call(id); refresh() }
  const seatWaitlist = (id, tableNumber) => {
    const before = waitlistService.getById(id)
    const r = seatingService.seatWaitlist(id, tableNumber)
    refresh()
    if (r.ok && before) safeNotify(() => tg.notifyWaitlistSeated(before, tableNumber))
    return r
  }
  const leaveWaitlist = (id) => { waitlistService.leave(id); refresh() }

  // ============ 顧客動作（不發 TG，太瑣碎）============
  const updateCustomer = (phone, patch) => { customerService.update(phone, patch); refresh() }
  const setCustomerBlacklist = (phone, value, reason) => { customerService.setBlacklist(phone, value, reason); refresh() }
  const setCustomerVip = (phone, tier) => { customerService.setVipTier(phone, tier); refresh() }

  // ============ 設定 ============
  const updateSettings = (patch) => {
    const s = settingsService.saveSettings(patch)
    setSettings(s)
    return s
  }

  const value = {
    bookings, tables, waitlist, customers, settings,
    refresh,
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
