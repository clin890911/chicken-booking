import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import * as bookingService from '../services/bookingService'
import * as tableService from '../services/tableService'
import * as settingsService from '../services/settingsService'

const BookingContext = createContext(null)

export function BookingProvider({ children }) {
  const [bookings, setBookings] = useState([])
  const [tables, setTables] = useState([])
  const [settings, setSettings] = useState(settingsService.getSettings())

  const refresh = useCallback(() => {
    setBookings(bookingService.listAll())
    setTables(tableService.listAll())
    setSettings(settingsService.getSettings())
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const addBooking = (data) => {
    const b = bookingService.create(data)
    refresh()
    return b
  }

  const updateBooking = (id, patch) => {
    const b = bookingService.update(id, patch)
    refresh()
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
    return b
  }

  const toggleTable = (number) => {
    tableService.toggle(number)
    refresh()
  }

  const updateSettings = (patch) => {
    const s = settingsService.saveSettings(patch)
    setSettings(s)
    return s
  }

  return (
    <BookingContext.Provider value={{
      bookings, tables, settings,
      refresh, addBooking, updateBooking, cycleStatus, setStatus, toggleTable, updateSettings
    }}>
      {children}
    </BookingContext.Provider>
  )
}

export const useBooking = () => useContext(BookingContext)
